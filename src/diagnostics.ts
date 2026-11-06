/***************************************
 *
 *   Zero-Overhead Diagnostics Channel (node:diagnostics_channel)
 *
 * Publishes structured telemetry events on Node's built-in
 * `node:diagnostics_channel` for OpenTelemetry and APM tools without
 * monkey-patching. When no subscribers are registered on a channel
 * (`channel.hasSubscribers === false`), event objects and high-resolution
 * timers are not allocated.
 *
 ***************************************/

import dc from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

export const DIAGNOSTICS_CHANNELS = {
    QUERY_START: 'firebird:query:start',
    QUERY_END: 'firebird:query:end',
    QUERY_ERROR: 'firebird:query:error',
    POOL_CHECKOUT: 'firebird:pool:checkout',
    TRANSACTION: 'firebird:transaction',
} as const;

export type DiagnosticsChannelName = typeof DIAGNOSTICS_CHANNELS[keyof typeof DIAGNOSTICS_CHANNELS];

export type TransactionLifecycleAction =
    | 'start'
    | 'commit'
    | 'rollback'
    | 'commitRetaining'
    | 'rollbackRetaining';

export interface QueryStartEvent {
    query: string;
    params?: unknown;
    database?: string;
    host?: string;
    port?: number;
    transaction?: unknown;
    batch: boolean;
    timestamp: number;
}

export interface QueryEndEvent {
    query: string;
    params?: unknown;
    database?: string;
    host?: string;
    port?: number;
    transaction?: unknown;
    batch: boolean;
    durationMs: number;
    rowCount?: number;
    isSelect?: boolean;
    timestamp: number;
}

export interface QueryErrorEvent {
    query: string;
    params?: unknown;
    database?: string;
    host?: string;
    port?: number;
    transaction?: unknown;
    batch: boolean;
    durationMs: number;
    error: unknown;
    timestamp: number;
}

export interface PoolCheckoutEvent {
    pool: unknown;
    db?: unknown;
    database?: string;
    host?: string;
    port?: number;
    created: boolean;
    waitMs: number;
    totalCount: number;
    idleCount: number;
    activeCount: number;
    waitingCount: number;
    error?: unknown;
    timestamp: number;
}

export interface TransactionEvent {
    action: TransactionLifecycleAction;
    transaction?: unknown;
    database?: string;
    host?: string;
    port?: number;
    options?: unknown;
    durationMs: number;
    error?: unknown;
    timestamp: number;
}

export const channels = {
    queryStart: dc.channel(DIAGNOSTICS_CHANNELS.QUERY_START),
    queryEnd: dc.channel(DIAGNOSTICS_CHANNELS.QUERY_END),
    queryError: dc.channel(DIAGNOSTICS_CHANNELS.QUERY_ERROR),
    poolCheckout: dc.channel(DIAGNOSTICS_CHANNELS.POOL_CHECKOUT),
    transaction: dc.channel(DIAGNOSTICS_CHANNELS.TRANSACTION),
};

export interface ConnectionEndpointInfo {
    database?: string;
    filename?: string;
    host?: string;
    port?: number;
}

/** Extract database/host/port metadata from a connection options object. */
export function extractEndpoint(options?: ConnectionEndpointInfo | null): {
    database?: string;
    host?: string;
    port?: number;
} {
    if (!options) {
        return {};
    }
    return {
        database: options.database || options.filename,
        host: options.host,
        port: options.port,
    };
}

/** Fast check whether any query channel currently has active subscribers. */
export function hasQuerySubscribers(): boolean {
    return (
        channels.queryStart.hasSubscribers ||
        channels.queryEnd.hasSubscribers ||
        channels.queryError.hasSubscribers
    );
}

/** High-resolution timestamp in milliseconds when subscribers exist, else 0. */
export function nowMs(): number {
    return performance.now();
}

export function publishQueryStart(
    query: string,
    params: unknown,
    endpointOptions: ConnectionEndpointInfo | null | undefined,
    transaction: unknown,
    batch = false
): number {
    const tracking = hasQuerySubscribers();
    if (!tracking) {
        return 0;
    }
    const startPerf = performance.now();
    if (channels.queryStart.hasSubscribers) {
        const ep = extractEndpoint(endpointOptions);
        const event: QueryStartEvent = {
            query,
            params,
            database: ep.database,
            host: ep.host,
            port: ep.port,
            transaction,
            batch,
            timestamp: Date.now(),
        };
        channels.queryStart.publish(event);
    }
    return startPerf;
}

export function publishQueryEnd(
    startPerf: number,
    query: string,
    params: unknown,
    endpointOptions: ConnectionEndpointInfo | null | undefined,
    transaction: unknown,
    rowCount?: number,
    isSelect?: boolean,
    batch = false
): void {
    if (!channels.queryEnd.hasSubscribers) {
        return;
    }
    const durationMs = startPerf > 0 ? Math.max(0, performance.now() - startPerf) : 0;
    const ep = extractEndpoint(endpointOptions);
    const event: QueryEndEvent = {
        query,
        params,
        database: ep.database,
        host: ep.host,
        port: ep.port,
        transaction,
        batch,
        durationMs,
        rowCount,
        isSelect,
        timestamp: Date.now(),
    };
    channels.queryEnd.publish(event);
}

export function publishQueryError(
    startPerf: number,
    query: string,
    params: unknown,
    endpointOptions: ConnectionEndpointInfo | null | undefined,
    transaction: unknown,
    error: unknown,
    batch = false
): void {
    if (!channels.queryError.hasSubscribers) {
        return;
    }
    const durationMs = startPerf > 0 ? Math.max(0, performance.now() - startPerf) : 0;
    const ep = extractEndpoint(endpointOptions);
    const event: QueryErrorEvent = {
        query,
        params,
        database: ep.database,
        host: ep.host,
        port: ep.port,
        transaction,
        batch,
        durationMs,
        error,
        timestamp: Date.now(),
    };
    channels.queryError.publish(event);
}

export function hasPoolCheckoutSubscribers(): boolean {
    return channels.poolCheckout.hasSubscribers;
}

export function publishPoolCheckout(
    pool: {
        options?: ConnectionEndpointInfo | null;
        totalCount: number;
        idleCount: number;
        activeCount: number;
        waitingCount: number;
    },
    startPerf: number,
    db: unknown,
    created: boolean,
    error?: unknown
): void {
    if (!channels.poolCheckout.hasSubscribers) {
        return;
    }
    const waitMs = startPerf > 0 ? Math.max(0, performance.now() - startPerf) : 0;
    const ep = extractEndpoint(pool.options);
    const event: PoolCheckoutEvent = {
        pool,
        db: db || undefined,
        database: ep.database,
        host: ep.host,
        port: ep.port,
        created,
        waitMs,
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        activeCount: pool.activeCount,
        waitingCount: pool.waitingCount,
        error,
        timestamp: Date.now(),
    };
    channels.poolCheckout.publish(event);
}

export function hasTransactionSubscribers(): boolean {
    return channels.transaction.hasSubscribers;
}

export function publishTransaction(
    action: TransactionLifecycleAction,
    startPerf: number,
    endpointOptions: ConnectionEndpointInfo | null | undefined,
    transaction?: unknown,
    options?: unknown,
    error?: unknown
): void {
    if (!channels.transaction.hasSubscribers) {
        return;
    }
    const durationMs = startPerf > 0 ? Math.max(0, performance.now() - startPerf) : 0;
    const ep = extractEndpoint(endpointOptions);
    const event: TransactionEvent = {
        action,
        transaction,
        database: ep.database,
        host: ep.host,
        port: ep.port,
        options,
        durationMs,
        error,
        timestamp: Date.now(),
    };
    channels.transaction.publish(event);
}
