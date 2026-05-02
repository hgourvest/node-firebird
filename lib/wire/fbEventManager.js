// FbEventManager – Firebird POST_EVENT subscription manager
//
// State machine overview
// ──────────────────────
//
//  ┌──────────────────────────────────────────────────────────────────────┐
//  │                      FbEventManager states                           │
//  └──────────────────────────────────────────────────────────────────────┘
//
//   attachEvent()
//       │
//       ▼
//   ┌─────────────────────────────────────────────────────────┐
//   │ IDLE                                                    │
//   │  _hasActiveSubscription = false                         │
//   │  events = {}                                            │
//   │  eventcallback = loop fn (set but subscription absent)  │
//   └──────────────┬────────────────────────────┬────────────┘
//                  │ registerEvent([...])        │ close()
//                  ▼                             ▼
//   ┌──────────────────────────┐    ┌───────────────────────┐
//   │ SUBSCRIBING              │    │ CLOSING               │
//   │  queEvents() sent        │    │  endAndWaitForClose()  │
//   │  waiting for op_response │    │  sock.end() + wait     │
//   └──────────┬───────────────┘    └───────────┬───────────┘
//              │ op_response ok                  │ 'close' event
//              ▼                                 ▼
//   ┌──────────────────────────┐    ┌───────────────────────┐
//   │ SUBSCRIBED               │    │ CLOSED / DONE         │
//   │  _hasActiveSubscription  │    │  eventconnection gone  │
//   │  = true                  │    └───────────────────────┘
//   │  eventcallback active    │
//   └───┬───────────┬──────────┘
//       │           │
//       │ op_event  │ unregisterEvent() (all removed) or close()
//       │ received  │
//       │           ▼
//       │  ┌──────────────────────────────────────────────────┐
//       │  │ CANCELLING                                       │
//       │  │  closeEvents() sent (op_cancel_events)           │
//       │  │  waiting for op_response                         │
//       │  └──────────┬───────────────────────────────────────┘
//       │             │ op_response ok
//       │             ▼
//       │  ┌──────────────────────────────────────────────────┐
//       │  │ IDLE  (or CLOSING if called from close())        │
//       │  └──────────────────────────────────────────────────┘
//       │
//       │ emit('post_event', name, count)
//       └──────────────────────┐
//                              ▼
//                  loop() → SUBSCRIBING (re-subscribe)
//
// Wire-protocol messages on the MAIN connection
// ──────────────────────────────────────────────
//   Client → Server : op_connect_request   (attachEvent / auxConnection)
//   Server → Client : op_response          (socket address of AUX port)
//   Client → Server : op_que_events        (registerEvent / loop)
//   Server → Client : op_response          (confirms event ID)
//   Client → Server : op_cancel_events     (unregisterEvent / close)
//   Server → Client : op_response
//
// Asynchronous notifications on the AUX (EventConnection) socket
// ───────────────────────────────────────────────────────────────
//   Server → Client : op_event  (fired by Firebird POST_EVENT trigger)

const Events = require('events');
const { doError } = require('../callback');

class FbEventManager extends Events.EventEmitter {
    constructor(db, eventconnection, eventid, callback) {
        super();
        this.db = db;
        this.eventconnection = eventconnection;
        this.events = {};
        this.eventid = eventid;
        // True when an op_que_events subscription is currently active on the
        // main connection (so close() and _changeEvent know whether to send
        // op_cancel_events before tearing down or re-subscribing).
        this._hasActiveSubscription = false;
        this._createEventLoop(callback);
    }

    /**
     * Returns a snapshot of the current state for debugging.
     * Useful for tracing the state machine during development.
     *
     * Stable states: 'IDLE', 'SUBSCRIBED', 'CLOSED'.
     * Transient states (SUBSCRIBING, CANCELLING, CLOSING) occur while waiting
     * for op_response on the main connection or for the socket to close; they
     * are not tracked with dedicated flags to keep the implementation simple,
     * but they can be inferred: if the socket is open and _hasActiveSubscription
     * disagrees with what the caller expects, a transitional operation is in
     * progress.
     *
     * @returns {{
     *   state: string,
     *   hasActiveSubscription: boolean,
     *   registeredEvents: Object,
     *   eventId: number,
     *   isEventConnectionOpen: boolean,
     *   isDatabaseConnectionClosed: boolean
     * }}
     */
    getState() {
        const evtConnOpen = this.eventconnection
            ? !this.eventconnection._isClosed
            : false;
        const dbConnClosed = this.db.connection
            ? this.db.connection._isClosed
            : true;

        // Derive a human-readable stable-state label.
        // Transitional states (SUBSCRIBING / CANCELLING / CLOSING) are not
        // individually flagged; callers that need finer granularity can
        // inspect hasActiveSubscription and isEventConnectionOpen together.
        let state;
        if (dbConnClosed || !evtConnOpen) {
            state = 'CLOSED';
        } else if (this._hasActiveSubscription) {
            state = 'SUBSCRIBED';
        } else {
            state = 'IDLE';
        }

        return {
            state,
            hasActiveSubscription: this._hasActiveSubscription,
            registeredEvents: Object.assign({}, this.events),
            eventId: this.eventid,
            isEventConnectionOpen: evtConnOpen,
            isDatabaseConnectionClosed: dbConnClosed,
        };
    }

    _createEventLoop(callback) {
        var self = this;
        var cnx = this.db.connection;
        this.eventconnection.emgr = this;

        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] FbEventManager._createEventLoop: eventid=%d', self.eventid);
        }

        // Re-subscribe after each op_event notification so that further
        // trigger fires continue to be delivered.
        function loop() {
            // Guard: do not send queEvents if the subscription has been
            // cancelled (e.g. via unregisterEvent removing all events) or if
            // there are no registered events.  Without this check, a late
            // op_event arriving on the event connection after closeEvents can
            // trigger queEvents({}) which Firebird never acknowledges,
            // permanently blocking the main connection queue.
            if (!self._hasActiveSubscription || Object.keys(self.events).length === 0) {
                return;
            }
            cnx.queEvents(self.events, self.eventid, function (err) {
                if (err) {
                    doError(err, callback);
                    return;
                }
                // subscription renewed, nothing else to do
            });
        }

        this.eventconnection.eventcallback = function (err, ret) {
            if (err || (self.eventid !== ret.eventid)) {
                doError(err || new Error('Bad eventid'), callback);
                return;
            }

            ret.events.forEach(function (event) {
                self.emit('post_event', event.name, event.count);
            });

            loop();
        };

        // Resolve attachEvent on the next tick – no subscription is needed
        // until the caller registers at least one event name via registerEvent().
        // process.nextTick ensures the outer `const evt = new FbEventManager(...)`
        // assignment in database.js completes before this callback fires.
        process.nextTick(function() { callback(null); });
    }

    _changeEvent(callback) {
        var self = this;

        // Temporarily suppress the event loop to prevent stale op_event
        // notifications from pushing spurious queEvents onto the main
        // connection queue while we're reconfiguring the subscription.
        var savedCallback = self.eventconnection.eventcallback;
        self.eventconnection.eventcallback = null;

        function subscribe() {
            // If no events remain, mark subscription as inactive and return.
            // Sending queEvents with an empty EPB after op_cancel_events does
            // not receive op_response from some Firebird versions, which would
            // permanently block the main connection queue.
            if (Object.keys(self.events).length === 0) {
                self._hasActiveSubscription = false;
                self.eventconnection.eventcallback = savedCallback;
                callback(null);
                return;
            }

            self.db.connection.queEvents(self.events, self.eventid, function (err, ret) {
                self.eventconnection.eventcallback = savedCallback;
                if (err) {
                    doError(err, callback);
                    return;
                }
                self._hasActiveSubscription = true;
                callback(null, ret);
            });
        }

        if (self._hasActiveSubscription) {
            // Cancel the current subscription before setting up a new one.
            self.db.connection.closeEvents(this.eventid, function (err) {
                if (err) {
                    self.eventconnection.eventcallback = savedCallback;
                    doError(err, callback);
                    return;
                }
                self._hasActiveSubscription = false;
                subscribe();
            });
        } else {
            // No active subscription yet (first registerEvent call, or after
            // all events were unregistered) – go straight to subscribing.
            subscribe();
        }
    }

    registerEvent(events, callback) {
        var self = this;

        if (self.db.connection._isClosed || self.eventconnection._isClosed)
            return self.eventconnection.throwClosed(callback);

        events.forEach((event) => self.events[event] = self.events[event] || 0);
        self._changeEvent(callback);
    }

    unregisterEvent(events, callback) {
        var self = this;

        if (self.db.connection._isClosed || self.eventconnection._isClosed)
            return self.eventconnection.throwClosed(callback);

        events.forEach(function (event) { delete self.events[event] });
        self._changeEvent(callback);
    }

    close(callback) {
        var self = this;

        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] FbEventManager.close() called, _hasActiveSubscription=%s eventid=%d', self._hasActiveSubscription, self.eventid);
        }

        // Prevent the event loop from re-queuing on stale op_event notifications
        // that may arrive between closeEvents and socket.end()
        self.eventconnection.eventcallback = null;

        // Gracefully close the event socket using a FIN (end()) rather than a RST
        // (destroy()), then wait for the 'close' event which confirms both sides have
        // exchanged FINs.  This gives Firebird (all versions 3/4/5) time to fully
        // process the previous event connection's teardown before the next
        // op_connect_request or op_que_events arrives on the main connection.
        // destroy() (RST) is faster but causes Firebird 3 to get confused on subsequent
        // queEvents calls – the server internally fails on the RST error and does not
        // clean up its event state in time for the next subscription request.
        // A 200 ms safety timer fires as a fallback if Firebird never sends its FIN.
        function endAndWaitForClose(cb) {
            var sock = self.eventconnection && self.eventconnection._socket;
            if (!sock || sock.destroyed) {
                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] endAndWaitForClose: socket already destroyed, calling back immediately');
                }
                if (cb) cb();
                return;
            }
            var fired = false;
            var timer;
            function done(source) {
                if (!fired) {
                    fired = true;
                    clearTimeout(timer);
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] endAndWaitForClose done() via %s, eventid=%d', source, self.eventid);
                    }
                    if (cb) cb();
                }
            }
            sock.once('close', function() { done('close-event'); });
            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] endAndWaitForClose: calling sock.end(), eventid=%d sock.destroyed=%s', self.eventid, sock.destroyed);
            }
            sock.end();
            // Safety fallback: if Firebird never sends its FIN (e.g. an error
            // occurs on the server side), resolve after 200 ms so tests don't hang.
            timer = setTimeout(function() { done('200ms-timer'); }, 200);
        }

        if (!self._hasActiveSubscription) {
            // No active subscription (attachEvent without registerEvent, or
            // all events were unregistered) – nothing to cancel.
            endAndWaitForClose(callback);
            return;
        }

        self.db.connection.closeEvents(this.eventid, function (err) {
            if (err) {
                doError(err, callback);
                return;
            }

            self._hasActiveSubscription = false;
            endAndWaitForClose(callback);
        });
    }
}

module.exports = FbEventManager;
