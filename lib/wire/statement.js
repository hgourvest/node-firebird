/***************************************
 *
 *   Statement
 *
 ***************************************/

class Statement {
    constructor(connection) {
        this.connection = connection;
    }

    close(callback) {
        this.connection.closeStatement(this, callback);
    }

    drop(callback) {
        this.connection.dropStatement(this, callback);
    }

    release(callback) {
        var cache_query = this.connection.getCachedQuery(this.query);
        if (cache_query)
            this.connection.closeStatement(this, callback);
        else
            this.connection.dropStatement(this, callback);
    }

    execute(transaction, params, callback, options) {
        if (params instanceof Function) {
            options = callback;
            callback = params;
            params = undefined;
        }

        this.options = options;
        this.connection.executeStatement(transaction, this, params, callback, options);
    }

    fetch(transaction, count, callback) {
        this.connection.fetch(this, transaction, count, callback);
    }

    fetchAll(transaction, callback) {
        this.connection.fetchAll(this, transaction, callback);
    }
}

module.exports = Statement;
