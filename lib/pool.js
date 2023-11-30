/***************************************
 *
 *   Simple Pooling
 *
 ***************************************/

function Pool(attach, max, options) {
    this.attach = attach;
    this.internaldb = []; // connection created by the pool (for destroy)
    this.pooldb = []; // available connection in the pool
    this.dbinuse = 0; // connection currently in use into the pool
    this.max = max || 4;
    this.pending = [];
    this.options = options;
}

Pool.prototype.get = function(callback) {
    var self = this;
    self.pending.push(callback);
    self.check();
    return self;
};

Pool.prototype.check = function() {

    var self = this;
    if (self.dbinuse >= self.max)
        return self;

    var cb = self.pending.shift();
    if (!cb)
        return self;
    self.dbinuse++;
    if (self.pooldb.length) {
        cb(null, self.pooldb.shift());
    } else {
        this.attach(self.options, function (err, db) {
            if (!err) {
                self.internaldb.push(db);
                db.on('detach', function () {
                    // also in pool (could be a twice call to detach)
                    if (self.pooldb.indexOf(db) !== -1 || self.internaldb.indexOf(db) === -1)
                        return;
                    // if not usable don't put in again in the pool and remove reference on it
                    if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled === false)
                        self.internaldb.splice(self.internaldb.indexOf(db), 1);
                    else
                        self.pooldb.push(db);

                    if (db.connection._pooled)
                        self.dbinuse--;
                    self.check();
                });
            } else {
                // attach fail so not in the pool
                self.dbinuse--;
            }

            cb(err, db);
        });
    }
    setImmediate(function() {
        self.check();
    });

    return self;
};

Pool.prototype.destroy = function(callback) {
    var self = this;

    var connectionCount = this.internaldb.length;

    if (connectionCount === 0 && callback) {
        callback();
    }

    function detachCallback(err) {
        if (err) {
            if (callback) {
                callback(err);
            }
            return;
        }

        connectionCount--;
        if (connectionCount === 0 && callback) {
            callback();
        }
    }

    this.internaldb.forEach(function(db) {
        if (db.connection._pooled === false) {
            detachCallback();
            return;
        }
        // check if the db is not free into the pool otherwise user should manual detach it
        var _db_in_pool = self.pooldb.indexOf(db);
        if (_db_in_pool !== -1) {
            self.pooldb.splice(_db_in_pool, 1);
            db.connection._pooled = false;
            db.detach(detachCallback);
        }
    });
};

module.exports = Pool;
