import Events from 'events';
import os from 'os';
import path from 'path';

import { XdrWriter, BlrWriter, XdrReader, BitSet, BlrReader } from './serialize';
import { doCallback, doError, type Callback, type SimpleCallback } from '../callback';
import * as srp from '../srp';
import * as crypt from '../unix-crypt';
import Const from './const';
import * as Xsql from './xsqlvar';
import ServiceManager from './service';
import Database from './database';
import Statement from './statement';
import Transaction from './transaction';
import { lookupMessages, noop, parseDate } from '../utils';
import Socket from './socket';
import type { QueueCallback, QueueEntry, WireResponse, InternalOptions, InternalQueryOptions, BatchCb, Quad, AcceptPacket } from './wire-types';
import type { BatchOptions, BatchResult, QueryParams } from '../types';

function parseValueIfJson(value: any, options: any) {
    if (options && options.jsonAsObject && typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
            return JSON.parse(value);
        } catch (e) {
            // Ignore parse error and keep as string
        }
    }
    return value;
}

/**
 * Resolve the prepared-statement cache limit from the connection options:
 * `statementCacheSize` (new), or the legacy `cacheQuery`/`maxCachedQuery`
 * pair (which had no eviction; it now gets a bounded LRU). 0 = disabled.
 */
/**
 * Build the isc_dpb_search_path value from the defaultSchema / searchPath
 * options (Firebird 6.0 / protocol 20+). There is no "default schema" DPB
 * tag in Firebird: CURRENT_SCHEMA is simply the first existing schema of
 * the search path, so defaultSchema is implemented by putting it at the
 * front of the list. When only defaultSchema is given, PUBLIC is kept as a
 * fallback so unqualified names outside the new schema still resolve (the
 * server always appends SYSTEM itself). Returns null when neither option
 * is set.
 */
function buildSchemaSearchPath(options: InternalOptions): string | null {
    var list: string[] = [];
    if (options.searchPath) {
        list = Array.isArray(options.searchPath)
            ? options.searchPath.slice()
            : String(options.searchPath).split(',').map(function(s: string) { return s.trim(); }).filter(Boolean);
    }
    var def = options.defaultSchema;
    if (def) {
        if (list.length === 0) {
            // defaultSchema alone: keep PUBLIC as a fallback after it
            list = def === 'PUBLIC' ? ['PUBLIC'] : [def, 'PUBLIC'];
        } else {
            // explicit searchPath: respect it, just move defaultSchema first
            list = [def].concat(list.filter(function(s) { return s !== def; }));
        }
    }
    return list.length ? list.join(',') : null;
}

function statementCacheLimit(options: InternalOptions): number {
    const size = options && options.statementCacheSize;
    if (size && size > 0) {
        return Math.floor(size);
    }
    if (options && options.cacheQuery) {
        const legacy = options.maxCachedQuery;
        return legacy && legacy > 0 ? Math.floor(legacy) : 100;
    }
    return 0;
}

// SQL type-code names live in xsqlvar.ts alongside the descriptors
const SQL_TYPE_NAMES = Xsql.SQL_TYPE_NAMES;

/**
 * Run the user's typeCast hook (options.typeCast) for one column value.
 * The hook receives the column metadata and a next() returning the value
 * the driver would produce by default (after blobAsText/jsonAsObject);
 * whatever it returns becomes the value in the row. Rows may be decoded
 * more than once when a response spans TCP packets, so the hook must be
 * a pure function of its inputs.
 */
function applyTypeCast(options: InternalOptions, meta: Partial<Xsql.SQLVarBase>, defaultValue: any) {
    const typeCast = options && options.typeCast;
    if (typeof typeCast !== 'function') {
        return defaultValue;
    }
    const column = Xsql.describeField(meta);
    // A hook exception must never escape into the row-decode loop: there it
    // would be mistaken for an incomplete packet and desync the response
    // queue (the same failure mode as issue #341). Fall back to the default
    // value instead and tell the user.
    try {
        return typeCast(column, function () { return defaultValue; });
    } catch (err: any) {
        console.warn('[node-firebird] typeCast hook threw for column "%s" (%s): %s — using default value',
            column.alias || column.field, column.typeName, err && err.message);
        return defaultValue;
    }
}

/***************************************
 *
 *   Connection
 *
 ***************************************/

class Connection {
    static decodeResponse: typeof decodeResponse;
    static fetch_blob_async_transaction: typeof fetch_blob_async_transaction;
    static fetch_blob_async: typeof fetch_blob_async;
    static parseValueIfJson: typeof parseValueIfJson;
    static describe: typeof describe;

    db: Database;
    svc: ServiceManager | undefined;
    options: InternalOptions;
    /** protocol negotiation result (op_accept / op_cond_accept / op_accept_data);
     *  populated during the connect/attach handshake */
    accept!: AcceptPacket;
    error: any;
    dbhandle: number | undefined;
    svchandle: number | undefined;
    clientKeys: srp.KeyPair | undefined;
    serverKeys: { salt: string; public: bigint; pluginName: string } | undefined;

    _msg: XdrWriter;
    _blr: BlrWriter;
    /** response queue: one entry per expected server response (see wire-types) */
    _queue: QueueEntry[];
    _pending: string[];
    _socket: Socket;
    /** partially received packet buffered between 'data' events */
    _xdr: XdrReader | undefined;
    _isOpened: boolean;
    _isClosed: boolean;
    _isDetach: boolean;
    _isUsed: boolean;
    _pooled: boolean;
    _lowercase_keys: boolean | undefined;
    _detachTimeout: any;
    _detachCallback: any;
    _detachAuto: any;
    _retry_connection_id: any;
    _retry_connection_interval: number;
    _statementCacheSize: number;
    _statementCache: Map<string, Statement> | null;
    _messageFile: string;
    _authStartTime: number | undefined;
    _pendingAccept: any;
    _inlineBlobs: Map<string, Buffer> | undefined;

    constructor(host: string, port: number, callback: SimpleCallback | undefined, options: InternalOptions, db?: Database, svc?: ServiceManager) {
        var self = this;
        // db is absent for service-manager connections; the wire core only
        // touches it on database attachments, where it is always set
        this.db = db!;
        this.svc = svc
        this._msg = new XdrWriter(32);
        this._blr = new BlrWriter(32);
        this._queue = [];
        this._detachTimeout;
        this._detachCallback;
        this._detachAuto;
        this._socket = new Socket(port, host,
            options.enableKeepAlive !== false,
            options.keepAliveInitialDelay);
        this._pending = [];
        this._isOpened = false;
        this._isClosed = false;
        this._isDetach = false;
        this._isUsed = false;
        this._pooled = options.isPool||false;
        // Credentials may be absent (e.g. a traditional host:database
        // connection string) — apply the driver defaults once here, so every
        // auth path (op_connect CNCT block, SRP proof, legacy cont_auth) sees
        // the same values.
        if (options && !options.user) options.user = Const.DEFAULT_USER;
        if (options && !options.password) options.password = Const.DEFAULT_PASSWORD;
        if (options && options.blobChunkSize && options.blobChunkSize > 65535) options.blobChunkSize = 65535;
        if (options && options.blobReadChunkSize && options.blobReadChunkSize > 65535) options.blobReadChunkSize = 65535;
        this.options = options;
        this._bind_events(host, port, callback);
        this.error;
        this._retry_connection_id;
        this._retry_connection_interval = options.retryConnectionInterval || 1000;
        this._statementCacheSize = statementCacheLimit(options);
        this._statementCache = this._statementCacheSize > 0 ? new Map() : null;
        this._messageFile = options.messageFile || path.join(__dirname, 'firebird.msg');
    }


    /**
     * Take an idle prepared statement for `query` out of the cache, or null.
     * The statement leaves the cache while in use, so concurrent callers of
     * the same query never share a server-side cursor — they simply prepare
     * a fresh statement and the spare is dropped when released.
     */
    takeCachedStatement(query: string) {
        const cache = this._statementCache;
        if (!cache) {
            return null;
        }
        const statement = cache.get(query);
        if (!statement) {
            return null;
        }
        cache.delete(query);
        return statement;
    }

    /**
     * Return a statement after use. With the statement cache enabled the
     * statement goes back into the cache as most-recently-used (closing its
     * cursor but keeping the prepared handle), evicting the least-recently
     * used statement over the limit. Failed statements, DDL and spares for
     * an already-cached query are dropped instead.
     */
    releaseStatement(statement: Statement, callback?: QueueCallback) {
        const cache = this._statementCache;
        const cacheable = cache &&
            statement.query &&
            !statement._failed &&
            statement.type !== Const.isc_info_sql_stmt_ddl &&
            !cache.has(statement.query);

        if (!cacheable) {
            this.dropStatement(statement, callback);
            return;
        }

        cache!.set(statement.query, statement);
        while (cache!.size > this._statementCacheSize) {
            const oldestKey = cache!.keys().next().value!;
            const oldest = cache!.get(oldestKey)!;
            cache!.delete(oldestKey);
            this.dropStatement(oldest, undefined);
        }
        this.closeStatement(statement, callback);
    }


    // Reject every request that is still awaiting a server response (e.g. a
    // transaction.commit() sent right before the server went away) instead of
    // leaving its callback to hang forever. Requests already in flight cannot
    // be transparently resumed on a reconnect: a fresh attach() hands out new
    // transaction/statement handles, so nothing the server sends back could
    // ever match a callback queued against the old connection.
    _rejectPending(err: any) {
        var queue = this._queue;
        this._queue = [];
        this._pending = [];

        for (var i = 0; i < queue.length; i++) {
            doError(err, queue[i]);
        }
    }


    /**
     * Deliver a connection-level error to 'error' listeners — and ONLY to
     * listeners. Emitting an unlistened 'error' makes Node throw the error
     * object as an uncaught exception; for errors that originate in
     * background contexts (the reconnect timer, socket-level failures whose
     * operations are separately rejected via _rejectPending) that crashes
     * the process — or, under a test runner, fails whatever unrelated test
     * happens to be running. The failing operations themselves always
     * still receive their error through their own callbacks.
     */
    _emitError(err: any) {
        if (this.db && typeof this.db.listenerCount === 'function' && this.db.listenerCount('error') > 0) {
            this.db.emit('error', err);
        } else if (process.env.FIREBIRD_DEBUG) {
            console.warn('[fb-debug] connection error (no error listener):', err && err.message);
        }
    }


    _bind_events(host: string, port: number, callback: SimpleCallback | undefined) {

        var self = this;

        self._socket.on('close', function() {

            if (!self._isOpened || self._isDetach) {
                return;
            }

            self._isOpened = false;
            self._isClosed = true;

            var lostError = self.error || new Error('Connection to Firebird server was lost.');

            if (!self.db) {
                self._rejectPending(lostError);
                if (callback)
                    callback(self.error);
                return;
            }

            self._rejectPending(lostError);

            // Pooled connections do not self-reconnect: the pool is the
            // recovery authority (dead-connection check on checkout + the
            // reaper), and a background reconnect here would produce a
            // zombie attachment the pool no longer tracks — whose own
            // failures then surface as uncatchable async errors.
            if (self.options && self.options.isPool) {
                return;
            }

            self._retry_connection_id = setTimeout(function() {
                self._socket.removeAllListeners();
                // transiently null while the replacement Connection is built
                // (restored by the Object.assign(self, ctx) below)
                self._socket = null!;

                var ctx = new Connection(host, port, function(err: any) {
                    ctx.connect(self.options, function(err: any) {

                        if (err) {
                            self._emitError(err);
                            return;
                        }

                        ctx.attach(self.options, function(err: any) {

                            if (err) {
                                self._emitError(err);
                                return;
                            }

                            self.db.emit('reconnect');

                        }, self.db);
                    });

                    Object.assign(self, ctx);

                }, self.options, self.db);
            }, self._retry_connection_interval);

        });
    
        self._socket.on('error', function(e: any) {

            self.error = e;

            // listeners only (_emitError): the affected operations get their
            // errors via the close handler's _rejectPending — an unlistened
            // socket error must not become an uncaught exception
            self._emitError(e);
    
            if (callback)
                callback(e);
    
        });
    
        self._socket.on('connect', function() {
            self._isClosed = false;
            self._isOpened = true;
            if (callback)
                callback();
        });
    
        self._socket.on('data', function (data: any) {
            var xdr: any;
            var hadSavedBuffer = Boolean(self._xdr);
    
            if (!self._xdr) {
                xdr = new XdrReader(data);
            } else {
                xdr = new XdrReader(Buffer.concat([self._xdr.buffer, data], self._xdr.buffer.length + data.length));
                delete (self._xdr);
            }

            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] data event: bytes=%d queue=%d pending=%d xdr.pos=%d savedBuf=%s',
                    xdr.buffer.length, self._queue.length, self._pending.length, xdr.pos, hadSavedBuffer);
            }
    
            while (xdr.pos < xdr.buffer.length) {
                var cb = self._queue[0], pos = xdr.pos;
                var lazySnapshot = cb ? cb.lazy_count : undefined;
    
                decodeResponse(xdr, cb, self, self._lowercase_keys, function (err, obj) {
    
                    if (err) {
                        if (err instanceof RangeError) {
                            // Genuinely incomplete packet – buffer the remaining bytes
                            // and wait for the next 'data' event to reassemble.
                            xdr.buffer = xdr.buffer.slice(pos);
                            xdr.pos = 0;
                            self._xdr = xdr;

                            if (process.env.FIREBIRD_DEBUG) {
                                console.log('[fb-debug] incomplete packet: saved %d bytes at pos=%d queue=%d',
                                    xdr.buffer.length, pos, self._queue.length);
                            }

                            // Restore lazy_count to its value before this (failed)
                            // decode attempt. Forcing lazy_count = 2 here made the
                            // decoder expect a second op_response that never arrives
                            // whenever a single large response (e.g. op_get_segment
                            // with a big buffer) spans multiple TCP packets.
                            if (cb) {
                                if (lazySnapshot === undefined) {
                                    delete cb.lazy_count;
                                } else {
                                    cb.lazy_count = lazySnapshot;
                                }
                            }
                        } else {
                            // Any other error (truly unknown opcode not handled above).
                            // Save the buffer so it can be retried, but log a warning.
                            if (process.env.FIREBIRD_DEBUG) {
                                console.warn(`[fb-debug] unhandled protocol error: ${err.message} pos=${pos} bytes=${xdr.buffer.length} queue=${self._queue.length}`);
                            }
                            xdr.buffer = xdr.buffer.slice(pos);
                            xdr.pos = 0;
                            self._xdr = xdr;
                        }
                        return;
                    }
    
                    // remove the op flag, needed for partial packet
                    if (xdr.r) {
                        delete (xdr.r);
                    }

                    // op_event / op_response_piggyback received on the main connection:
                    // data has been consumed by decodeResponse but it does not belong to
                    // any queued request – do NOT shift the queue or invoke any pending
                    // callback.
                    if (obj && obj._isOpEvent) {
                        if (process.env.FIREBIRD_DEBUG) {
                            console.log('[fb-debug] async opcode consumed (ignored): queue=%d xdr.pos=%d remaining=%d',
                                self._queue.length, xdr.pos, xdr.buffer.length - xdr.pos);
                        }
                        return;
                    }
    
                    self._queue.shift();
                    self._pending.shift();
    
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] response dispatched: queue remaining=%d pending remaining=%d xdr.pos=%d',
                            self._queue.length, self._pending.length, xdr.pos);
                    }

                    // Surface isc_arg_warning entries (parsed since 2.10.0 but
                    // dropped here): resolve their message text and emit them on
                    // the Database on the next tick, so a listener registered
                    // inside this very response's callback (e.g. right after
                    // attach) still receives them.
                    if (obj && obj.warnings && obj.warnings.length && self.db && typeof self.db.emit === 'function') {
                        const warnings = obj.warnings;
                        for (const w of warnings) {
                            if (w.message === undefined) {
                                w.message = lookupMessages([w]);
                                if (!w.message || w.message === 'Unknow error') {
                                    // codes newer than the bundled firebird.msg:
                                    // still say something actionable
                                    w.message = 'Firebird warning ' + w.gdscode +
                                        (w.params && w.params.length ? ': ' + w.params.join(', ') : '');
                                }
                            }
                        }
                        process.nextTick(function () {
                            for (const w of warnings) {
                                self.db.emit('warning', w);
                            }
                        });
                    }

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


    disconnect() {
        this._socket.end();
    }





    sendOpContAuth(authData: string, authDataEnc: BufferEncoding, pluginName: string) {
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


    sendOpCrypt(encryptPlugin: string) {
        var msg = this._msg;
        msg.pos = 0;

        msg.addInt(Const.op_crypt);
        msg.addString(encryptPlugin || 'Arc4', Const.DEFAULT_ENCODING);
        msg.addString('Symmetric', Const.DEFAULT_ENCODING);

        this._socket.write(msg.getData());
    }


    sendOpCryptKeyCallback(pluginData: BlrWriter) {
        var msg = this._msg;
        msg.pos = 0;

        msg.addInt(Const.op_crypt_key_callback);
        msg.addBlr(pluginData); // Send the callback response data as a buffer

        this._socket.write(msg.getData());
    }


    /**
     * Send an out-of-band op_cancel packet (protocol 12+ / Firebird 2.5+).
     * The server reads it asynchronously while an operation is executing and
     * makes that operation fail with isc_cancelled (GDSCode.CANCELLED); the
     * op_cancel packet itself has no response, so nothing is queued here.
     */
    cancelOperation(kind?: number | SimpleCallback, callback?: SimpleCallback) {
        if (typeof kind === 'function') {
            callback = kind;
            kind = undefined;
        }
        kind = kind || Const.fb_cancel_raise;

        if (this._isClosed)
            return this.throwClosed(callback);

        if (!this.accept || this.accept.protocolVersion < Const.PROTOCOL_VERSION12) {
            doError(new Error('Query cancellation requires protocol 12+ (Firebird 2.5 or newer)'), callback);
            return;
        }

        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_cancel);
        msg.addInt(kind);
        this._socket.write(msg.getData());

        if (callback)
            callback();
    }


    /** Write a prebuilt packet and queue its response callback. */
    _queueEventBuffer(buffer: Buffer, callback: QueueCallback | undefined) {
        if (this._isClosed) {
            if (callback)
                callback(new Error('Connection is closed.'));
            return;
        }

        this._socket.write(buffer);
        this._queue.push(callback);
    }


    _queueEvent(callback: QueueCallback | undefined, defer = false) {
        var self = this;
    
        if (self._isClosed) {
            if (callback)
                callback(new Error('Connection is closed.'));
            return;
        }
    
        const canDefer = defer && this.accept.protocolVersion >= Const.PROTOCOL_VERSION11;
    
        self._socket.write(self._msg.getData(), canDefer);
        if (canDefer) {
            // A deferred packet sits in the socket buffer until the next
            // non-deferred write flushes it, but the server still answers it
            // with its own op_response (delivered along with that next
            // exchange). Queue a placeholder to consume that response —
            // otherwise the queue pairs it with the NEXT request and every
            // later response is off by one. The op itself is fire-and-forget,
            // so complete the caller right away.
            self._queue.push(undefined);
            if (callback)
                callback();
        } else {
            self._queue.push(callback);
        }
    }


    connect(options: InternalOptions, callback: Callback<AcceptPacket> | undefined) {
        var pluginName = options.pluginName || Const.AUTH_PLUGIN_LIST[0];
        var msg = this._msg;
        var blr = this._blr;
    
        this._pending.push('connect');
        this._authStartTime = Date.now();
    
        msg.pos = 0;
        blr.pos = 0;
    
        blr.addString(Const.CNCT_login, options.user!, Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_plugin_name, pluginName, Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_plugin_list, Const.AUTH_PLUGIN_LIST.join(','), Const.DEFAULT_ENCODING);
    
        var specificData = '';
        if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(pluginName) > -1) {
            const _t0 = Date.now();
            this.clientKeys = srp.clientSeed();
            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] srp.clientSeed: %dms', Date.now() - _t0);
            }
            specificData = this.clientKeys.public.toString(16);
            blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
        } else if (pluginName === Const.AUTH_PLUGIN_LEGACY) {
            specificData = crypt.crypt(options.password!, Const.LEGACY_AUTH_SALT).substring(2);
            blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
        } else {
            doError(new Error('Invalide auth plugin \'' + pluginName + '\''), callback);
            return;
        }
        blr.addBytes([Const.CNCT_client_crypt, 4, options.wireCrypt !== undefined ? options.wireCrypt : Const.WIRE_CRYPT_ENABLE, 0, 0, 0]);
        blr.addString(Const.CNCT_user, os.userInfo().username || 'Unknown', Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_host, os.hostname(), Const.DEFAULT_ENCODING);
        blr.addBytes([Const.CNCT_user_verification, 0]);
    
        msg.addInt(Const.op_connect);
        msg.addInt(Const.op_attach);
        msg.addInt(Const.CONNECT_VERSION3);
        msg.addInt(Const.ARCHITECTURE_GENERIC);
        msg.addString(options.database || options.filename, Const.DEFAULT_ENCODING);
        // Send the full list by default. Servers parse every entry and ignore
        // versions they do not know (verified back to Firebird 2.5), so the
        // list length itself is harmless; the option remains as an escape
        // hatch to cap negotiation at an older protocol.
        var maxProtocols = options.maxNegotiatedProtocols !== undefined ? options.maxNegotiatedProtocols : Const.SUPPORTED_PROTOCOL.length;
        var protocolsToSend = Const.SUPPORTED_PROTOCOL;
        if (protocolsToSend.length > maxProtocols) {
            // keep the FIRST N entries: the list is ordered oldest→newest, so
            // capping the count caps the newest protocol offered (e.g. 10 =
            // stop at protocol 19, the documented pre-Firebird-6 behavior)
            protocolsToSend = protocolsToSend.slice(0, maxProtocols);
        }

        msg.addInt(protocolsToSend.length);  // Count of Protocol version understood count.
        msg.addBlr(this._blr);
    
        for (var protocol of protocolsToSend) {
            msg.addInt(protocol[0]); // Version
            msg.addInt(protocol[1]); // Architecture
            msg.addInt(protocol[2]); // Min type
            if (protocol[0] >= Const.PROTOCOL_VERSION13 && options.wireCompression) {
                msg.addInt(protocol[3] | Const.pflag_compress); // Max type with compress flag
            } else {
                msg.addInt(protocol[3]); // Max type
            }
            msg.addInt(protocol[4]); // Preference weight
        }
    
        var self = this;
        function cb(err: any, ret: any) {
            if (err) {
                doError(err, callback);
                return;
            }

            // Check for pending accept from op_cond_accept flow
            if (self._pendingAccept) {
                ret = self._pendingAccept;
                delete self._pendingAccept;
            }

            self.accept = ret;

            // Wire encryption: send op_crypt if SRP session key is available
            if (ret.sessionKey && ret.protocolVersion >= Const.PROTOCOL_VERSION13 &&
                options.wireCrypt !== Const.WIRE_CRYPT_DISABLE) {
                var padLen = 40;
                var keyBuf = Buffer.from(ret.sessionKey.toString(16).padStart(padLen, '0'), 'hex');

                var selectedPlugin = 'Arc4';
                if (ret.keys) {
                    var serverPlugins = ret.keys.split(',').map(function(s: any) { return s.trim().toLowerCase(); });
                    var preferred = ['chacha64', 'chacha', 'arc4'];
                    for (var i = 0; i < preferred.length; i++) {
                        if (serverPlugins.indexOf(preferred[i]) !== -1) {
                            var mapping: Record<string, string> = {
                                chacha64: 'ChaCha64',
                                chacha: 'ChaCha',
                                arc4: 'Arc4'
                            };
                            selectedPlugin = mapping[preferred[i]];
                            break;
                        }
                    }
                }

                // Send op_crypt BEFORE enabling encryption (op_crypt is sent plaintext)
                // The server then enables encryption from its side.
                // After the op_response to op_crypt, both sides are encrypted.
                self.sendOpCrypt(selectedPlugin);

                if (selectedPlugin === 'Arc4') {
                    self._socket.enableEncryption(keyBuf, 'Arc4');
                }

                self._pending.push('crypt');
                self._queue.push(function(cryptErr: any, response: any) {
                    if (cryptErr) {
                        doError(cryptErr, callback);
                        return;
                    }

                    if (selectedPlugin !== 'Arc4') {
                        var iv = response && response.buffer;
                        if (!iv || (selectedPlugin === 'ChaCha64' && iv.length < 8) || (selectedPlugin === 'ChaCha' && iv.length < 12)) {
                            var errIv = new Error('Invalid or missing IV for ' + selectedPlugin + ' encryption');
                            doError(errIv, callback);
                            return;
                        }
                        self._socket.enableEncryption(keyBuf, selectedPlugin, iv);
                    }

                    if (callback)
                        callback(undefined, ret);
                });
                return;
            }


            if (callback)
                callback(undefined, ret);
        }
    
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] auth: op_connect sent plugin=%s t=%dms', pluginName, Date.now() - this._authStartTime);
        }
        this._queueEvent(cb);
    }


    attach(options: InternalOptions, callback?: Callback<Database>, db?: Database) {
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
        
        // For Firebird 3+ (protocol 13+), add UTF-8 filename flag to ensure all DPB strings are handled with UTF-8
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
            blr.addByte(Const.isc_dpb_utf8_filename);
            blr.addByte(0);
        }
        
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

        if (options.sessionTimeZone) {
            blr.addString(Const.isc_dpb_session_time_zone, options.sessionTimeZone, Const.DEFAULT_ENCODING);
        }

        if (options.parallelWorkers !== undefined) {
            blr.addNumeric(Const.isc_dpb_parallel_workers, options.parallelWorkers);
        }

        if (options.maxInlineBlobSize !== undefined) {
            blr.addNumeric(Const.isc_dpb_max_inline_blob_size, options.maxInlineBlobSize);
        }

        // Firebird 6.0 SQL Schema parameters (Protocol 20+).
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION20) {
            const sp = buildSchemaSearchPath(options);
            if (sp) {
                blr.addString(Const.isc_dpb_search_path, sp, Const.DEFAULT_ENCODING);
            }
        }

        msg.addInt(Const.op_attach);
        msg.addInt(0);  // Database Object ID
        msg.addString(database, Const.DEFAULT_ENCODING);
        msg.addBlr(this._blr);
    
        function cb(err: any, ret: any) {
            if (err) {
                doError(err, callback);
                return;
            }
    
            self.dbhandle = ret.handle;
            if (callback)
                callback(undefined, ret);
            if (!db)
                ret.emit('attach', ret);
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
    }


    detach(callback: Callback | undefined) {

        var self = this;

        if (self._isClosed)
            return this.throwClosed(callback);
    
        self._isUsed = false;
        self._isDetach = true;
    
        var msg = self._msg;
    
        msg.pos = 0;
        msg.addInt(Const.op_detach);
        msg.addInt(0); // Database Object ID
    
        self._queueEvent(function(err: any, ret: any) {
            clearTimeout(self._retry_connection_id);
            delete(self.dbhandle);
            if (callback)
                callback(err, ret);
        });
    }


    createDatabase(options: InternalOptions, callback: Callback<Database> | undefined) {
        // Mirror attach(): honour the lowercase_keys option so that db.query()
        // called on a freshly-created database returns the expected column case.
        this._lowercase_keys = options.lowercase_keys || Const.DEFAULT_LOWERCASE_KEYS;

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
        
        // For Firebird 3+ (protocol 13+), add UTF-8 filename flag to ensure all DPB strings are handled with UTF-8
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
            blr.addByte(Const.isc_dpb_utf8_filename);
            blr.addByte(0);
        }
        
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

        if (options.sessionTimeZone) {
            blr.addString(Const.isc_dpb_session_time_zone, options.sessionTimeZone, Const.DEFAULT_ENCODING);
        }

        if (options.parallelWorkers !== undefined) {
            blr.addNumeric(Const.isc_dpb_parallel_workers, options.parallelWorkers);
        }

        if (options.maxInlineBlobSize !== undefined) {
            blr.addNumeric(Const.isc_dpb_max_inline_blob_size, options.maxInlineBlobSize);
        }

        // Firebird 6.0 SQL Schema parameters (Protocol 20+).
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION20) {
            const sp = buildSchemaSearchPath(options);
            if (sp) {
                blr.addString(Const.isc_dpb_search_path, sp, Const.DEFAULT_ENCODING);
            }
        }

        if (options.owner) {
            // Firebird 6.0+ (issue #7718): create the database owned by a
            // different user (requires superuser rights). Older servers
            // ignore unknown DPB tags, so this is safe to always send.
            blr.addString(Const.isc_dpb_owner, options.owner, Const.DEFAULT_ENCODING);
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
    
        function cb(err: any, ret: any) {
    
            if (ret)
                self.dbhandle = ret.handle;

            if (callback)
                callback(err, ret);

            if (!err && ret)
                ret.emit('attach', ret);
        }
    
        cb.response = new Database(this);
        this._queueEvent(cb);
    }


    dropDatabase(callback: SimpleCallback | undefined) {
        var msg = this._msg;
        msg.pos = 0;
    
        msg.addInt(Const.op_drop_database);
        msg.addInt(this.dbhandle!);
    
        var self = this;
        this._queueEvent(function(err: any) {
            self.detach(function() {
                self.disconnect();
    
                if (callback)
                    callback(err);
            });
        });
    }


    throwClosed(callback: ((err: Error, ...args: any[]) => void) | undefined) {
        var err = new Error('Connection is closed.');
        // listeners only: the caller receives the error through its own
        // callback below either way
        this._emitError(err);
        if (callback)
            callback(err);
        return this;
    }


    /** `options` is a resolved options object, a bare isolation array, or
     *  the callback itself when no options are given. */
    startTransaction(options: any, callback?: any) {
    
        if (typeof(options) === 'function') {
            var tmp = options;
            options = callback;
            callback = tmp;
        }
    
        // Compatibility
        if (Array.isArray(options)) {
            options = {
                isolation: options,
                readOnly: (options === Const.ISOLATION_READ_COMMITTED_READ_ONLY),
            };
        }
    
        // Default options
        options = Object.assign({
            autoCommit: false,
            autoUndo: true,
            isolation: Const.ISOLATION_READ_COMMITTED,
            ignoreLimbo: false,
            //lock: [],
            readOnly: false,
            wait: true,
            waitTimeout: 0,
        }, options);
    
        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('startTransaction');
    
        var blr = this._blr;
        var msg = this._msg;
    
        blr.pos = 0;
        msg.pos = 0;
    
        blr.addByte(Const.isc_tpb_version3);
        blr.addBytes(options.isolation);
        blr.addByte(options.readOnly ? Const.isc_tpb_read : Const.isc_tpb_write);
        if (options.wait) {
            blr.addByte(Const.isc_tpb_wait);
    
            if (options.waitTimeout) {
                blr.addNumeric(Const.isc_tpb_lock_timeout, options.waitTimeout);
            }
        } else {
            blr.addByte(Const.isc_tpb_nowait);
        }
        if (!options.autoUndo) {
            blr.addByte(Const.isc_tpb_no_auto_undo);
        }
        if (options.autoCommit) {
            blr.addByte(Const.isc_tpb_autocommit);
        }
        if (options.ignoreLimbo) {
            blr.addByte(Const.isc_tpb_ignore_limbo);
        }
        // TODO
        /*if (options.lock.length) {
            for (let table of options.lock) {
                const lockMode = table.write ? Const.isc_tpb_lock_write : Const.isc_tpb_lock_read;
                const lockType = table.protected ? Const.isc_tpb_protected : Const.isc_tpb_shared;
    
                blr.addString(lockMode, table.table || table, Const.DEFAULT_ENCODING);
                blr.addByte(lockType);
            }
        }*/
    
        msg.addInt(Const.op_transaction);
        msg.addInt(this.dbhandle!);
        msg.addBlr(blr);
        callback.response = new Transaction(this);
    
        this.db.emit('transaction', options);
        this._queueEvent(callback);
    }


    commit(transaction: Transaction, callback: QueueCallback | undefined) {
    
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
    }


    rollback(transaction: Transaction, callback: QueueCallback | undefined) {
    
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
    }


    commitRetaining(transaction: Transaction, callback: QueueCallback | undefined) {

        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('commitRetaining');
    
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_commit_retaining);
        msg.addInt(transaction.handle);
        this._queueEvent(callback);
    }


    rollbackRetaining(transaction: Transaction, callback: QueueCallback | undefined) {
    
        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('rollbackRetaining');
    
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_rollback_retaining);
        msg.addInt(transaction.handle);
        this._queueEvent(callback);
    }


    allocateStatement(callback: QueueCallback) {
    
        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('allocateStatement');
    
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_allocate_statement);
        msg.addInt(this.dbhandle!);
        callback.response = new Statement(this);
        this._queueEvent(callback);
    }


    dropStatement(statement: Statement, callback: QueueCallback | undefined) {
    
        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('dropStatement');
    
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_free_statement);
        msg.addInt(statement.handle);
        msg.addInt(Const.DSQL_drop);
    
        this._queueEvent(callback, true);
    }


    closeStatement(statement: Statement, callback: QueueCallback | undefined) {
    
        if (this._isClosed)
            return this.throwClosed(callback);
    
        // for auto detach
        this._pending.push('closeStatement');
    
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_free_statement);
        msg.addInt(statement.handle);
        msg.addInt(Const.DSQL_close);
    
        this._queueEvent(callback, true);
    }


    allocateAndPrepareStatement(transaction: Transaction, query: string, plan: boolean, callback: Callback<Statement>) {
        var self = this;
        var mainCallback: QueueCallback = function(err: any, ret: any) {
            if (!err) {
                mainCallback.response.handle = ret.handle;
                describe(ret.buffer, mainCallback.response);
                mainCallback.response.query = query;
                self.db.emit('query', query);
                ret = mainCallback.response;
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
        msg.addInt(this.dbhandle!);
        mainCallback.lazy_count = 1;
    
        const describeBytes = this.accept.protocolVersion >= Const.PROTOCOL_VERSION20 ? Const.DESCRIBE_WITH_SCHEMA : Const.DESCRIBE;
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] describeBytes:', describeBytes);
        }
        blr.addBytes(describeBytes);
        if (plan)
            blr.addByte(Const.isc_info_sql_get_plan);
    
        msg.addInt(Const.op_prepare_statement);
        msg.addInt(transaction.handle);
        msg.addInt(0xFFFF);
        msg.addInt(3); // dialect = 3
        msg.addString(query, Const.DEFAULT_ENCODING);
        msg.addBlr(blr);
        msg.addInt(65535); // buffer_length
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION20) {
            // p_sqlst_flags (IStatement::PREPARE_* bits, none needed) — the
            // server blocks reading this field if it is missing, which was
            // the protocol-20 "prepare hang"
            msg.addInt(0);
        }
        mainCallback.lazy_count += 1;
    
        mainCallback.response = new Statement(this);
        this._queueEvent(mainCallback);
    }


    prepare(transaction: Transaction, query: string, plan: boolean, callback: Callback<Statement>) {
        var self = this;
    
        if (this.accept.protocolMinimumType === Const.ptype_lazy_send) { // V11 Statement or higher
            self.allocateAndPrepareStatement(transaction, query, plan, callback);
        } else { // V10 Statement
            self.allocateStatement(function (err: any, statement: Statement) {
                if (err) {
                    doError(err, callback);
                    return;
                }
    
                self.prepareStatement(transaction, statement, query, plan, callback);
            });
        }
    }



    /** `plan` may be the callback itself when no plan flag is given. */
    prepareStatement(transaction: Transaction, statement: Statement, query: string, plan: boolean | Callback<Statement>, callback?: Callback<Statement>) {
    
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
    
        const describeBytes = this.accept.protocolVersion >= Const.PROTOCOL_VERSION20 ? Const.DESCRIBE_WITH_SCHEMA : Const.DESCRIBE;
        blr.addBytes(describeBytes);
    
        if (plan)
            blr.addByte(Const.isc_info_sql_get_plan);
    
        msg.addInt(Const.op_prepare_statement);
        msg.addInt(transaction.handle);
        msg.addInt(statement.handle);
        msg.addInt(3); // dialect = 3
        msg.addString(query, Const.DEFAULT_ENCODING);
        msg.addBlr(blr);
        msg.addInt(65535); // buffer_length
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION20) {
            msg.addInt(0); // p_sqlst_flags (see allocateAndPrepareStatement)
        }
    
        var self = this;
        this._queueEvent(function(err: any, ret: any) {
    
            if (!err) {
                describe(ret.buffer, statement);
                statement.query = query;
                self.db.emit('query', query);
                ret = statement;
            }
    
            if (callback)
                callback(err, ret);
        });
    
    }



    /**
     * Execute a statement once per row using the Firebird 4 batch API
     * (protocol 16+): op_batch_create + op_batch_msg(s) + op_batch_exec +
     * op_batch_rls, all pipelined in a single network flush. Every packet
     * gets an in-order response (op_batch_cs for exec), so the regular
     * response queue keeps everything in sync.
     *
     * rows: array of parameter arrays, one per record. BLOB columns accept
     * Buffers, strings, JSON-able objects or pre-created blob quad ids —
     * values are uploaded as transaction blobs first (all initiated
     * back-to-back so they pipeline) and the batch messages reference their
     * ids. ARRAY columns are not supported. The callback receives a
     * completion object: { recordCount, updateCounts, errors:
     * [{recordNumber, error}], errorRecordNumbers, success }.
     */
    executeBatch(transaction: Transaction, statement: Statement, rows: QueryParams[], callback: BatchCb | undefined, options?: BatchOptions) {
        options = options || {};

        if (this._isClosed)
            return this.throwClosed(callback);

        if (!this.accept || this.accept.protocolVersion < Const.PROTOCOL_VERSION16) {
            doError(new Error('executeBatch requires protocol 16+ (Firebird 4.0 or newer)'), callback);
            return;
        }

        var input = statement.input;
        if (!input || !input.length) {
            doError(new Error('executeBatch requires a statement with input parameters'), callback);
            return;
        }

        if (!Array.isArray(rows)) {
            doError(new Error('executeBatch expects an array of parameter rows'), callback);
            return;
        }

        if (rows.length === 0) {
            if (callback) callback(undefined, {
                recordCount: 0, updateCounts: [], errors: [], errorRecordNumbers: [], success: true,
            });
            return;
        }

        for (var i = 0; i < rows.length; i++) {
            if (!Array.isArray(rows[i]) || rows[i].length !== input.length) {
                doError(new Error('executeBatch row ' + i + ' must be an array of ' + input.length + ' values'), callback);
                return;
            }
        }

        var self = this;

        // BLOB pre-pass: upload every Buffer/string blob value as a
        // transaction blob and replace it (in a cloned row) with the quad
        // id the batch message will carry. All uploads are initiated
        // back-to-back, so the create/segment/close ops pipeline on the
        // wire instead of paying a round trip per blob.
        var blobCols: number[] = [];
        for (var bj = 0; bj < input.length; bj++) {
            var bt = input[bj].type;
            if (bt === Const.SQL_BLOB || bt === Const.SQL_QUAD) {
                blobCols.push(bj);
            }
        }

        // all-NULL blob columns are common — a large row set must not pay
        // for a full clone when there is nothing to upload or unwrap
        var needsBlobPass = false;
        if (blobCols.length) {
            outer:
            for (var ri = 0; ri < rows.length; ri++) {
                for (var ci = 0; ci < blobCols.length; ci++) {
                    var bv = (rows[ri] as any[])[blobCols[ci]];
                    if (bv !== null && bv !== undefined) {
                        needsBlobPass = true;
                        break outer;
                    }
                }
            }
        }

        if (needsBlobPass) {
            var cloned: any[][] = rows.map(function(r) { return (r as any[]).slice(); });
            var pendingBlobs = 1; // sentinel so zero uploads still settle
            var blobFailure: any = null;
            var settleBlobs = function(err?: any) {
                if (err && !blobFailure) {
                    blobFailure = err;
                }
                if (--pendingBlobs) {
                    return;
                }
                if (blobFailure) {
                    doError(blobFailure, callback);
                    return;
                }
                self._executeBatchEncoded(transaction, statement, cloned, callback, options);
            };

            cloned.forEach(function(row) {
                blobCols.forEach(function(j) {
                    var v = row[j];
                    if (v === null || v === undefined) {
                        return;
                    }
                    // a pre-created blob id (SQLParamQuad wrapper) passes
                    // through; plain {high, low} objects are deliberately NOT
                    // treated as ids — they are legitimate JSON blob content
                    // and would silently misroute to a bogus blob reference
                    if (v instanceof Xsql.SQLParamQuad) {
                        row[j] = v.value;
                        return;
                    }
                    pendingBlobs++;
                    self.uploadBlob(transaction, v, function(err: any, oid: any) {
                        if (!err) {
                            row[j] = oid;
                        }
                        settleBlobs(err);
                    });
                });
            });
            settleBlobs();
            return;
        }

        this._executeBatchEncoded(transaction, statement, rows as any[][], callback, options);
    }


    /** Encode and send the batch packets (rows are fully materialized:
     *  blob values already replaced by quad ids by executeBatch). */
    _executeBatchEncoded(transaction: Transaction, statement: Statement, rows: any[][], callback: BatchCb | undefined, options: BatchOptions) {
        var input = statement.input;
        var built;
        try {
            built = buildBatchEncoders(input, Object.assign({}, this.options, options));
        } catch (err) {
            doError(err, callback);
            return;
        }

        var self = this;
        var encoders = built.encoders;
        var chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : 500;
        var chunkCount = Math.ceil(rows.length / chunkSize);

        var failure: any = null;
        var completion: any = null;
        var remaining = 2 + chunkCount; // create + msg chunks + exec

        function settle(err?: any) {
            if (err && !failure)
                failure = err;
            remaining--;
            if (remaining > 0)
                return;

            if (failure) {
                doError(failure, callback);
                return;
            }

            var detailed = completion ? completion.detailedErrors : [];
            var errorRecordNumbers = detailed.map(function(e: any) { return e.recordNumber; })
                .concat(completion ? completion.errorRecordNumbers : []);

            if (callback) callback(undefined, {
                recordCount: completion ? completion.recordCount : 0,
                updateCounts: completion ? completion.updateCounts : [],
                errors: detailed,
                errorRecordNumbers: errorRecordNumbers,
                success: errorRecordNumbers.length === 0,
            });
        }

        var msg = this._msg;
        var blr = this._blr;

        // Build every packet before writing anything: an encoding failure
        // (e.g. an oversized CHAR/VARCHAR value) must abort the batch before
        // a single byte hits the wire, or the response queue desyncs.
        var packets: Buffer[] = [];
        try {
            // 1. op_batch_create — the BLR is the statement's own described
            // input format: the engine requires batch messages to match it
            // exactly (a value-derived format is rejected with SQLDA errors).
            msg.pos = 0;
            blr.pos = 0;
            CalcBlr(blr, input);

            msg.addInt(Const.op_batch_create);
            msg.addInt(statement.handle);
            msg.addBlr(blr);
            msg.addInt(built.msglen);
            var pb = buildBatchPb(options);
            msg.addInt(pb.length);
            msg.addParamBuffer(pb);
            packets.push(Buffer.from(msg.getData()));

            // 2. op_batch_msg — packed messages (null bitmap + non-null
            // values), exactly the op_execute protocol-13 message encoding.
            for (var c = 0; c < chunkCount; c++) {
                var start = c * chunkSize;
                var end = Math.min(start + chunkSize, rows.length);

                msg.pos = 0;
                msg.addInt(Const.op_batch_msg);
                msg.addInt(statement.handle);
                msg.addInt(end - start);

                for (var i = start; i < end; i++) {
                    // validated as an array of input.length values above
                    var row = rows[i] as any[];

                    var nullBits = new BitSet();
                    for (var j = 0; j < input.length; j++) {
                        nullBits.set(j, row[j] === null || row[j] === undefined ? 1 : 0);
                    }
                    var nullBuffer = nullBits.toBuffer();
                    var requireBytes = Math.floor((input.length + 7) / 8);
                    var remainingBytes = requireBytes - nullBuffer.length;

                    if (nullBuffer.length) {
                        msg.addBuffer(nullBuffer);
                    }
                    if (remainingBytes > 0) {
                        msg.addBuffer(Buffer.alloc(remainingBytes));
                    }
                    msg.addAlignment(requireBytes);

                    for (var j = 0; j < input.length; j++) {
                        if (row[j] !== null && row[j] !== undefined) {
                            encoders[j](msg, row[j]);
                        }
                    }
                }

                packets.push(Buffer.from(msg.getData()));
            }

            // 3. op_batch_exec — answered with op_batch_cs.
            msg.pos = 0;
            msg.addInt(Const.op_batch_exec);
            msg.addInt(statement.handle);
            msg.addInt(transaction.handle);
            packets.push(Buffer.from(msg.getData()));

            // 4. op_batch_rls — free the server-side batch.
            msg.pos = 0;
            msg.addInt(Const.op_batch_rls);
            msg.addInt(statement.handle);
            packets.push(Buffer.from(msg.getData()));
        } catch (err) {
            doError(err, callback);
            return;
        }

        // Pipeline everything: the server answers each packet in order
        // (op_response for create/msg, op_batch_cs for exec), so one queued
        // callback per packet keeps the response stream in sync. The server
        // DEFERS the responses to create/msg/rls (PORT_lazy send_partial) —
        // they only hit the wire when a flushing send occurs, which the
        // op_batch_cs answer to exec provides. The rls response however is
        // deferred past our last packet and arrives with the NEXT flushed
        // response (commit, query, detach…), so completion must not wait
        // for it: its queued callback is a no-op that just keeps the
        // response stream aligned.
        var execIndex = packets.length - 2;
        for (var p = 0; p < packets.length; p++) {
            this._pending.push('executeBatch');
            if (p === execIndex) {
                this._queueEventBuffer(packets[p], function(err: any, ret: any) {
                    if (!err && ret && ret.batchCompletion) {
                        completion = ret.batchCompletion;
                        settle();
                    } else {
                        settle(err || new Error('op_batch_exec did not return a completion state'));
                    }
                });
            } else if (p === packets.length - 1) {
                this._queueEventBuffer(packets[p], function() {});
            } else {
                this._queueEventBuffer(packets[p], function(err: any) { settle(err); });
            }
        }
    }


    /** `params` may be the callback itself when the statement has no parameters. */
    executeStatement(transaction: Transaction, statement: Statement, params: any, callback?: QueueCallback, custom?: InternalQueryOptions) {
    
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
    
        function PrepareParams(params: any[], input: Xsql.SQLVarBase[], callback: (prms: any[]) => void) {

            var value, meta;
            var ret = new Array(params.length);

            function putBlobData(index: any, value: any, callback: any) {
    
                self.createBlob2(transaction, function(err: any, blob: any) {
    
                    var b;
                    var isStream = value.readable;
    
                    if (Buffer.isBuffer(value))
                        b = value;
                    else if (typeof(value) === 'string')
                        b = Buffer.from(value, Const.DEFAULT_ENCODING);
                    else if (!isStream)
                        b = Buffer.from(JSON.stringify(value), Const.DEFAULT_ENCODING);
    
                    // Use configured transfer size or default to 1024
                    var chunkSize = self.options.blobChunkSize || 1024;
    
                    if (Buffer.isBuffer(b)) {
                        bufferReader(b, chunkSize, function (b, next) {
                            self.batchSegments(blob, b, next);
                        }, function() {
                            ret[index] = new Xsql.SQLParamQuad(blob.oid);
                            self.closeBlob(blob, callback, false);
                        });
                        return;
                    }

                    var isReading = false;
                    var isEnd = false;

                    value.on('data', function(chunk: any) {
                        // Optimization: If chunk is smaller than transfer size, send directly
                        if (chunk.length <= chunkSize) {
                            self.batchSegments(blob, chunk, function () {
                                if (isEnd && !isReading) {
                                    ret[index] = new Xsql.SQLParamQuad(blob.oid);
                                    self.closeBlob(blob, callback, false);
                                }
                            });
                            return;
                        }

                        value.pause();
                        isReading = true;
                        bufferReader(chunk, chunkSize, function (b, next) {
                            self.batchSegments(blob, b, next);
                        }, function() {
                            isReading = false;

                            if (isEnd) {
                                ret[index] = new Xsql.SQLParamQuad(blob.oid);
                                self.closeBlob(blob, callback, false);
                            } else
                                value.resume();
                        });
                    });

                    value.on('end', function() {
                        isEnd = true;
                        if (isReading)
                            return;
                        // If we are not currently reading (paused), close immediately
                        // If we are reading, the callback in batchSegments/bufferReader will handle closure
                        if (!isReading) {
                            ret[index] = new Xsql.SQLParamQuad(blob.oid);
                            self.closeBlob(blob, callback, false);
                        }
                    });
                });
            }
    
            function step(i: any) {
                if (i === params.length) {
                    callback(ret);
                    return;
                }

                value = params[i];
                meta = input[i];

                if (statement.connection.options && statement.connection.options.jsonAsObject && value !== null && value !== undefined && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
                    if (typeof value.pipe !== 'function') {
                        value = JSON.stringify(value);
                    }
                }

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
                        case Const.SQL_TIME_TZ:
                        case Const.SQL_TIME_TZ_EX:
                        case Const.SQL_TIMESTAMP_TZ:
                        case Const.SQL_TIMESTAMP_TZ_EX:
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
                    step(i + 1);
                } else {
                    switch (meta.type) {
                        case Const.SQL_BLOB:
                            putBlobData(i, value, function() { step(i + 1); });
                            break;

                        case Const.SQL_TIMESTAMP:
                        case Const.SQL_TYPE_DATE:
                        case Const.SQL_TYPE_TIME:
                        case Const.SQL_TIME_TZ:
                        case Const.SQL_TIME_TZ_EX:
                        case Const.SQL_TIMESTAMP_TZ:
                        case Const.SQL_TIMESTAMP_TZ_EX:
                            if (value instanceof Date)
                                ret[i] = new Xsql.SQLParamDate(value);
                            else if (typeof(value) === 'string')
                                ret[i] = new Xsql.SQLParamDate(parseDate(value));
                            else
                                ret[i] = new Xsql.SQLParamDate(new Date(value));

                            step(i + 1);
                            break;

                        default:
                            if (Buffer.isBuffer(value)) {
                                ret[i] = new Xsql.SQLParamBuffer(value);
                            } else {
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
                            }
                            step(i + 1);
                    }
                }
            }

            step(0);
        }
    
        var input = statement.input;
    
        if (input.length) {
    
            if (!(params instanceof Array)) {
                if (params !== undefined && typeof params === 'object' && params !== null) {
                    var mappedParams: any[] = [];
                    for (var i = 0; i < input.length; i++) {
                        mappedParams.push(undefined);
                    }
                    var matchedCount = 0;
                    var nameMap: Record<string, number> = {};
                    for (var i = 0; i < input.length; i++) {
                        var name = input[i].alias || input[i].field;
                        if (name) {
                            nameMap[name.toUpperCase()] = i;
                        }
                    }
                    for (var key in params) {
                        if (Object.prototype.hasOwnProperty.call(params, key)) {
                            var cleanKey = key.startsWith(':') ? key.substring(1) : key;
                            var index = nameMap[cleanKey.toUpperCase()];
                            if (index !== undefined) {
                                mappedParams[index] = params[key];
                                matchedCount++;
                            }
                        }
                    }
                    if (matchedCount > 0) {
                        params = mappedParams;
                    } else {
                        params = [params];
                    }
                } else if (params !== undefined) {
                    params = [params];
                } else {
                    params = [];
                }
            }
    
            if (params.length !== input.length) {
                self._pending.pop();
                callback!(new Error('Expected parameters: (params=' + params.length + ' vs. expected=' + input.length + ') - ' + statement.query));
                return;
            }
    
            PrepareParams(params, input, function(prms: any) {
                self.sendExecute(op, statement, transaction, callback, prms);
            });
    
            return;
        }
    
        this.sendExecute(op, statement, transaction, callback);
    }


    sendExecute(op: number, statement: Statement, transaction: Transaction, callback: QueueCallback | undefined, parameters?: any[]) {
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
                    nullBits.set(i, parameters[i].value === null ? 1 : 0);
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

        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION16) {
            // TODO impl statement timout
            msg.addInt(statement.options?.timeout || 0); // p_sqldata_timeout
        }

        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION18) {
            msg.addInt(statement.options?.scrollable ? 1 : 0); // p_sqldata_cursor_flags (1 = CURSOR_TYPE_SCROLLABLE)
        }

        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION19) {
            msg.addInt(statement.options?.maxInlineBlobSize !== undefined ? statement.options.maxInlineBlobSize : (this.options?.maxInlineBlobSize || 0)); // p_sqldata_inline_blob_size
        }
    
        callback!.statement = statement;
        this._queueEvent(callback);
    }




    /** `count` may be the callback itself when no fetch size is given. */
    fetch(statement: Statement, transaction: Transaction, count: any, callback?: QueueCallback) {
    
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
    
        callback!.statement = statement;
        this._queueEvent(callback);
    }


    fetchScroll(statement: Statement, transaction: Transaction, direction: string | number, offset: any, count: any, callback?: QueueCallback) {
        if (typeof count === 'function') {
            callback = count;
            count = undefined;
        }
        if (typeof offset === 'function') {
            callback = offset;
            offset = undefined;
            count = undefined;
        }

        var msg = this._msg;
        var blr = this._blr;
    
        msg.pos = 0;
        blr.pos = 0;
    
        let dirInt = 0;
        if (typeof direction === 'number') {
            dirInt = direction;
        } else if (typeof direction === 'string') {
            const dirUpper = direction.toUpperCase();
            switch (dirUpper) {
                case 'NEXT':     dirInt = 0; break;
                case 'PRIOR':    dirInt = 1; break;
                case 'FIRST':    dirInt = 2; break;
                case 'LAST':     dirInt = 3; break;
                case 'ABSOLUTE': dirInt = 4; break;
                case 'RELATIVE': dirInt = 5; break;
                default:
                    throw new Error('Invalid fetch direction: ' + direction);
            }
        }

        const offsetVal = offset || 0;
        const fetchCount = count || 1;

        msg.addInt(Const.op_fetch_scroll);
        msg.addInt(statement.handle);
        CalcBlr(blr, statement.output);
        msg.addBlr(blr);
        msg.addInt(0); // message number
        msg.addInt(fetchCount); // fetch count
        msg.addInt(dirInt); // fetch operation
        msg.addInt(offsetVal); // fetch position (offset)
    
        callback!.statement = statement;
        this._queueEvent(callback);
    }


    /**
     * Query runtime information about a prepared statement via op_info_sql
     * (e.g. Const.RECORDS_INFO for the per-verb DML row counts). The
     * response is a plain op_response whose buffer holds the info clusters.
     */
    statementInfo(statement: Statement, items: number[], callback?: QueueCallback) {
        if (this._isClosed)
            return this.throwClosed(callback);

        this._pending.push('statementInfo');

        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;

        blr.addBytes(items);

        msg.addInt(Const.op_info_sql);
        msg.addInt(statement.handle);
        msg.addInt(0); // incarnation
        msg.addBlr(blr);
        msg.addInt(65535); // buffer_length

        this._queueEvent(callback);
    }


    fetchAll(statement: Statement, transaction: Transaction, callback: Callback<any[]>) {
        const self = this;
        const custom = statement.options || {};
        const asStream = custom.asStream && custom.on;
        const data: any[] | null = asStream ? null : [];
        let streamIndex = 0;
        const loop = (err: any, ret: any) => {
            if (err) {
                callback(err);
                return;
            }

            if (ret && ret.data && ret.data.length) {
                // Read blobs sequentially instead of in parallel to avoid
                // exceeding Firebird's per-connection open-blob-handle limit,
                // which causes a server-side deadlock when many rows contain
                // BLOBs and blobAsText is true. See issue #387.
                const arrBlobFns = ret.arrBlob || [];
                const readBlobsSequentially = (index: any, results: any) => {
                    if (index >= arrBlobFns.length) {
                        return Promise.resolve(results);
                    }
                    return arrBlobFns[index](transaction).then((v: any) => {
                        results.push(v);
                        return readBlobsSequentially(index + 1, results);
                    });
                };

                readBlobsSequentially(0, []).then((arrBlob: any) => {
                    for (let i = 0; i < arrBlob.length; i++) {
                        const blob = arrBlob[i];
                        // nestTables === true rows: the value lives in the
                        // per-table sub-object, not on the row itself
                        Xsql.nestCell(ret.data[blob.row], blob.table)[blob.column] = applyTypeCast(
                            statement.connection.options, blob.meta || {},
                            parseValueIfJson(blob.value, statement.connection.options));
                    }

                    doSynchronousLoop(ret.data, (row, _i, next) => {
                        const pos = asStream ? streamIndex++ : (data!.push(row) - 1);
                        if (asStream) {
                            executeStreamRow(custom, row, pos, statement.output, next);
                        } else {
                            next();
                        }
                    }, (streamErr) => {
                        if (streamErr) {
                            callback(streamErr);
                            return;
                        }

                        if (ret.fetched) {
                            callback(undefined, data || []);
                        } else {
                            self.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
                        }
                    });
                }).catch(callback);
                return;
            }

            if (ret && ret.fetched) {
                callback(undefined, data || []);
            } else {
                self.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
            }
        };

        this.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
    }



    openBlob(blob: Quad, transaction: Transaction, callback: QueueCallback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_open_blob);
        msg.addInt(transaction.handle);
        msg.addQuad(blob);
        this._queueEvent(callback);
    }


    closeBlob(blob: any, callback?: QueueCallback, defer = true) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_close_blob);
        msg.addInt(blob.handle);
        this._queueEvent(callback, defer);
    }


    getSegment(blob: any, callback: QueueCallback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_get_segment);
        msg.addInt(blob.handle);
        msg.addInt(this.options.blobReadChunkSize || 1024); // buffer length (max 65535)
        msg.addInt(0); // ???
        this._queueEvent(callback);
    }


    createBlob2(transaction: Transaction, callback: QueueCallback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_create_blob2);
        msg.addInt(0);
        msg.addInt(transaction.handle);
        msg.addInt(0);
        msg.addInt(0);
        this._queueEvent(callback);
    }


    batchSegments(blob: any, buffer: Buffer, callback: QueueCallback) {
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
    }


    /**
     * Create a transaction blob, upload `value` (Buffer, string, or a
     * JSON-able object) and deliver its quad id. executeBatch's blob
     * pre-pass uses this: batch messages reference pre-created transaction
     * blobs (the batch parameter buffer's default BLOB_NONE policy), just
     * like the classic execute path stores blob params.
     */
    uploadBlob(transaction: Transaction, value: any, callback: (err: any, oid?: any) => void) {
        var self = this;
        var b: Buffer;
        if (Buffer.isBuffer(value)) {
            b = value;
        } else if (typeof value === 'string') {
            b = Buffer.from(value, Const.DEFAULT_ENCODING);
        } else {
            b = Buffer.from(JSON.stringify(value), Const.DEFAULT_ENCODING);
        }

        self.createBlob2(transaction, function(err: any, blob: any) {
            if (err) {
                return callback(err);
            }
            var chunkSize = self.options.blobChunkSize || 1024;
            // bufferReader's next() drops errors — capture the first segment
            // failure so a truncated upload is never reported as success
            var segmentError: any = null;
            bufferReader(b, chunkSize, function(part, next) {
                self.batchSegments(blob, part, function(segErr: any) {
                    if (segErr && !segmentError) {
                        segmentError = segErr;
                    }
                    next();
                } as any);
            }, function() {
                self.closeBlob(blob, function(closeErr: any) {
                    callback(segmentError || closeErr, blob.oid);
                } as any, false);
            });
        });
    }


    svcattach(options: InternalOptions, callback?: Callback<ServiceManager>, svc?: ServiceManager) {
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
        
        // For Firebird 3+ (protocol 13+), add UTF-8 filename flag to ensure all DPB strings are handled with UTF-8
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
            blr.addByte(Const.isc_dpb_utf8_filename);
            blr.addByte(0);
        }
        
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
    
        function cb(err: any, ret: any) {
    
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


    svcstart(spbaction: BlrWriter, callback: QueueCallback | undefined) {
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        msg.addInt(Const.op_service_start);
        msg.addInt(this.svchandle!);
        msg.addInt(0)
        msg.addBlr(spbaction);
        this._queueEvent(callback);
    }


    svcquery(spbquery: number[], resultbuffersize: number, timeout: number | undefined, callback: QueueCallback | undefined) {
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
        msg.addInt(this.svchandle!);
        msg.addInt(0);
        msg.addBlr(blr);
        blr.pos = 0
        blr.addBytes(spbquery);
        msg.addBlr(blr);
        msg.addInt(resultbuffersize);
        this._queueEvent(callback);
    }


    svcdetach(callback: Callback | undefined) {
        var self = this;

        if (self._isClosed) {
            doError(new Error('Connection is closed.'), callback);
            return;
        }
    
        self._isUsed = false;
        self._isDetach = true;
    
        var msg = self._msg;
    
        msg.pos = 0;
        msg.addInt(Const.op_service_detach);
        msg.addInt(this.svchandle!); // Database Object ID
    
        self._queueEvent(function (err: any, ret: any) {
            delete (self.svchandle);
            if (callback)
                callback(err, ret);
        });
    }



    auxConnection(eventid: number | Callback, callback?: Callback) {
        if (typeof eventid === 'function') {
            // Preserve the older auxConnection(callback) call shape; plain
            // auxiliary connections historically used event id 0.
            callback = eventid;
            eventid = 0;
        }
        var self = this;
        if (self._isClosed)
            return this.throwClosed(callback);
        var msg = self._msg;
        msg.pos = 0;
        msg.addInt(Const.op_connect_request);
        msg.addInt(1); // async
        msg.addInt(self.dbhandle!);
        msg.addInt(eventid);
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] auxConnection: sending op_connect_request(53) dbhandle=%d eventid=%d queue_before=%d xdr_saved=%s',
                self.dbhandle, eventid, self._queue.length, Boolean(self._xdr));
        }
        function cb(err: any, ret: any) {
    
            if (err) {
                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] auxConnection: op_connect_request error: %s queue=%d', err.message, self._queue.length);
                }
                doError(err, callback);
                return;
            }
    
            var socket_info = {
                family: ret.buffer.readInt16BE(0),
                port: ret.buffer.readUInt16BE(2),
                host: ret.buffer.readUInt8(4) + '.' + ret.buffer.readUInt8(5) + '.' + ret.buffer.readUInt8(6) + '.' + ret.buffer.readUInt8(7)
            }

            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] auxConnection: op_response ok → aux family=%d port=%d host=%s queue=%d',
                    socket_info.family, socket_info.port, socket_info.host, self._queue.length);
            }
    
            callback!(undefined, socket_info);
        }
        this._queueEvent(cb);
    }


    queEvents(events: Record<string, number>, eventid: number, callback: Callback) {
        var self = this;
        if (this._isClosed)
            return this.throwClosed(callback);
        var msg = this._msg;
        var blr = this._blr;
        blr.pos = 0;
        msg.pos = 0;
        msg.addInt(Const.op_que_events);
        msg.addInt(this.dbhandle!);
        // prepare EPB
        blr.addByte(1) // epb_version
        for (var event in events) {
            var event_buffer = Buffer.from(event, 'utf8');
            blr.addByte(event_buffer.length);
            blr.addBytes(event_buffer);
            blr.addInt32(events[event]);
        }
        msg.addBlr(blr);    // epb    
        msg.addInt(0);    // ast
        msg.addInt(0);   // args
        msg.addInt(eventid);
        
        function cb(err: any, ret: any) {
            if (err) {
                doError(err, callback);
                return;
            }
            
            callback(null, ret);
        }
        
        this._queueEvent(cb);
    }


    closeEvents(eventid: number, callback: Callback) {
        var self = this;
        if (this._isClosed)
            return this.throwClosed(callback);
        var msg = self._msg;
        msg.pos = 0;
        msg.addInt(Const.op_cancel_events);
        msg.addInt(self.dbhandle!);
        msg.addInt(eventid);
    
        function cb(err: any, ret: any) {
            if (err) {
                doError(err, callback);
                return;
            }
    
            callback(null);
        }
    
        this._queueEvent(cb);
    }

}

// Reverse-lookup table: opcode number → name for FIREBIRD_DEBUG trace logging.
const opcodeNames = Object.fromEntries(
    Object.entries(Const).filter(([k]) => k.startsWith('op_')).map(([k, v]) => [v, k])
);

function decodeResponse(data: XdrReader, callback: QueueCallback | undefined, cnx: Connection, lowercase_keys: boolean | undefined, cb: (err?: any, obj?: any) => void) {
    try {
        do {
            var r = data.r || data.readInt();
            if (data.r) {
                data.r = null;
            }
            if (r === Const.op_dummy) {
                continue;
            }
            if (r === Const.op_inline_blob) {
                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] decodeResponse: opcode=op_inline_blob');
                }
                var tran_id = data.readInt();
                var blob_id = data.readQuad();
                var blob_data = data.readArray();
                if (!cnx._inlineBlobs) {
                    cnx._inlineBlobs = new Map();
                }
                const cacheKey = `${blob_id.high}:${blob_id.low}`;
                cnx._inlineBlobs.set(cacheKey, blob_data!);
                r = Const.op_dummy; // Continue loop to read next opcode
            }
        } while (r === Const.op_dummy);

        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] decodeResponse: opcode=%d(%s) pos=%d buflen=%d',
                r, opcodeNames[r] || 'unknown', data.pos, data.buffer.length);
        }

        var item, op, response: any;

        switch (r) {
            case Const.op_response:

                if (callback) {
                    response = callback.response || {};
                } else {
                    response = {};
                }

                let loop = function (err: any) {
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
            case Const.op_batch_cs: {
                // Batch completion state (response to op_batch_exec):
                // statement, reccount, updates count, vectors count, errors
                // count, then the update-count array, the (recnum + status
                // vector) pairs and finally the status-less error recnums.
                var completion: any = {
                    statementHandle: data.readInt(),
                    recordCount: data.readInt(),
                };
                var updatesCount = data.readInt();
                var vectorsCount = data.readInt();
                var simpleErrorsCount = data.readInt();

                completion.updateCounts = new Array(updatesCount);
                for (var bi = 0; bi < updatesCount; bi++) {
                    completion.updateCounts[bi] = data.readInt();
                }

                completion.detailedErrors = [];
                for (var bi = 0; bi < vectorsCount; bi++) {
                    var recordNumber = data.readInt();
                    var vector = readStatusVector(data);
                    var recordError: any = new Error(lookupMessages(vector.status) || 'Batch record failed');
                    if (vector.status.length) {
                        recordError.gdscode = vector.status[0].gdscode;
                        recordError.gdsparams = vector.status[0].params;
                    }
                    if (vector.sqlcode !== undefined) {
                        recordError.sqlcode = vector.sqlcode;
                    }
                    completion.detailedErrors.push({ recordNumber: recordNumber, error: recordError });
                }

                completion.errorRecordNumbers = [];
                for (var bi = 0; bi < simpleErrorsCount; bi++) {
                    completion.errorRecordNumbers.push(data.readInt());
                }

                return cb(null, { batchCompletion: completion });
            }
            case Const.op_fetch_response:
            case Const.op_sql_response:
                // fetch/sql_response entries always carry their statement
                var statement = callback!.statement!;
                var output = statement.output;
                var custom = statement.options || {};
                var isOpFetch = r === Const.op_fetch_response;
                var _xdrpos;
                statement.nbrowsfetched = statement.nbrowsfetched || 0;

                // The f* decode state is only meaningful within a single
                // decode call: incomplete packets are re-decoded from scratch
                // on a fresh XdrReader (see the 'data' handler). State left by
                // an earlier packet in the same data event (e.g. fstatus=100 /
                // fcount=0 from a completed fetch) would make this decode
                // consume just the opcode and desync every later response.
                delete data.fstatus;
                delete data.fcount;
                delete data.fcolumn;
                delete data.frow;
                delete data.frows;
                delete data.fcols;
                delete data.ftables;

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
                    const nest = Xsql.resolveNestTables(custom, cnx.options);
                    const transform = Xsql.resolveKeyTransform(custom, cnx.options);
                    const columnKeys = Xsql.computeColumnKeys(output, nest, lowercase_keys, transform);
                    data.fcols = columnKeys.map((k) => k.key);
                    if (nest === true) {
                        // computeColumnKeys always sets table when nesting
                        data.ftables = columnKeys.map((k) => k.table!);
                    }
                }

                const arrBlob: any[] = [];
                const lowerV13 = statement.connection.accept.protocolVersion <  Const.PROTOCOL_VERSION13;

                // op_sql_response (op_execute2) is always followed by an
                // op_response carrying the execute status vector. The row loop
                // below consumes it after the last row, but with zero rows
                // (e.g. INSERT ... RETURNING failing on a constraint) it stays
                // in the buffer, shifting every later response to the wrong
                // callback and poisoning the connection (issue #341).
                var sqlResponseTrailerPending = !isOpFetch && !data.fcount;

                while (data.fcount && (data.fstatus !== 100)) {
                    let nullBitSet;
                    if (!lowerV13) {
                        const nullBitsLen = Math.floor((output.length + 7) / 8);
                        nullBitSet = new BitSet(data.readBuffer(nullBitsLen, false)!);
                        data.readBuffer((4 - nullBitsLen) & 3, false); // Skip padding
                    }

                    for (let length = output.length; data.fcolumn < length; data.fcolumn++) {
                        item = output[data.fcolumn];

                        if (!lowerV13 && nullBitSet!.get(data.fcolumn)) {
                            const nullKey = custom.asObject ? data.fcols![data.fcolumn!] : data.fcolumn;
                            // ftables is only set when nestTables === true, so
                            // the default path writes straight into the row
                            (data.ftables ? Xsql.nestCell(data.frow, data.ftables[data.fcolumn!]) : data.frow)[nullKey] =
                                applyTypeCast(cnx.options, item, null);

                            continue;
                        }

                        try {
                            _xdrpos = data.pos;
                            const key = custom.asObject ? data.fcols![data.fcolumn!] : data.fcolumn;
                            const row = data.frows.length;
                            let value = item.decode(data, lowerV13, cnx.options);
                            // text blobs resolved by blobAsText run through the
                            // typeCast hook once the text arrives (see fetchAll),
                            // not here where the value is still a pending fetch
                            let pendingTextBlob = false;

                            if (item.type === Const.SQL_BLOB && value !== null) {
                                if (item.subType === Const.isc_blob_text && cnx.options.blobAsText) {
                                    value = fetch_blob_async_transaction(statement, value, key, row, item,
                                        data.ftables && data.ftables[data.fcolumn!]);
                                    arrBlob.push(value);
                                    pendingTextBlob = true;
                                } else {
                                    value = fetch_blob_async(statement, value, key, row);
                                }
                            }

                            (data.ftables ? Xsql.nestCell(data.frow, data.ftables[data.fcolumn!]) : data.frow)[key] = pendingTextBlob
                                ? value
                                : applyTypeCast(cnx.options, item, parseValueIfJson(value, cnx.options));
                        } catch (e) {
                            // uncomplete packet read
                            data.pos = _xdrpos!;
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

                if (sqlResponseTrailerPending) {
                    op = data.readInt();
                    if (op === Const.op_response) {
                        response = {};
                        parseOpResponse(data, response);
                        if (response.status) {
                            return cb(null, response);
                        }
                    }
                }

                // ToDo: emit "result" with blob subtype string decoded
                statement.connection.db.emit('result', data.frows, arrBlob);
                return cb(null, {data: data.frows, fetched: Boolean(!isOpFetch || data.fstatus === 100), arrBlob});
            case Const.op_accept:
            case Const.op_cond_accept:
            case Const.op_accept_data:
                let accept: any = {
                    protocolVersion: data.readInt(),
                    protocolArchitecture: data.readInt(),
                    protocolMinimumType: data.readInt(),
                    compress: false,
                    pluginName: '',
                    authData: '',
                    sessionKey: ''
                };

                accept.compress = (accept.protocolMinimumType & Const.pflag_compress) !== 0;
                accept.protocolMinimumType = accept.protocolMinimumType & Const.ptype_mask;
                //accept.compress = (accept.acceptType & pflag_compress) !== 0; // TODO Handle zlib compression
                if (accept.protocolVersion < 0) {
                    accept.protocolVersion = (accept.protocolVersion & Const.FB_PROTOCOL_MASK) | Const.FB_PROTOCOL_FLAG;
                }

                if (r === Const.op_cond_accept || r === Const.op_accept_data) {
                    var d = new BlrReader(data.readArray()!);
                    accept.pluginName = data.readString(Const.DEFAULT_ENCODING);
                    var is_authenticated = data.readInt();
                    var keys = data.readString(Const.DEFAULT_ENCODING); // keys
                    accept.keys = keys;

                    if (is_authenticated === 0) {
                        if (cnx.options.pluginName && cnx.options.pluginName !== accept.pluginName) {
                            var errPlugin = new Error('Server don\'t accept plugin : ' + cnx.options.pluginName + ', but support : ' + accept.pluginName);
                            doError(errPlugin, callback);
                            return cb(errPlugin);
                        }

                        if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(accept.pluginName) !== -1 && !cnx.clientKeys) {
                            var errPlugin = new Error('Server accepted plugin : ' + accept.pluginName + ', but client did not initialize SRP keys');
                            doError(errPlugin, callback);
                            return cb(errPlugin);
                        }

                        if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(accept.pluginName) !== -1) {
                            var crypto: Record<string, string> = {
                                Srp: 'sha1',
                                Srp256: 'sha256',
                                Srp384: 'sha384',
                                Srp512: 'sha512'
                            };
                            accept.srpAlgo = crypto[accept.pluginName];

                            if (!d.buffer) {
                                cnx._pendingAccept = accept;
                                cnx.sendOpContAuth(
                                    cnx.clientKeys!.public.toString(16),
                                    Const.DEFAULT_ENCODING,
                                    accept.pluginName
                                );
                                return;
                            }

                            // Check buffer contains salt
                            var saltLen = d.buffer.readUInt16LE(0);
                            if (saltLen > 32 * 2) {
                                console.log('salt to long'); // TODO : Throw error
                            }

                            // Check buffer contains key
                            var keyLen = d.buffer.readUInt16LE(saltLen + 2);
                            if (d.buffer.length < saltLen + 4) {
                                var errBuf = new Error('Invalid buffer size for ' + accept.pluginName + ' login');
                                doError(errBuf, callback);
                                return cb(errBuf);
                            }
                            var keyStart = (saltLen + 2 + 3) & ~3;

                            // Server keys
                            cnx.serverKeys = {
                                salt: d.buffer.slice(2, saltLen + 2).toString('utf8'),
                                public: BigInt('0x' + d.buffer.slice(keyStart, d.buffer.length).toString('utf8')),
                                pluginName: accept.pluginName
                            };

                            if (process.env.FIREBIRD_DEBUG) {
                                console.log('--- DEBUG SRP Handshake ---');
                                console.log('salt:', cnx.serverKeys!.salt);
                                console.log('server public key:', cnx.serverKeys!.public.toString(16));
                                console.log('client public key:', cnx.clientKeys!.public.toString(16));
                                console.log('hashAlgo:', accept.srpAlgo);
                            }

                            const _t1 = Date.now();
                            var proof = srp.clientProof(
                                cnx.options.user!.toUpperCase(),
                                cnx.options.password!,
                                cnx.serverKeys!.salt,
                                cnx.clientKeys!.public,
                                cnx.serverKeys!.public,
                                cnx.clientKeys!.private,
                                accept.srpAlgo
                            );

                            if (process.env.FIREBIRD_DEBUG) {
                                // Never log the private key or the session key: the
                                // session key is the wire-encryption key material.
                                console.log('client proof M1:', proof.authData.toString(16));
                            }

                            if (process.env.FIREBIRD_DEBUG) {
                                console.log('[fb-debug] srp.clientProof(%s): %dms', accept.srpAlgo, Date.now() - _t1);
                            }

                            accept.authData = proof.authData.toString(16);
                            accept.sessionKey = proof.clientSessionKey;
                        } else if (accept.pluginName === Const.AUTH_PLUGIN_LEGACY) {
                            accept.authData = crypt.crypt(cnx.options.password!, Const.LEGACY_AUTH_SALT).substring(2);
                        } else {
                            return cb(new Error('Unknow auth plugin : ' + accept.pluginName));
                        }
                    } else {
                        accept.authData = '';
                        accept.sessionKey = '';
                    }
                }

                if (accept.compress) {
                    cnx._socket.enableCompression();
                }

                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] auth: %s received plugin=%s proto=%d t=%dms',
                        r === Const.op_cond_accept ? 'op_cond_accept' : r === Const.op_accept_data ? 'op_accept_data' : 'op_accept',
                        accept.pluginName, accept.protocolVersion,
                        cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                }

                // For op_cond_accept: send op_cont_auth and wait for response
                if (r === Const.op_cond_accept && accept.authData) {
                    cnx._pendingAccept = accept;
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] auth: sending op_cont_auth plugin=%s t=%dms',
                            accept.pluginName, cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                    }
                    cnx.sendOpContAuth(
                        accept.authData,
                        Const.DEFAULT_ENCODING,
                        accept.pluginName
                    );
                    return; // Don't call cb - queue stays for op_response
                }

                return cb(undefined, accept);
            case Const.op_cont_auth:
                var d = new BlrReader(data.readArray()!);
                var pluginName = data.readString(Const.DEFAULT_ENCODING);
                data.readString(Const.DEFAULT_ENCODING); // plist
                data.readString(Const.DEFAULT_ENCODING); // pkey

                if (process.env.FIREBIRD_DEBUG) {
                    console.log('[fb-debug] auth: op_cont_auth received plugin=%s pendingAccept=%s t=%dms',
                        pluginName,
                        cnx._pendingAccept ? cnx._pendingAccept.pluginName : 'none',
                        cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                }

                // During SRP mutual authentication, the server sends op_cont_auth
                // with its proof (M2) after receiving the client's proof (M1).
                // When we have an active auth exchange for this plugin:
                if (cnx._pendingAccept && (cnx._pendingAccept.pluginName === pluginName || Const.AUTH_PLUGIN_SRP_LIST.indexOf(pluginName) !== -1)) {
                    if (cnx._pendingAccept.pluginName !== pluginName) {
                        cnx._pendingAccept.pluginName = pluginName;
                    }
                    // The server can switch SRP hash variants mid-handshake: after
                    // the client answers with e.g. Srp256, some accounts make the
                    // server come back with a fresh op_cont_auth naming a different
                    // SRP plugin (e.g. plain Srp/sha1), reusing the same salt/B.
                    // That must be treated as a brand-new challenge - recomputing
                    // the proof with the new plugin's hash algorithm - rather than
                    // as the server's M2 proof, otherwise the client silently waits
                    // forever for an op_accept the server will never send (#254).
                    if (!cnx.serverKeys || cnx.serverKeys!.pluginName !== pluginName) {
                        // Check buffer contains salt
                        var saltLen = d.buffer.readUInt16LE(0);
                        if (saltLen > 32 * 2) {
                            console.log('salt to long'); // TODO : Throw error
                        }

                        // Check buffer contains key
                        var keyLen = d.buffer.readUInt16LE(saltLen + 2);
                        if (d.buffer.length < saltLen + 4) {
                            var errBuf = new Error('Invalid buffer size for ' + pluginName + ' login');
                            doError(errBuf, callback);
                            return cb(errBuf);
                        }
                        var keyStart = (saltLen + 2 + 3) & ~3;

                        // Server keys
                        cnx.serverKeys = {
                            salt: d.buffer.slice(2, saltLen + 2).toString('utf8'),
                            public: BigInt('0x' + d.buffer.slice(keyStart, d.buffer.length).toString('utf8')),
                            pluginName: pluginName
                        };

                        var crypto: Record<string, string> = {
                            Srp: 'sha1',
                            Srp256: 'sha256',
                            Srp384: 'sha384',
                            Srp512: 'sha512'
                        };
                        var srpAlgo = crypto[pluginName];

                        if (process.env.FIREBIRD_DEBUG) {
                            console.log('--- DEBUG SRP Handshake ---');
                            console.log('salt:', cnx.serverKeys!.salt);
                            console.log('server public key:', cnx.serverKeys!.public.toString(16));
                            console.log('client public key:', cnx.clientKeys!.public.toString(16));
                            console.log('hashAlgo:', srpAlgo);
                        }

                        const _t1 = Date.now();
                        var proof = srp.clientProof(
                            cnx.options.user!.toUpperCase(),
                            cnx.options.password!,
                            cnx.serverKeys!.salt,
                            cnx.clientKeys!.public,
                            cnx.serverKeys!.public,
                            cnx.clientKeys!.private,
                            srpAlgo
                        );

                        if (process.env.FIREBIRD_DEBUG) {
                            console.log('[fb-debug] srp.clientProof(%s): %dms', srpAlgo, Date.now() - _t1);
                        }

                        cnx._pendingAccept.authData = proof.authData.toString(16);
                        cnx._pendingAccept.sessionKey = proof.clientSessionKey;

                        cnx.sendOpContAuth(
                            cnx._pendingAccept.authData,
                            Const.DEFAULT_ENCODING,
                            pluginName
                        );
                        return; // wait for server SRP proof (M2) and/or op_accept
                    } else {
                        if (process.env.FIREBIRD_DEBUG) {
                            console.log('[fb-debug] auth: server SRP proof (M2) received, waiting for op_accept t=%dms',
                                cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                        }
                        return; // Server SRP proof received - wait for op_accept
                    }
                }

                // Firebird 4/5 (protocols 16/17) chained-auth: after the client sends
                // the SRP M1 proof, the server sends op_cont_auth with Legacy_Auth.
                // SRP has already established the session key; the server additionally
                // requires a Legacy_Auth verification step before sending op_accept.
                // Respond with Legacy_Auth credentials and wait for op_accept.
                if (cnx._pendingAccept && pluginName === Const.AUTH_PLUGIN_LEGACY) {
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] auth: SRP+Legacy_Auth chained-auth (proto %d), sending Legacy_Auth credentials t=%dms',
                            cnx._pendingAccept.protocolVersion,
                            cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                    }
                    var legacyAuthData = crypt.crypt(cnx.options.password!, Const.LEGACY_AUTH_SALT).substring(2);
                    cnx.sendOpContAuth(legacyAuthData, Const.DEFAULT_ENCODING, pluginName);
                    return; // wait for op_accept
                }

                if (!cnx.options.pluginName) {
                    if (cnx.accept && cnx.accept.pluginName === pluginName) {
                        // Erreur plugin not able to connect
                        return cb(new Error("Unable to connect with plugin " + cnx.accept.pluginName));
                    }

                    if (pluginName === Const.AUTH_PLUGIN_LEGACY) { // Fallback to LegacyAuth
                        cnx.accept.pluginName = pluginName;
                        cnx.accept.authData = crypt.crypt(cnx.options.password!, Const.LEGACY_AUTH_SALT).substring(2);

                        cnx.sendOpContAuth(
                            cnx.accept.authData,
                            Const.DEFAULT_ENCODING,
                            pluginName
                        );

                        return {error: new Error('login')};
                    }
                }

                // Server sent op_cont_auth but we don't know how to handle it.
                if (process.env.FIREBIRD_DEBUG) {
                    console.warn('[fb-debug] auth: op_cont_auth unhandled plugin=%s pendingAccept=%s options.plugin=%s t=%dms',
                        pluginName,
                        cnx._pendingAccept ? cnx._pendingAccept.pluginName : 'none',
                        cnx.options.pluginName || 'none',
                        cnx._authStartTime ? Date.now() - cnx._authStartTime : -1);
                }
                return cb(new Error('Unhandled server op_cont_auth for plugin: ' + pluginName));
            case Const.op_crypt_key_callback:
                // Database encryption key callback
                // Read server data (plugin data sent by server)
                var serverPluginData = data.readArray();
                data.readInt(); // p_cc_reply
                
                // Get client response from dbCryptConfig option
                var clientPluginData = parseDbCryptConfig(cnx.options.dbCryptConfig);
                
                // Create a BlrWriter to send the response
                // Note: BlrWriter needs initial buffer size allocation
                var responseBlr = new BlrWriter(clientPluginData.length + 4);
                responseBlr.addBytes(clientPluginData);
                
                // Send the response back to the server
                cnx.sendOpCryptKeyCallback(responseBlr);
                
                // Don't call cb - wait for next operation (likely op_response or another op_crypt_key_callback)
                return;
            case Const.op_event:
                // op_event may occasionally arrive on the main connection
                // (e.g. Firebird routing an async notification here instead of
                // the dedicated aux socket).  Consume all its fields so the
                // buffer position advances correctly, then signal the data
                // handler to skip queue manipulation for this frame.
                //
                // Firebird wire protocol – op_event payload (remote protocol):
                //   p_event_database : Int32  – database handle
                //   p_event_items    : Array  – event parameter block (EPB)
                //   p_event_ast      : Int64  – AST routine pointer (0 for remote)
                //   p_event_rid      : Int32  – remote event ID
                {
                    const evtDb = data.readInt();    // p_event_database
                    data.readArray();               // p_event_items (EPB buffer)
                    data.readInt64();               // p_event_ast
                    const evtRid = data.readInt();  // p_event_rid
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] op_event on main connection: db=%d rid=%d (consumed, not queued)', evtDb, evtRid);
                    }
                }
                return cb(null, { _isOpEvent: true });
            case Const.op_response_piggyback:
                // Firebird 5 (Protocol 16/17) sends op_response_piggyback (72)
                // as an unsolicited cleanup notification after certain operations
                // (e.g. after the EventConnection aux socket is torn down).
                // It has the same wire layout as op_response but does NOT
                // correspond to any queued client request.  Parse and discard it
                // so that the xdr buffer position advances correctly, then signal
                // the data handler to skip queue manipulation.
                //
                // Wire layout (identical to op_response):
                //   handle  : Int32
                //   object  : Quad (2x Int32)
                //   data    : Array
                //   status  : status-vector ending with isc_arg_end
                parseOpResponse(data, {}, function(err) {
                    if (process.env.FIREBIRD_DEBUG) {
                        if (err) {
                            console.warn('[fb-debug] op_response_piggyback parse error:', err.message);
                        } else {
                            console.log('[fb-debug] op_response_piggyback consumed (unsolicited Firebird 5 cleanup)');
                        }
                    }
                });
                return cb(null, { _isOpEvent: true });
            default:
                if (process.env.FIREBIRD_DEBUG) {
                    console.warn('[fb-debug] unknown opcode=%d at pos=%d buflen=%d queue=%d',
                        r, data.pos, data.buffer.length, cnx && cnx._queue ? cnx._queue.length : 0);
                }
                return cb(new Error('Unexpected:' + r));
        }
    } catch (err: any) {
        if (process.env.FIREBIRD_DEBUG) {
            console.warn('[fb-debug] decodeResponse exception: %s (RangeError=%s) pos=%d buflen=%d',
                err.message, err instanceof RangeError, data.pos, data.buffer.length);
        }
        if (err instanceof RangeError) {
            return cb(err);
        }
        throw err;
    }
}

/**
 * Read one XDR status vector (as in op_response / op_batch_cs error
 * vectors): a stream of isc_arg_* items terminated by isc_arg_end.
 */
function readStatusVector(data: XdrReader): { status: any[]; warnings?: any[]; sqlcode?: number } {
    var result: { status: any[]; warnings?: any[]; sqlcode?: number } = { status: [] };
    var item: any = {};

    while (true) {
        var op = data.readInt();

        switch (op) {
            case Const.isc_arg_end:
                return result;
            case Const.isc_arg_gds:
                var num = data.readInt();
                if (!num) {
                    break;
                }
                item = { gdscode: num };
                result.status.push(item);
                break;
            case Const.isc_arg_string:
            case Const.isc_arg_interpreted:
            case Const.isc_arg_sql_state:
                var str = data.readString(Const.DEFAULT_ENCODING);
                (item.params = item.params || []).push(str);
                break;
            case Const.isc_arg_number:
                var n = data.readInt();
                (item.params = item.params || []).push(n);
                if (item.gdscode === Const.isc_sqlerr) {
                    result.sqlcode = n;
                }
                break;
            case Const.isc_arg_warning:
                // A warning attached to a SUCCESS vector (e.g. "parallel
                // workers value capped"). Keep it out of `status` so the
                // operation is not mistaken for a failure; later string/
                // number items attach to the warning entry.
                var wnum = data.readInt();
                item = { gdscode: wnum };
                if (wnum) {
                    (result.warnings = result.warnings || []).push(item);
                }
                break;
            default:
                throw new Error('Unexpected status vector item: ' + op);
        }
    }
}

function parseOpResponse(data: XdrReader, response: WireResponse, cb?: (err?: any, response?: any) => void) {
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

    var num: any, op: any, item: any = {};
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
            case Const.isc_arg_warning:
                // A warning attached to a SUCCESS response (e.g. Firebird's
                // "parallel workers value capped" on attach). Keep it out of
                // `status` so the response is not mistaken for an error;
                // later string/number items attach to the warning entry.
                num = data.readInt();
                item = { gdscode: num };
                if (num) {
                    (response.warnings = response.warnings || []).push(item);
                }
                break;
            default:
                // Stop parsing: continuing the loop after an unknown item
                // re-read the same bytes forever (the caller resets the
                // reader position when the error is delivered).
                if (cb) {
                    return cb(new Error('Unexpected: ' + op));
                }
                throw new Error('Unexpected: ' + op);
        }
    }
}

function describe(buff: Buffer, statement: Statement) {
    var br = new BlrReader(buff);
    var parameters: any = null;
    var type: any, param: any;

    while (br.pos < br.buffer.length) {
        switch (br.readByteCode()) {
            case Const.isc_info_sql_stmt_type:
                statement.type = br.readInt()!;
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
                            // describe output always encodes the sequence as a
                            // 1/2/4-byte int, so readInt cannot return undefined
                            var num = br.readInt()!;
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
                                case Const.SQL_TIME_TZ:   param = new Xsql.SQLVarTimeTz(); break;
                                case Const.SQL_TIME_TZ_EX: param = new Xsql.SQLVarTimeTzEx(); break;
                                case Const.SQL_TIMESTAMP_TZ: param = new Xsql.SQLVarTimeStampTz(); break;
                                case Const.SQL_TIMESTAMP_TZ_EX: param = new Xsql.SQLVarTimeStampTzEx(); break;
                                case Const.SQL_BLOB:      param = new Xsql.SQLVarBlob(); break;
                                case Const.SQL_ARRAY:     param = new Xsql.SQLVarArray(); break;
                                case Const.SQL_QUAD:      param = new Xsql.SQLVarQuad(); break;
                                case Const.SQL_LONG:      param = new Xsql.SQLVarInt(); break;
                                case Const.SQL_SHORT:     param = new Xsql.SQLVarShort(); break;
                                case Const.SQL_INT64:     param = new Xsql.SQLVarInt64(); break;
                                case Const.SQL_INT128:     param = new Xsql.SQLVarInt128(); break;
                                case Const.SQL_DEC16:     param = new Xsql.SQLVarDecFloat16(); break;
                                case Const.SQL_DEC34:     param = new Xsql.SQLVarDecFloat34(); break;
                                case Const.SQL_BOOLEAN:   param = new Xsql.SQLVarBoolean(); break;
                                default:
                                    throw new Error('Unexpected');
                            }
                            // isc_info_sql_sqlda_seq always precedes the type
                            // item in the describe stream, so num is set here
                            parameters[num!-1] = param;
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
                        case Const.isc_info_sql_relation_schema:
                            // Firebird 6.0 (Protocol 20+): schema that owns the
                            // source relation.  Empty string means the default
                            // (PUBLIC) schema or a non-schema-aware server.
                            param.relationSchema = br.readString(Const.DEFAULT_ENCODING);
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

    function unpackCharSetCollation(params: any[]) {
        if (!params) return;
        for (let i = 0; i < params.length; i++) {
            const p = params[i];
            if (p && (p.type === Const.SQL_TEXT || p.type === Const.SQL_VARYING)) {
                if (p.subType !== undefined) {
                    p.charSetId = p.subType & 0xFF;
                    p.collationId = p.subType >> 8;
                }
            }
        }
    }
    unpackCharSetCollation(statement.input);
    unpackCharSetCollation(statement.output);
}

/**
 * Batch support: the engine requires every batch message to use EXACTLY the
 * statement's described input format (unlike op_execute, where the client
 * may declare its own format and the server converts). The BLR is therefore
 * CalcBlr(statement.input), and this helper returns one value encoder per
 * column that writes the wire representation mirroring the corresponding
 * SQLVar* decode, including scale. Returns { encoders, msglen } where
 * encoders[j](msg, value) writes a non-null value and msglen is the
 * unpacked message length sent with op_batch_create.
 */
function buildBatchEncoders(input: any[], options: any) {
    var encoders: Array<(msg: any, v: any) => void> = [];
    var offset = 0;
    var align = function(a: number) { offset = (offset + a - 1) & ~(a - 1); };

    var jsonAsObject = options && options.jsonAsObject;
    var toText = function(v: any): string {
        if (typeof v === 'string') return v;
        if (v instanceof Date) return v.toString();
        if (typeof v === 'object' && !Buffer.isBuffer(v)) return jsonAsObject ? JSON.stringify(v) : v.toString();
        return String(v);
    };
    var toBytes = function(v: any, meta: any, column: number): Buffer {
        var b = Buffer.isBuffer(v) ? v : Buffer.from(toText(v), Const.DEFAULT_ENCODING);
        if (b.length > meta.length) {
            throw new Error('Batch value for column ' + column + ' is ' + b.length +
                ' bytes but the column accepts at most ' + meta.length + ' (' + (meta.field || '?') + ')');
        }
        return b;
    };
    var toDate = function(v: any): Date {
        if (v instanceof Date) return v;
        if (typeof v === 'string') return parseDate(v);
        return new Date(v);
    };
    var scaled = function(v: any, scale: number): number {
        var n = typeof v === 'string' ? parseFloat(v) : Number(v);
        return scale ? Math.round(n * Math.pow(10, -scale)) : n;
    };
    var scaledBig = function(v: any, scale: number): bigint {
        if (typeof v === 'bigint') {
            return scale ? v * (10n ** BigInt(-scale)) : v;
        }
        return BigInt(scaled(v, scale));
    };

    for (var j = 0; j < input.length; j++) {
        var meta = input[j];
        var column = j + 1;

        switch (meta.type) {
            case Const.SQL_TEXT: // CHAR: fixed meta.length bytes, space-padded
                encoders.push((function(m, col) {
                    return function(msg: any, v: any) {
                        var b = toBytes(v, m, col);
                        if (b.length < m.length) {
                            b = Buffer.concat([b, Buffer.alloc(m.length - b.length, 0x20)]);
                        }
                        msg.addParamBuffer(b);
                    };
                })(meta, column));
                offset += meta.length;
                break;

            case Const.SQL_VARYING:
            case Const.SQL_NULL:
                encoders.push((function(m, col) {
                    return function(msg: any, v: any) {
                        var b = toBytes(v, m, col);
                        msg.addInt(b.length);
                        msg.addParamBuffer(b);
                    };
                })(meta, column));
                align(2); offset += 2 + meta.length;
                break;

            case Const.SQL_SHORT:
                // 2 bytes in the message struct (msglen), 4 on the XDR wire
                encoders.push((function(m) {
                    return function(msg: any, v: any) { msg.addInt(scaled(v, m.scale)); };
                })(meta));
                align(2); offset += 2;
                break;

            case Const.SQL_LONG:
                encoders.push((function(m) {
                    return function(msg: any, v: any) { msg.addInt(scaled(v, m.scale)); };
                })(meta));
                align(4); offset += 4;
                break;

            case Const.SQL_INT64:
                encoders.push((function(m) {
                    return function(msg: any, v: any) {
                        msg.addInt64(typeof v === 'bigint' ? (scaledBig(v, m.scale) as any) : scaled(v, m.scale));
                    };
                })(meta));
                align(8); offset += 8;
                break;

            case Const.SQL_INT128:
                encoders.push((function(m) {
                    return function(msg: any, v: any) { msg.addInt128(scaledBig(v, m.scale)); };
                })(meta));
                align(8); offset += 16;
                break;

            case Const.SQL_FLOAT:
            case Const.SQL_D_FLOAT:
                encoders.push(function(msg: any, v: any) { msg.addFloat(Number(v)); });
                align(4); offset += 4;
                break;

            case Const.SQL_DOUBLE:
                encoders.push(function(msg: any, v: any) { msg.addDouble(Number(v)); });
                align(8); offset += 8;
                break;

            case Const.SQL_DEC16:
                encoders.push(function(msg: any, v: any) { msg.addDecFloat16(v); });
                align(8); offset += 8;
                break;

            case Const.SQL_DEC34:
                encoders.push(function(msg: any, v: any) { msg.addDecFloat34(v); });
                align(8); offset += 16;
                break;

            case Const.SQL_BOOLEAN:
                // xdr_datum sends booleans as a 1-byte opaque (value byte
                // first, then 3 pad bytes), not as a big-endian int.
                encoders.push(function(msg: any, v: any) {
                    msg.addBuffer(Buffer.from([v ? 1 : 0]));
                    msg.addAlignment(1);
                });
                offset += 1;
                break;

            case Const.SQL_TIMESTAMP:
                encoders.push(function(msg: any, v: any) {
                    var parts = Xsql.encodeDateTimeParts(toDate(v));
                    msg.addInt(parts.date);
                    msg.addUInt(parts.time);
                });
                align(4); offset += 8;
                break;

            case Const.SQL_TYPE_DATE:
                encoders.push(function(msg: any, v: any) {
                    msg.addInt(Xsql.encodeDateTimeParts(toDate(v)).date);
                });
                align(4); offset += 4;
                break;

            case Const.SQL_TYPE_TIME:
                encoders.push(function(msg: any, v: any) {
                    msg.addUInt(Xsql.encodeDateTimeParts(toDate(v)).time);
                });
                align(4); offset += 4;
                break;

            case Const.SQL_BLOB:
            case Const.SQL_QUAD:
                // the value is a transaction blob quad id — placed by
                // executeBatch's uploadBlob pre-pass, or passed by the
                // caller directly. ISC_QUAD: two longs, align 4.
                encoders.push((function(col) {
                    return function(msg: any, v: any) {
                        if (!v || typeof v.high !== 'number' || typeof v.low !== 'number') {
                            throw new Error('Batch value for BLOB column ' + col +
                                ' must be a Buffer, string, object, or blob quad id');
                        }
                        msg.addInt(v.high);
                        msg.addInt(v.low);
                    };
                })(column));
                align(4); offset += 8;
                break;

            default:
                throw new Error('executeBatch does not support the type of parameter ' + column +
                    ' yet (' + (meta.field || '?') + ', SQL type ' + meta.type + ')');
        }

        // null indicator short that CalcBlr appends per parameter
        align(2); offset += 2;
    }

    // msglen must EXACTLY match the length the server computes from the BLR
    // (MsgMetadata::makeOffsets — no trailing alignment), or op_batch_create
    // fails with -804 SQLDA errors.
    return { encoders: encoders, msglen: offset };
}

/**
 * Build the batch parameter buffer (p_batch_pb): a wide-tagged clumplet
 * buffer — version byte, then per clumplet a tag byte, int32 LE length and
 * the value (ints are 4-byte LE).
 */
function buildBatchPb(options: any): Buffer {
    var parts: number[] = [Const.BATCH_VERSION1];

    var addIntClumplet = function(tag: number, value: number) {
        parts.push(tag, 4, 0, 0, 0, value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF);
    };

    addIntClumplet(Const.BATCH_TAG_RECORD_COUNTS, 1);
    if (!options || options.multiError !== false) {
        addIntClumplet(Const.BATCH_TAG_MULTIERROR, 1);
    }
    if (options && options.bufferSize) {
        addIntClumplet(Const.BATCH_TAG_BUFFER_BYTES_SIZE, options.bufferSize);
    }
    if (options && options.detailedErrors !== undefined) {
        addIntClumplet(Const.BATCH_TAG_DETAILED_ERRORS, options.detailedErrors);
    }

    return Buffer.from(parts);
}

function CalcBlr(blr: BlrWriter, xsqlda: any[]) {
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

function fetch_blob_async_transaction(statement: Statement, id: Quad, column: string | number, row: number, meta?: Xsql.SQLVarBase, table?: string) {
    const infoValue = { row, column, value: '', meta, table };

    return (transactionArg: any) => {
        const cacheKey = `${id.high}:${id.low}`;
        if (statement.connection._inlineBlobs && statement.connection._inlineBlobs.has(cacheKey)) {
            const data = statement.connection._inlineBlobs.get(cacheKey);
            infoValue.value = data ? data.toString(Const.DEFAULT_ENCODING) : '';
            return Promise.resolve(infoValue);
        }

        const singleTransaction = transactionArg === undefined;

        let promiseTransaction: Promise<Transaction>;
        if (singleTransaction) {
            promiseTransaction = new Promise((resolve, reject) => {
                statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err: any, transaction: Transaction) => {
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
                statement.connection.openBlob(id, transaction, (err: any, blob: any) => {

                    if (err) {
                        reject(err);
                        return;
                    }

                    const read = () => {
                        statement.connection.getSegment(blob, (err: any, ret: any) => {

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
                                transaction.commit((err: any) => {
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

function fetch_blob_async(statement: Statement, id: Quad, name: string | number, row: number) {
    const cbTransaction = (transaction: Transaction, close: any, callback: any) => {
        statement.connection._pending.push('openBlob');
        statement.connection.openBlob(id, transaction, (err: any, blob: any) => {
            let e: any = new Events.EventEmitter();

            e.pipe = (stream: any) => {
                e.on('data', (chunk: any) => {
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
                statement.connection.getSegment(blob, (err: any, ret: any) => {

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
                        transaction.commit((err: any) => {
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

    return (transaction: Transaction, callback: any) => {
        // callback(error, nameField, eventEmitter, row)
        const singleTransaction = callback === undefined;
        const actualCallback = singleTransaction ? transaction : callback;

        const cacheKey = `${id.high}:${id.low}`;
        if (statement.connection._inlineBlobs && statement.connection._inlineBlobs.has(cacheKey)) {
            const data = statement.connection._inlineBlobs.get(cacheKey);
            let e: any = new Events.EventEmitter();
            e.pipe = (stream: any) => {
                e.on('data', (chunk: any) => {
                    stream.write(chunk);
                });
                e.on('end', () => {
                    stream.end();
                });
            };

            actualCallback(null, name, e, row);

            setImmediate(() => {
                if (data) {
                    e.emit('data', data);
                }
                e.emit('end');
            });
            return;
        }

        if (singleTransaction) {
            callback = transaction;
            statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err: any, transaction: Transaction) => {
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

function doSynchronousLoop(data: any[], processData: (row: any, index: number, next: (err?: any) => void) => void, done: (err?: any) => void) {
    if (!data || !data.length) {
        done();
        return;
    }

    const loop = (index: any) => {
        processData(data[index], index, (err) => {
            if (err) {
                done(err);
                return;
            }

            const nextIndex = index + 1;
            if (nextIndex < data.length) {
                loop(nextIndex);
            } else {
                done();
            }
        });
    };

    loop(0);
}

function executeStreamRow(custom: any, row: any, index: number, output: any, next: (err?: any) => void) {
    let done = false;
    const finish = (err?: any) => {
        if (done) {
            return;
        }
        done = true;
        next(err);
    };

    try {
        const ret = custom.on(row, index, output, finish);
        if (custom.on.length < 4) {
            if (ret && typeof ret.then === 'function') {
                ret.then(() => finish()).catch(finish);
            } else {
                finish();
            }
        } else if (ret && typeof ret.then === 'function') {
            ret.catch(finish);
        }
    } catch (err) {
        finish(err);
    }
}

function bufferReader(buffer: Buffer, max: number, writer: (b: Buffer, next: () => void) => void, cb: () => void, beg?: number, end?: number) {

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

/**
 * Parse dbCryptConfig option and convert to bytes.
 * Supports:
 * - "base64:<value>" - decodes base64 to bytes
 * - plain string - encodes as UTF-8
 * - undefined/null/empty - returns empty buffer
 */
function parseDbCryptConfig(config: string | null | undefined): Buffer {
    if (!config) {
        return Buffer.alloc(0);
    }

    // Check if it's a base64 encoded value
    if (config.startsWith('base64:')) {
        const base64Value = config.substring(7);
        try {
            return Buffer.from(base64Value, 'base64');
        } catch (e) {
            console.error('Failed to decode base64 dbCryptConfig, returning empty buffer:', e);
            return Buffer.alloc(0);
        }
    }

    // Plain string - encode as UTF-8
    return Buffer.from(config, 'utf8');
}

Connection.decodeResponse = decodeResponse;
Connection.fetch_blob_async_transaction = fetch_blob_async_transaction;
Connection.fetch_blob_async = fetch_blob_async;
Connection.parseValueIfJson = parseValueIfJson;
Connection.describe = describe;
export = Connection;
