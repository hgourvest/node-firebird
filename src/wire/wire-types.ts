/***************************************
 *
 *   Internal wire-protocol types (type-only module)
 *
 * Shared vocabulary for the wire core (connection/statement/transaction/
 * database). Nothing here exists at runtime.
 *
 ***************************************/

import type { Callback, FbStatusItem } from '../callback';
import type Statement from './statement';
import type { BatchResult, Options, QueryOptions, Statement as PublicStatement } from '../types';

/**
 * One entry of the connection's response queue (`connection._queue`).
 * The function itself is the user/driver callback; the extra properties
 * steer decodeResponse:
 *
 * - `response`  — pre-allocated object the op_response decode fills in
 *                 (a Statement, Transaction, or plain response object).
 * - `statement` — statement whose `output` describes the rows of an
 *                 op_fetch_response / op_sql_response.
 * - `lazy_count`— number of chained lazy op_responses this entry consumes
 *                 (ptype_lazy_send batches e.g. allocate+prepare).
 *
 * Deferred ops (op_free_statement, op_close_blob, ...) push `undefined`
 * placeholders so every server response still pairs with one entry.
 */
export interface QueueCallback {
    (err?: any, obj?: any): void;
    response?: any;
    statement?: Statement;
    lazy_count?: number;
}

/** A queue entry: a callback, or a placeholder for a deferred op. */
export type QueueEntry = QueueCallback | undefined;

/** XDR quad — 64-bit value as two 32-bit halves (blob ids, object ids). */
export interface Quad {
    high: number;
    low: number;
}

/**
 * Decoded op_response packet (see parseOpResponse): object handle, object
 * id, optional info buffer and, on failure, the status vector. Statement /
 * Transaction responses are these fields merged onto the pre-allocated
 * object from QueueCallback.response.
 */
export interface WireResponse {
    handle?: number;
    oid?: Quad;
    buffer?: Buffer;
    status?: FbStatusItem[];
    /** isc_arg_warning entries — attached to a SUCCESSFUL response */
    warnings?: FbStatusItem[];
    sqlcode?: number;
    message?: string;
}

/** Result of decoding op_fetch_response / op_sql_response row data. */
export interface FetchResult {
    data: any[];
    /** true when the cursor is exhausted (fetch status 100 / singleton). */
    fetched: boolean;
    /** pending blobAsText fetches to resolve before delivering rows. */
    arrBlob?: any[];
}

/**
 * Protocol negotiation result decoded from op_accept / op_cond_accept /
 * op_accept_data, plus the auth/crypt state accumulated during the
 * handshake (op_cont_auth rounds, wire-crypt keys).
 */
export interface AcceptPacket {
    protocolVersion: number;
    protocolArchitecture: number;
    protocolMinimumType: number;
    compress: boolean;
    pluginName: string;
    authData: any;
    sessionKey?: any;
    [key: string]: any;
}

/**
 * Query options as the wire core sees them: the public QueryOptions plus
 * the internal row-delivery flags set by the Database/Transaction helpers
 * (query / sequentially / queryStream).
 */
export type InternalQueryOptions = QueryOptions & {
    /** deliver rows as objects keyed by column alias */
    asObject?: boolean;
    /** deliver rows one by one (row events / `on` delegate) instead of accumulating */
    asStream?: boolean;
    /** per-row delegate installed by sequentially() */
    on?: (row: any, index: number, meta: any[], next: (err?: any) => void) => void;
    [key: string]: any;
};

/**
 * newStatement callback: the internal optional-args shape, or the public
 * strict shape (non-optional statement) declared in types.ts.
 */
export type StatementCb = Callback<Statement> | ((err: Error | null, statement: PublicStatement) => void);

/**
 * executeBatch callback: the internal optional-args shape, or the public
 * strict shape (non-optional result) declared in types.ts.
 */
export type BatchCb = Callback<BatchResult> | ((err: any, result: BatchResult) => void);

/**
 * Connection options as the wire core sees them: the public Options plus
 * internal flags set by the driver itself.
 */
export type InternalOptions = Options & {
    /** set by the pool so detach() returns the connection instead */
    isPool?: boolean;
    /** override path of the firebird.msg error-message file */
    messageFile?: string;
    /** legacy statement-cache flags (mapped onto statementCacheSize) */
    cacheQuery?: boolean;
    maxCachedQuery?: number;
    [key: string]: any;
};
