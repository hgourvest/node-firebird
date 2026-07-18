import Events from 'events';
import { doError, fromCallback, type Callback, type SimpleCallback } from '../callback';
import { batchResultToError, escape } from '../utils';
import Const from './const';
import { makeSqlTag, type SqlTag } from '../sql-template';
import { computeColumnKeys, nestCell, resolveKeyTransform, resolveNestTables } from './xsqlvar';
import EventConnection from './eventConnection';
import FbEventManager from './fbEventManager';
import makeQueryStream from './query-stream';
import makeBatchStream from './batch-stream';
import type Connection from './connection';
import type Transaction from './transaction';
import type Statement from './statement';
import type { BatchCb, StatementCb, InternalQueryOptions } from './wire-types';
import type { BatchOptions, BatchResult, Isolation, QueryParams, QueryStreamOptions, TransactionCallback, TransactionOptions } from '../types';

/** Callback for startTransaction: the internal optional-args shape, or the
 *  public TransactionCallback (non-optional transaction) from types.ts. */
type TransactionCb = Callback<Transaction> | TransactionCallback;

/** startTransaction options: resolved options object, a bare isolation
 *  array, or omitted entirely (callback in the options position). */
type TransactionArg = TransactionOptions | Isolation | TransactionCb | undefined;

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

function readblob(blob: any, callback: Callback): void {
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

function fetchBlobSyncRow(row: any, meta: any[], nestTables: boolean | string | undefined, lowercaseKeys: boolean | undefined, transform: ((key: string) => string) | undefined, callback: Callback): void {
    if (!row || !meta || !meta.length || !meta.some((m) => m && m.type === Const.SQL_BLOB)) {
        callback(null, row);
        return;
    }

    // locate blob cells by the same key computation the fetch decoder used,
    // rather than assuming Object.keys(row) is index-aligned with meta —
    // duplicate JOIN column names (and nested rows) break that alignment.
    // Array rows (sequentially's legacy boolean form) are keyed by index.
    const isArrayRow = Array.isArray(row);
    const keys = isArrayRow ? null : computeColumnKeys(meta, nestTables, lowercaseKeys, transform);
    const blobCells: { target: any; key: string | number }[] = [];

    for (let i = 0; i < meta.length; i++) {
        if (!meta[i] || meta[i].type !== Const.SQL_BLOB) {
            continue;
        }
        const target = keys ? nestCell(row, keys[i].table) : row;
        const key = keys ? keys[i].key : i;
        // duplicate aliases collapse onto one cell — read it only once
        if (typeof target[key] === 'function' &&
            !blobCells.some((cell) => cell.target === target && cell.key === key)) {
            blobCells.push({ target, key });
        }
    }

    if (!blobCells.length) {
        callback(null, row);
        return;
    }

    let pending = blobCells.length;
    let blobErr: any;

    blobCells.forEach(function(cell) {
        readblob(cell.target[cell.key], function(err: any, data: any) {
            if (err && !blobErr) {
                blobErr = err;
            }
            cell.target[cell.key] = data;
            pending--;
            if (pending === 0) {
                callback(blobErr, row);
            }
        });
    });
}

class Database extends Events.EventEmitter {
    connection: Connection;
    eventid: number;
    private _sql?: SqlTag;

    constructor(connection: Connection) {
        super();
        this.connection = connection;
        connection.db = this;
        this.eventid = 1;
    }

    /**
     * Tagged-template query API: db.sql`SELECT ... ${value}` (see README).
     * Built lazily on first access; the compiled text is positional-only,
     * so the namedPlaceholders rewriter is disabled — any `:token` in the
     * template is PSQL (EXECUTE BLOCK), not a placeholder.
     */
    get sql(): SqlTag {
        return this._sql || (this._sql = makeSqlTag((text, params, options) =>
            this.queryAsync(text, params, { ...options, namedPlaceholders: false })));
    }

    escape(value: any): string {
        return escape(value, this.connection.accept.protocolVersion);
    }

    detach(callback?: Callback, force?: boolean): this {
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

            });
        } else {
            self.emit('detach', false);
            if (callback)
                callback();
        }

        return self;
    }

    transaction(options: TransactionArg, callback?: TransactionCb): this {
        return this.startTransaction(options, callback);
    }

    startTransaction(options: TransactionArg, callback?: TransactionCb): this {
        this.connection.startTransaction(options, callback);
        return this;
    }

    newStatement(query: string, callback: StatementCb): this {
        // the public strict callback shape and the internal optional-args
        // shape only differ in optionality; treat it as the internal one
        const cb = callback as Callback<Statement>;
        this.startTransaction(function(err: any, transaction?: Transaction) {

            if (err || !transaction) {
                cb(err);
                return;
            }

            transaction.newStatement(query, function(err: any, statement?: Statement) {

                if (err) {
                    cb(err);
                    return;
                }

                transaction.commit(function(err: any) {
                    cb(err, statement);
                });
            });
        });

        return this;
    }

    execute(query: string, params?: QueryParams | Callback, callback?: any, options?: InternalQueryOptions): this {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        var self = this;

        self.connection.startTransaction(function(err: any, transaction?: Transaction) {

            if (err || !transaction) {
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

    /**
     * Bulk-execute `query` once per row via the Firebird 4 batch API
     * (protocol 16+) with all-or-nothing semantics: the batch runs in its
     * own transaction, committed only when every record succeeded and
     * rolled back otherwise. On failure the error of the first failed
     * record is reported, with the full completion attached as
     * err.batchCompletion. Use transaction.executeBatch for partial-success
     * handling.
     */
    executeBatch(query: string, rows: QueryParams[], callback?: BatchCb, options?: BatchOptions): this {
        var self = this;

        self.connection.startTransaction(function(err: any, transaction?: Transaction) {
            if (err || !transaction) {
                doError(err, callback);
                return;
            }

            transaction.executeBatch(query, rows, function(err: any, result?: BatchResult) {
                if (err || !result) {
                    transaction.rollback(function() {
                        doError(err, callback);
                    });
                    return;
                }

                if (!result.success) {
                    transaction.rollback(function() {
                        doError(batchResultToError(result), callback);
                    });
                    return;
                }

                transaction.commit(function(err: any) {
                    if (callback)
                        callback(err, result);
                });
            }, options);
        });

        return self;
    }

    sequentially(query: string, params?: any, on?: any, callback?: any, options: InternalQueryOptions | boolean = {}): this {
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
        var keyResolutionDone = false;
        var resolvedNest: boolean | string | undefined;
        var resolvedTransform: ((key: string) => string) | undefined;
        var _on = function(row: any, i: number, meta: any[], next: (err?: any) => void) {
            var done = false;
            var finish = function(err?: any) {
                if (done) {
                    return;
                }
                done = true;
                next(err);
            };

            // options is read at call time, after the normalization below;
            // both values are query-invariant, so resolve them once on the
            // first row instead of allocating per row
            if (!keyResolutionDone) {
                resolvedNest = resolveNestTables(options as any, self.connection.options);
                resolvedTransform = resolveKeyTransform(options as any, self.connection.options);
                keyResolutionDone = true;
            }
            fetchBlobSyncRow(row, meta, resolvedNest, self.connection._lowercase_keys, resolvedTransform, function(blobErr: any) {
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

    /**
     * Run `query` and return an object-mode Readable emitting one row per
     * chunk (what pg-query-stream / mysql2 .stream() return), with real
     * backpressure: fetching pauses while the stream buffer is full. Runs
     * in its own transaction, like db.query. Destroying the stream early
     * (e.g. a pipeline() teardown) aborts the fetch and releases the
     * statement. Rows go through the regular decode path, so typeCast,
     * blobAsText and jsonAsObject all apply.
     */
    queryStream(query: string, params?: QueryParams, options?: QueryStreamOptions) {
        return makeQueryStream(this, query, params, options);
    }

    /**
     * Bulk-insert Writable (the COPY FROM analogue, Firebird 4.0+): write
     * parameter-array rows, they are flushed in chunks through the batch
     * API on one prepared statement. Runs its own transaction — committed
     * on finish, rolled back on error/destroy (all-or-nothing for the
     * whole stream). BLOB columns accept Buffers/strings. After 'finish',
     * stream.recordCount / stream.affectedRows carry the totals.
     */
    batchStream(query: string, options?: any) {
        return makeBatchStream(this, query, options, true);
    }

    query(query: string, params?: QueryParams | Callback, callback?: any, options: InternalQueryOptions = {}): this {
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

    drop(callback?: SimpleCallback): void {
        return this.connection.dropDatabase(callback);
    }

    /**
     * Cancel the operation currently executing on this connection by sending
     * an out-of-band op_cancel (Firebird 2.5+ / protocol 12+). The cancelled
     * operation fails through its own callback with err.gdscode ===
     * GDSCode.CANCELLED. `kind` defaults to fb_cancel_raise; cancellation is
     * per-attachment, not per-statement.
     */
    cancel(kind?: number | SimpleCallback, callback?: SimpleCallback): this {
        if (typeof kind === 'function') {
            callback = kind;
            kind = undefined;
        }
        this.connection.cancelOperation(kind, callback);
        return this;
    }

    attachEvent(callback: Callback<FbEventManager>): this {
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
    createTablespace(name: string, filePath: string, callback?: Callback): this {
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
    alterTablespace(name: string, filePath: string, callback?: Callback): this {
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
    dropTablespace(name: string, callback?: Callback): this {
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
    createSchema(schemaName: string, tablespaceName?: string | Callback, callback?: Callback): this {
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
     * stays untouched. The promises resolve with the rows alone unless
     * { withMeta: true } is passed, which resolves the full
     * { rows, fields, affectedRows, recordCounts, warnings } result.
     */

    queryAsync(query: string, params?: QueryParams, options?: InternalQueryOptions): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.query(query, params, cb, options); });
    }

    executeAsync(query: string, params?: QueryParams, options?: InternalQueryOptions): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.execute(query, params, cb, options); });
    }

    executeBatchAsync(query: string, rows: QueryParams[], options?: BatchOptions): Promise<BatchResult> {
        var self = this;
        return fromCallback(function(cb) { self.executeBatch(query, rows, cb, options); });
    }

    /** `on` may hold the options when the params argument is the row callback
     *  (public overload: sequentiallyAsync(query, rowCallback, options)). */
    sequentiallyAsync(query: string, params?: any, on?: any, options?: InternalQueryOptions | boolean): Promise<void> {
        if (params instanceof Function) {
            options = on;
            on = params;
            params = undefined;
        }
        var self = this;
        return fromCallback(function(cb) { self.sequentially(query, params, on, cb, options); });
    }

    transactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction> {
        var self = this;
        return fromCallback(function(cb) { self.startTransaction(options, cb); });
    }

    startTransactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction> {
        return this.transactionAsync(options);
    }

    newStatementAsync(query: string): Promise<Statement> {
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

    attachEventAsync(): Promise<FbEventManager> {
        var self = this;
        return fromCallback(function(cb) { self.attachEvent(cb); });
    }

    cancelAsync(kind?: number): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.cancel(kind, cb); });
    }

    /**
     * Run `work` inside a transaction: commits when the returned promise
     * resolves, rolls back when it rejects (the original error is rethrown,
     * even if the rollback itself fails).
     */
    async withTransaction<T>(work: (transaction: Transaction) => Promise<T> | T, options?: TransactionOptions | Isolation): Promise<T> {
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
