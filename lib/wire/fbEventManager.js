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
            cnx.queEvents(self.events, self.eventid, function (err) {
                if (err) {
                    doError(err, callback);
                }
                // first=false path: subscription renewed, nothing else to do
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

        // Resolve attachEvent immediately – no subscription is needed until
        // the caller registers at least one event name via registerEvent().
        callback(null);
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

        // Prevent the event loop from re-queuing on stale op_event notifications
        // that may arrive between closeEvents and socket.end()
        self.eventconnection.eventcallback = null;

        if (!self._hasActiveSubscription) {
            // No active subscription (attachEvent without registerEvent, or
            // all events were unregistered) – nothing to cancel.
            self.eventconnection._socket.end();
            if (callback)
                callback();
            return;
        }

        self.db.connection.closeEvents(this.eventid, function (err) {
            if (err) {
                doError(err, callback);
                return;
            }

            self._hasActiveSubscription = false;
            self.eventconnection._socket.end();
            if (callback)
                callback();
        });
    }
}

module.exports = FbEventManager;
