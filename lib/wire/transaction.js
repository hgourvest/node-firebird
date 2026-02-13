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

    execute(query, params, callback, custom) {
        if (params instanceof Function) {
            custom = callback;
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

            }, custom);
        });
    }

    sequentially(query, params, on, callback, asArray) {
        if (params instanceof Function) {
            asArray = callback;
            callback = on;
            on = params;
            params = undefined;
        }

        if (on === undefined){
            throw new Error('Expected "on" delegate.');
        }

        if (callback instanceof Boolean) {
            asArray = callback;
            callback = undefined;
        }

        var self = this;
        self.execute(query, params, callback, { asObject: !asArray, asStream: true, on: on });
        return self;
    }

    query(query, params, callback) {
        if (params instanceof Function) {
            callback = params;
            params = undefined;
        }

        if (callback === undefined)
            callback = noop;

        this.execute(query, params, callback, { asObject: true, asStream: callback === undefined || callback === null });
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
