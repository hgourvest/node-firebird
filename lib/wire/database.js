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
 * Driver events (emitted on the Database instance itself)
 * --------------------------------------------------------
 * These are synchronous notifications from the driver about connection-level
 * operations. Subscribe with db.on(eventName, handler).
 *
 *   'attach'      – fired synchronously after the user callback returns,
 *                   once the database is attached.
 *   'detach'      – fired when the database connection is detached.
 *   'reconnect'   – fired after the driver successfully reconnects a dropped socket.
 *   'error'       – fired for connection-level errors (socket errors, closed
 *                   connection attempts, etc.).
 *   'transaction' – fired when a transaction is started (before server response),
 *                   with the resolved transaction options object as the argument.
 *   'commit'      – fired when a transaction commit is sent (before server response).
 *   'rollback'    – fired when a transaction rollback is sent (before server response).
 *   'query'       – fired with the SQL string when a statement is prepared.
 *   'row'         – fired with each individual row as it is decoded.
 *   'result'      – fired with the full rows array once all rows are fetched.
 *
 * Firebird database events (POST_EVENT)
 * ----------------------------------------
 * Real Firebird asynchronous notifications triggered by POST_EVENT inside
 * PSQL triggers or stored procedures are handled through a separate channel:
 *   1. Call db.attachEvent(callback) to obtain a FbEventManager instance.
 *   2. Call evtmgr.registerEvent(names, callback) to subscribe to event names.
 *   3. Listen for evtmgr.on('post_event', (name, count) => {}) to receive them.
 *   4. Call evtmgr.unregisterEvent(names, callback) to cancel a subscription.
 *   5. Call evtmgr.close(callback) when done to release the aux connection.
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

    execute(query, params, callback, options) {
        if (params instanceof Function) {
            options = callback;
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

            }, options);
        });

        return self;
    }

    sequentially(query, params, on, callback, options = {}) {
        if (params instanceof Function) {
            options = callback;
            callback = on;
            on = params;
            params = undefined;
        }

        if (on === undefined){
            throw new Error('Expected "on" delegate.');
        }

        if (callback instanceof Boolean) {
            options = callback;
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

        // back compatibility - options parameter is a boolean
        if (typeof options === 'boolean') {
            options = { asObject: !options, asStream: true, on: _on };
        } else {
            options = {
                asObject: true,
                asStream: true,
                on: _on,
                ...options,
            };
        }

        self.execute(query, params, callback, options);
        return self;
    }

    query(query, params, callback, options = {}) {
        if (params instanceof Function) {
            options = callback || {};
            callback = params;
            params = undefined;
        }

        options = {
            asObject: true,
            asStream: callback === undefined || callback === null,
            ...options
        };

        var self = this;
        self.execute(query, params, callback, options);
        return self;
    }

    drop(callback) {
        return this.connection.dropDatabase(callback);
    }

    attachEvent(callback) {
        var self = this;
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] Database.attachEvent: calling auxConnection, eventid=%d queue=%d', self.eventid, self.connection._queue.length);
        }
        this.connection.auxConnection(function (err, socket_info) {

            if (err) {
                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] Database.attachEvent: auxConnection error:', err.message);
                }
                doError(err, callback);
                return;
            }

            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] Database.attachEvent: auxConnection ok, connecting to aux port %s:%d', socket_info.host, socket_info.port);
            }

            const host = (socket_info.host === '0.0.0.0' || socket_info.host === '::')
                ? self.connection.options.host
                : socket_info.host;

            const eventConnection = new EventConnection(
                host, socket_info.port, function(err) {
                if (err) {
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] Database.attachEvent: EventConnection error:', err.message);
                    }
                    doError(err, callback);
                    return;
                }

                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] Database.attachEvent: EventConnection connected, creating FbEventManager eventid=%d', self.eventid);
                }

                const evt = new FbEventManager(self, eventConnection, self.eventid++, function (err) {
                    if (err) {
                        doError(err, callback);
                        return;
                    }

                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] Database.attachEvent: FbEventManager ready, eventid=%d', evt.eventid);
                    }

                    callback(err, evt);
                });
            }, self);
        });

        return this;
    }
}

module.exports = Database;
