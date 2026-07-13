import { doCallback, doError } from '../callback';
import { noop } from '../utils';
import Const from './const';

/***************************************
 *
 *   Transaction
 *
 ***************************************/

class Transaction {
    connection: any;
    db: any;
    handle: number;
    [key: string]: any;

    constructor(connection: any) {
        this.connection = connection;
        this.db = connection.db;
    }

    newStatement(query: string, callback: (err: any, statement?: any) => void): void {
        var cnx = this.connection;
        var self = this;
        var query_cache = cnx.getCachedQuery(query);

        if (query_cache) {
            callback(null, query_cache);
        } else {
            cnx.prepare(self, query, false, callback);
        }
    }

    execute(query: string, params?: any, callback?: any, options?: any): void {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        var self = this;
        this.newStatement(query, function(err: any, statement: any) {

            if (err) {
                doError(err, callback);
                return;
            }

            function dropError(err: any) {
                statement.release();
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
        });
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

    query(query: string, params?: any, callback?: any, options: any = {}): void {
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

    commit(callback?: (err?: any) => void): void {
        this.connection.commit(this, callback);
    }

    rollback(callback?: (err?: any) => void): void {
        this.connection.rollback(this, callback);
    }

    commitRetaining(callback?: (err?: any) => void): void {
        this.connection.commitRetaining(this, callback);
    }

    rollbackRetaining(callback?: (err?: any) => void): void {
        this.connection.rollbackRetaining(this, callback);
    }
}

export = Transaction;
