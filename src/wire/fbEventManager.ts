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
//       │ eventBaseline: first op_event → emit('baseline', counts)
//       │ otherwise → emit('post_event', name, count)
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
//   Error / unexpected close → CLOSED; emit manager 'error' once

import Events from 'events';
import { doError } from '../callback';

class FbEventManager extends Events.EventEmitter {
    db: any;
    eventconnection: any;
    events: Record<string, number>;
    eventid: number;
    _subscriptionVersion: number;
    _activeSubscriptionVersion: number;
    _hasActiveSubscription: boolean;
    _baselinePending: boolean;
    _eventBaseline: boolean;
    _baselineChangeInProgress: boolean;
    _baselineCallbacks: Array<(err: any, ret?: any) => void>;
    _hasQueuedBaseline: boolean;
    _retiredEventIds: Set<number>;
    _baselineCloseRequested: boolean;
    _baselineCloseCallbacks: Array<(err?: any) => void>;
    _readySettled: boolean;
    _terminalErrorReported: boolean;
    _readyCallback: (err: any, ret?: any) => void;

    constructor(db: any, eventconnection: any, eventid: number, callback: (err: any, ret?: any) => void) {
        super();
        this.db = db;
        this.eventconnection = eventconnection;
        this.events = {};
        this.eventid = eventid;
        // Guards _hasActiveSubscription against late callbacks from an older
        // register/unregister cycle after a newer subscription change started.
        this._subscriptionVersion = 0;
        this._activeSubscriptionVersion = 0;
        // True when an op_que_events subscription is currently active on the
        // main connection (so close() and _changeEvent know whether to send
        // op_cancel_events before tearing down or re-subscribing).
        this._hasActiveSubscription = false;
        this._baselinePending = false;
        this._eventBaseline = db.connection.options?.eventBaseline === true;
        this._baselineChangeInProgress = false;
        this._baselineCallbacks = [];
        this._hasQueuedBaseline = false;
        this._retiredEventIds = new Set();
        this._baselineCloseRequested = false;
        this._baselineCloseCallbacks = [];
        this._readySettled = false;
        this._terminalErrorReported = false;
        this._readyCallback = callback;
        this._createEventLoop();
        process.nextTick(() => this._finishReady());
    }

    on(event: 'baseline', listener: (counts: Readonly<Record<string, number>>) => void): this;
    on(event: 'post_event', listener: (name: string, count: number) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    once(event: 'baseline', listener: (counts: Readonly<Record<string, number>>) => void): this;
    once(event: 'post_event', listener: (name: string, count: number) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    _finishReady(err?: Error): void {
        if (this._readySettled) return;
        this._readySettled = true;
        if (err) doError(err, this._readyCallback);
        else this._readyCallback(null);
    }

    _handleAsyncError(err: any): void {
        if (this._terminalErrorReported) return;
        this._terminalErrorReported = true;
        const error = err instanceof Error ? err : new Error(String(err));
        this._hasActiveSubscription = false;
        this._baselinePending = false;
        this._subscriptionVersion++;
        this.eventconnection._isClosed = true;
        this.eventconnection._isOpened = false;
        this.eventconnection.eventcallback = null;
        if (this.eventconnection._socket && !this.eventconnection._socket.destroyed &&
            typeof this.eventconnection._socket.destroy === 'function') {
            this.eventconnection._socket.destroy();
        }

        if (!this._readySettled) {
            this._finishReady(error);
        } else if (this.listenerCount('error') > 0) {
            this.emit('error', error);
        } else if (this.db.connection && typeof this.db.connection._emitError === 'function') {
            this.db.connection._emitError(error);
        }
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
    getState(): { state: string; hasActiveSubscription: boolean; registeredEvents: Record<string, number>; eventId: number; isEventConnectionOpen: boolean; isDatabaseConnectionClosed: boolean } {
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
        let state: string;
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

    _createEventLoop(): void {
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
            if (!self._hasActiveSubscription || Object.keys(self.events).length === 0 ||
                (self._eventBaseline && self._activeSubscriptionVersion !== self._subscriptionVersion)) {
                return;
            }
            const eventId = self.eventid;
            cnx.queEvents(self.events, eventId, function (err: any) {
                if (err && (!self._eventBaseline || !self._retiredEventIds.has(eventId))) {
                    self._handleAsyncError(err);
                    return;
                }
                // subscription renewed, nothing else to do
            });
        }

        this.eventconnection.eventcallback = function (err: any, ret?: any) {
            if (err || !ret) {
                self._handleAsyncError(err || new Error('Missing event packet'));
                return;
            }
            if (self.eventid !== ret.eventid) {
                if (self._eventBaseline && self._retiredEventIds.has(ret.eventid)) return;
                self._handleAsyncError(new Error('Bad eventid'));
                return;
            }

            if (self._eventBaseline &&
                (self._baselineCloseRequested || !self._hasActiveSubscription ||
                self._activeSubscriptionVersion !== self._subscriptionVersion ||
                Object.keys(ret.counts).some(name =>
                    !Object.prototype.hasOwnProperty.call(self.events, name)))) {
                // Ignore a packet from a cancelled subscription (including
                // one carrying an event that has since been unregistered).
                return;
            }

            if (self._eventBaseline) {
                for (const [name, count] of Object.entries(ret.counts as Record<string, number>)) {
                    self.events[name] = count;
                }
            }

            if (self._eventBaseline && self._baselinePending && self._hasActiveSubscription) {
                self._baselinePending = false;
                // Give callers their own snapshot, never the mutable
                // subscription object.
                self.emit('baseline', Object.freeze({ ...self.events }));
            } else {
                ret.events.forEach(function (event: { name: string; count: number }) {
                    self.emit('post_event', event.name, event.count);
                });
            }

            loop();
        };

    }

    _changeEvent(callback: (err: any, ret?: any) => void): void {
        if (this._eventBaseline) {
            this._changeEventWithBaseline(callback);
            return;
        }
        var self = this;
        const changeVersion = ++self._subscriptionVersion;

        function subscribe() {
            // If no events remain, mark subscription as inactive and return.
            // Sending queEvents with an empty EPB after op_cancel_events does
            // not receive op_response from some Firebird versions, which would
            // permanently block the main connection queue.
            if (Object.keys(self.events).length === 0) {
                self._hasActiveSubscription = false;
                self._baselinePending = false;
                callback(null);
                return;
            }

            // Firebird can deliver the initial op_event baseline before the
            // matching op_response reaches the main connection. Mark the
            // subscription active before sending queEvents so that this early
            // op_event can re-queue the next one-shot request.
            self._hasActiveSubscription = true;
            self.db.connection.queEvents(self.events, self.eventid, function (err: any, ret?: any) {
                if (err) {
                    if (self._subscriptionVersion === changeVersion) {
                        self._hasActiveSubscription = false;
                        self._baselinePending = false;
                    }
                    doError(err, callback);
                    return;
                }
                callback(null, ret);
            });
        }

        if (self._hasActiveSubscription) {
            // Cancel the current subscription before setting up a new one.
            self.db.connection.closeEvents(this.eventid, function (err: any) {
                if (err) {
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

    _changeEventWithBaseline(callback: (err: any, ret?: any) => void): void {
        const cnx = this.db.connection;
        this._subscriptionVersion++;
        this._baselineCallbacks.push(callback);
        if (this._baselineChangeInProgress) return;
        this._baselineChangeInProgress = true;

        const finish = (err: any, ret?: any) => {
            this._baselineChangeInProgress = false;
            if (this._baselineCloseRequested && !err) err = new Error('Event Connection is closed.');
            const callbacks = this._baselineCallbacks.splice(0);
            for (const done of callbacks) {
                if (err) doError(err, done);
                else done(null, ret);
            }
            if (this._baselineCloseRequested) {
                this._baselineCloseRequested = false;
                const closeCallbacks = this._baselineCloseCallbacks.splice(0);
                this.close(closeError => {
                    for (const done of closeCallbacks) done(closeError);
                });
            }
        };

        const subscribe = () => {
            if (this._baselineCloseRequested) {
                finish(new Error('Event Connection is closed.'));
                return;
            }
            if (Object.keys(this.events).length === 0) {
                this._hasActiveSubscription = false;
                this._baselinePending = false;
                finish(null);
                return;
            }

            // p_event_rid is client-generated. A fresh ID makes a delayed
            // notification from an older generation distinguishable even
            // when both generations contain the same event name.
            if (this._hasQueuedBaseline) this.eventid = this.db.eventid++;
            this._hasQueuedBaseline = true;
            const version = this._subscriptionVersion;
            this._activeSubscriptionVersion = version;
            for (const name of Object.keys(this.events)) this.events[name] = 0;
            this._baselinePending = true;
            this._hasActiveSubscription = true;
            cnx.queEvents(this.events, this.eventid, (err: any, ret?: any) => {
                if (err) {
                    this._hasActiveSubscription = false;
                    this._baselinePending = false;
                    finish(err);
                } else if (version !== this._subscriptionVersion) {
                    cycle();
                } else {
                    finish(null, ret);
                }
            });
        };

        const cycle = () => {
            if (!this._hasActiveSubscription) {
                subscribe();
                return;
            }
            const oldId = this.eventid;
            this._hasActiveSubscription = false;
            this._baselinePending = false;
            this._retiredEventIds.add(oldId);
            cnx.closeEvents(oldId, (err: any) => {
                if (err) finish(err);
                else subscribe();
            });
        };

        cycle();
    }

    registerEvent(events: string[], callback: (err: any, ret?: any) => void): any {
        var self = this;

        if (self.db.connection._isClosed || self.eventconnection._isClosed || self._baselineCloseRequested)
            return self.eventconnection.throwClosed(callback);

        events.forEach((event) => self.events[event] = self.events[event] || 0);
        self._changeEvent(callback);
    }

    unregisterEvent(events: string[], callback: (err: any, ret?: any) => void): any {
        var self = this;

        if (self.db.connection._isClosed || self.eventconnection._isClosed || self._baselineCloseRequested)
            return self.eventconnection.throwClosed(callback);

        events.forEach(function (event) { delete self.events[event] });
        self._changeEvent(callback);
    }

    close(callback?: (err?: any) => void): void {
        var self = this;

        if (self._eventBaseline && self._baselineChangeInProgress) {
            self._baselineCloseRequested = true;
            if (callback) self._baselineCloseCallbacks.push(callback);
            return;
        }

        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] FbEventManager.close() called, _hasActiveSubscription=%s eventid=%d', self._hasActiveSubscription, self.eventid);
        }

        // Prevent the event loop from re-queuing on stale op_event notifications
        // that may arrive between closeEvents and socket.end()
        self.eventconnection._intentionalClose = true;
        self.eventconnection.eventcallback = null;
        self._baselinePending = false;

        // Gracefully close the event socket using a FIN (end()) rather than a RST
        // (destroy()), then wait for the 'close' event which confirms both sides have
        // exchanged FINs.  This gives Firebird (all versions 3/4/5) time to fully
        // process the previous event connection's teardown before the next
        // op_connect_request or op_que_events arrives on the main connection.
        // destroy() (RST) is faster but causes Firebird 3 to get confused on subsequent
        // queEvents calls – the server internally fails on the RST error and does not
        // clean up its event state in time for the next subscription request.
        // A 200 ms safety timer fires as a fallback if Firebird never sends its FIN.
        function endAndWaitForClose(cb?: (err?: any) => void) {
            var sock = self.eventconnection && self.eventconnection._socket;
            if (!sock || sock.destroyed) {
                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] endAndWaitForClose: socket already destroyed, calling back immediately');
                }
                if (cb) cb();
                return;
            }
            var fired = false;
            var timer: NodeJS.Timeout;
            function done(source: string) {
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

        self.db.connection.closeEvents(this.eventid, function (err: any) {
            if (err) {
                doError(err, callback);
                return;
            }

            self._hasActiveSubscription = false;
            endAndWaitForClose(callback);
        });
    }
}

export = FbEventManager;
