const {doCallback, doError} = require('../callback');
const Const = require('./const');

/***************************************
 *
 *   Transaction
 *
 ***************************************/

class Transaction {
    constructor(connection) {
        this.connection = connection;
        this.db = connection.db;
    }

    newStatement(query, callback) {
        var cnx = this.connection;
        var self = this;
        var query_cache = cnx.getCachedQuery(query);

        if (query_cache) {
            callback(null, query_cache);
        } else {
            cnx.prepare(self, query, false, callback);
        }
    }

    execute(query, params, callback, options) {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        var self = this;
        this.newStatement(query, function(err, statement) {

            if (err) {
                doError(err, callback);
                return;
            }

            function dropError(err) {
                statement.release();
                doCallback(err, callback);
            }

            statement.execute(self, params, function(err, ret) {
                if (err) {
                    dropError(err);
                    return;
                }

                switch (statement.type) {
                    case Const.isc_info_sql_stmt_select:
                        statement.fetchAll(self, function(err, r) {
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
                            statement.fetch(self, 1, function(err, ret) {
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

    query(query, params, callback, options = {}) {
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

    commit(callback) {
        this.connection.commit(this, callback);
    }

    rollback(callback) {
        this.connection.rollback(this, callback);
    }

    commitRetaining(callback) {
        this.connection.commitRetaining(this, callback);
    }

    rollbackRetaining(callback) {
        this.connection.rollbackRetaining(this, callback);
    }
}

module.exports = Transaction;
