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

    _createEventLoop(callback) {
        var self = this;
        var cnx = this.db.connection;
        this.eventconnection.emgr = this;

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
                console.error('[DBG:loop] skipping queEvents: hasActiveSub=%s eventsEmpty=%s', self._hasActiveSubscription, Object.keys(self.events).length === 0);
                return;
            }
            console.error('[DBG:loop] sending queEvents eventid=%d events=%j', self.eventid, self.events);
            cnx.queEvents(self.events, self.eventid, function (err) {
                if (err) {
                    doError(err, callback);
                    return;
                }
                console.error('[DBG:loop] queEvents response OK eventid=%d', self.eventid);
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
        console.error('[DBG:_changeEvent] enter eventid=%d hasActiveSub=%s events=%j', self.eventid, self._hasActiveSubscription, self.events);

        function subscribe() {
            // If no events remain, mark subscription as inactive and return.
            // Sending queEvents with an empty EPB after op_cancel_events does
            // not receive op_response from some Firebird versions, which would
            // permanently block the main connection queue.
            if (Object.keys(self.events).length === 0) {
                self._hasActiveSubscription = false;
                self.eventconnection.eventcallback = savedCallback;
                console.error('[DBG:_changeEvent] subscribe: events empty, skip queEvents, calling callback');
                callback(null);
                return;
            }

            console.error('[DBG:_changeEvent] subscribe: sending queEvents eventid=%d events=%j', self.eventid, self.events);
            self.db.connection.queEvents(self.events, self.eventid, function (err, ret) {
                self.eventconnection.eventcallback = savedCallback;
                if (err) {
                    doError(err, callback);
                    return;
                }
                self._hasActiveSubscription = true;
                console.error('[DBG:_changeEvent] queEvents response OK eventid=%d', self.eventid);
                callback(null, ret);
            });
        }

        if (self._hasActiveSubscription) {
            // Cancel the current subscription before setting up a new one.
            console.error('[DBG:_changeEvent] sending closeEvents eventid=%d', self.eventid);
            self.db.connection.closeEvents(this.eventid, function (err) {
                if (err) {
                    self.eventconnection.eventcallback = savedCallback;
                    doError(err, callback);
                    return;
                }
                self._hasActiveSubscription = false;
                console.error('[DBG:_changeEvent] closeEvents response OK eventid=%d', self.eventid);
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

        // Prevent the event loop from re-queuing on stale op_event notifications
        // that may arrive between closeEvents and socket.end()
        self.eventconnection.eventcallback = null;
        console.error('[DBG:close] enter eventid=%d hasActiveSub=%s', self.eventid, self._hasActiveSubscription);

        if (!self._hasActiveSubscription) {
            // No active subscription (attachEvent without registerEvent, or
            // all events were unregistered) – nothing to cancel.
            self.eventconnection._socket.end();
            console.error('[DBG:close] no active sub, socket.end() called');
            if (callback)
                callback();
            return;
        }

        console.error('[DBG:close] sending closeEvents eventid=%d', self.eventid);
        self.db.connection.closeEvents(this.eventid, function (err) {
            if (err) {
                doError(err, callback);
                return;
            }

            self._hasActiveSubscription = false;
            self.eventconnection._socket.end();
            console.error('[DBG:close] closeEvents response OK, socket.end() called eventid=%d', self.eventid);
            if (callback)
                callback();
        });
    }
}

module.exports = FbEventManager;
