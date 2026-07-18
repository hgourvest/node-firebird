import { doCallback, doError, fromCallback, type Callback, type SimpleCallback } from '../callback';
import { parseNamedPlaceholders } from '../named-params';
import { noop } from '../utils';
import Const from './const';
import { makeSqlTag, type SqlTag } from '../sql-template';
import { describeFields, parseRecordCounts } from './xsqlvar';
import makeQueryStream from './query-stream';
import makeBatchStream from './batch-stream';
import type Connection from './connection';
import type Database from './database';
import type Statement from './statement';
import type { BatchCb, StatementCb, InternalQueryOptions } from './wire-types';
import type { BatchOptions, BatchResult, QueryOptions, QueryParams, QueryStreamOptions, RecordCounts, SequentialCallback } from '../types';

/***************************************
 *
 *   Transaction
 *
 ***************************************/

/** The error delivered when options.signal was already aborted on entry. */
function abortError(signal: any): Error {
    if (signal && signal.reason instanceof Error)
        return signal.reason;
    var err: any = new Error('The operation was aborted');
    err.name = 'AbortError';
    err.code = 'ABORT_ERR';
    return err;
}

/**
 * Wire an AbortSignal to a running statement: on abort, send an out-of-band
 * op_cancel so the server fails the executing operation with isc_cancelled
 * (surfaced through the statement's own callback as err.gdscode ===
 * GDSCode.CANCELLED). Returns the wrapped callback that detaches the
 * listener once the operation settles.
 */
function hookAbortSignal(connection: Connection, signal: AbortSignal, callback: any): any {
    var settled = false;
    var onAbort = function() {
        if (!settled)
            connection.cancelOperation(Const.fb_cancel_raise);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return function(err?: any, result?: any, meta?: any, isSelect?: boolean) {
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (callback)
            callback(err, result, meta, isSelect);
    };
}

class Transaction {
    connection: Connection;
    db: Database;
    // populated externally from the op_transaction response
    handle!: number;

    private _sql?: SqlTag;

    constructor(connection: Connection) {
        this.connection = connection;
        this.db = connection.db;
    }

    /**
     * Tagged-template query API: tx.sql`SELECT ... ${value}` (see README).
     * Built lazily — transactions are created per-query internally, and
     * those throwaway instances must not pay for the tag. The compiled text
     * is positional-only, so the namedPlaceholders rewriter is disabled:
     * any `:token` in the template is PSQL (EXECUTE BLOCK), not a
     * placeholder.
     */
    get sql(): SqlTag {
        return this._sql || (this._sql = makeSqlTag((text, params, options) =>
            this.queryAsync(text, params, { ...options, namedPlaceholders: false })));
    }

    /** Current savepoint nesting depth (names savepoints, see savepoint()). */
    private _savepointDepth = 0;

    /**
     * Run `work` inside a savepoint (Firebird 1.5+): on resolve the
     * savepoint is released, on reject the transaction rolls back TO the
     * savepoint — undoing only work's changes — and the error is rethrown,
     * leaving the transaction itself usable. Nestable (each call generates
     * a fresh NF_SP_n name), mirroring db.withTransaction's style and
     * Postgres.js's sql.savepoint().
     *
     * Do NOT run sibling savepoints concurrently on one transaction
     * (Promise.all): Firebird's RELEASE SAVEPOINT also releases every
     * savepoint created after it, so interleaved siblings release each
     * other. Nested (awaited) savepoints are fine.
     */
    async savepoint<T>(work: (transaction: this) => Promise<T> | T): Promise<T> {
        if (typeof work !== 'function') {
            throw new Error('savepoint(work) expects a function');
        }
        // named by nesting depth, not a global counter: sequential
        // savepoints at the same depth reuse the same three SQL strings, so
        // the statement cache serves them instead of accumulating
        // single-use entries (redefining a released savepoint name is legal)
        const name = 'NF_SP_' + (++this._savepointDepth);
        try {
            await this.queryAsync('SAVEPOINT ' + name);

            let result: T;
            try {
                result = await work(this);
            } catch (err: any) {
                // only a work() failure rolls back to the savepoint — a
                // RELEASE failure below must NOT undo work's successful
                // changes
                try {
                    await this.queryAsync('ROLLBACK TO SAVEPOINT ' + name);
                } catch (rollbackErr: any) {
                    // the original failure matters more; keep the rollback
                    // failure attached for diagnosis
                    if (err && typeof err === 'object') {
                        err.savepointRollbackError = rollbackErr;
                    }
                }
                throw err;
            }

            await this.queryAsync('RELEASE SAVEPOINT ' + name);
            return result;
        } finally {
            this._savepointDepth--;
        }
    }

    /** Per-call options.namedPlaceholders overrides the connection option. */
    private namedPlaceholdersEnabled(options?: InternalQueryOptions): boolean {
        if (options && options.namedPlaceholders !== undefined)
            return !!options.namedPlaceholders;
        return !!(this.connection.options && this.connection.options.namedPlaceholders);
    }

    newStatement(query: string, callback: StatementCb, options?: InternalQueryOptions): void {
        var cnx = this.connection;
        var self = this;
        // the public strict callback shape and the internal optional-args
        // shape only differ in optionality; treat it as the internal one
        var cb = callback as Callback<Statement>;

        // With namedPlaceholders on, prepare the positional rewrite and
        // remember the name order on the statement so statement.execute can
        // accept a values-by-name object. The rewritten SQL is the cache key.
        var names: string[] | null = null;
        if (this.namedPlaceholdersEnabled(options)) {
            var parsed = parseNamedPlaceholders(query);
            if (parsed.names) {
                query = parsed.sql;
                names = parsed.names;
            }
        }

        var deliver = function(err: any, statement?: Statement) {
            if (statement)
                statement.namedParams = names;
            cb(err, statement);
        };

        var query_cache = cnx.takeCachedStatement(query);

        if (query_cache) {
            deliver(null, query_cache);
        } else {
            cnx.prepare(self, query, false, deliver);
        }
    }

    execute(query: string, params?: QueryParams | Callback, callback?: any, options?: InternalQueryOptions): void {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        var signal = options && options.signal;
        if (signal) {
            if (signal.aborted) {
                doError(abortError(signal), callback);
                return;
            }
            callback = hookAbortSignal(this.connection, signal, callback);
        }

        var self = this;
        this.newStatement(query, function(err: any, statement?: Statement) {

            if (err || !statement) {
                doError(err, callback);
                return;
            }

            function dropError(err: any) {
                // do not put a statement that just failed back into the cache
                // (statement is guaranteed by the guard above; hoisting keeps
                // the narrowing from reaching this function declaration)
                statement!._failed = true;
                statement!.release();
                doCallback(err, callback);
            }

            statement.execute(self, params, function(err: any, ret: any) {
                if (err) {
                    dropError(err);
                    return;
                }

                // withMeta applies to query/execute only: in streaming mode
                // (sequentially/queryStream, which spread user options) rows
                // bypass fetchAll's array, so a result object here would
                // carry rows: [] and a meaningless affectedRows
                var withMeta = Boolean(options && typeof options === 'object' &&
                    (options as any).withMeta && !(options as any).asStream);

                // Deliver the historic result shape, or — when options.withMeta
                // is set — request the per-verb DML row counts while the
                // statement handle is still open and wrap everything in a
                // { rows, fields, affectedRows, recordCounts, warnings } object.
                function deliver(rows: any, isSelect: boolean, plainDml?: boolean) {
                    if (!withMeta) {
                        statement!.release();
                        if (callback) {
                            if (plainDml) {
                                // plain DML historically calls back with no args
                                callback();
                            } else {
                                callback(undefined, rows, statement!.output, isSelect);
                            }
                        }
                        return;
                    }

                    var execWarnings = (ret && ret.warnings) || [];
                    var finalize = function(counts?: RecordCounts) {
                        statement!.release();
                        if (!callback) {
                            return;
                        }
                        // DML: what the server actually changed; SELECT: rows
                        // returned (pg's rowCount convention)
                        var affectedRows = counts
                            ? counts.insertCount + counts.updateCount + counts.deleteCount
                            : (Array.isArray(rows) ? rows.length : (rows !== undefined ? 1 : 0));
                        callback(undefined, {
                            rows: rows,
                            fields: describeFields(statement!.output),
                            affectedRows: affectedRows,
                            recordCounts: counts,
                            warnings: execWarnings,
                        }, statement!.output, isSelect);
                    };

                    var t = statement!.type;
                    var isDml = t === Const.isc_info_sql_stmt_insert ||
                        t === Const.isc_info_sql_stmt_update ||
                        t === Const.isc_info_sql_stmt_delete ||
                        t === Const.isc_info_sql_stmt_exec_procedure;
                    if (!isDml) {
                        finalize();
                        return;
                    }
                    self.connection.statementInfo(statement!, Const.RECORDS_INFO, function(err: any, info: any) {
                        if (err) {
                            dropError(err);
                            return;
                        }
                        finalize(parseRecordCounts(info && info.buffer));
                    });
                }

                switch (statement.type) {
                    case Const.isc_info_sql_stmt_select:
                        statement.fetchAll(self, function(err: any, r: any) {
                            if (err) {
                                dropError(err);
                                return;
                            }

                            deliver(r, true);
                        });

                        break;

                    case Const.isc_info_sql_stmt_exec_procedure:
                        if (ret && ret.data && ret.data.length > 0) {
                            deliver(ret.data[0], true);
                            break;
                        } else if (statement.output.length) {
                            statement.fetch(self, 1, function(err: any, fret: any) {
                                if (err) {
                                    dropError(err);
                                    return;
                                }

                                deliver(fret.data[0], false);
                            });

                            break;
                        }

                    // Fall through is normal
                    default:
                        deliver(undefined, false, true);
                        break;
                }

            }, options);
        }, options);
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
        var _on = function(row: any, i: number, meta: any[], next: (err?: any) => void) {
            var done = false;
            var finish = function(err?: any) {
                if (done) {
                    return;
                }
                done = true;
                next(err);
            };

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
        };

        // back compatibility - options parameter is a boolean
        if (typeof options === 'boolean') {
            options = { asObject: !options, asStream: true, on: _on };
        } else {
            options = {
                asStream: true,
                asObject: true,
                on: _on,
                ...options,
            };
        }

        self.execute(query, params, callback, options);
        return self;
    }

    /**
     * Run `query` inside this transaction and return an object-mode
     * Readable emitting one row per chunk, with real backpressure (see
     * Database.queryStream). The transaction is NOT committed when the
     * stream ends — commit or roll back yourself.
     */
    queryStream(query: string, params?: QueryParams, options?: QueryStreamOptions) {
        return makeQueryStream(this, query, params, options);
    }

    /**
     * Bulk-insert Writable running inside this transaction (see
     * Database.batchStream). The transaction is NOT committed or rolled
     * back by the stream — settle it yourself after 'finish'/'error'.
     */
    batchStream(query: string, options?: any) {
        return makeBatchStream(this, query, options, false);
    }

    query(query: string, params?: QueryParams | Callback, callback?: any, options: InternalQueryOptions = {}): void {
        if (params instanceof Function) {
            callback = params;
            params = undefined;
        }

        if (callback === undefined)
            callback = noop;

        options = {
            asObject: true,
            asStream: callback === undefined || callback === null,
            ...options,
        };

        this.execute(query, params, callback, options);
    }

    /**
     * Execute `query` once per row in `rows` using the Firebird 4 batch API
     * (protocol 16+, single network flush). The callback receives a
     * completion object: { recordCount, updateCounts, errors:
     * [{recordNumber, error}], errorRecordNumbers, success }. Per-record
     * failures do NOT roll anything back here — inspect the completion and
     * commit or roll back yourself (or use db.executeBatch for
     * all-or-nothing semantics).
     */
    executeBatch(query: string, rows: QueryParams[], callback?: BatchCb, options?: BatchOptions & QueryOptions): void {
        var self = this;
        this.newStatement(query, function(err: any, statement?: Statement) {
            if (err || !statement) {
                doError(err, callback);
                return;
            }

            statement.executeBatch(self, rows, function(err: any, result: BatchResult) {
                if (err)
                    statement._failed = true;
                statement.release();
                if (callback)
                    callback(err, result);
            }, options);
        }, options);
    }

    executeBatchAsync(query: string, rows: QueryParams[], options?: BatchOptions & QueryOptions): Promise<BatchResult> {
        var self = this;
        return fromCallback(function(cb) { self.executeBatch(query, rows, cb, options); });
    }

    commit(callback?: SimpleCallback): void {
        this.connection.commit(this, callback);
    }

    rollback(callback?: SimpleCallback): void {
        this.connection.rollback(this, callback);
    }

    commitRetaining(callback?: SimpleCallback): void {
        this.connection.commitRetaining(this, callback);
    }

    rollbackRetaining(callback?: SimpleCallback): void {
        this.connection.rollbackRetaining(this, callback);
    }

    /* Promise / async-await API — wrappers over the callback methods above. */

    queryAsync(query: string, params?: QueryParams, options?: InternalQueryOptions): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.query(query, params, cb, options); });
    }

    executeAsync(query: string, params?: QueryParams, options?: InternalQueryOptions): Promise<any[]> {
        var self = this;
        return fromCallback(function(cb) { self.execute(query, params, cb, options); });
    }

    sequentiallyAsync(query: string, params?: any, on?: SequentialCallback, options?: InternalQueryOptions | boolean): Promise<void> {
        if (params instanceof Function) {
            options = on;
            on = params;
            params = undefined;
        }
        var self = this;
        return fromCallback(function(cb) { self.sequentially(query, params, on, cb, options); });
    }

    newStatementAsync(query: string): Promise<Statement> {
        var self = this;
        return fromCallback(function(cb) { self.newStatement(query, cb); });
    }

    commitAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.commit(cb); });
    }

    rollbackAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.rollback(cb); });
    }

    commitRetainingAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.commitRetaining(cb); });
    }

    rollbackRetainingAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.rollbackRetaining(cb); });
    }
}

export = Transaction;
