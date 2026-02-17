const Events = require('events');
const { doError } = require('../callback');

class FbEventManager extends Events.EventEmitter {
    constructor(db, eventconnection, eventid, callback) {
        super();
        this.db = db;
        this.eventconnection = eventconnection;
        this.events = {};
        this.eventid = eventid;
        this._createEventLoop(callback);
    }

    _createEventLoop(callback) {
        var self = this;
        var cnx = this.db.connection;
        this.eventconnection.emgr = this;
        console.log('[EventManager] Creating event loop, eventid:', this.eventid);
        // create the loop
        function loop(first) {
            console.log('[EventManager] Calling queEvents, first:', first, 'events:', Object.keys(self.events));
            cnx.queEvents(self.events, self.eventid, function (err, ret) {
                console.log('[EventManager] queEvents callback, err:', err, 'ret:', ret, 'first:', first);
                if (err) {
                    console.log('[EventManager] queEvents error:', err);
                    doError(err, callback);
                    return;
                }
                if (first) {
                    console.log('[EventManager] First loop complete, calling callback');
                    callback(null);
                }
            })
        }

        this.eventconnection.eventcallback = function (err, ret) {
            console.log('[EventManager] eventcallback invoked, err:', err, 'eventid match:', self.eventid === ret?.eventid);
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

        console.log('[EventManager] _changeEvent called, eventid:', this.eventid, 'events:', Object.keys(self.events));
        // Temporarily suppress the event loop to prevent stale op_event
        // notifications from pushing spurious queEvents onto the main
        // connection queue while closeEvents + queEvents are in flight
        var savedCallback = self.eventconnection.eventcallback;
        self.eventconnection.eventcallback = null;
        console.log('[EventManager] Suppressed event callback, calling closeEvents');

        self.db.connection.closeEvents(this.eventid, function (err) {
            console.log('[EventManager] closeEvents callback, err:', err);
            if (err) {
                self.eventconnection.eventcallback = savedCallback;
                doError(err, callback);
                return;
            }
            
            console.log('[EventManager] closeEvents success, calling queEvents');
            self.db.connection.queEvents(self.events, self.eventid, function (err, ret) {
                console.log('[EventManager] queEvents callback in _changeEvent, err:', err, 'ret:', ret);
                // Restore the event loop now that our queEvents is safely queued
                self.eventconnection.eventcallback = savedCallback;
                console.log('[EventManager] Restored event callback');
                if (err) {
                    console.log('[EventManager] queEvents error in _changeEvent:', err);
                    doError(err, callback);
                    return;
                }
                console.log('[EventManager] _changeEvent complete, calling final callback');
                callback(null, ret);
            });
        })
    }

    registerEvent(events, callback) {
        var self = this;

        console.log('[EventManager] registerEvent called with events:', events);
        console.log('[EventManager] Connection closed?', self.db.connection._isClosed, 'Event connection closed?', self.eventconnection._isClosed);
        
        if (self.db.connection._isClosed || self.eventconnection._isClosed)
            return self.eventconnection.throwClosed(callback);

        events.forEach((event) => self.events[event] = self.events[event] || 0);
        console.log('[EventManager] Events registered, current events:', Object.keys(self.events));
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

        self.db.connection.closeEvents(this.eventid, function (err) {
            if (err) {
                doError(err, callback);
                return;
            }

            self.eventconnection._socket.end();
            if (callback)
                callback();
        });
    }
}

module.exports = FbEventManager;