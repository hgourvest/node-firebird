// Public API type definitions for node-firebird.
//
// These types were previously maintained by hand in lib/index.d.ts
// (originally contributed by Marco Warm <https://github.com/MarcusCalidus>).
// They now live in the TypeScript source tree and are compiled into the
// published declaration files.

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

export type QueryOptions = {
    timeout?: number;
    scrollable?: boolean;
}

export interface Database {
    detach(callback?: SimpleCallback): Database;
    transaction(options: TransactionOptions|Isolation|TransactionCallback, callback?: TransactionCallback): Database;
    newStatement(query: string, callback: (err: Error | null, statement: Statement) => void): Database;
    query(query: string, params: any[], callback: QueryCallback, options?: QueryOptions): Database;
    execute(query: string, params: any[], callback: QueryCallback, options?: QueryOptions): Database;
    sequentially(query: string, params: any[], rowCallback: SequentialCallback, callback: SimpleCallback, options?: QueryOptions | boolean): Database;
    drop(callback: SimpleCallback): void;
    escape(value: any): string;
    attachEvent(callback: any): this;
    createTablespace(name: string, filePath: string, callback?: QueryCallback): Database;
    alterTablespace(name: string, filePath: string, callback?: QueryCallback): Database;
    dropTablespace(name: string, callback?: QueryCallback): Database;
    createSchema(schemaName: string, tablespaceName?: string | QueryCallback, callback?: QueryCallback): Database;

    // Promise / async-await API (see README § Promises / async–await).
    // Result metadata is only available through the callback API.
    queryAsync<T = any>(query: string, params?: any[], options?: QueryOptions): Promise<T[]>;
    executeAsync<T = any>(query: string, params?: any[], options?: QueryOptions): Promise<T[]>;
    sequentiallyAsync(query: string, params: any[] | undefined, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    sequentiallyAsync(query: string, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
    transactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction>;
    startTransactionAsync(options?: TransactionOptions | Isolation): Promise<Transaction>;
    newStatementAsync(query: string): Promise<Statement>;
    detachAsync(force?: boolean): Promise<void>;
    dropAsync(): Promise<void>;
    attachEventAsync(): Promise<any>;
    /** Starts a transaction, commits when `work` resolves, rolls back when it rejects. */
    withTransaction<T>(work: (transaction: Transaction) => Promise<T> | T, options?: TransactionOptions | Isolation): Promise<T>;
}

export interface Transaction {
    newStatement(query: string, callback: (err: Error | null, statement: Statement) => void): void;
    query(query: string, params: any[], callback: QueryCallback, options?: QueryOptions): void;
    execute(query: string, params: any[], callback: QueryCallback, options?: QueryOptions): void;
    sequentially(query: string, params: any[], rowCallback: SequentialCallback, callback: SimpleCallback, options?: QueryOptions | boolean): Database;
    commit(callback?: SimpleCallback): void;
    commitRetaining(callback?: SimpleCallback): void;
    rollback(callback?: SimpleCallback): void;
    rollbackRetaining(callback?: SimpleCallback): void;

    // Promise / async-await API
    queryAsync<T = any>(query: string, params?: any[], options?: QueryOptions): Promise<T[]>;
    executeAsync<T = any>(query: string, params?: any[], options?: QueryOptions): Promise<T[]>;
    sequentiallyAsync(query: string, params: any[] | undefined, rowCallback: SequentialCallback, options?: QueryOptions | boolean): Promise<void>;
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
    execute(transaction: Transaction, params: any[], callback: QueryCallback, options?: QueryOptions): void;
    fetch(transaction: Transaction, count: number, callback: QueryCallback): void;
    fetchScroll(transaction: Transaction, direction: 'NEXT' | 'PRIOR' | 'FIRST' | 'LAST' | 'ABSOLUTE' | 'RELATIVE' | number, offset: number, count: number, callback: QueryCallback): void;
    fetchAll(transaction: Transaction, callback: QueryCallback): void;

    // Promise / async-await API
    executeAsync(transaction: Transaction, params?: any[], options?: QueryOptions): Promise<any>;
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
     * **Firebird 6.0+ only (Protocol 20+)**
     *
     * Sets the session's current schema at connection time.  Equivalent to
     * executing `SET SCHEMA <name>` immediately after connecting.
     *
     * Unqualified object references (tables, procedures, etc.) that do not
     * match any schema in the `searchPath` fall back to `PUBLIC`.
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
     * **Firebird 6.0+ only (Protocol 20+)**
     *
     * Automatically stringifies JavaScript objects/arrays passed as query
     * parameters to JSON strings, and automatically parses returned JSON
     * text/BLOB columns back into JavaScript objects/arrays.
     */
    jsonAsObject?: boolean;
}

export interface SvcMgrOptions extends Options {
    manager: true; // Attach to ServiceManager
}

export interface ConnectionPool {
    get(callback: DatabaseCallback): void;
    destroy(callback?: SimpleCallback): void;

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
}
