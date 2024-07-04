const Events = require('events');
const net = require('net');
const os = require('os');
const path = require('path');
const BigInt = require('big-integer');

const {XdrWriter, BlrWriter, XdrReader, BitSet, BlrReader} = require('./serialize');
const {doCallback, doError} = require('../callback');
const srp = require('../srp');
const crypt = require('../unix-crypt');
const Const = require('./const');
const Xsql = require('./xsqlvar');
const ServiceManager = require('./service');
const Database = require('./database');
const Statement = require('./statement');
const Transaction = require('./transaction');
const {lookupMessages, noop, parseDate} = require('../utils');

/***************************************
 *
 *   Connection
 *
 ***************************************/

var Connection = function (host, port, callback, options, db, svc) {
    var self = this;
    this.db = db;
    this.svc = svc
    this._msg = new XdrWriter(32);
    this._blr = new BlrWriter(32);
    this._queue = [];
    this._detachTimeout;
    this._detachCallback;
    this._detachAuto;
    this._socket = net.createConnection(port, host);
    this._pending = [];
    this._isOpened = false;
    this._isClosed = false;
    this._isDetach = false;
    this._isUsed = false;
    this._pooled = options.isPool||false;
    this.options = options;
    this._bind_events(host, port, callback);
    this.error;
    this._retry_connection_id;
    this._retry_connection_interval = options.retryConnectionInterval || 1000;
    this._max_cached_query = options.maxCachedQuery || -1;
    this._cache_query = options.cacheQuery?{}:null;
    this._messageFile = options.messageFile || path.join(__dirname, 'firebird.msg');
};

Connection.prototype._setcachedquery = function (query, statement) {
    if (this._cache_query){
        if (this._max_cached_query === -1 || this._max_cached_query > Object.keys(this._cache_query).length){
            this._cache_query[query] = statement;
        }
    }


};

Connection.prototype.getCachedQuery = function (query) {
    return this._cache_query ? this._cache_query[query] : null;
};

Connection.prototype._bind_events = function(host, port, callback) {

    var self = this;

    self._socket.on('close', function() {

        if (!self._isOpened || self._isDetach) {
            return;
        }

        self._isOpened = false;

        if (!self.db) {
            if (callback)
                callback(self.error);
            return;
        }

        self._retry_connection_id = setTimeout(function() {
            self._socket.removeAllListeners();
            self._socket = null;

            var ctx = new Connection(host, port, function(err) {
                ctx.connect(self.options, function(err) {

                    if (err) {
                        self.db.emit('error', err);
                        return;
                    }

                    ctx.attach(self.options, function(err) {

                        if (err) {
                            self.db.emit('error', err);
                            return;
                        }

                        ctx._queue = ctx._queue.concat(self._queue);
                        ctx._pending = ctx._pending.concat(self._pending);
                        self.db.emit('reconnect');

                    }, self.db);
                });

                Object.assign(self, ctx);

            }, self.options, self.db);
        }, self._retry_connection_interval);

    });

    self._socket.on('error', function(e) {

        self.error = e;

        if (self.db)
            self.db.emit('error', e)

        if (callback)
            callback(e);

    });

    self._socket.on('connect', function() {
        self._isClosed = false;
        self._isOpened = true;
        if (callback)
            callback();
    });

    self._socket.on('data', function (data) {
        var xdr;

        if (!self._xdr) {
            xdr = new XdrReader(data);
        } else {
            xdr = new XdrReader(Buffer.concat([self._xdr.buffer, data], self._xdr.buffer.length + data.length));
            delete (self._xdr);
        }

        while (xdr.pos < xdr.buffer.length) {
            var cb = self._queue[0], pos = xdr.pos;

            decodeResponse(xdr, cb, self, self._lowercase_keys, function (err, obj) {

                if (err) {
                    xdr.buffer = xdr.buffer.slice(pos);
                    xdr.pos = 0;
                    self._xdr = xdr;

                    if (self.accept.protocolMinimumType === Const.ptype_lazy_send && self._queue.length > 0) {
                        self._queue[0].lazy_count = 2;
                    }
                    return;
                }

                // remove the op flag, needed for partial packet
                if (xdr.r) {
                    delete (xdr.r);
                }

                self._queue.shift();
                self._pending.shift();

                if (obj && obj.status) {
                    obj.message = lookupMessages(obj.status);
                    doCallback(obj, cb);
                } else {
                    doCallback(obj, cb);
                }

            });

            if (xdr.pos === 0) {
                break;
            }
        }

        if (!self._detachAuto || self._pending.length !== 0) {
            return;
        }

        clearTimeout(self._detachTimeout);
        self._detachTimeout = setTimeout(function () {
            self.db.detach(self._detachCallback);
            self._detachAuto = false;
        }, 100);

    });
}

Connection.prototype.disconnect = function() {
    this._socket.end();
};


function decodeResponse(data, callback, cnx, lowercase_keys, cb) {
    try {
        do {
            var r = data.r || data.readInt();
        } while (r === Const.op_dummy);

        var item, op, response;

        switch (r) {
            case Const.op_response:

                if (callback) {
                    response = callback.response || {};
                } else {
                    response = {};
                }

                let loop = function (err) {
                    if (err) {
                        return cb(err);
                    } else {
                        if (callback && callback.lazy_count) {
                            callback.lazy_count--;
                            if (callback.lazy_count > 0) {
                                r = data.readInt(); // Read new op
                                parseOpResponse(data, response, loop);
                            } else {
                                cb(null, response);
                            }
                        } else {
                            cb(null, response);
                        }
                    }
                };
                // Parse normal and lazy response
                return parseOpResponse(data, response, loop);
            case Const.op_fetch_response:
            case Const.op_sql_response:
                var statement = callback.statement;
                var output = statement.output;
                var custom = statement.custom || {};
                var isOpFetch = r === Const.op_fetch_response;
                var _xdrpos;
                statement.nbrowsfetched = statement.nbrowsfetched || 0;

                if (isOpFetch && data.fop) { // could be set when a packet is not complete
                    data.readBuffer(68); // ??
                    op = data.readInt(); // ??
                    data.fop = false;
                    if (op === Const.op_response) {
                        return parseOpResponse(data, {}, cb);
                    }
                }

                if (!isOpFetch) {
                    data.fstatus = 0;
                }

                data.fstatus = data.fstatus !== undefined ? data.fstatus : data.readInt();
                data.fcount = data.fcount !== undefined ? data.fcount : data.readInt();
                data.fcolumn = data.fcolumn || 0;
                data.frow = data.frow || (custom.asObject ? {} : new Array(output.length));
                data.frows = data.frows || [];

                if (custom.asObject && !data.fcols) {
                    if (lowercase_keys) {
                        data.fcols = output.map((column) => column.alias.toLowerCase());
                    } else {
                        data.fcols = output.map((column) => column.alias);
                    }
                }

                const arrBlob = [];
                const lowerV13 = statement.connection.accept.protocolVersion <  Const.PROTOCOL_VERSION13;

                while (data.fcount && (data.fstatus !== 100)) {
                    let nullBitSet;
                    if (!lowerV13) {
                        const nullBitsLen = Math.floor((output.length + 7) / 8);
                        nullBitSet = new BitSet(data.readBuffer(nullBitsLen, false));
                        data.readBuffer((4 - nullBitsLen) & 3, false); // Skip padding
                    }

                    for (let length = output.length; data.fcolumn < length; data.fcolumn++) {
                        item = output[data.fcolumn];

                        if (!lowerV13 && nullBitSet.get(data.fcolumn)) {
                            if (custom.asObject) {
                                data.frow[data.fcols[data.fcolumn]] = null;
                            } else {
                                data.frow[data.fcolumn] = null;
                            }

                            continue;
                        }

                        try {
                            _xdrpos = data.pos;
                            const key = custom.asObject ? data.fcols[data.fcolumn] : data.fcolumn;
                            const row = data.frows.length;
                            let value = item.decode(data, lowerV13);

                            if (item.type === Const.SQL_BLOB && value !== null) {
                                if (item.subType === Const.isc_blob_text && cnx.options.blobAsText) {
                                    value = fetch_blob_async_transaction(statement, value, key, row);
                                    arrBlob.push(value);
                                } else {
                                    value = fetch_blob_async(statement, value, key, row);
                                }
                            }

                            data.frow[key] = value;
                        } catch (e) {
                            // uncomplete packet read
                            data.pos = _xdrpos;
                            data.r = r;
                            return cb(new Error('Packet is not complete'));
                        }

                    }

                    data.fcolumn = 0;
                    // ToDo: emit "row" with blob subtype string decoded
                    // use: data.frow['fieldBlob'](transaction?).then(({ value }) => console.log(value))
                    // arg "transaction" is optional
                    statement.connection.db.emit('row', data.frow, statement.nbrowsfetched, custom.asObject);
                    data.frows.push(data.frow);
                    data.frow = custom.asObject ? {} : new Array(output.length);

                    try {
                        _xdrpos = data.pos;
                        if (isOpFetch) {
                            delete data.fstatus;
                            delete data.fcount;
                            op = data.readInt(); // ??
                            if (op === Const.op_response) {
                                return parseOpResponse(data, {}, cb);
                            }
                            data.fstatus = data.readInt();
                            data.fcount = data.readInt();
                        } else {
                            data.fcount--;
                            if (r === Const.op_sql_response) {
                                op = data.readInt();
                                if (op === Const.op_response) {
                                    parseOpResponse(data, {});
                                }
                            }
                        }
                    } catch (e) {
                        if (_xdrpos === data.pos) {
                            data.fop = true;
                        }
                        data.r = r;
                        return cb(new Error("Packet is not complete"));
                    }
                    statement.nbrowsfetched++;
                }

                // ToDo: emit "result" with blob subtype string decoded
                statement.connection.db.emit('result', data.frows, arrBlob);
                return cb(null, {data: data.frows, fetched: Boolean(!isOpFetch || data.fstatus === 100), arrBlob});
            case Const.op_accept:
            case Const.op_cond_accept:
            case Const.op_accept_data:
                let accept = {
                    protocolVersion: data.readInt(),
                    protocolArchitecture: data.readInt(),
                    protocolMinimumType: data.readInt(),
                    pluginName: '',
                    authData: '',
                    sessionKey: ''
                };

                accept.protocolMinimumType = accept.protocolMinimumType & 0xFF;
                //accept.compress = (accept.acceptType & pflag_compress) !== 0; // TODO Handle zlib compression
                if (accept.protocolVersion < 0) {
                    accept.protocolVersion = (accept.protocolVersion & Const.FB_PROTOCOL_MASK) | Const.FB_PROTOCOL_FLAG;
                }

                if (r === Const.op_cond_accept || r === Const.op_accept_data) {
                    var d = new BlrReader(data.readArray());
                    accept.pluginName = data.readString(Const.DEFAULT_ENCODING);
                    var is_authenticated = data.readInt();
                    var keys = data.readString(Const.DEFAULT_ENCODING); // keys

                    if (is_authenticated === 0) {
                        if (cnx.options.pluginName && cnx.options.pluginName !== accept.pluginName) {
                            doError(new Error('Server don\'t accept plugin : ' + cnx.options.pluginName + ', but support : ' + accept.pluginName), callback);
                        }

                        if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(accept.pluginName) !== -1) {
                            var crypto = {
                                Srp: 'sha1',
                                Srp256: 'sha256'
                            };
                            accept.srpAlgo = crypto[accept.pluginName];

                            // TODO : Fallback Srp256 to Srp ?
                            /*if (!d.buffer) {
                                cnx.sendOpContAuth(
                                    cnx.clientKeys.public.toString(16),
                                    DEFAULT_ENCODING,
                                    accept.pluginName
                                );

                                return cb(new Error('login'));
                            }*/

                            // Check buffer contains salt
                            var saltLen = d.buffer.readUInt16LE(0);
                            if (saltLen > 32 * 2) {
                                console.log('salt to long'); // TODO : Throw error
                            }

                            // Check buffer contains key
                            var keyLen = d.buffer.readUInt16LE(saltLen + 2);
                            var keyStart = saltLen + 4;
                            if (d.buffer.length - keyStart !== keyLen) {
                                console.log('key error'); // TODO : Throw error
                            }

                            // Server keys
                            cnx.serverKeys = {
                                salt: d.buffer.slice(2, saltLen + 2).toString('utf8'),
                                public: BigInt(d.buffer.slice(keyStart, d.buffer.length).toString('utf8'), 16)
                            };

                            var proof = srp.clientProof(
                                cnx.options.user.toUpperCase(),
                                cnx.options.password,
                                cnx.serverKeys.salt,
                                cnx.clientKeys.public,
                                cnx.serverKeys.public,
                                cnx.clientKeys.private,
                                accept.srpAlgo
                            );

                            accept.authData = proof.authData.toString(16);
                            accept.sessionKey = proof.clientSessionKey;
                        } else if (accept.pluginName === Const.AUTH_PLUGIN_LEGACY) {
                            accept.authData = crypt.crypt(cnx.options.password, Const.LEGACY_AUTH_SALT).substring(2);
                        } else {
                            return cb(new Error('Unknow auth plugin : ' + accept.pluginName));
                        }
                    } else {
                        accept.authData = '';
                        accept.sessionKey = '';
                    }
                }

                return cb(undefined, accept);
            case Const.op_cont_auth:
                var d = new BlrReader(data.readArray());
                var pluginName = data.readString(Const.DEFAULT_ENCODING);
                data.readString(Const.DEFAULT_ENCODING); // plist
                data.readString(Const.DEFAULT_ENCODING); // pkey

                if (!cnx.options.pluginName) {
                    if (cnx.accept.pluginName === pluginName) {
                        // Erreur plugin not able to connect
                        return cb(new Error("Unable to connect with plugin " + cnx.accept.pluginName));
                    }

                    if (pluginName === Const.AUTH_PLUGIN_LEGACY) { // Fallback to LegacyAuth
                        cnx.accept.pluginName = pluginName;
                        cnx.accept.authData = crypt.crypt(cnx.options.password, Const.LEGACY_AUTH_SALT).substring(2);

                        cnx.sendOpContAuth(
                            cnx.accept.authData,
                            Const.DEFAULT_ENCODING,
                            pluginName
                        );

                        return {error: new Error('login')};
                    }
                }

                return data.accept;
            default:
                return cb(new Error('Unexpected:' + r));
        }
    } catch (err) {
        if (err instanceof RangeError) {
            return cb(err);
        }
        throw err;
    }
}

function parseOpResponse(data, response, cb) {
    var handle = data.readInt();

    if (!response.handle) {
        response.handle = handle;
    }

    var oid = data.readQuad();
    if (oid.low || oid.high) {
        response.oid = oid;
    }

    var buf = data.readArray();
    if (buf) {
        response.buffer = buf;
    }

    var num, op, item = {};
    while (true) {
        op = data.readInt();

        switch (op) {
            case Const.isc_arg_end:
                return cb ? cb(undefined, response) : response;
            case Const.isc_arg_gds:
                num = data.readInt();
                if (!num) {
                    break;
                }

                item = {gdscode: num};

                if (response.status) {
                    response.status.push(item);
                } else {
                    response.status = [item];
                }

                break;
            case Const.isc_arg_string:
            case Const.isc_arg_interpreted:
            case Const.isc_arg_sql_state:
                if (item.params) {
                    var str = data.readString(Const.DEFAULT_ENCODING);
                    item.params.push(str);
                } else {
                    item.params = [data.readString(Const.DEFAULT_ENCODING)];
                }

                break;
            case Const.isc_arg_number:
                num = data.readInt();

                if (item.params) {
                    item.params.push(num);
                } else {
                    item.params = [num];
                }

                if (item.gdscode === Const.isc_sqlerr) {
                    response.sqlcode = num;
                }

                break;
            default:
                if (cb) {
                    cb(new Error('Unexpected: ' + op))
                } else {
                    throw new Error('Unexpected: ' + op);
                }
        }
    }
}

Connection.prototype.sendOpContAuth = function(authData, authDataEnc, pluginName) {
    var msg = this._msg;
    msg.pos = 0;

    msg.addInt(Const.op_cont_auth);
    msg.addString(authData, authDataEnc);
    msg.addString(pluginName, Const.DEFAULT_ENCODING)
    msg.addString(Const.AUTH_PLUGIN_LIST.join(','), Const.DEFAULT_ENCODING);
    // msg.addInt(0); // p_list
    msg.addInt(0); // keys

    this._socket.write(msg.getData());
}

Connection.prototype._queueEvent = function(callback){
    var self = this;

    if (self._isClosed) {
        if (callback)
            callback(new Error('Connection is closed.'));
        return;
    }

    self._queue.push(callback);
    self._socket.write(self._msg.getData());
};

Connection.prototype.connect = function (options, callback) {
    var pluginName = options.manager ? Const.AUTH_PLUGIN_LEGACY : options.pluginName || Const.AUTH_PLUGIN_LIST[0]; // TODO Srp for service
    var msg = this._msg;
    var blr = this._blr;

    this._pending.push('connect');

    msg.pos = 0;
    blr.pos = 0;

    blr.addString(Const.CNCT_login, options.user, Const.DEFAULT_ENCODING);
    blr.addString(Const.CNCT_plugin_name, pluginName, Const.DEFAULT_ENCODING);
    blr.addString(Const.CNCT_plugin_list, Const.AUTH_PLUGIN_LIST.join(','), Const.DEFAULT_ENCODING);

    var specificData = '';
    if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(pluginName) > -1) {
        this.clientKeys = srp.clientSeed();
        specificData = this.clientKeys.public.toString(16);
        blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
    } else if (pluginName === Const.AUTH_PLUGIN_LEGACY) {
        specificData = crypt.crypt(options.password, Const.LEGACY_AUTH_SALT).substring(2);
        blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
    } else {
        doError(new Error('Invalide auth plugin \'' + pluginName + '\''), callback);
        return;
    }
    blr.addBytes([Const.CNCT_client_crypt, 4, Const.WIRE_CRYPT_DISABLE, 0, 0, 0]); // WireCrypt = Disabled
    blr.addString(Const.CNCT_user, os.userInfo().username || 'Unknown', Const.DEFAULT_ENCODING);
    blr.addString(Const.CNCT_host, os.hostname(), Const.DEFAULT_ENCODING);
    blr.addBytes([Const.CNCT_user_verification, 0]);

    msg.addInt(Const.op_connect);
    msg.addInt(Const.op_attach);
    msg.addInt(Const.CONNECT_VERSION3);
    msg.addInt(Const.ARCHITECTURE_GENERIC);
    msg.addString(options.database || options.filename, Const.DEFAULT_ENCODING);
    msg.addInt(Const.SUPPORTED_PROTOCOL.length);  // Count of Protocol version understood count.
    msg.addBlr(this._blr);

    for (var protocol of Const.SUPPORTED_PROTOCOL) {
        msg.addInt(protocol[0]); // Version
        msg.addInt(protocol[1]); // Architecture
        msg.addInt(protocol[2]); // Min type
        msg.addInt(protocol[3]); // Max type
        msg.addInt(protocol[4]); // Preference weight
    }

    var self = this;
    function cb(err, ret) {
        if (err) {
            doError(err, callback);
            return;
        }

        self.accept = ret;
        if (callback)
            callback(undefined, ret);
    }

    this._queueEvent(cb);
};

Connection.prototype.attach = function (options, callback, db) {
    this._lowercase_keys = options.lowercase_keys || Const.DEFAULT_LOWERCASE_KEYS;

    var database = options.database || options.filename;
    if (database == null || database.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var user = options.user || Const.DEFAULT_USER;
    var password = options.password || Const.DEFAULT_PASSWORD;
    var role = options.role;
    var self = this;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addByte(Const.isc_dpb_version1);
    blr.addString(Const.isc_dpb_lc_ctype, options.encoding || 'UTF8', Const.DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
    if (options.password && !this.accept.authData) {
        if (this.accept.protocolVersion < Const.PROTOCOL_VERSION13) {
            if (this.accept.protocolVersion === Const.PROTOCOL_VERSION10) {
                blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
            } else {
                blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, Const.LEGACY_AUTH_SALT).substring(2), Const.DEFAULT_ENCODING);
            }
        }
    }

    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);

    blr.addBytes([Const.isc_dpb_process_id, 4]);
    blr.addInt32(process.pid);

    let processName  = process.title || "";
    blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255,  processName.length) : processName, Const.DEFAULT_ENCODING);

    if (this.accept.authData) {
        blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, Const.DEFAULT_ENCODING);
    }

    msg.addInt(Const.op_attach);
    msg.addInt(0);  // Database Object ID
    msg.addString(database, Const.DEFAULT_ENCODING);
    msg.addBlr(this._blr);

    function cb(err, ret) {
        if (err) {
            doError(err, callback);
            return;
        }

        self.dbhandle = ret.handle;
        if (callback)
            callback(undefined, ret);
    }

    // For reconnect
    if (db) {
        db.connection = this;
        cb.response = db;
    } else {
        cb.response = new Database(this);
        cb.response.removeAllListeners('error');
        cb.response.on('error', noop);
    }

    this._queueEvent(cb);
};

Connection.prototype.detach = function (callback) {

    var self = this;

    if (self._isClosed)
        return;

    self._isUsed = false;
    self._isDetach = true;

    var msg = self._msg;

    msg.pos = 0;
    msg.addInt(Const.op_detach);
    msg.addInt(0); // Database Object ID

    self._queueEvent(function(err, ret) {
        clearTimeout(self._retry_connection_id);
        delete(self.dbhandle);
        if (callback)
            callback(err, ret);
    });
};

Connection.prototype.createDatabase = function (options, callback) {
    var database = options.database || options.filename;
    if (database == null || database.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var user = options.user || Const.DEFAULT_USER;
    var password = options.password || Const.DEFAULT_PASSWORD;
    var pageSize = options.pageSize || Const.DEFAULT_PAGE_SIZE;
    var role = options.role;
    var blr = this._blr;

    blr.pos = 0;
    blr.addByte(Const.isc_dpb_version1);
    blr.addString(Const.isc_dpb_set_db_charset, 'UTF8', Const.DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_lc_ctype, 'UTF8', Const.DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
    if (this.accept.protocolVersion < Const.PROTOCOL_VERSION13) {
        if (this.accept.protocolVersion === Const.PROTOCOL_VERSION10) {
            blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
        } else {
            blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, Const.LEGACY_AUTH_SALT).substring(2), Const.DEFAULT_ENCODING);
        }
    }
    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);

    blr.addBytes([Const.isc_dpb_process_id, 4]);
    blr.addInt32(process.pid);

    let processName  = process.title || "";
    blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255,  processName.length) : processName, Const.DEFAULT_ENCODING);

    if (this.accept.authData) {
        blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, Const.DEFAULT_ENCODING);
    }

    blr.addNumeric(Const.isc_dpb_sql_dialect, 3);
    blr.addNumeric(Const.isc_dpb_force_write, 1);
    blr.addNumeric(Const.isc_dpb_overwrite, 1);
    blr.addNumeric(Const.isc_dpb_page_size, pageSize);

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_create);  // op_create
    msg.addInt(0);          // Database Object ID
    msg.addString(database, Const.DEFAULT_ENCODING);
    msg.addBlr(blr);

    var self = this;

    function cb(err, ret) {

        if (ret)
            self.dbhandle = ret.handle;

        setImmediate(function() {
            if (self.db)
                self.db.emit('attach', ret);
        });

        if (callback)
            callback(err, ret);
    }

    cb.response = new Database(this);
    this._queueEvent(cb);
};

Connection.prototype.dropDatabase = function (callback) {
    var msg = this._msg;
    msg.pos = 0;

    msg.addInt(Const.op_drop_database);
    msg.addInt(this.dbhandle);

    var self = this;
    this._queueEvent(function(err) {
        self.detach(function() {
            self.disconnect();

            if (callback)
                callback(err);
        });
    });
};

Connection.prototype.throwClosed = function(callback) {
    var err = new Error('Connection is closed.');
    this.db.emit('error', err);
    if (callback)
        callback(err);
    return this;
};

Connection.prototype.startTransaction = function(isolation, callback) {

    if (typeof(isolation) === 'function') {
        var tmp = isolation;
        isolation = callback;
        callback = tmp;
    }

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('startTransaction');

    var blr = this._blr;
    var msg = this._msg;

    blr.pos = 0;
    msg.pos = 0;

    blr.addBytes(isolation || Const.ISOLATION_REPEATABLE_READ);
    msg.addInt(Const.op_transaction);
    msg.addInt(this.dbhandle);
    msg.addBlr(blr);
    callback.response = new Transaction(this);

    this.db.emit('transaction', isolation);
    this._queueEvent(callback);
};

Connection.prototype.commit = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('commit');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_commit);
    msg.addInt(transaction.handle);
    this.db.emit('commit');
    this._queueEvent(callback);
};

Connection.prototype.rollback = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('rollback');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_rollback);
    msg.addInt(transaction.handle);
    this.db.emit('rollback');
    this._queueEvent(callback);
};

Connection.prototype.commitRetaining = function (transaction, callback) {

    if (this._isClosed)
        throw new Error('Connection is closed.');

    // for auto detach
    this._pending.push('commitRetaining');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_commit_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback);
};

Connection.prototype.rollbackRetaining = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('rollbackRetaining');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_rollback_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback);
};

Connection.prototype.allocateStatement = function (callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('allocateStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_allocate_statement);
    msg.addInt(this.dbhandle);
    callback.response = new Statement(this);
    this._queueEvent(callback);
};

Connection.prototype.dropStatement = function (statement, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('dropStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(Const.DSQL_drop);
    this._queueEvent(callback);
};

Connection.prototype.closeStatement = function (statement, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('closeStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(Const.DSQL_close);

    this._queueEvent(callback);
};

Connection.prototype.allocateAndPrepareStatement = function (transaction, query, plan, callback) {
    var self = this;
    var mainCallback = function(err, ret) {
        if (!err) {
            mainCallback.response.handle = ret.handle;
            describe(ret.buffer, mainCallback.response);
            mainCallback.response.query = query;
            self.db.emit('query', query);
            ret = mainCallback.response;
            self._setcachedquery(query, ret);
        }

        if (callback)
            callback(err, ret);
    };

    // for auto detach
    this._pending.push('allocateAndPrepareStatement');

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    msg.addInt(Const.op_allocate_statement);
    msg.addInt(this.dbhandle);
    mainCallback.lazy_count = 1;

    blr.addBytes(Const.DESCRIBE);
    if (plan)
        blr.addByte(Const.isc_info_sql_get_plan);

    msg.addInt(Const.op_prepare_statement);
    msg.addInt(transaction.handle);
    msg.addInt(0xFFFF);
    msg.addInt(3); // dialect = 3
    msg.addString(query, Const.DEFAULT_ENCODING);
    msg.addBlr(blr);
    msg.addInt(65535); // buffer_length
    mainCallback.lazy_count += 1;

    mainCallback.response = new Statement(this);
    this._queueEvent(mainCallback);
};

Connection.prototype.prepare = function (transaction, query, plan, callback) {
    var self = this;

    if (this.accept.protocolMinimumType === Const.ptype_lazy_send) { // V11 Statement or higher
        self.allocateAndPrepareStatement(transaction, query, plan, callback);
    } else { // V10 Statement
        self.allocateStatement(function (err, statement) {
            if (err) {
                doError(err, callback);
                return;
            }

            self.prepareStatement(transaction, statement, query, plan, callback);
        });
    }
};

function describe(buff, statement) {
    var br = new BlrReader(buff);
    var parameters = null;
    var type, param;

    while (br.pos < br.buffer.length) {
        switch (br.readByteCode()) {
            case Const.isc_info_sql_stmt_type:
                statement.type = br.readInt();
                break;
            case Const.isc_info_sql_get_plan:
                statement.plan = br.readString(Const.DEFAULT_ENCODING);
                break;
            case Const.isc_info_sql_select:
                statement.output = parameters = [];
                break;
            case Const.isc_info_sql_bind:
                statement.input = parameters = [];
                break;
            case Const.isc_info_sql_num_variables:
                br.readInt(); // eat int
                break;
            case Const.isc_info_sql_describe_vars:
                if (!parameters) {return}
                br.readInt(); // eat int ?
                var finishDescribe = false;
                param = null;
                while (!finishDescribe){
                    switch (br.readByteCode()) {
                        case Const.isc_info_sql_describe_end:
                            break;
                        case Const.isc_info_sql_sqlda_seq:
                            var num = br.readInt();
                            break;
                        case Const.isc_info_sql_type:
                            type = br.readInt();
                            switch (type&~1) {
                                case Const.SQL_VARYING:   param = new Xsql.SQLVarString(); break;
                                case Const.SQL_NULL:      param = new Xsql.SQLVarNull(); break;
                                case Const.SQL_TEXT:      param = new Xsql.SQLVarText(); break;
                                case Const.SQL_DOUBLE:    param = new Xsql.SQLVarDouble(); break;
                                case Const.SQL_FLOAT:
                                case Const.SQL_D_FLOAT:   param = new Xsql.SQLVarFloat(); break;
                                case Const.SQL_TYPE_DATE: param = new Xsql.SQLVarDate(); break;
                                case Const.SQL_TYPE_TIME: param = new Xsql.SQLVarTime(); break;
                                case Const.SQL_TIMESTAMP: param = new Xsql.SQLVarTimeStamp(); break;
                                case Const.SQL_BLOB:      param = new Xsql.SQLVarBlob(); break;
                                case Const.SQL_ARRAY:     param = new Xsql.SQLVarArray(); break;
                                case Const.SQL_QUAD:      param = new Xsql.SQLVarQuad(); break;
                                case Const.SQL_LONG:      param = new Xsql.SQLVarInt(); break;
                                case Const.SQL_SHORT:     param = new Xsql.SQLVarShort(); break;
                                case Const.SQL_INT64:     param = new Xsql.SQLVarInt64(); break;
                                case Const.SQL_INT128:     param = new Xsql.SQLVarInt128(); break;
                                case Const.SQL_BOOLEAN:   param = new Xsql.SQLVarBoolean(); break;
                                default:
                                    throw new Error('Unexpected');
                            }
                            parameters[num-1] = param;
                            param.type = type;
                            param.nullable = Boolean(param.type & 1);
                            param.type &= ~1;
                            break;
                        case Const.isc_info_sql_sub_type:
                            param.subType = br.readInt();
                            break;
                        case Const.isc_info_sql_scale:
                            param.scale = br.readInt();
                            break;
                        case Const.isc_info_sql_length:
                            param.length = br.readInt();
                            break;
                        case Const.isc_info_sql_null_ind:
                            param.nullable = Boolean(br.readInt());
                            break;
                        case Const.isc_info_sql_field:
                            param.field = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_relation:
                            param.relation = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_owner:
                            param.owner = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_alias:
                            param.alias = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_relation_alias:
                            param.relationAlias = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_truncated:
                            throw new Error('Truncated');
                        default:
                            finishDescribe = true;
                            br.pos--;
                    }
                }
        }
    }
}

Connection.prototype.prepareStatement = function (transaction, statement, query, plan, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    if (plan instanceof Function) {
        callback = plan;
        plan = false;
    }

    blr.addBytes(Const.DESCRIBE);

    if (plan)
        blr.addByte(Const.isc_info_sql_get_plan);

    msg.addInt(Const.op_prepare_statement);
    msg.addInt(transaction.handle);
    msg.addInt(statement.handle);
    msg.addInt(3); // dialect = 3
    msg.addString(query, Const.DEFAULT_ENCODING);
    msg.addBlr(blr);
    msg.addInt(65535); // buffer_length

    var self = this;
    this._queueEvent(function(err, ret) {

        if (!err) {
            describe(ret.buffer, statement);
            statement.query = query;
            self.db.emit('query', query);
            ret = statement;
            self._setcachedquery(query, ret);
        }

        if (callback)
            callback(err, ret);
    });

};

function CalcBlr(blr, xsqlda) {
    blr.addBytes([Const.blr_version5, Const.blr_begin, Const.blr_message, 0]); // + message number
    blr.addWord(xsqlda.length * 2);

    for (var i = 0, length = xsqlda.length; i < length; i++) {
        xsqlda[i].calcBlr(blr);
        blr.addByte(Const.blr_short);
        blr.addByte(0);
    }

    blr.addByte(Const.blr_end);
    blr.addByte(Const.blr_eoc);
}

Connection.prototype.executeStatement = function(transaction, statement, params, callback, custom) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('executeStatement');

    if (params instanceof Function) {
        callback = params;
        params = undefined;
    }

    var self = this;

    var op = Const.op_execute;
    if (
        this.accept.protocolVersion >= Const.PROTOCOL_VERSION13 &&
        statement.type === Const.isc_info_sql_stmt_exec_procedure &&
        statement.output.length
    ) {
        op = Const.op_execute2;
    }

    function PrepareParams(params, input, callback) {

        var value, meta;
        var ret = new Array(params.length);
        var wait = params.length;

        function done() {
            wait--;
            if (wait === 0)
                callback(ret);
        }

        function putBlobData(index, value, callback) {

            self.createBlob2(transaction, function(err, blob) {

                var b;
                var isStream = value.readable;

                if (Buffer.isBuffer(value))
                    b = value;
                else if (typeof(value) === 'string')
                    b = Buffer.from(value, Const.DEFAULT_ENCODING);
                else if (!isStream)
                    b = Buffer.from(JSON.stringify(value), Const.DEFAULT_ENCODING);

                if (Buffer.isBuffer(b)) {
                    bufferReader(b, 1024, function(b, next) {
                        self.batchSegments(blob, b, next);
                    }, function() {
                        ret[index] = new Xsql.SQLParamQuad(blob.oid);
                        self.closeBlob(blob, callback);
                    });
                    return;
                }

                var isReading = false;
                var isEnd = false;

                value.on('data', function(chunk) {
                    value.pause();
                    isReading = true;
                    bufferReader(chunk, 1024, function(b, next) {
                        self.batchSegments(blob, b, next);
                    }, function() {
                        isReading = false;

                        if (isEnd) {
                            ret[index] = new Xsql.SQLParamQuad(blob.oid);
                            self.closeBlob(blob, callback);
                        } else
                            value.resume();
                    });
                });

                value.on('end', function() {
                    isEnd = true;
                    if (isReading)
                        return;
                    ret[index] = new Xsql.SQLParamQuad(blob.oid);
                    self.closeBlob(blob, callback);
                });
            });
        }

        for (var i = 0, length = params.length; i < length; i++) {
            value = params[i];
            meta = input[i];

            if (value === null || value === undefined) {
                switch (meta.type) {
                    case Const.SQL_VARYING:
                    case Const.SQL_NULL:
                    case Const.SQL_TEXT:
                        ret[i] = new Xsql.SQLParamString(null);
                        break;
                    case Const.SQL_DOUBLE:
                    case Const.SQL_FLOAT:
                    case Const.SQL_D_FLOAT:
                        ret[i] = new Xsql.SQLParamDouble(null);
                        break;
                    case Const.SQL_TYPE_DATE:
                    case Const.SQL_TYPE_TIME:
                    case Const.SQL_TIMESTAMP:
                        ret[i] = new Xsql.SQLParamDate(null);
                        break;
                    case Const.SQL_BLOB:
                    case Const.SQL_ARRAY:
                    case Const.SQL_QUAD:
                        ret[i] = new Xsql.SQLParamQuad(null);
                        break;
                    case Const.SQL_LONG:
                    case Const.SQL_SHORT:
                    case Const.SQL_INT64:
                    case Const.SQL_BOOLEAN:
                        ret[i] = new Xsql.SQLParamInt(null);
                        break;
                    default:
                        ret[i] = null;
                }
                done();
            } else {
                switch (meta.type) {
                    case Const.SQL_BLOB:
                        putBlobData(i, value, done);
                        break;

                    case Const.SQL_TIMESTAMP:
                    case Const.SQL_TYPE_DATE:
                    case Const.SQL_TYPE_TIME:

                        if (value instanceof Date)
                            ret[i] = new Xsql.SQLParamDate(value);
                        else if (typeof(value) === 'string')
                            ret[i] = new Xsql.SQLParamDate(parseDate(value));
                        else
                            ret[i] = new Xsql.SQLParamDate(new Date(value));

                        done();
                        break;

                    default:
                        switch (typeof value) {
                            case 'bigint':
                                ret[i] = new Xsql.SQLParamInt128(value);
                                break;
                            case 'number':
                                if (value % 1 === 0) {
                                    if (value >= Const.MIN_INT && value <= Const.MAX_INT)
                                        ret[i] = new Xsql.SQLParamInt(value);
                                    else
                                        ret[i] = new Xsql.SQLParamInt64(value);
                                } else
                                    ret[i] = new Xsql.SQLParamDouble(value);
                                break;
                            case 'string':
                                ret[i] = new Xsql.SQLParamString(value);
                                break;
                            case 'boolean':
                                ret[i] = new Xsql.SQLParamBool(value);
                                break;
                            default:
                                //throw new Error('Unexpected parametter: ' + JSON.stringify(params) + ' - ' + JSON.stringify(input));
                                ret[i] = new Xsql.SQLParamString(value.toString());
                                break;
                        }
                        done();
                }
            }
        }
    }

    var input = statement.input;

    if (input.length) {

        if (!(params instanceof Array)) {
            if (params !== undefined)
                params = [params];
            else
                params = [];
        }

        if (params.length !== input.length) {
            self._pending.pop();
            callback(new Error('Expected parameters: (params=' + params.length + ' vs. expected=' + input.length + ') - ' + statement.query));
            return;
        }

        PrepareParams(params, input, function(prms) {
            self.sendExecute(op, statement, transaction, callback, prms);
        });

        return;
    }

    this.sendExecute(op, statement, transaction, callback);
};

Connection.prototype.sendExecute = function (op, statement, transaction, callback, parameters) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    msg.addInt(op);
    msg.addInt(statement.handle);
    msg.addInt(transaction.handle);

    if (parameters && parameters.length) {
        CalcBlr(blr, parameters);
        msg.addBlr(blr);    // params blr
        msg.addInt(0); // message number
        msg.addInt(1); // param count

        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
            // start with null indicator bitmap
            var nullBits = new BitSet();

            for (var i = 0; i < parameters.length; i++) {
                nullBits.set(i, (parameters[i].value === null) & 1);
            }

            var nullBuffer = nullBits.toBuffer();
            var requireBytes = Math.floor((parameters.length + 7) / 8);
            var remainingBytes = requireBytes - nullBuffer.length;

            if (nullBuffer.length) {
                msg.addBuffer(nullBuffer);
            }
            if (remainingBytes > 0) {
                msg.addBuffer(Buffer.alloc(remainingBytes));
            }
            msg.addAlignment(requireBytes);

            for(var i = 0; i < parameters.length; i++) {
                if (parameters[i].value !== null) {
                    parameters[i].encode(msg);
                }
            }
        } else {
            for(var i = 0; i < parameters.length; i++) {
                parameters[i].encode(msg);
                if (parameters[i].value !== null) {
                    msg.addInt(0);
                }
            }
        }
    } else {
        msg.addBlr(blr);    // empty
        msg.addInt(0); // message number
        msg.addInt(0); // param count
    }

    if (op === Const.op_execute2) {
        var outputBlr = new BlrWriter(32);

        if (statement.output && statement.output.length) {
            CalcBlr(outputBlr, statement.output);
            msg.addBlr(outputBlr);
        } else {
            msg.addBlr(outputBlr); // empty
        }
        msg.addInt(0); // out_message_number = out_message_type
    }

    callback.statement = statement;
    this._queueEvent(callback);
}

function fetch_blob_async_transaction(statement, id, column, row) {
    const infoValue = { row, column, value: '' };

    return (transactionArg) => {
        const singleTransaction = transactionArg === undefined;

        let promiseTransaction;
        if (singleTransaction) {
            promiseTransaction = new Promise((resolve, reject) => {
                statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err, transaction) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(transaction);
                });
            });
        } else {
            promiseTransaction = Promise.resolve(transactionArg);
        }

        return promiseTransaction.then((transaction) => {
            return new Promise((resolve, reject) => {
                statement.connection._pending.push('openBlob');
                statement.connection.openBlob(id, transaction, (err, blob) => {

                    if (err) {
                        reject(err);
                        return;
                    }

                    const read = () => {
                        statement.connection.getSegment(blob, (err, ret) => {

                            if (err) {
                                if (singleTransaction) {
                                    transaction.rollback(() => reject(err));
                                } else {
                                    reject(err);
                                }
                                return;
                            }

                            if (ret.buffer) {
                                const blr = new BlrReader(ret.buffer);
                                const data = blr.readSegment();
                                infoValue.value += data.toString(Const.DEFAULT_ENCODING);
                            }

                            if (ret.handle !== 2) {
                                read();
                                return;
                            }

                            statement.connection.closeBlob(blob);
                            if (singleTransaction) {
                                transaction.commit((err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(infoValue);
                                    }
                                });
                            } else {
                                resolve(infoValue);
                            }
                        });
                    };

                    read();
                });
            });
        });
    };
}

function fetch_blob_async(statement, id, name, row) {
    const cbTransaction = (transaction, close, callback) => {
        statement.connection._pending.push('openBlob');
        statement.connection.openBlob(id, transaction, (err, blob) => {
            let e = new Events.EventEmitter();

            e.pipe = (stream) => {
                e.on('data', (chunk) => {
                    stream.write(chunk);
                });
                e.on('end', () => {
                    stream.end();
                });
            };

            if (err) {
                return callback(err, name, e, row);
            }

            const read = () => {
                statement.connection.getSegment(blob, (err, ret) => {

                    if (err) {
                        transaction.rollback(() => {
                            e.emit('error', err);
                        });
                        return;
                    }

                    if (ret.buffer) {
                        const blr = new BlrReader(ret.buffer);
                        const data = blr.readSegment();

                        e.emit('data', data);
                    }

                    if (ret.handle !== 2) {
                        read();
                        return;
                    }

                    statement.connection.closeBlob(blob);
                    if (close) {
                        transaction.commit((err) => {
                            if (err) {
                                e.emit('error', err);
                            } else {
                                e.emit('end');
                            }
                            e = null;
                        });
                    } else {
                        e.emit('end');
                        e = null;
                    }
                });
            };

            callback(err, name, e, row);
            read();
        });
    };

    return (transaction, callback) => {
        // callback(error, nameField, eventEmitter, row)
        const singleTransaction = callback === undefined;
        if (singleTransaction) {
            callback = transaction;
            statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err, transaction) => {
                if (err) {
                    callback(err);
                    return;
                }
                cbTransaction(transaction, singleTransaction, callback);
            });
        } else {
            cbTransaction(transaction, singleTransaction, callback);
        }
    };
}

Connection.prototype.fetch = function(statement, transaction, count, callback) {

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    if (count instanceof Function) {
        callback = count;
        count = Const.DEFAULT_FETCHSIZE;
    }

    msg.addInt(Const.op_fetch);
    msg.addInt(statement.handle);
    CalcBlr(blr, statement.output);
    msg.addBlr(blr);
    msg.addInt(0); // message number
    msg.addInt(count || Const.DEFAULT_FETCHSIZE); // fetch count

    callback.statement = statement;
    this._queueEvent(callback);
};

Connection.prototype.fetchAll = function (statement, transaction, callback) {
    const self = this, data = [];
    const loop = (err, ret) => {
        if (err) {
            return callback(err);
        } else if (ret && ret.data && ret.data.length) {
            const arrPromise = (ret.arrBlob || []).map(value => value(transaction));

            Promise.all(arrPromise).then((arrBlob) => {
                for (let i = 0; i < arrBlob.length; i++) {
                    const blob = arrBlob[i];
                    ret.data[blob.row][blob.column] = blob.value;
                }

                const lastIndex = ret.data.length - 1;
                for (let i = 0; i < ret.data.length; i++) {
                    const pos = data.push(ret.data[i]);
                    if (statement.custom && statement.custom.asStream && statement.custom.on) {
                        statement.custom.on(ret.data[i], pos - 1);
                    }
                    if (i === lastIndex) {
                        if (ret.fetched) {
                            return callback(undefined, data);
                        } else {
                            self.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
                        }
                    }
                }
            }).catch(callback);
        } else if (ret.fetched) {
            callback(undefined, data);
        } else {
            self.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
        }
    }

    this.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
};


Connection.prototype.openBlob = function(blob, transaction, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_open_blob);
    msg.addInt(transaction.handle);
    msg.addQuad(blob);
    this._queueEvent(callback);
};

Connection.prototype.closeBlob = function(blob, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_close_blob);
    msg.addInt(blob.handle);
    this._queueEvent(callback);
};

Connection.prototype.getSegment = function(blob, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_get_segment);
    msg.addInt(blob.handle);
    msg.addInt(1024); // buffer length
    msg.addInt(0); // ???
    this._queueEvent(callback);
};

Connection.prototype.createBlob2 = function (transaction, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(Const.op_create_blob2);
    msg.addInt(0);
    msg.addInt(transaction.handle);
    msg.addInt(0);
    msg.addInt(0);
    this._queueEvent(callback);
};

Connection.prototype.batchSegments = function(blob, buffer, callback){
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    msg.addInt(Const.op_batch_segments);
    msg.addInt(blob.handle);
    msg.addInt(buffer.length + 2);
    blr.addBuffer(buffer);
    msg.addBlr(blr);
    this._queueEvent(callback);
};

Connection.prototype.svcattach = function (options, callback, svc) {
    this._lowercase_keys = options.lowercase_keys || Const.DEFAULT_LOWERCASE_KEYS;
    var database = options.database || options.filename;
    var user = options.user || Const.DEFAULT_USER;
    var password = options.password || Const.DEFAULT_PASSWORD;
    var role = options.role;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addBytes([Const.isc_dpb_version2, Const.isc_dpb_version2]);
    blr.addString(Const.isc_dpb_lc_ctype, 'UTF8', Const.DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
    blr.addByte(Const.isc_dpb_dummy_packet_interval);
    blr.addByte(4);
    blr.addBytes([120, 10, 0, 0]); // FROM DOT NET PROVIDER
    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);

    msg.addInt(Const.op_service_attach);
    msg.addInt(0);
    msg.addString(Const.DEFAULT_SVC_NAME, Const.DEFAULT_ENCODING); // only local for moment
    msg.addBlr(this._blr);

    var self = this;

    function cb(err, ret) {

        if (err) {
            doError(err, callback);
            return;
        }

        self.svchandle = ret.handle;
        if (callback)
            callback(undefined, ret);
    }

    // For reconnect
    if (svc) {
        svc.connection = this;
        cb.response = svc;
    } else {
        cb.response = new ServiceManager(this);
        cb.response.removeAllListeners('error');
        cb.response.on('error', noop);
    }

    this._queueEvent(cb);
}

Connection.prototype.svcstart = function (spbaction, callback) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    msg.addInt(Const.op_service_start);
    msg.addInt(this.svchandle);
    msg.addInt(0)
    msg.addBlr(spbaction);
    this._queueEvent(callback);
}

Connection.prototype.svcquery = function (spbquery, resultbuffersize, timeout,callback) {
    if (resultbuffersize > Const.MAX_BUFFER_SIZE) {
        doError(new Error('Buffer is too big'), callback);
        return;
    }

    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    blr.addByte(Const.isc_spb_current_version);
    //blr.addByteInt32(Const.isc_info_svc_timeout, timeout);
    msg.addInt(Const.op_service_info);
    msg.addInt(this.svchandle);
    msg.addInt(0);
    msg.addBlr(blr);
    blr.pos = 0
    blr.addBytes(spbquery);
    msg.addBlr(blr);
    msg.addInt(resultbuffersize);
    this._queueEvent(callback);
}

Connection.prototype.svcdetach = function (callback) {
    var self = this;

    if (self._isClosed)
        return;

    self._isUsed = false;
    self._isDetach = true;

    var msg = self._msg;

    msg.pos = 0;
    msg.addInt(Const.op_service_detach);
    msg.addInt(this.svchandle); // Database Object ID

    self._queueEvent(function (err, ret) {
        delete (self.svchandle);
        if (callback)
            callback(err, ret);
    });
}

function bufferReader(buffer, max, writer, cb, beg, end) {

    if (!beg)
        beg = 0;

    if (!end)
        end = max;

    if (end >= buffer.length)
        end = undefined;

    var b = buffer.slice(beg, end);

    writer(b, function() {

        if (end === undefined) {
            cb();
            return;
        }

        bufferReader(buffer, max, writer, cb, beg + max, end + max);
    });
}

Connection.prototype.auxConnection = function (callback) {
    var self = this;
    if (self._isClosed)
        return this.throwClosed(callback);
    var msg = self._msg;
    msg.pos = 0;
    msg.addInt(Const.op_connect_request);
    msg.addInt(1); // async
    msg.addInt(self.dbhandle);
    msg.addInt(0);
    function cb(err, ret) {

        if (err) {
            doError(err, callback);
            return;
        }

        var socket_info = {
            family: ret.buffer.readInt16BE(0),
            port: ret.buffer.readUInt16BE(2),
            host: ret.buffer.readUInt8(4) + '.' + ret.buffer.readUInt8(5) + '.' + ret.buffer.readUInt8(6) + '.' + ret.buffer.readUInt8(7)
        }

        callback(undefined, socket_info);
    }
    this._queueEvent(cb);
}

Connection.prototype.queEvents = function (events, eventid, callback) {
    var self = this;
    if (this._isClosed)
        return this.throwClosed(callback);
    var msg = this._msg;
    var blr = this._blr;
    blr.pos = 0;
    msg.pos = 0;
    msg.addInt(Const.op_que_events);
    msg.addInt(this.dbhandle);
    // prepare EPB
    blr.addByte(1) // epb_version
    for (var event in events) {
        var event_buffer = new Buffer(event, 'UTF8');
        blr.addByte(event_buffer.length);
        blr.addBytes(event_buffer);
        blr.addInt32(events[event]);
    }
    msg.addBlr(blr);    // epb    
    msg.addInt(0);    // ast
    msg.addInt(0);   // args
    msg.addInt(eventid);
    this._queueEvent(callback);
}

Connection.prototype.closeEvents = function (eventid, callback) {
    var self = this;
    if (this._isClosed)
        return this.throwClosed(callback);
    var msg = self._msg;
    msg.pos = 0;
    msg.addInt(Const.op_cancel_events);
    msg.addInt(self.dbhandle);
    msg.addInt(eventid);

    function cb(err, ret) {
        if (err) {
            doError(err, callback);
            return;
        }

        callback(err);
    }

    this._queueEvent(cb);
}

module.exports = Connection;
