// Public API type definitions for node-firebird.
//
// These types were previously maintained by hand in lib/index.d.ts
// (originally contributed by Marco Warm <https://github.com/MarcusCalidus>).
// They now live in the TypeScript source tree and are compiled into the
// published declaration files.

import type { Readable } from 'stream';

export type DatabaseCallback = (err: any, db: Database) => void;
export type TransactionCallback = (err: any, transaction: Transaction) => void;
export type QueryCallback = (err: any, result: any[]) => void;
export type SimpleCallback = (err: any) => void;
export type SequentialCallback = (row: any, index: number, next?: (err?: any) => void) => void | Promise<void>;

/**
 * Describes a single column in a prepared statement's result set or
 * parameter list.  The properties here are populated by the
 * `isc_info_sql_*` response items returned by the Firebird server during
 * op_prepare_statement.
 *
 * On Firebird 6.0+ (Protocol 20) `relationSchema` is additionally
 * populated when the column comes from a table that lives in a
 * named schema.
 */
export interface ColumnMetadata {
    /** Internal Firebird SQL type code (before nullability bit is masked). */
    type: number;
    /** SQL sub-type (e.g. BLOB sub-type 1 = TEXT). */
    subType: number;
    /** Numeric scale for fixed-point types (negative, e.g. NUMERIC(9,2) → -2). */
    scale: number;
    /** Maximum byte length for character / binary columns. */
    length: number;
    /** Whether the column accepts NULL values. */
    nullable: boolean;
    /** Column / parameter name as declared in the DDL. */
    field?: string;
    /** Source relation (table / view) name. */
    relation?: string;
    /**
     * **Firebird 6.0+ (Protocol 20+)**
     * Schema that owns the source relation.  `undefined` or empty string
     * for legacy (pre-6.0) servers or columns not drawn from a named
     * schema (e.g. computed expressions).
     */
    relationSchema?: string;
    /** Column alias as it appears in the SELECT list. */
    alias?: string;
    /** Alias of the source relation / sub-query. */
    relationAlias?: string;
    /** Owner (user) of the source relation. */
    owner?: string;
    /**
     * **Firebird 6.0+ (Protocol 20+)**
     *
     * Character Set ID extracted from packed subType for string/character types.
     */
    charSetId?: number;
    /**
     * **Firebird 6.0+ (Protocol 20+)**
     *
     * Collation ID extracted from packed subType for string/character types.
     */
    collationId?: number;
}

export type Isolation = number[];

export type TransactionOptions = {
    autoCommit?: boolean;
    autoUndo?: boolean;
    isolation?: Isolation;
    ignoreLimbo?: boolean;
    readOnly?: boolean;
    wait?: boolean;
    waitTimeout?: number;
};

/** Result of an executeBatch call (Firebird 4 batch API, protocol 16+). */
export interface BatchResult {
    /** Total number of records processed by the server. */
    recordCount: number;
    /** Per-record update counts (in record order). */
    updateCounts: number[];
    /** Per-record failures with full status vectors (capped by `detailedErrors`). */
    errors: Array<{ recordNumber: number; error: Error }>;
    /** Record numbers of ALL failed records (detailed + status-less). */
    errorRecordNumbers: number[];
    /** True when every record executed without error. */
    success: boolean;
}

export type BatchOptions = {
    /** Continue past per-record errors and report them all (default true). */
    multiError?: boolean;
    /** Server-side batch buffer limit in bytes (BATCH_TAG_BUFFER_BYTES_SIZE). */
    bufferSize?: number;
    /** Max number of detailed per-record status vectors returned (server default 64). */
    detailedErrors?: number;
    /** Rows per op_batch_msg packet (default 500). */
    chunkSize?: number;
};

/**
 * Positional query parameters (array), or — when named placeholders are
 * enabled via the `namedPlaceholders` connection/query option — values by
 * placeholder name.
 */
export type QueryParams = any[] | Record<string, any>;

export type QueryOptions = {
    timeout?: number;
    scrollable?: boolean;
    /**
     * Per-query override of the `namedPlaceholders` connection option
     * (e.g. disable it for one EXECUTE BLOCK statement whose body uses
     * `:variable` PSQL references).
     */
    namedPlaceholders?: boolean;
    /**
     * Abort the query when the signal fires (Firebird 2.5+ / protocol 12+).
     * If the signal is already aborted the query is not sent at all and the
     * callback/promise fails with an `AbortError`. If it fires mid-flight an
     * out-of-band op_cancel is sent and the query fails with
     * `err.gdscode === GDSCode.CANCELLED`. Cancellation is per-attachment:
     * it cancels whatever is currently executing on the connection.
     */
    signal?: AbortSignal;
    /**
     * Per-query override of the `nestTables` connection option (mysql2
     * semantics). `true` nests each object row by source table:
     * `row[table][column]` — the table key is the query's relation alias
     * when one is used (`FROM emp e` → `row.E`), the table name otherwise,
     * and `''` for expression columns. A string separator flattens keys
     * instead: `nestTables: '_'` → `row.EMP_NAME`; expression columns get
     * the bare separator prefix (`row._ANSWER`, as in mysql2). Keys honour
     * `lowercase_keys`. Object rows only — `db.execute` array rows are
     * unaffected.
     */
    nestTables?: boolean | string;
    /**
     * Deliver a full result object `{ rows, fields, affectedRows,
     * recordCounts, warnings }` instead of the bare rows (callback and
     * promise APIs). For DML, `affectedRows` is what the server actually
     * changed (`isc_info_sql_records`, one extra lightweight info request
     * per statement — hence opt-in) and `recordCounts` breaks it down per
     * verb; for SELECT it is the number of rows returned (pg's `rowCount`
     * convention) with no extra round-trip. `warnings` carries any
     * `isc_arg_warning` entries from the execute response. Honoured by
     * query/execute and their *Async wrappers only — ignored by the
     * streaming APIs (sequentially/queryStream, where rows bypass the
     * result) and executeBatch (which has its own completion shape).
     */
    withMeta?: boolean;
}

/** Column metadata delivered in withMeta results (`fields`) — the same
 *  vocabulary the typeCast hook receives, plus nullable and the relation
 *  alias/schema. */
export interface FieldMetadata {
    type: number;
    typeName: string;
    subType?: number;
    scale?: number;
    length?: number;
    nullable?: boolean;
    field?: string;
    relation?: string;
    relationAlias?: string;
    relationSchema?: string;
    alias?: string;
}

/** Per-verb server row counts of an executed DML statement. */
export interface RecordCounts {
    selectCount: number;
    insertCount: number;
    updateCount: number;
    deleteCount: number;
}

/** An isc_arg_warning entry from a server response ('warning' driver event
 *  and withMeta `warnings`). */
export interface ServerWarning {
    gdscode: number;
    params?: (string | number)[];
    message: string;
}

/** Full result shape delivered when `withMeta: true` is set. */
export interface QueryResult<T = any> {
    /** Rows array (SELECT), single row object (RETURNING / procedures), or undefined (plain DML). */
    rows: T[] | T | undefined;
    fields: FieldMetadata[];
    /** DML: rows the server changed; SELECT: rows returned. */
    affectedRows: number;
    /** Set for DML statements only. */
    recordCounts?: RecordCounts;
    warnings: ServerWarning[];
}

export type QueryStreamOptions = QueryOptions & {
    /**
     * Rows buffered internally before fetching pauses (object-mode
     * Readable highWaterMark, default 16).
     */
    highWaterMark?: number;
    /** Emit array rows instead of objects (like db.execute). */
    asObject?: boolean;
}

export interface Database {
    detach(callback?: SimpleCallback): Database;
    transaction(options: TransactionOptions|Isolation|TransactionCallback, callback?: TransactionCallback): Database;
    newStatement(query: string, callback: (err: Error | null, statement: Statement) => void): Database;
    query(query: string, params: QueryParams, callback: QueryCallback, options?: QueryOptions): Database;
    execute(query: string, params: QueryParams, callback: QueryCallback, options?: QueryOptions): Database;
    /** Bulk-execute in its own transaction, all-or-nothing (Firebird 4.0+). */
    executeBatch(query: string, rows: QueryParams[], callback?: (err: any, result: BatchResult) => void, options?: BatchOptions): Database;
    sequentially(query: string, params: QueryParams, rowCallback: SequentialCallback, callback: SimpleCallback, options?: QueryOptions | boolean): Database;
    /**
     * Run `query` and return an object-mode Readable emitting one row per
     * chunk, with backpressure (fetching pauses while the buffer is full).
     * Runs in its own transaction. Destroying the stream early aborts the
     * fetch and releases the statement.
     */
    queryStream(query: string, params?: QueryParams, options?: QueryStreamOptions): Readable;
    drop(callback: SimpleCallback): void;
    escape(value: any): string;
    attachEvent(callback: any): this;
    createTablespace(name: string, filePath: string, callback?: QueryCallback): Database;
    alterTablespace(name: string, filePath: string, callback?: QueryCallback): Database;
    dropTablespace(name: string, callback?: QueryCallback): Database;
    createSchema(schemaName: string, tablespaceName?: string | QueryCallback, callback?: QueryCallback): Database;

    // Promise / async-await API (see README § Promises / async–await).
    // Pass { withMeta: true } to resolve with the full QueryResult
    // (rows + fields + affectedRows + warnings) instead of bare rows.
    queryAsync<T = any>(query: string, params: QueryParams | undefined, options: QueryOptions & { withMeta: true }): Promise<QueryResult<T>>;
    queryAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]>;
    executeAsync<T = any>(query: string, params: QueryParams | undefined, options: QueryOptions & { withMeta: true }): Promise<QueryResult<T>>;
    executeAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]>;
    executeBatchAsync(query: string, rows: QueryParams[], options?: BatchOptions): Promise<BatchResult>;
    sequentiallyAsync(query: string, params: QueryParams | undefined, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    sequentiallyAsync(query: string, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    transactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction>;
    startTransactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction>;
    newStatementAsync(query: string): Promise<Statement>;
    detachAsync(force?: boolean): Promise<void>;
    dropAsync(): Promise<void>;
    attachEventAsync(): Promise<any>;
    /** Starts a transaction, commits when `work` resolves, rolls back when it rejects. */
    withTransaction<T>(work: (transaction: Transaction) => Promise<T> | T, options?: TransactionOptions | Isolation): Promise<T>;
    /**
     * Cancel the operation currently executing on this connection
     * (Firebird 2.5+ / protocol 12+). The cancelled operation fails through
     * its own callback/promise with `err.gdscode === GDSCode.CANCELLED`.
     */
    cancel(callback?: SimpleCallback): Database;
    cancel(kind: number, callback?: SimpleCallback): Database;
    cancelAsync(kind?: number): Promise<void>;
}

export interface Transaction {
    newStatement(query: string, callback: (err: Error | null, statement: Statement) => void): void;
    query(query: string, params: QueryParams, callback: QueryCallback, options?: QueryOptions): void;
    execute(query: string, params: QueryParams, callback: QueryCallback, options?: QueryOptions): void;
    /** Bulk-execute within this transaction; per-record failures do not roll back (Firebird 4.0+). */
    executeBatch(query: string, rows: QueryParams[], callback?: (err: any, result: BatchResult) => void, options?: BatchOptions): void;
    sequentially(query: string, params: QueryParams, rowCallback: SequentialCallback, callback: SimpleCallback, options?: QueryOptions | boolean): Database;
    /**
     * Run `query` inside this transaction and return an object-mode
     * Readable emitting one row per chunk, with backpressure. The
     * transaction is NOT committed when the stream ends.
     */
    queryStream(query: string, params?: QueryParams, options?: QueryStreamOptions): Readable;
    commit(callback?: SimpleCallback): void;
    commitRetaining(callback?: SimpleCallback): void;
    rollback(callback?: SimpleCallback): void;
    rollbackRetaining(callback?: SimpleCallback): void;

    // Promise / async-await API
    queryAsync<T = any>(query: string, params: QueryParams | undefined, options: QueryOptions & { withMeta: true }): Promise<QueryResult<T>>;
    queryAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]>;
    executeAsync<T = any>(query: string, params: QueryParams | undefined, options: QueryOptions & { withMeta: true }): Promise<QueryResult<T>>;
    executeAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]>;
    executeBatchAsync(query: string, rows: QueryParams[], options?: BatchOptions): Promise<BatchResult>;
    sequentiallyAsync(query: string, params: QueryParams | undefined, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    sequentiallyAsync(query: string, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    newStatementAsync(query: string): Promise<Statement>;
    commitAsync(): Promise<void>;
    commitRetainingAsync(): Promise<void>;
    rollbackAsync(): Promise<void>;
    rollbackRetainingAsync(): Promise<void>;
}

export interface Statement {
    close(callback?: SimpleCallback): void;
    drop(callback?: SimpleCallback): void;
    release(callback?: SimpleCallback): void;
    execute(transaction: Transaction, params: QueryParams, callback: QueryCallback, options?: QueryOptions): void;
    fetch(transaction: Transaction, count: number, callback: QueryCallback): void;
    fetchScroll(transaction: Transaction, direction: 'NEXT' | 'PRIOR' | 'FIRST' | 'LAST' | 'ABSOLUTE' | 'RELATIVE' | number, offset: number, count: number, callback: QueryCallback): void;
    fetchAll(transaction: Transaction, callback: QueryCallback): void;

    /** Execute this prepared statement once per row (Firebird 4.0+ batch API). */
    executeBatch(transaction: Transaction, rows: QueryParams[], callback?: (err: any, result: BatchResult) => void, options?: BatchOptions): void;

    // Promise / async-await API
    executeAsync(transaction: Transaction, params?: QueryParams, options?: QueryOptions): Promise<any>;
    executeBatchAsync(transaction: Transaction, rows: QueryParams[], options?: BatchOptions): Promise<BatchResult>;
    fetchAsync(transaction: Transaction, count: number | 'all'): Promise<any>;
    fetchScrollAsync(transaction: Transaction, direction: 'NEXT' | 'PRIOR' | 'FIRST' | 'LAST' | 'ABSOLUTE' | 'RELATIVE' | number, offset?: number, count?: number): Promise<any>;
    fetchAllAsync(transaction: Transaction): Promise<any>;
    closeAsync(): Promise<void>;
    dropAsync(): Promise<void>;
    releaseAsync(): Promise<void>;
}

export type SupportedCharacterSet = |
    'NONE' |
    'CP943C' |
    'DOS737' |
    'DOS775' |
    'DOS858' |
    'DOS862' |
    'DOS864' |
    'DOS866' |
    'DOS869' |
    'GB18030' |
    'GBK' |
    'ISO8859_1' |
    'ISO8859_2' |
    'ISO8859_3' |
    'ISO8859_4' |
    'ISO8859_5' |
    'ISO8859_6' |
    'ISO8859_7' |
    'ISO8859_8' |
    'ISO8859_9' |
    'ISO8859_13' |
    'KOI8R' |
    'KOI8U' |
    'TIS620' |
    'UTF8' |
    'WIN1251' |
    'WIN1252' |
    'WIN1253' |
    'WIN1254' |        
    'WIN1255' |
    'WIN1256' |
    'WIN1257' |
    'WIN1258' |
    'WIN_1258';

export interface Options {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    lowercase_keys?: boolean;
    role?: string;
    pageSize?: number;
    retryConnectionInterval?: number;
    encoding?: SupportedCharacterSet;
    blobAsText?: boolean; // only affects for blob subtype 1
    /**
     * Segment size in bytes used when WRITING blobs (op_batch_segments).
     * Default 1024, max 65535. Use 65535 to minimize round-trips on
     * remote/high-latency connections.
     */
    blobChunkSize?: number;
    /**
     * Buffer size in bytes requested per op_get_segment when READING
     * blobs. Default 1024, max 65535. Use 65535 to minimize round-trips
     * on remote/high-latency connections (~64x fewer round-trips).
     */
    blobReadChunkSize?: number;
    wireCrypt?: number; // WIRE_CRYPT_DISABLE or WIRE_CRYPT_ENABLE
    wireCompression?: boolean;
    /**
     * Enable named placeholders: SQL may use `:name` markers and params may
     * be a values-by-name object (`db.query('... WHERE id = :id', { id: 1 })`).
     * Placeholders are rewritten client-side to positional `?` before
     * preparing; positional arrays keep working unchanged. Off by default
     * because `EXECUTE BLOCK` bodies use `:variable` for PSQL references —
     * with this option on, run such statements with positional params or a
     * per-query `namedPlaceholders: false` override.
     */
    namedPlaceholders?: boolean;
    /**
     * Qualify object-row keys by source table (same option as mysql2), so
     * JOINed columns with the same name stop overwriting each other:
     * `true` nests each row as `row[table][column]`; a string separator
     * flattens to `row['table' + sep + 'column']`. See
     * `QueryOptions.nestTables` for the exact key rules. Applies wherever
     * object rows are produced (query / sequentially / queryStream);
     * array rows (execute) are unaffected. Overridable per query.
     */
    nestTables?: boolean | string;
    /**
     * TCP keepalive probing to detect dead/stale connections (same option
     * names as mysql2). On by default; set false to disable.
     */
    enableKeepAlive?: boolean;
    /**
     * Milliseconds a socket must be idle before the first TCP keepalive
     * probe is sent (default 60000). Ignored when enableKeepAlive is false.
     */
    keepAliveInitialDelay?: number;
    pluginName?: string;
    parallelWorkers?: number;
    maxInlineBlobSize?: number;
    maxNegotiatedProtocols?: number;
    dbCryptConfig?: string; // Database encryption key callback config (base64: prefix for base64, or plain string)
    /**
     * Timeout in milliseconds for a single pool.get() attach operation.
     * If attach() does not complete within this time the slot is freed,
     * the caller receives an error, and any late-arriving connection is
     * safely discarded. Set to 0 or omit to disable (default: no timeout).
     *
     * Recommended value: 5000–10000 ms depending on network latency and
     * expected Firebird server response time under load.
     */
    connectTimeout?: number;
    /**
     * Pool only: minimum number of physical connections the idle reaper
     * keeps alive. Only meaningful together with `idleTimeoutMillis`.
     * Default 0 (the pool may shrink to no connections).
     */
    min?: number;
    /**
     * Pool only: close connections that have been idle in the pool for this
     * many milliseconds, never shrinking below `min`. Dead idle connections
     * (server restarts, dropped sockets) are evicted on the same sweep.
     * Default 0 (idle connections are kept forever).
     */
    idleTimeoutMillis?: number;
    /**
     * **Firebird 6.0+ only (Protocol 20+)**
     *
     * Sets the session's current schema at connection time. `CURRENT_SCHEMA`
     * in Firebird is the first existing schema of the search path, so this
     * option is implemented by putting the schema at the front of the
     * `searchPath` sent to the server (with `PUBLIC` kept as a fallback when
     * no explicit `searchPath` is given).
     *
     * Example: `defaultSchema: 'myapp'`
     */
    defaultSchema?: string;
    /**
     * **Firebird 6.0+ only (Protocol 20+)**
     *
     * Comma-separated (or array of) schema names used to resolve
     * unqualified object references, tried in order from left to right.
     * Equivalent to PostgreSQL's `search_path`.
     *
     * Examples:
     * ```ts
     * searchPath: 'myapp,PUBLIC'
     * searchPath: ['myapp', 'PUBLIC']
     * ```
     *
     * When omitted the server uses its own configured default
     * (typically `PUBLIC` then `SYSTEM`).
     */
    searchPath?: string | string[];
    /**
     * **Firebird 6.0+ only**
     *
     * Owner of a newly created database (`isc_dpb_owner`), allowing a
     * superuser to create a database owned by another user
     * ([firebird#7718](https://github.com/FirebirdSQL/firebird/issues/7718)).
     * Only honored by `create`/`attachOrCreate` when the database is
     * created; ignored on plain attach and by older servers.
     *
     * Example: `owner: 'APP_OWNER'`
     */
    owner?: string;
    /**
     * **Firebird 6.0+ only (Protocol 20+)**
     *
     * Automatically stringifies JavaScript objects/arrays passed as query
     * parameters to JSON strings, and automatically parses returned JSON
     * text/BLOB columns back into JavaScript objects/arrays.
     */
    jsonAsObject?: boolean;
    /**
     * Custom type parser (mysql2-style). Called for every column value of
     * every result row (including NULLs); whatever it returns becomes the
     * value in the row. Call `next()` to get the value the driver would
     * produce by default (after `blobAsText`/`jsonAsObject` are applied).
     *
     * ```js
     * typeCast: (column, next) =>
     *     column.typeName === 'INT64' ? Number(next()) : next()
     * ```
     *
     * Non-text BLOB columns reach the hook as the usual fetch function;
     * text BLOBs with `blobAsText` reach it as the resolved string. The
     * hook must be a pure function: a row can be decoded more than once
     * when a response spans TCP packets.
     */
    typeCast?: TypeCastFunction;
    /**
     * Per-connection LRU cache of prepared statements (like mysql2's
     * statement cache). `db.query`/`tx.query` and friends transparently
     * reuse the prepared handle for a repeated SQL string, skipping the
     * prepare round-trip on hot paths. The number is the maximum of idle
     * cached statements; least-recently-used ones are dropped over the
     * limit. 0 / unset = disabled. Statements that failed and DDL are
     * never cached; concurrent runs of the same SQL never share a
     * statement (extra preparations are simply not cached).
     */
    statementCacheSize?: number;
}

/** Column metadata passed to the {@link Options.typeCast} hook. */
export interface TypeCastColumn {
    /** Firebird SQL type code (see the exported `SQL_TYPES` map). */
    type: number;
    /** Friendly name of the type code: 'VARYING', 'INT64', 'BLOB', ... */
    typeName: string;
    /** Column subtype (e.g. 1 = text for BLOBs; charset id for strings). */
    subType?: number;
    /** Negative decimal scale for NUMERIC/DECIMAL columns (e.g. -2). */
    scale?: number;
    /** Declared length in bytes. */
    length?: number;
    /** Column name in the table. */
    field?: string;
    /** Table (relation) name. */
    relation?: string;
    /** Alias used in the SELECT list (the row key for object rows). */
    alias?: string;
}

export type TypeCastFunction = (column: TypeCastColumn, next: () => any) => any;

export interface SvcMgrOptions extends Options {
    manager: true; // Attach to ServiceManager
}

export type PoolEvent = 'connect' | 'acquire' | 'release' | 'remove' | 'error';

export interface ConnectionPool {
    get(callback: DatabaseCallback): void;
    destroy(callback?: SimpleCallback): void;

    // Metrics (live counters, pg.Pool-style)
    /** Physical connections owned by the pool (idle + in use). */
    readonly totalCount: number;
    /** Connections sitting idle in the pool. */
    readonly idleCount: number;
    /** Connections currently handed out to callers. */
    readonly activeCount: number;
    /** get() requests queued for a free slot. */
    readonly waitingCount: number;

    // Events
    on(event: 'connect' | 'acquire' | 'release' | 'remove', listener: (db: Database) => void): this;
    on(event: 'error', listener: (err: Error, db?: Database) => void): this;
    once(event: 'connect' | 'acquire' | 'release' | 'remove', listener: (db: Database) => void): this;
    once(event: 'error', listener: (err: Error, db?: Database) => void): this;
    off(event: PoolEvent, listener: (...args: any[]) => void): this;
    removeListener(event: PoolEvent, listener: (...args: any[]) => void): this;

    // Promise / async-await API
    getAsync(): Promise<Database>;
    destroyAsync(): Promise<void>;
    /** Acquire a connection, run `work`, always return the connection to the pool. */
    withConnection<T>(work: (db: Database) => Promise<T> | T): Promise<T>;
}

export interface ReadableOptions {
    optread?: 'byline' | 'buffer'; // default 'byline'
    buffersize?: number; // default 'byline': 2048, 'buffer': 8192
    timeout?: number;
}

export interface BackupOptions extends ReadableOptions {
    database?: string;
    files: string | { filename: string, sizefile: string }[];
    factor?: number; // If backing up to a physical tape device, this switch lets you specify the tape's blocking factor
    verbose?: boolean;
    ignorechecksums?: boolean;
    ignorelimbo?: boolean;
    metadataonly?: boolean;
    nogarbasecollect?: boolean;
    olddescriptions?: boolean;
    nontransportable?: boolean;
    convert?: boolean;
    expand?: boolean;
    notriggers?: boolean;
}

export interface NBackupOptions extends ReadableOptions {
    database?: string;
    file: string;
    level?: number; // nb day for incremental
    notriggers?: boolean;
    direct?: 'on' | 'off'; // default 'on'
}

export interface RestoreOptions extends ReadableOptions {
    database?: string;
    files: string | string[];
    verbose?: boolean;
    cachebuffers?: number; // default 2048, gbak -buffers
    pagesize?: boolean; // default 4096
    readonly?: boolean; // default false
    deactivateindexes?: boolean; // default false
    noshadow?: boolean; // default false
    novalidity?: boolean; // default false
    individualcommit?: boolean; // default true
    replace?: boolean; // default false
    create?: boolean; // default true
    useallspace?: boolean; // default false
    metadataonly?: boolean; // default false
    fixfssdata?: string; // default null
    fixfssmetadata?: string; // default null
}

export interface NRestoreOptions extends ReadableOptions {
    database?: string;
    files: string | string[];
}

export interface ValidateOptions extends ReadableOptions {
    database?: string;
    checkdb?: boolean;
    ignorechecksums?: boolean;
    killshadows?: boolean;
    mend?: boolean;
    validate?: boolean;
    full?: boolean;
    sweep?: boolean;
    listlimbo?: boolean;
    icu?: boolean;
}

export interface StatsOptions extends ReadableOptions {
    database?: string;
    record?: boolean;
    nocreation?: boolean;
    tables?: boolean;
    pages?: boolean;
    header?: boolean;
    indexes?: boolean;
    tablesystem?: boolean;
    encryption?: boolean;
    objects?: string; // space-separated list of object index,table,systemtable
}

export interface UserInfo {
    userid: number;
    groupid: number;
    username: string;
    firstname: string;
    middlename: string;
    lastname: string
    admin: number;
    rolename?: string;
    groupname?: string;
}

export interface ServerInfo {
    result: number;
    dbinfo?: { database: any[], nbattachment: number, nbdatabase: number };
    fbconfig?: any;
    svcversion?: number;
    fbversion?: string;
    fbimplementation?: string;
    fbcapatibilities: string[];
    pathsecuritydb?: string;
    fbenv?: string;
    fbenvlock?: string;
    fbenvmsg?: string;
    limbotrans?: number[];
    fbusers?: UserInfo[]
}

export interface ServerInfoReq {
    dbinfo?: boolean;
    fbconfig?: boolean;
    svcversion?: boolean;
    fbversion?: boolean;
    fbimplementation?: boolean;
    fbcapatibilities?: boolean;
    pathsecuritydb?: boolean;
    fbenv?: boolean;
    fbenvlock?: boolean;
    fbenvmsg?: boolean;
    limbotrans?: boolean;
}

export interface TraceOptions extends ReadableOptions {
    configfile?: string; // startTrace uses it
    tracename?: string; // startTrace uses it
    traceid?: number; // suspendTrace, stopTrace, and resumeTrace use it
}

export type ServiceManagerCallback = (err: any, svc: ServiceManager) => void;
export type ReadableCallback = (err: any, reader: NodeJS.ReadableStream) => void;
export type InfoCallback = (err: any, info: ServerInfo) => void;
export type LineCallback = (err: any, data: { result: number, line: string }) => void;

export enum ShutdownMode { NORMAL = 0, MULTI = 1, SINGLE = 2, FULL = 3 }
export enum ShutdownKind { FORCED = 0, DENY_TRANSACTION = 1, DENY_ATTACHMENT = 2 }

export interface ServiceManager {
    detach(callback?: SimpleCallback, force?: boolean): void;
    backup(options: BackupOptions, callback: ReadableCallback): void;
    nbackup(options: BackupOptions, callback: ReadableCallback): void;
    restore(options: RestoreOptions, callback: ReadableCallback): void;
    nrestore(options: NRestoreOptions, callback: ReadableCallback): void;
    setDialect(db: string, dialect: 1 | 3, callback: ReadableCallback): void;
    setSweepinterval(db: string, interval: number, callback: Function): void; // gfix -h INTERVAL
    setCachebuffer(db: string, nbpages: any, callback: ReadableCallback): void; // gfix -b NBPAGES
    BringOnline(db: string, callback: ReadableCallback): void; // gfix -o
    Shutdown(db: string, kind: ShutdownKind, delay: number, mode: ShutdownMode, callback: ReadableCallback): void; // server version >= 2.0
    Shutdown(db: string, kind: ShutdownKind, delay: number, callback: ReadableCallback): void; // server version < 2.0
    setShadow(db: string, val: boolean, callback: ReadableCallback): void;
    setForcewrite(db: string, val: boolean, callback: ReadableCallback): void; // gfix -write
    setReservespace(db: string, val: boolean, callback: ReadableCallback): void; // true: gfix -use reserve, false: gfix -use full
    setReadonlyMode(db: string, callback: ReadableCallback): void; //  gfix -mode read_only
    setReadwriteMode(db: string, callback: ReadableCallback): void; //  gfix -mode read_write
    validate(options: ValidateOptions, callback: ReadableCallback): void; // gfix -validate
    commit(db: string, transactid: number, callback: ReadableCallback): void; // gfix -commit
    rollback(db: string, transactid: number, callback: ReadableCallback): void;
    recover(db: string, transactid: number, callback: ReadableCallback): void;
    getStats(options: StatsOptions, callback: ReadableCallback): void;
    getLog(options: ReadableOptions, callback: ReadableCallback): void;
    getUsers(username: string | null, callback: InfoCallback): void;
    addUser(username: string, password: string, info: UserInfo, callback: ReadableCallback): void;
    editUser(username: string, info: UserInfo, callback: ReadableCallback): void;
    removeUser(username: string, rolename: string | null, callback: ReadableCallback): void;
    getFbserverInfos(infos: ServerInfoReq, options: { buffersize?: number, timeout?: number }, callback: InfoCallback): void; // if infos is empty all options are asked to the service
    startTrace(options: TraceOptions, callback: ReadableCallback): void;
    suspendTrace(options: TraceOptions, callback: ReadableCallback): void;
    resumeTrace(options: TraceOptions, callback: ReadableCallback): void;
    stopTrace(options: TraceOptions, callback: ReadableCallback): void;
    getTraceList(options: ReadableOptions, callback: ReadableCallback): void;
    readline(options: ReadableOptions, callback: LineCallback): void;
    readeof(options: ReadableOptions, callback: LineCallback): void;
    hasRunningAction(options: ReadableOptions, callback: ReadableCallback): void;
    readusers(options: ReadableOptions, callback: ReadableCallback): void;
    readlimbo(options: ReadableOptions, callback: ReadableCallback): void;

    // Promise / async-await API (see README § Promises / async–await).
    detachAsync(force?: boolean): Promise<void>;
    backupAsync(options: BackupOptions): Promise<NodeJS.ReadableStream>;
    nbackupAsync(options: BackupOptions): Promise<NodeJS.ReadableStream>;
    restoreAsync(options: RestoreOptions): Promise<NodeJS.ReadableStream>;
    nrestoreAsync(options: NRestoreOptions): Promise<NodeJS.ReadableStream>;
    setDialectAsync(db: string, dialect: 1 | 3): Promise<NodeJS.ReadableStream>;
    setSweepintervalAsync(db: string, interval: number): Promise<any>;
    setCachebufferAsync(db: string, nbpages: any): Promise<NodeJS.ReadableStream>;
    BringOnlineAsync(db: string): Promise<NodeJS.ReadableStream>;
    ShutdownAsync(db: string, kind: ShutdownKind, delay: number, mode?: ShutdownMode): Promise<NodeJS.ReadableStream>;
    setShadowAsync(db: string, val: boolean): Promise<NodeJS.ReadableStream>;
    setForcewriteAsync(db: string, val: boolean): Promise<NodeJS.ReadableStream>;
    setReservespaceAsync(db: string, val: boolean): Promise<NodeJS.ReadableStream>;
    setReadonlyModeAsync(db: string): Promise<NodeJS.ReadableStream>;
    setReadwriteModeAsync(db: string): Promise<NodeJS.ReadableStream>;
    validateAsync(options: ValidateOptions): Promise<NodeJS.ReadableStream>;
    commitAsync(db: string, transactid: number): Promise<NodeJS.ReadableStream>;
    rollbackAsync(db: string, transactid: number): Promise<NodeJS.ReadableStream>;
    recoverAsync(db: string, transactid: number): Promise<NodeJS.ReadableStream>;
    getStatsAsync(options: StatsOptions): Promise<NodeJS.ReadableStream>;
    getLogAsync(options: ReadableOptions): Promise<NodeJS.ReadableStream>;
    getUsersAsync(username?: string | null): Promise<ServerInfo>;
    addUserAsync(username: string, password: string, info?: UserInfo): Promise<NodeJS.ReadableStream>;
    editUserAsync(username: string, info: UserInfo): Promise<NodeJS.ReadableStream>;
    removeUserAsync(username: string, rolename?: string | null): Promise<NodeJS.ReadableStream>;
    getFbserverInfosAsync(infos?: ServerInfoReq, options?: { buffersize?: number, timeout?: number }): Promise<ServerInfo>;
    startTraceAsync(options: TraceOptions): Promise<NodeJS.ReadableStream>;
    suspendTraceAsync(options: TraceOptions): Promise<NodeJS.ReadableStream>;
    resumeTraceAsync(options: TraceOptions): Promise<NodeJS.ReadableStream>;
    stopTraceAsync(options: TraceOptions): Promise<NodeJS.ReadableStream>;
    getTraceListAsync(options?: ReadableOptions): Promise<NodeJS.ReadableStream>;
    readlineAsync(options?: ReadableOptions): Promise<{ result: number, line: string }>;
    readeofAsync(options?: ReadableOptions): Promise<{ result: number, line: string }>;
    hasRunningActionAsync(options?: ReadableOptions): Promise<any>;
    readusersAsync(options?: ReadableOptions): Promise<any>;
    readlimboAsync(options?: ReadableOptions): Promise<any>;
}
