import Events from 'events';
import { doError, fromCallback } from '../callback';
import { escape } from '../utils';
import Const from './const';
import EventConnection from './eventConnection';
import FbEventManager from './fbEventManager';

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

function readblob(blob: any, callback: (err: any, data?: any) => void): void {
    if (blob === undefined || blob === null) {
        callback(null, blob);
        return;
    }

    if (typeof blob !== 'function') {
        callback(null, blob);
        return;
    }

    blob(function(err: any, name: any, e: any) {
        if (err) {
            callback(err);
            return;
        }

        if (!e) {
            callback(null, null);
            return;
        }

        const chunks: Buffer[] = [];
        let chunksLength = 0;

        e.on('data', function(chunk: Buffer) {
            chunksLength += chunk.length;
            chunks.push(chunk);
        });

        e.on('end', function() {
            callback(null, Buffer.concat(chunks, chunksLength));
        });

        e.on('error', function(streamErr: any) {
            callback(streamErr);
        });
    });
}

function fetchBlobSyncRow(row: any, meta: any[], callback: (err: any, row?: any) => void): void {
    if (!row || !meta || !meta.length) {
        callback(null, row);
        return;
    }

    const rowKeys = Object.keys(row);
    const blobColumns: string[] = [];

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
    let blobErr: any;

    blobColumns.forEach(function(columnName) {
        readblob(row[columnName], function(err: any, data: any) {
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
    connection: any;
    eventid: number;

    constructor(connection: any) {
        super();
        this.connection = connection;
        connection.db = this;
        this.eventid = 1;
    }

    escape(value: any): string {
        return escape(value, this.connection.accept.protocolVersion);
    }

    detach(callback?: (err?: any, obj?: any) => void, force?: boolean): this {
        var self = this;

        if (!force && self.connection._pending.length > 0) {
            self.connection._detachAuto = true;
            self.connection._detachCallback = callback;
            return self;
        }

        if (self.connection._pooled === false) {
            self.connection.detach(function (err: any, obj: any) {

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

    transaction(options: any, callback?: (err: any, transaction?: any) => void): this {
        return this.startTransaction(options, callback);
    }

    startTransaction(options: any, callback?: (err: any, transaction?: any) => void): this {
        this.connection.startTransaction(options, callback);
        return this;
    }

    newStatement(query: string, callback: (err: any, statement?: any) => void): this {
        this.startTransaction(function(err: any, transaction: any) {

            if (err) {
                callback(err);
                return;
            }

            transaction.newStatement(query, function(err: any, statement: any) {

                if (err) {
                    callback(err);
                    return;
                }

                transaction.commit(function(err: any) {
                    callback(err, statement);
                });
            });
        });

        return this;
    }

    execute(query: string, params?: any, callback?: any, options?: any): this {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        var self = this;

        self.connection.startTransaction(function(err: any, transaction: any) {

            if (err) {
                doError(err, callback);
                return;
            }

            transaction.execute(query, params, function(err: any, result: any, meta: any, isSelect: boolean) {

                if (err) {
                    transaction.rollback(function() {
                        doError(err, callback);
                    });
                    return;
                }

                transaction.commit(function(err: any) {
                    if (callback)
                        callback(err, result, meta, isSelect);
                });

            }, options);
        });

        return self;
    }

    sequentially(query: string, params?: any, on?: any, callback?: any, options: any = {}): this {
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
        var _on = function(row: any, i: number, meta: any, next: (err?: any) => void) {
            var done = false;
            var finish = function(err?: any) {
                if (done) {
                    return;
                }
                done = true;
                next(err);
            };

            fetchBlobSyncRow(row, meta, function(blobErr: any) {
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

    query(query: string, params?: any, callback?: any, options: any = {}): this {
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

    drop(callback?: (err?: any) => void): void {
        return this.connection.dropDatabase(callback);
    }

    attachEvent(callback: (err: any, evt?: any) => void): this {
        var self = this;
        const eventid = self.eventid++;
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] Database.attachEvent: calling auxConnection, eventid=%d queue=%d', eventid, self.connection._queue.length);
        }
        this.connection.auxConnection(eventid, function (err: any, socket_info: any) {

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
                host, socket_info.port, function(err?: any) {
                if (err) {
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] Database.attachEvent: EventConnection error:', err.message);
                    }
                    doError(err, callback);
                    return;
                }

                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] Database.attachEvent: EventConnection connected, creating FbEventManager eventid=%d', eventid);
                }

                const evt = new FbEventManager(self, eventConnection, eventid, function (err: any) {
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

    /**
     * Create a physical tablespace.
     * Supported in Firebird 6.0+ (Protocol 20+).
     *
     * @param {string} name - The name of the tablespace.
     * @param {string} filePath - The physical file path for the tablespace.
     * @param {function} [callback] - Asynchronous completion callback.
     * @returns {Database}
     */
    createTablespace(name: string, filePath: string, callback?: any): this {
        const sql = `CREATE TABLESPACE ${name} FILE '${filePath}'`;
        return this.execute(sql, [], callback);
    }

    /**
     * Alter an existing tablespace physical location.
     * Supported in Firebird 6.0+ (Protocol 20+).
     *
     * @param {string} name - The name of the tablespace.
     * @param {string} filePath - The new physical file path.
     * @param {function} [callback] - Asynchronous completion callback.
     * @returns {Database}
     */
    alterTablespace(name: string, filePath: string, callback?: any): this {
        const sql = `ALTER TABLESPACE ${name} SET FILE TO '${filePath}'`;
        return this.execute(sql, [], callback);
    }

    /**
     * Drop a tablespace.
     * Supported in Firebird 6.0+ (Protocol 20+).
     *
     * @param {string} name - The name of the tablespace.
     * @param {function} [callback] - Asynchronous completion callback.
     * @returns {Database}
     */
    dropTablespace(name: string, callback?: any): this {
        const sql = `DROP TABLESPACE ${name}`;
        return this.execute(sql, [], callback);
    }

    /**
     * Create a schema/namespace. Can optionally partition/map the namespace
     * to a physical tablespace.
     * Supported in Firebird 6.0+ (Protocol 20+).
     *
     * @param {string} schemaName - The name of the schema.
     * @param {string} [tablespaceName] - Optional tablespace name to bind this schema namespace.
     * @param {function} [callback] - Asynchronous completion callback.
     * @returns {Database}
     */
    createSchema(schemaName: string, tablespaceName?: string | ((err?: any) => void), callback?: any): this {
        if (typeof tablespaceName === 'function') {
            callback = tablespaceName;
            tablespaceName = undefined;
        }
        let sql = `CREATE SCHEMA ${schemaName}`;
        if (tablespaceName) {
            sql += ` TABLESPACE ${tablespaceName}`;
        }
        return this.execute(sql, [], callback);
    }

    /*
     * Promise / async-await API.
     * Each *Async method wraps its callback counterpart; the callback API
     * stays untouched. Result metadata is only available through the
     * callback API — the promises resolve with the rows alone.
     */

    queryAsync(query: string, params?: any, options?: any): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.query(query, params, cb, options); });
    }

    executeAsync(query: string, params?: any, options?: any): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.execute(query, params, cb, options); });
    }

    sequentiallyAsync(query: string, params?: any, on?: any, options?: any): Promise<void> {
        if (params instanceof Function) {
            options = on;
            on = params;
            params = undefined;
        }
        var self = this;
        return fromCallback(function(cb) { self.sequentially(query, params, on, cb, options); });
    }

    transactionAsync(options?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.startTransaction(options, cb); });
    }

    startTransactionAsync(options?: any): Promise<any> {
        return this.transactionAsync(options);
    }

    newStatementAsync(query: string): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.newStatement(query, cb); });
    }

    detachAsync(force?: boolean): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.detach(cb, force); });
    }

    dropAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.drop(cb); });
    }

    attachEventAsync(): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.attachEvent(cb); });
    }

    /**
     * Run `work` inside a transaction: commits when the returned promise
     * resolves, rolls back when it rejects (the original error is rethrown,
     * even if the rollback itself fails).
     */
    async withTransaction<T>(work: (transaction: any) => Promise<T> | T, options?: any): Promise<T> {
        const transaction = await this.transactionAsync(options);
        try {
            const result = await work(transaction);
            await fromCallback(function(cb) { transaction.commit(cb); });
            return result;
        } catch (err) {
            try {
                await fromCallback(function(cb) { transaction.rollback(cb); });
            } catch { /* surface the original error, not the rollback failure */ }
            throw err;
        }
    }
}

export = Database;
