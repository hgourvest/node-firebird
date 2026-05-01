const Events = require('events');
const { doError } = require('../callback');

class FbEventManager extends Events.EventEmitter {
    constructor(db, eventconnection, eventid, callback) {
        super();
        this.db = db;
        this.eventconnection = eventconnection;
        this.events = {};
        this.eventid = eventid;
        this._subscriptionActive = false;
        this._createEventLoop(callback);
    }

    _createEventLoop(callback) {
        var self = this;
        var cnx = this.db.connection;
        this.eventconnection.emgr = this;
        // create the loop
        function loop(first) {
            cnx.queEvents(self.events, self.eventid, function (err, ret) {
                if (err) {
                    doError(err, callback);
                    return;
                }
                self._subscriptionActive = true;
                if (first) {
                    callback(null);
                }
            })
        }

        this.eventconnection.eventcallback = function (err, ret) {
            if (err || (self.eventid !== ret.eventid)) {
                doError(err || new Error('Bad eventid'), callback);
                return;
            }

            ret.events.forEach(function (event) {
                self.emit('post_event', event.name, event.count)
            })

            loop(false);
        }

        loop(true);
    }

    _changeEvent(callback) {
        var self = this;

        // Temporarily suppress the event loop to prevent stale op_event
        // notifications from pushing spurious queEvents onto the main
        // connection queue while closeEvents + queEvents are in flight
        var savedCallback = self.eventconnection.eventcallback;
        self.eventconnection.eventcallback = null;

        self.db.connection.closeEvents(this.eventid, function (err) {
            if (err) {
                self.eventconnection.eventcallback = savedCallback;
                doError(err, callback);
                return;
            }

            self._subscriptionActive = false;

            // If no events remain, skip re-subscribing (queEvents with empty EPB
            // does not receive op_response from Firebird after op_cancel_events)
            if (Object.keys(self.events).length === 0) {
                self.eventconnection.eventcallback = savedCallback;
                callback(null);
                return;
            }

            self.db.connection.queEvents(self.events, self.eventid, function (err, ret) {
                // Restore the event loop now that our queEvents is safely queued
                self.eventconnection.eventcallback = savedCallback;
                if (err) {
                    doError(err, callback);
                    return;
                }
                self._subscriptionActive = true;
                callback(null, ret);
            });
        })
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

        // If there is no active subscription (e.g. after unregisterEvent emptied
        // all events and _changeEvent already sent op_cancel_events), sending
        // another op_cancel_events would be a duplicate that Firebird silently
        // ignores without sending op_response, permanently blocking the queue.
        if (!self._subscriptionActive) {
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

            self._subscriptionActive = false;
            self.eventconnection._socket.end();
            if (callback)
                callback();
        });
    }
}

module.exports = FbEventManager;