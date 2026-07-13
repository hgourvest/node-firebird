/***************************************
 *
 *   Statement
 *
 ***************************************/

class Statement {
    connection: any;
    query: string;
    type: number;
    output: any[];
    input: any[];
    options: any;
    handle: number;
    plan: string;
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
        var cache_query = this.connection.getCachedQuery(this.query);
        if (cache_query)
            this.connection.closeStatement(this, callback);
        else
            this.connection.dropStatement(this, callback);
    }

    execute(transaction: any, params?: any, callback?: any, options?: any): void {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
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
}

export = Statement;
