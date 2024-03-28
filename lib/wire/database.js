const Events = require('events');
const { doError } = require('../callback');
const { escape } = require('../utils');
const EventConnection = require('./eventConnection');
const FbEventManager = require('./fbEventManager');

/***************************************
 *
 *   Database
 *
 ***************************************/

function Database(connection) {
    this.connection = connection;
    connection.db = this;
    this.eventid = 1;
}

Database.prototype.__proto__ = Object.create(Events.EventEmitter.prototype, {
    constructor: {
        value: Database,
        enumberable: false
    }
});

Database.prototype.escape = function(value) {
    return escape(value, this.connection.accept.protocolVersion);
};

Database.prototype.detach = function(callback, force) {

    var self = this;

    if (!force && self.connection._pending.length > 0) {
        self.connection._detachAuto = true;
        self.connection._detachCallback = callback;
        return self;
    }

    if (self.connection._pooled === false) {
        self.connection.detach(function (err, obj) {

            self.connection.disconnect();
            self.emit('detach', false);

            if (callback)
                callback(err, obj);

        }, force);
    } else {
        self.emit('detach', false);
        if (callback)
            callback();
    }

    return self;
};

Database.prototype.transaction = function(isolation, callback) {
    return this.startTransaction(isolation, callback);
};

Database.prototype.startTransaction = function(isolation, callback) {
    this.connection.startTransaction(isolation, callback);
    return this;
};

Database.prototype.newStatement = function (query, callback) {

    this.startTransaction(function(err, transaction) {

        if (err) {
            callback(err);
            return;
        }

        transaction.newStatement(query, function(err, statement) {

            if (err) {
                callback(err);
                return;
            }

            transaction.commit(function(err) {
                callback(err, statement);
            });
        });
    });

    return this;
};

Database.prototype.execute = function(query, params, callback, custom) {

    if (params instanceof Function) {
        custom = callback;
        callback = params;
        params = undefined;
    }

    var self = this;

    self.connection.startTransaction(function(err, transaction) {

        if (err) {
            doError(err, callback);
            return;
        }

        transaction.execute(query, params, function(err, result, meta, isSelect) {

            if (err) {
                transaction.rollback(function() {
                    doError(err, callback);
                });
                return;
            }

            transaction.commit(function(err) {
                if (callback)
                    callback(err, result, meta, isSelect);
            });

        }, custom);
    });

    return self;
};

Database.prototype.sequentially = function(query, params, on, callback, asArray) {

    if (params instanceof Function) {
        asArray = callback;
        callback = on;
        on = params;
        params = undefined;
    }

    if (on === undefined){
        throw new Error('Expected "on" delegate.');
    }

    if (callback instanceof Boolean) {
        asArray = callback;
        callback = undefined;
    }

    var self = this;
    self.execute(query, params, callback, { asObject: !asArray, asStream: true, on: on });
    return self;
};

Database.prototype.query = function(query, params, callback) {

    if (params instanceof Function) {
        callback = params;
        params = undefined;
    }

    var self = this;
    self.execute(query, params, callback, { asObject: true, asStream: callback === undefined || callback === null });
    return self;
};

Database.prototype.drop = function(callback) {
    return this.connection.dropDatabase(callback);
};

Database.prototype.attachEvent = function (callback) {
    var self = this;
    this.connection.auxConnection(function (err, socket_info) {

        if (err) {
            doError(err, callback);
            return;
        }

        const eventConnection = new EventConnection(self.connection.host, socket_info.port, function (err) {
            if (err) {
                doError(err, callback);
                return;
            }

            const evt = new FbEventManager(self, eventConnection, self.eventid++, function (err) {
                if (err) {
                    doError(err, callback);
                    return;
                }

                callback(err, evt);
            });
        }, self);
    });

    return this;
}

module.exports = Database;
