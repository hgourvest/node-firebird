const Events = require('events');
const { doError } = require('../callback');


function FbEventManager(db, eventconnection, eventid, callback) {
    this.db = db;
    this.eventconnection = eventconnection;
    this.events = {};
    this.eventid = eventid;
    this._createEventLoop(callback);
}

FbEventManager.prototype.__proto__ = Object.create(Events.EventEmitter.prototype, {
    constructor: {
        value: FbEventManager,
        enumberable: false
    }
});

FbEventManager.prototype._createEventLoop = function (callback) {
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
            if (first)
                callback();
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

FbEventManager.prototype._changeEvent = function (callback) {
    var self = this;

    self.db.connection.closeEvents(this.eventid, function (err) {
        if (err) {
            doError(err, callback);
            return;
        }
        
        self.db.connection.queEvents(self.events, self.eventid, callback);
    })
}

FbEventManager.prototype.registerEvent = function (events, callback) {
    var self = this;

    if (self.db.connection._isClosed || self.eventconnection._isClosed)
        return self.eventconnection.throwClosed(callback);

    events.forEach((event) => self.events[event] = self.events[event] || 0);
    self._changeEvent(callback);
}

FbEventManager.prototype.unregisterEvent = function (events, callback) {
    var self = this;

    if (self.db.connection._isClosed || self.eventconnection._isClosed)
        return self.eventconnection.throwClosed(callback);

    events.forEach(function (event) { delete self.events[event] });
    self._changeEvent(callback);
}

FbEventManager.prototype.close = function (callback) {
    var self = this;

    self.db.connection.closeEvents(this.eventid, function (err) {
        if (err) {
            doError(err, callback);
            return;
        }

        self.eventconnection._socket.end();
    });
}

module.exports = FbEventManager;