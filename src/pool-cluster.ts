/***************************************
 *
 *   PoolCluster — multi-host pooling (primaries/replicas, failover)
 *
 *   The mysql2 PoolCluster model on top of this driver's Pool: named
 *   nodes, each backed by a regular connection pool (health checks,
 *   recycling and metrics included), selected by glob pattern +
 *   selector. Consecutive connection failures take a node offline
 *   (with optional timed restoration), and get() fails over to the
 *   next matching online node.
 *
 ***************************************/

import Events from 'events';
import { fromCallback, withPooledConnection } from './callback';
import type { Callback } from './callback';
import { parseConnectionString } from './uri';
import Pool from './pool';

type AttachFn = (options: any, callback: Callback) => void;

export type ClusterSelector = 'rr' | 'random' | 'order';

export interface PoolClusterOptions {
    /** Options shared by every node (user, password, database, …). */
    defaults?: any;
    /** name → per-node option overrides (host, port, …). */
    nodes?: Record<string, any>;
    /** Per-node pool size (default 4). */
    max?: number;
    /** Default selector for get()/of() (default 'rr'). */
    selector?: ClusterSelector;
    /**
     * Consecutive connection failures after which a node goes offline
     * (default 5; 0 disables offlining).
     */
    removeNodeErrorCount?: number;
    /**
     * Milliseconds after which an offline node is restored and probed
     * again (default 30000; 0 = stay offline until restore()/remove()).
     */
    restoreNodeTimeout?: number;
}

interface ClusterNode {
    name: string;
    options: any;
    pool: Pool;
    online: boolean;
    errorCount: number;
    restoreTimer: NodeJS.Timeout | null;
}

function patternToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
}

/**
 * Events: 'online' (name) — node restored; 'offline' (name) — node taken
 * out of rotation after too many connection failures; 'remove' (name) —
 * node removed via remove().
 */
class PoolCluster extends Events.EventEmitter {
    private attach: AttachFn;
    private nodes = new Map<string, ClusterNode>();
    private rrIndex = new Map<string, number>();
    private max: number;
    private defaults: any;
    private selector: ClusterSelector;
    private removeNodeErrorCount: number;
    private restoreNodeTimeout: number;
    private _destroyed = false;

    constructor(attach: AttachFn, options?: PoolClusterOptions) {
        super();
        options = options || {};
        this.attach = attach;
        this.defaults = options.defaults || {};
        this.max = options.max && options.max > 0 ? options.max : 4;
        this.selector = options.selector || 'rr';
        this.removeNodeErrorCount = options.removeNodeErrorCount !== undefined ? options.removeNodeErrorCount : 5;
        this.restoreNodeTimeout = options.restoreNodeTimeout !== undefined ? options.restoreNodeTimeout : 30000;

        for (const [name, overrides] of Object.entries(options.nodes || {})) {
            this.add(name, overrides);
        }
    }

    /** Register a node; its pool is created lazily-safe right away. */
    add(name: string, overrides?: any): this {
        if (this._destroyed) {
            throw new Error('PoolCluster has been destroyed');
        }
        if (this.nodes.has(name)) {
            throw new Error('PoolCluster node already exists: ' + name);
        }
        // a connection-string override must be parsed, not object-spread
        // into character-indexed garbage
        if (typeof overrides === 'string') {
            overrides = parseConnectionString(overrides);
        }
        const nodeOptions = { ...this.defaults, ...(overrides || {}) };
        this.nodes.set(name, {
            name,
            options: nodeOptions,
            pool: new Pool(this.attach, nodeOptions.max || this.max, { ...nodeOptions, isPool: true }),
            online: true,
            errorCount: 0,
            restoreTimer: null,
        });
        return this;
    }

    /** Remove a node for good, destroying its pool. */
    remove(name: string, callback?: (err?: any) => void): void {
        const node = this.nodes.get(name);
        if (!node) {
            if (callback) callback();
            return;
        }
        this.nodes.delete(name);
        if (node.restoreTimer) {
            clearTimeout(node.restoreTimer);
        }
        this.emit('remove', name);
        node.pool.destroy(callback);
    }

    /** Bring an offline node back into rotation immediately. */
    restore(name: string): void {
        const node = this.nodes.get(name);
        if (!node || node.online) {
            return;
        }
        if (node.restoreTimer) {
            clearTimeout(node.restoreTimer);
            node.restoreTimer = null;
        }
        node.online = true;
        node.errorCount = 0;
        this.emit('online', name);
    }

    /** name → { online, errorCount, pool metrics } for every node. */
    status(): Record<string, any> {
        const out: Record<string, any> = {};
        for (const node of this.nodes.values()) {
            out[node.name] = {
                online: node.online,
                errorCount: node.errorCount,
                totalCount: node.pool.totalCount,
                idleCount: node.pool.idleCount,
                activeCount: node.pool.activeCount,
                waitingCount: node.pool.waitingCount,
            };
        }
        return out;
    }

    private matching(pattern: string): ClusterNode[] {
        const re = patternToRegExp(pattern);
        const out: ClusterNode[] = [];
        for (const node of this.nodes.values()) {
            if (re.test(node.name)) {
                out.push(node);
            }
        }
        return out;
    }

    private pick(pattern: string, selector: ClusterSelector, exclude: Set<string>): ClusterNode | null {
        const candidates = this.matching(pattern).filter((n) => n.online && !exclude.has(n.name));
        if (!candidates.length) {
            return null;
        }
        if (selector === 'random') {
            return candidates[Math.floor(Math.random() * candidates.length)];
        }
        if (selector === 'order') {
            return candidates[0];
        }
        // round-robin per pattern; only the FIRST pick of a get() advances
        // the counter — failover re-picks reuse it, or a run of failovers
        // would skew the distribution toward nodes after the failing ones
        const index = this.rrIndex.get(pattern) || 0;
        if (exclude.size === 0) {
            this.rrIndex.set(pattern, index + 1);
        }
        return candidates[index % candidates.length];
    }

    private noteFailure(node: ClusterNode): void {
        // a node removed while a get was in flight must not accumulate
        // counters, emit 'offline', or arm a restore timer nobody clears
        if (!this.nodes.has(node.name)) {
            return;
        }
        node.errorCount++;
        if (!this.removeNodeErrorCount || node.errorCount < this.removeNodeErrorCount || !node.online) {
            return;
        }
        node.online = false;
        this.emit('offline', node.name);
        if (this.restoreNodeTimeout > 0) {
            node.restoreTimer = setTimeout(() => {
                node.restoreTimer = null;
                this.restore(node.name);
            }, this.restoreNodeTimeout);
            if (node.restoreTimer.unref) {
                node.restoreTimer.unref();
            }
        }
    }

    /**
     * Acquire a connection from a node matching `pattern` (default '*').
     * Connection failures mark the node and FAIL OVER to the next
     * matching online node; only when every candidate has failed does the
     * callback receive the last error. Release connections with
     * db.detach(), exactly like a plain pool.
     */
    get(pattern: string | Callback, selector?: ClusterSelector | Callback, callback?: Callback): void {
        if (typeof pattern === 'function') {
            callback = pattern;
            pattern = '*';
        }
        if (typeof selector === 'function') {
            callback = selector;
            selector = undefined;
        }
        if (this._destroyed) {
            callback!(new Error('PoolCluster has been destroyed'), null);
            return;
        }

        const sel = (selector as ClusterSelector) || this.selector;
        const tried = new Set<string>();
        const self = this;

        const attempt = (lastError?: any) => {
            const node = self.pick(pattern as string, sel, tried);
            if (!node) {
                callback!(lastError || new Error('PoolCluster: no online node matches pattern "' + pattern + '"'), null);
                return;
            }
            tried.add(node.name);
            node.pool.get((err: any, db: any) => {
                if (err) {
                    self.noteFailure(node);
                    attempt(err);
                    return;
                }
                node.errorCount = 0;
                callback!(null, db);
            });
        };
        attempt();
    }

    getAsync(pattern?: string, selector?: ClusterSelector): Promise<any> {
        const self = this;
        return fromCallback((cb) => self.get(pattern || '*', selector, cb));
    }

    /**
     * A pool-like facade bound to a pattern (mysql2's cluster.of):
     * { get, getAsync, withConnection } routed through the cluster's
     * selection and failover.
     */
    of(pattern: string, selector?: ClusterSelector) {
        const self = this;
        return {
            get(callback: Callback) {
                self.get(pattern, selector, callback);
            },
            getAsync() {
                return self.getAsync(pattern, selector);
            },
            withConnection<T>(work: (db: any) => Promise<T> | T): Promise<T> {
                return self.withConnection(pattern, work, selector);
            },
        };
    }

    /** Run `work` with a connection from a matching node, always released. */
    withConnection<T>(pattern: string, work: (db: any) => Promise<T> | T, selector?: ClusterSelector): Promise<T> {
        return withPooledConnection(() => this.getAsync(pattern, selector), work);
    }

    /** Destroy every node's pool. */
    destroy(callback?: (err?: any) => void): void {
        this._destroyed = true;
        const nodes = [...this.nodes.values()];
        this.nodes.clear();
        let remaining = nodes.length;
        if (!remaining) {
            if (callback) callback();
            return;
        }
        let firstError: any = null;
        for (const node of nodes) {
            if (node.restoreTimer) {
                clearTimeout(node.restoreTimer);
            }
            node.pool.destroy((err?: any) => {
                if (err && !firstError) firstError = err;
                if (--remaining === 0 && callback) callback(firstError);
            });
        }
    }

    destroyAsync(): Promise<void> {
        const self = this;
        return fromCallback((cb) => self.destroy(cb));
    }
}

export default PoolCluster;
