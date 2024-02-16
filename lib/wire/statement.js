/***************************************
 *
 *   Statement
 *
 ***************************************/

function Statement(connection) {
    this.connection = connection;
}

Statement.prototype.close = function(callback) {
    this.connection.closeStatement(this, callback);
};

Statement.prototype.drop = function(callback) {
    this.connection.dropStatement(this, callback);
};

Statement.prototype.release = function(callback) {
    var cache_query = this.connection.getCachedQuery(this.query);
    if (cache_query)
        this.connection.closeStatement(this, callback);
    else
        this.connection.dropStatement(this, callback);
};

Statement.prototype.execute = function(transaction, params, callback, custom) {

    if (params instanceof Function) {
        custom = callback;
        callback = params;
        params = undefined;
    }

    this.custom = custom;
    this.connection.executeStatement(transaction, this, params, callback, custom);
};

Statement.prototype.fetch = function(transaction, count, callback) {
    this.connection.fetch(this, transaction, count, callback);
};

Statement.prototype.fetchAll = function(transaction, callback) {
    this.connection.fetchAll(this, transaction, callback);
};

module.exports = Statement;
