/***************************************
 *
 *   Simple Pooling
 *
 ***************************************/

import Events from 'events';
import { fromCallback } from './callback';
import type { Callback } from './callback';

type AttachFn = (options: any, callback: Callback) => void;

/**
 * Connection pool with pg.Pool-style observability.
 *
 * Events (all optional to listen to):
 *   'connect' (db)      — a new physical connection was established
 *   'acquire' (db)      — a connection was handed to a caller
 *   'release' (db)      — a connection was returned to the idle pool
 *   'remove'  (db)      — a physical connection left the pool for good
 *   'error'   (err, db) — a background error (idle eviction, reaper detach);
 *                         only emitted when a listener is attached, so
 *                         existing applications never crash on it
 *
 * Metrics: totalCount, idleCount, activeCount, waitingCount.
 *
 * Options: max (factory argument), options.min (floor the reaper never
 * shrinks below), options.idleTimeoutMillis (close idle connections after
 * this many ms; 0/absent = never), options.connectTimeout.
 */
class Pool extends Events.EventEmitter {
    attach: AttachFn;
    internaldb: any[];
    pooldb: any[];
    dbinuse: number;
    _creating: number;
    max: number;
    min: number;
    idleTimeoutMillis: number;
    pending: Callback[];
    options: any;
    _destroyed: boolean;
    _reaper: NodeJS.Timeout | null;

    constructor(attach: AttachFn, max: number, options: any) {
        super();
        this.attach    = attach;
        this.internaldb = []; // connections created by the pool (for destroy)
        this.pooldb    = []; // connections available in the pool (idle)
        this.dbinuse   = 0;  // connections currently handed out to callers
        this._creating = 0;  // connections currently being created (attach in flight)
        this.max       = max || 4;
        this.min       = (options && options.min > 0) ? Math.min(options.min, this.max) : 0;
        this.idleTimeoutMillis = (options && options.idleTimeoutMillis > 0) ? options.idleTimeoutMillis : 0;
        this.pending   = []; // callbacks waiting for a free slot
        this.options   = options;
        this._destroyed = false; // true after destroy() — prevents further use
        this._reaper   = null;

        if (this.idleTimeoutMillis) {
            var self = this;
            // Sweep at half the idle timeout (bounded to 100ms..30s) so a
            // connection lives at most ~1.5x idleTimeoutMillis. unref() keeps
            // the timer from holding the process open.
            var interval = Math.min(Math.max(this.idleTimeoutMillis / 2, 100), 30000);
            this._reaper = setInterval(function() { self._reap(); }, interval);
            if (this._reaper.unref) this._reaper.unref();
        }
    }

    /** Physical connections owned by the pool (idle + in use). */
    get totalCount(): number {
        return this.internaldb.length;
    }

    /** Connections sitting idle in the pool. */
    get idleCount(): number {
        return this.pooldb.length;
    }

    /** Connections currently handed out to callers. */
    get activeCount(): number {
        return this.dbinuse;
    }

    /** get() requests queued for a free slot. */
    get waitingCount(): number {
        return this.pending.length;
    }

    /** True when the connection can no longer be used. */
    _isDead(db: any): boolean {
        return !db.connection || db.connection._isClosed || db.connection._isDetach ||
            !db.connection._socket || db.connection._socket.destroyed;
    }

    /** Drop a physical connection from the pool's books and emit 'remove'. */
    _forget(db: any): void {
        var idx = this.internaldb.indexOf(db);
        if (idx !== -1) this.internaldb.splice(idx, 1);
        idx = this.pooldb.indexOf(db);
        if (idx !== -1) this.pooldb.splice(idx, 1);
        this.emit('remove', db);
    }

    /** Emit 'error' only when someone listens — never crash the app. */
    _emitError(err: any, db?: any): void {
        if (this.listenerCount('error') > 0) this.emit('error', err, db);
    }

    /**
     * Idle sweep: evict dead idle connections immediately and close healthy
     * ones that have been idle longer than idleTimeoutMillis, keeping at
     * least `min` physical connections. (issue #329)
     */
    _reap(): void {
        if (this._destroyed) return;
        var self = this;
        var now = Date.now();

        // iterate over a copy — we splice from pooldb while walking
        this.pooldb.slice().forEach(function(db) {
            if (self._isDead(db)) {
                self._forget(db);
                return;
            }
            if (self.internaldb.length <= self.min) return;
            var idleSince = typeof db.__poolIdleSince === 'number' ? db.__poolIdleSince : now;
            if (now - idleSince < self.idleTimeoutMillis) return;

            self._forget(db);
            db.connection._pooled = false;
            try {
                db.detach(function(err?: any) {
                    if (err) self._emitError(err, db);
                });
            } catch (e) {
                self._emitError(e, db);
            }
        });
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
            if (self._isDead(db)) {
                self._forget(db);
                self.pending.unshift(cb);
                setImmediate(function () { self.check(); });
                return self;
            }
            // Idle connection available — hand it out immediately.
            self.dbinuse++;
            self.emit('acquire', db);
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
                        if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled === false) {
                            self.internaldb.splice(self.internaldb.indexOf(db), 1);
                            self.emit('remove', db);
                        } else {
                            db.__poolIdleSince = Date.now();
                            self.pooldb.push(db);
                            self.emit('release', db);
                        }

                        self.dbinuse--;
                        self.check();
                    });
                    self.emit('connect', db);
                    self.emit('acquire', db);
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

        if (self._reaper) {
            clearInterval(self._reaper);
            self._reaper = null;
        }

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
                self.emit('remove', db);
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
