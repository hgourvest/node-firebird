const Events = require('events');
const { doError } = require('../callback');
const { escape } = require('../utils');
const Const = require('./const');
const EventConnection = require('./eventConnection');
const FbEventManager = require('./fbEventManager');

/***************************************
 *
 *   Database
 *
 ***************************************/

function readblob(blob, callback) {
    if (blob === undefined || blob === null) {
        callback(null, blob);
        return;
    }

    if (typeof blob !== 'function') {
        callback(null, blob);
        return;
    }

    blob(function(err, name, e) {
        if (err) {
            callback(err);
            return;
        }

        if (!e) {
            callback(null, null);
            return;
        }

        const chunks = [];
        let chunksLength = 0;

        e.on('data', function(chunk) {
            chunksLength += chunk.length;
            chunks.push(chunk);
        });

        e.on('end', function() {
            callback(null, Buffer.concat(chunks, chunksLength));
        });

        e.on('error', function(streamErr) {
            callback(streamErr);
        });
    });
}

function fetchBlobSyncRow(row, meta, callback) {
    if (!row || !meta || !meta.length) {
        callback(null, row);
        return;
    }

    const rowKeys = Object.keys(row);
    const blobColumns = [];

    for (let i = 0; i < meta.length; i++) {
        if (meta[i] && meta[i].type === Const.SQL_BLOB && rowKeys[i] !== undefined) {
            blobColumns.push(rowKeys[i]);
        }
    }

    if (!blobColumns.length) {
        callback(null, row);
        return;
    }

    let pending = blobColumns.length;
    let blobErr;

    blobColumns.forEach(function(columnName) {
        readblob(row[columnName], function(err, data) {
            if (err && !blobErr) {
                blobErr = err;
            }
            row[columnName] = data;
            pending--;
            if (pending === 0) {
                callback(blobErr, row);
            }
        });
    });
}

class Database extends Events.EventEmitter {
    constructor(connection) {
        super();
        this.connection = connection;
        connection.db = this;
        this.eventid = 1;
    }

    escape(value) {
        return escape(value, this.connection.accept.protocolVersion);
    }

    detach(callback, force) {
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
    }

    transaction(options, callback) {
        return this.startTransaction(options, callback);
    }

    startTransaction(options, callback) {
        this.connection.startTransaction(options, callback);
        return this;
    }

    newStatement(query, callback) {
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
    }

    execute(query, params, callback, custom) {
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
    }

    sequentially(query, params, on, callback, asArray) {
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
        var _on = function(row, i, meta, next) {
            var done = false;
            var finish = function(err) {
                if (done) {
                    return;
                }
                done = true;
                next(err);
            };

            fetchBlobSyncRow(row, meta, function(blobErr) {
                if (blobErr) {
                    finish(blobErr);
                    return;
                }

                try {
                    var ret;
                    if (on.length >= 3) {
                        ret = on(row, i, finish);
                    } else {
                        ret = on(row, i);
                    }

                    if (ret && typeof ret.then === 'function') {
                        ret.then(function() {
                            finish();
                        }).catch(finish);
                    } else if (on.length < 3) {
                        finish();
                    }
                } catch (err) {
                    finish(err);
                }
            });
        };

        self.execute(query, params, callback, { asObject: !asArray, asStream: true, on: _on });
        return self;
    }

    query(query, params, callback) {
        if (params instanceof Function) {
            callback = params;
            params = undefined;
        }

        var self = this;
        self.execute(query, params, callback, { asObject: true, asStream: callback === undefined || callback === null });
        return self;
    }

    drop(callback) {
        return this.connection.dropDatabase(callback);
    }

    attachEvent(callback) {
        var self = this;
        this.connection.auxConnection(function (err, socket_info) {

            if (err) {
                doError(err, callback);
                return;
            }

            const host = (socket_info.host === '0.0.0.0' || socket_info.host === '::')
                ? self.connection.options.host
                : socket_info.host;

            const eventConnection = new EventConnection(
                host, socket_info.port, function(err) {
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
}

module.exports = Database;
