/***************************************
 *
 *   Simple Pooling
 *
 ***************************************/

import { fromCallback } from './callback';
import type { Callback } from './callback';

type AttachFn = (options: any, callback: Callback) => void;

class Pool {
    attach: AttachFn;
    internaldb: any[];
    pooldb: any[];
    dbinuse: number;
    _creating: number;
    max: number;
    pending: Callback[];
    options: any;
    _destroyed: boolean;

    constructor(attach: AttachFn, max: number, options: any) {
        this.attach    = attach;
        this.internaldb = []; // connections created by the pool (for destroy)
        this.pooldb    = []; // connections available in the pool (idle)
        this.dbinuse   = 0;  // connections currently handed out to callers
        this._creating = 0;  // connections currently being created (attach in flight)
        this.max       = max || 4;
        this.pending   = []; // callbacks waiting for a free slot
        this.options   = options;
        this._destroyed = false; // true after destroy() — prevents further use
    }

    get(callback: Callback): this {
        // [Fix 2] Reject immediately if the pool has already been destroyed.
        if (this._destroyed) {
            callback(new Error('Pool has been destroyed'), null);
            return this;
        }
        var self = this;
        self.pending.push(callback);
        self.check();
        return self;
    }

    check(): this {
        var self = this;

        // [Fix 2] Do not serve requests on a destroyed pool.
        if (self._destroyed) return self;

        if ((self.dbinuse + self._creating) >= self.max)
            return self;

        var cb = self.pending.shift();
        if (!cb)
            return self;
        if (self.pooldb.length) {
            var db = self.pooldb.shift();
            // Discard connections that have been closed or destroyed while idle
            if (db.connection && (db.connection._isClosed || db.connection._isDetach || !db.connection._socket || db.connection._socket.destroyed)) {
                var idx = self.internaldb.indexOf(db);
                if (idx !== -1) self.internaldb.splice(idx, 1);
                self.pending.unshift(cb);
                setImmediate(function () { self.check(); });
                return self;
            }
            // Idle connection available — hand it out immediately.
            self.dbinuse++;
            cb(null, db);
        } else {
            // No idle connection — create a new one via attach().
            self._creating++;

            var timedOut = false;
            var timer: NodeJS.Timeout | null = null;

            // [Fix 1] Optional per-attach timeout.
            // If attach() does not call back within connectTimeout ms (e.g. because
            // the server accepted TCP but stalled on the Firebird wire protocol), we
            // free the slot and notify the caller. Any connection that arrives late
            // is discarded in the attach() callback below.
            if (self.options.connectTimeout > 0) {
                timer = setTimeout(function () {
                    timedOut = true;
                    self._creating--;
                    cb(new Error(
                        'Connection timeout after ' + self.options.connectTimeout + 'ms'
                    ), null);
                    // Free the slot so the next pending request can be served.
                    setImmediate(function () { self.check(); });
                }, self.options.connectTimeout);
            }

            this.attach(self.options, function (err, db) {

                // [Fix 1] Timeout already fired — discard this late connection.
                // Without this guard the socket would stay open until the OS-level
                // TCP timeout (potentially minutes), leaking a file descriptor.
                if (timedOut) {
                    if (db) {
                        try {
                            // _pooled = false forces a real op_detach / socket close
                            // instead of a silent pool-return emit.
                            if (db.connection) db.connection._pooled = false;
                            db.detach();
                        } catch (e) { /* ignore cleanup errors */ }
                    }
                    return;
                }

                if (timer) clearTimeout(timer);
                self._creating--;

                // [Fix 3] Pool was destroyed while attach() was in flight.
                if (self._destroyed) {
                    if (db) {
                        try {
                            if (db.connection) db.connection._pooled = false;
                            db.detach();
                        } catch (e) { /* ignore cleanup errors */ }
                    }
                    cb(new Error('Pool has been destroyed'), null);
                    return;
                }

                if (!err) {
                    self.dbinuse++;
                    self.internaldb.push(db);
                    db.on('detach', function () {
                        // also in pool (could be a twice call to detach)
                        if (self.pooldb.indexOf(db) !== -1 || self.internaldb.indexOf(db) === -1)
                            return;
                        // if not usable don't put it back in the pool
                        if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled === false)
                            self.internaldb.splice(self.internaldb.indexOf(db), 1);
                        else
                            self.pooldb.push(db);

                        self.dbinuse--;
                        self.check();
                    });
                }

                cb(err, db);
            });
        }
        setImmediate(function() {
            self.check();
        });

        return self;
    }

    destroy(callback?: (err?: any) => void): void {
        var self = this;
        self._destroyed = true;

        // [Fix 4] Drain pending callbacks so callers are not left hanging.
        // This is critical when destroy() is called as a recovery measure after
        // a timeout: without draining, every concurrent pool.get() that had not
        // yet received a slot would hang until the process exits.
        var draining = self.pending.splice(0);
        draining.forEach(function (cb) {
            try { cb(new Error('Pool is being destroyed'), null); } catch (e) { /* ignore */ }
        });

        var connectionCount = this.internaldb.length;

        if (connectionCount === 0 && callback) {
            callback();
        }

        function detachCallback(err?: any) {
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
            } else {
                // [Fix 5] Connection is currently in use (dbinuse > 0).
                // The caller is responsible for releasing it via detach().
                // Count it down here so the destroy() callback is not blocked forever.
                detachCallback();
            }
        });
    }

    /* Promise / async-await API — wrappers over the callback methods above. */

    getAsync(): Promise<any> {
        var self = this;
        return fromCallback(function(cb) { self.get(cb); });
    }

    destroyAsync(): Promise<void> {
        var self = this;
        return fromCallback(function(cb) { self.destroy(cb); });
    }

    /**
     * Run `work` with a connection from the pool, returning it to the pool
     * (detach) when the returned promise settles — success or failure.
     */
    async withConnection<T>(work: (db: any) => Promise<T> | T): Promise<T> {
        const db = await this.getAsync();
        try {
            return await work(db);
        } finally {
            // A pooled detach only returns the connection to the pool; do not
            // let a detach hiccup mask the outcome of `work`.
            await new Promise<void>(function(resolve) { db.detach(function() { resolve(); }); });
        }
    }
}

export = Pool;
