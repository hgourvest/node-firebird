/***************************************
 *
 *   Statement
 *
 ***************************************/

import { doError, fromCallback, type Callback, type SimpleCallback } from '../callback';
import { bindNamedParams, isNamedParamsObject } from '../named-params';
import type Connection from './connection';
import type Transaction from './transaction';
import type { SQLVarBase } from './xsqlvar';
import type { QueryOptions, QueryParams } from '../types';

class Statement {
    connection: Connection;
    // populated externally from the op_allocate_statement /
    // op_prepare_statement responses (see describe() in connection.ts),
    // hence the definite assignment assertions
    query!: string;
    type!: number;
    output!: SQLVarBase[];
    input!: SQLVarBase[];
    /** per-execute query options (asObject/asStream/timeout/...) */
    options: QueryOptions & { [key: string]: any } | undefined;
    handle!: number;
    plan!: string;
    /**
     * Placeholder names in positional order when this statement was
     * prepared from SQL with named placeholders (namedPlaceholders on),
     * null/undefined otherwise. Set by Transaction.newStatement.
     */
    namedParams?: string[] | null;
    /** set when an execute/fetch on this statement errored — the statement
     *  is dropped on release instead of going back into the cache */
    _failed?: boolean;
    /** rows fetched so far by the current cursor (decodeResponse) */
    nbrowsfetched?: number;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    close(callback?: SimpleCallback): void {
        this.connection.closeStatement(this, callback);
    }

    drop(callback?: SimpleCallback): void {
        this.connection.dropStatement(this, callback);
    }

    release(callback?: SimpleCallback): void {
        this.connection.releaseStatement(this, callback);
    }

    execute(transaction: Transaction, params?: any, callback?: any, options?: any): void {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        if (this.namedParams && isNamedParamsObject(params)) {
            try {
                params = bindNamedParams(this.namedParams, params);
            } catch (err) {
                doError(err, callback);
                return;
            }
        }

        this.options = options;
        this.connection.executeStatement(transaction, this, params, callback, options);
    }

    fetch(transaction: Transaction, count: number | string, callback: Callback): void {
        this.connection.fetch(this, transaction, count, callback);
    }

    fetchScroll(transaction: Transaction, direction: string | number, offset?: any, count?: any, callback?: any): void {
        if (typeof count === 'function') {
            callback = count;
            count = undefined;
        }
        if (typeof offset === 'function') {
            callback = offset;
            offset = undefined;
            count = undefined;
        }
        this.connection.fetchScroll(this, transaction, direction, offset, count, callback);
    }

    fetchAll(transaction: Transaction, callback: Callback): void {
        this.connection.fetchAll(this, transaction, callback);
    }

    /**
     * Execute this statement once per row via the Firebird 4 batch API
     * (protocol 16+). `rows` is an array of parameter arrays — or, when the
     * statement was prepared with named placeholders, of values-by-name
     * objects (the two forms can be mixed).
     */
    executeBatch(transaction: Transaction, rows: QueryParams[], callback?: any, options?: any): void {
        var names = this.namedParams;
        if (names && Array.isArray(rows)) {
            try {
                rows = rows.map(function(row: any) {
                    return isNamedParamsObject(row) ? bindNamedParams(names as string[], row) : row;
                });
            } catch (err) {
                doError(err, callback);
                return;
            }
        }
        this.connection.executeBatch(transaction, this, rows, callback, options);
    }

    /* Promise / async-await API — wrappers over the callback methods above. */

    executeAsync(transaction: Transaction, params?: any, options?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.execute(transaction, params, cb, options); });
    }

    executeBatchAsync(transaction: Transaction, rows: QueryParams[], options?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.executeBatch(transaction, rows, cb, options); });
    }

    fetchAsync(transaction: Transaction, count: number | string): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.fetch(transaction, count, cb); });
    }

    fetchScrollAsync(transaction: Transaction, direction: string | number, offset?: any, count?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.fetchScroll(transaction, direction, offset, count, cb); });
    }

    fetchAllAsync(transaction: Transaction): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.fetchAll(transaction, cb); });
    }

    closeAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.close(cb); });
    }

    dropAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.drop(cb); });
    }

    releaseAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.release(cb); });
    }
}

export = Statement;
