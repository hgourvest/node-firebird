/***************************************
 *
 *   Statement
 *
 ***************************************/

import { doError, fromCallback } from '../callback';
import { bindNamedParams, isNamedParamsObject } from '../named-params';

class Statement {
    connection: any;
    // populated externally from the op_allocate_statement /
    // op_prepare_statement responses (see describe() in connection.ts),
    // hence the definite assignment assertions
    query!: string;
    type!: number;
    output!: any[];
    input!: any[];
    options: any;
    handle!: number;
    plan!: string;
    /**
     * Placeholder names in positional order when this statement was
     * prepared from SQL with named placeholders (namedPlaceholders on),
     * null/undefined otherwise. Set by Transaction.newStatement.
     */
    namedParams?: string[] | null;
    [key: string]: any;

    constructor(connection: any) {
        this.connection = connection;
    }

    close(callback?: (err?: any) => void): void {
        this.connection.closeStatement(this, callback);
    }

    drop(callback?: (err?: any) => void): void {
        this.connection.dropStatement(this, callback);
    }

    release(callback?: (err?: any) => void): void {
        this.connection.releaseStatement(this, callback);
    }

    execute(transaction: any, params?: any, callback?: any, options?: any): void {
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

    fetch(transaction: any, count: number | string, callback: (err: any, result?: any) => void): void {
        this.connection.fetch(this, transaction, count, callback);
    }

    fetchScroll(transaction: any, direction: string | number, offset?: any, count?: any, callback?: any): void {
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

    fetchAll(transaction: any, callback: (err: any, result?: any) => void): void {
        this.connection.fetchAll(this, transaction, callback);
    }

    /**
     * Execute this statement once per row via the Firebird 4 batch API
     * (protocol 16+). `rows` is an array of parameter arrays — or, when the
     * statement was prepared with named placeholders, of values-by-name
     * objects (the two forms can be mixed).
     */
    executeBatch(transaction: any, rows: any[][], callback?: any, options?: any): void {
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

    executeAsync(transaction: any, params?: any, options?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.execute(transaction, params, cb, options); });
    }

    executeBatchAsync(transaction: any, rows: any[][], options?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.executeBatch(transaction, rows, cb, options); });
    }

    fetchAsync(transaction: any, count: number | string): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.fetch(transaction, count, cb); });
    }

    fetchScrollAsync(transaction: any, direction: string | number, offset?: any, count?: any): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.fetchScroll(transaction, direction, offset, count, cb); });
    }

    fetchAllAsync(transaction: any): Promise<any> {
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
