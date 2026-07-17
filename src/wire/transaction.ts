import { doCallback, doError, fromCallback, type Callback, type SimpleCallback } from '../callback';
import { parseNamedPlaceholders } from '../named-params';
import { noop } from '../utils';
import Const from './const';
import makeQueryStream from './query-stream';
import type Connection from './connection';
import type Database from './database';
import type Statement from './statement';
import type { BatchCb, StatementCb, InternalQueryOptions } from './wire-types';
import type { BatchOptions, BatchResult, QueryOptions, QueryParams, QueryStreamOptions, SequentialCallback } from '../types';

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

    constructor(connection: Connection) {
        this.connection = connection;
        this.db = connection.db;
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

                switch (statement.type) {
                    case Const.isc_info_sql_stmt_select:
                        statement.fetchAll(self, function(err: any, r: any) {
                            if (err) {
                                dropError(err);
                                return;
                            }

                            statement.release();

                            if (callback)
                                callback(undefined, r, statement.output, true);

                        });

                        break;

                    case Const.isc_info_sql_stmt_exec_procedure:
                        if (ret && ret.data && ret.data.length > 0) {
                            statement.release();

                            if (callback)
                                callback(undefined, ret.data[0], statement.output, true);

                            break;
                        } else if (statement.output.length) {
                            statement.fetch(self, 1, function(err: any, ret: any) {
                                if (err) {
                                    dropError(err);
                                    return;
                                }

                                statement.release();

                                if (callback)
                                    callback(undefined, ret.data[0], statement.output, false);
                            });

                            break;
                        }

                    // Fall through is normal
                    default:
                        statement.release();
                        if (callback)
                            callback()
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
