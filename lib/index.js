const Const = require('./wire/const');
const {doError, doCallback} = require('./callback');
const Connection = require('./wire/connection');
const Pool = require('./pool');
const {escape} = require('./utils');

if (typeof(setImmediate) === 'undefined') {
    global.setImmediate = function(cb) {
        process.nextTick(cb);
    };
}

exports.AUTH_PLUGIN_LEGACY = Const.AUTH_PLUGIN_LEGACY;
exports.AUTH_PLUGIN_SRP = Const.AUTH_PLUGIN_SRP;
// exports.AUTH_PLUGIN_SRP256 = Const.AUTH_PLUGIN_SRP256;

exports.WIRE_CRYPT_DISABLE = Const.WIRE_CRYPT_DISABLE;
exports.WIRE_CRYPT_ENABLE = Const.WIRE_CRYPT_ENABLE;

exports.ISOLATION_READ_UNCOMMITTED = Const.ISOLATION_READ_UNCOMMITTED;
exports.ISOLATION_READ_COMMITTED = Const.ISOLATION_READ_COMMITTED;
exports.ISOLATION_REPEATABLE_READ = Const.ISOLATION_REPEATABLE_READ;
exports.ISOLATION_SERIALIZABLE = Const.ISOLATION_SERIALIZABLE;
exports.ISOLATION_READ_COMMITTED_READ_ONLY = Const.ISOLATION_READ_COMMITTED_READ_ONLY;

if (!String.prototype.padLeft) {
    String.prototype.padLeft = function(max, c) {
        var self = this;
        return new Array(Math.max(0, max - self.length + 1)).join(c || ' ') + self;
    };
}

exports.escape = escape;

exports.attach = function(options, callback) {
    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;
    var manager = options.manager || false;
    var cnx = this.connection = new Connection(host, port, function(err) {

        if (err) {
            doError(err, callback);
            return;
        }

        cnx.connect(options, function(err) {
            if (err) {
                doError(err, callback);
            } else {
                if (manager)
                    cnx.svcattach(options, callback);
                else
                    cnx.attach(options, callback);
            }
        });

    }, options);
};

exports.drop = function(options, callback) {
	exports.attach(options, function(err, db) {
		if (err) {
			callback({ error: err, message: "Drop error" });
			return;
		}

		db.drop(callback);
	});
};

exports.create = function(options, callback) {
    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;
    var cnx = this.connection = new Connection(host, port, function(err) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" });
            return;
        }

        cnx.connect(options, function(err) {
            if (err) {
                self.db.emit('error', err);
                doError(err, callback);
                return;
            }

            cnx.createDatabase(options, callback);
        });
    }, options);
};

exports.attachOrCreate = function(options, callback) {

    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;

    var cnx = this.connection = new Connection(host, port, function(err) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" });
            return;
        }

        cnx.connect(options, function(err) {

            if (err) {
                doError(err, callback);
                return;
            }

            cnx.attach(options, function(err, ret) {

                if (!err) {
                    if (self.db)
                        self.db.emit('connect', ret);
                    doCallback(ret, callback);
                    return;
                }

                cnx.createDatabase(options, callback);
            });
        });

    }, options);
};

// Pooling
exports.pool = function(max, options) {
	return new Pool(exports.attach, max, Object.assign({}, options, { isPool: true }));
};
