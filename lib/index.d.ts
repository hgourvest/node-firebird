// Type definitions for node-firebird
// Project: node-firebird
// Definitions by: Marco Warm <https://github.com/MarcusCalidus>

declare module 'node-firebird' {
    type DatabaseCallback = (err: any, db: Database) => void;
    type TransactionCallback = (err: any, transaction: Transaction) => void;
    type QueryCallback = (err: any, result: any[]) => void;
    type SimpleCallback = (err: any) => void;
    type SequentialCallback = (row: any, index: number) => void;

    export const AUTH_PLUGIN_LEGACY: string;
    export const AUTH_PLUGIN_SRP: string;
    export const AUTH_PLUGIN_SRP256: string;

    export const WIRE_CRYPT_ENABLE: number;
    export const WIRE_CRYPT_DISABLE: number;

    /** A transaction sees changes done by uncommitted transactions. */
    export const ISOLATION_READ_UNCOMMITTED: number[];
    /** A transaction sees only data committed before the statement has been executed. */
    export const ISOLATION_READ_COMMITTED: number[];
    /** A transaction sees during its lifetime only data committed before the transaction has been started. */
    export const ISOLATION_REPEATABLE_READ: number[];
    /**
     * This is the strictest isolation level, which enforces transaction serialization.
     * Data accessed in the context of a serializable transaction cannot be accessed by any other transaction.
     */
    export const ISOLATION_SERIALIZABLE: number[];
    export const ISOLATION_READ_COMMITTED_READ_ONLY: number[];

    export type Isolation = number[];

    export interface Database {
        detach(callback?: SimpleCallback): Database;
        transaction(isolation: Isolation, callback: TransactionCallback): Database;
        query(query: string, params: any[], callback: QueryCallback): Database;
        execute(query: string, params: any[], callback: QueryCallback): Database;
        sequentially(query: string, params: any[], rowCallback: SequentialCallback, callback: SimpleCallback, asArray?: boolean): Database;
        drop(callback: SimpleCallback): void;
        escape(value: any): string;
        attachEvent(callback: any): this;
    }

    export interface Transaction {
        query(query: string, params: any[], callback: QueryCallback): void;
        execute(query: string, params: any[], callback: QueryCallback): void;
        sequentially(query: string, params: any[], rowCallback: SequentialCallback, callback: SimpleCallback, asArray?: boolean): Database;
        commit(callback?: SimpleCallback): void;
        commitRetaining(callback?: SimpleCallback): void;
        rollback(callback?: SimpleCallback): void;
        rollbackRetaining(callback?: SimpleCallback): void;
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
    }

    export interface SvcMgrOptions extends Options {
        manager: true; // Attach to ServiceManager
    }

    export interface ConnectionPool {
        get(callback: DatabaseCallback): void;
        destroy(callback?: SimpleCallback): void;
    }

    export function attach(options: Options, callback: DatabaseCallback): void;
    export function attach(options: SvcMgrOptions, callback: ServiceManagerCallback): void;
    export function escape(value: any, protocolVersion?: number /*PROTOCOL_VERSION13*/): string;
    export function create(options: Options, callback: DatabaseCallback): void;
    export function attachOrCreate(options: Options, callback: DatabaseCallback): void;
    export function pool(max: number, options: Options): ConnectionPool;
    export function drop(options: Options, callback: SimpleCallback): void;

    interface ReadableOptions {
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

    interface UserInfo {
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

    type ServiceManagerCallback = (err: any, svc: ServiceManager) => void;
    // @ts-ignore
    type ReadableCallback = (err: any, reader: NodeJS.ReadableStream) => void;
    type InfoCallback = (err: any, info: ServerInfo) => void;
    type LineCallback = (err: any, data: { result: number, line: string }) => void;

    export enum ShutdownMode { NORMAL = 0, MULTI = 1, SINGLE = 2, FULL = 3 }
    export enum ShutdownKind { FORCED = 0, DENY_TRANSACTION = 1, DENY_ATTACHMENT = 2 }

    export interface ServiceManager {
        detach(callback?: SimpleCallback, force?: boolean): void;
        backup(options: BackupOptions, callback: ReadableCallback): void;
        nbackup(options: BackupOptions, callback: ReadableCallback): void;
        restore(options: NRestoreOptions, callback: ReadableCallback): void;
        nrestore(options: any, callback: Function): void;
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
}
