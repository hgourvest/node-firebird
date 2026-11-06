import Events from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fromCallback, toError, type Callback, type SimpleCallback } from './callback';
import Const from './wire/const';
import { escape } from './utils';
import { parseNamedPlaceholders } from './named-params';
import { makeSqlTag, type SqlTag } from './sql-template';
import { resolveKeyTransform } from './wire/xsqlvar';
import Pool from './pool';
import { normalizeOptions } from './uri';
import {
    hasQuerySubscribers,
    publishQueryStart,
    publishQueryEnd,
    publishQueryError,
    hasTransactionSubscribers,
    nowMs,
    publishTransaction,
} from './diagnostics';
import type {
    BatchOptions,
    BatchResult,
    ConnectionPool,
    Database,
    DatabaseCallback,
    Isolation,
    Options,
    QueryOptions,
    QueryParams,
    SequentialCallback,
    TransactionCallback,
    TransactionOptions,
} from './types';

let cachedNativeModule: any = undefined;

/**
 * Attempt to load the optional `node-firebird-driver-native` package.
 * Checks:
 *   1. `process.env.FIREBIRD_NATIVE_DRIVER_PATH` (if set)
 *   2. Standard Node module resolution (`require('node-firebird-driver-native')`)
 *   3. Sibling monorepo checkout (`../../node-firebird-drivers/packages/node-firebird-driver-native`)
 *
 * Returns `null` if the package or its native N-API binding is not present.
 */
export function loadNativeDriver(): any | null {
    if (cachedNativeModule !== undefined) {
        return cachedNativeModule;
    }

    const candidates: string[] = [];
    if (process.env.FIREBIRD_NATIVE_DRIVER_PATH) {
        candidates.push(process.env.FIREBIRD_NATIVE_DRIVER_PATH);
    }
    candidates.push('node-firebird-driver-native');
    candidates.push(
        path.resolve(__dirname, '../../node-firebird-drivers/packages/node-firebird-driver-native')
    );

    for (const candidate of candidates) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(candidate);
            if (mod && typeof mod.createNativeClient === 'function') {
                cachedNativeModule = mod;
                return mod;
            }
        } catch {
            // try next candidate
        }
    }

    cachedNativeModule = null;
    return null;
}

/**
 * Returns `true` when `node-firebird-driver-native` (and `libfbclient`) can be loaded.
 */
export function hasNativeDriver(): boolean {
    return loadNativeDriver() !== null;
}

function requireNativeDriver(): any {
    const mod = loadNativeDriver();
    if (!mod) {
        throw new Error(
            'Optional native driver "node-firebird-driver-native" is not installed or its native binding is not built. ' +
                'Install it with: npm install node-firebird-driver-native'
        );
    }
    return mod;
}

let sharedNativeClient: any = null;

function ensureFirebirdLockPermissions(): void {
    try {
        for (const name of fs.readdirSync('/tmp/firebird')) {
            try {
                fs.chmodSync(path.join('/tmp/firebird', name), 0o666);
            } catch {
                // ignore files not owned by current user
            }
        }
    } catch {
        // ignore if /tmp/firebird does not exist
    }
}

function getNativeClient(customLibFilename?: string): any {
    const mod = requireNativeDriver();
    if (!process.env.FIREBIRD_LOCK) {
        process.env.FIREBIRD_LOCK = os.tmpdir();
    }
    ensureFirebirdLockPermissions();
    if (customLibFilename) {
        return mod.createNativeClient(customLibFilename);
    }
    if (!sharedNativeClient || !sharedNativeClient.isValid) {
        sharedNativeClient = mod.createNativeClient(mod.getDefaultLibraryFilename());
    }
    return sharedNativeClient;
}

function formatNativeUri(options: any): string {
    const db = options.database || options.filename;
    if (!db) {
        throw new Error('No database specified');
    }
    if (options.embedded) {
        return db;
    }
    const host = options.host || Const.DEFAULT_HOST;
    const port = options.port || Const.DEFAULT_PORT;
    return `${host}/${port}:${db}`;
}

function buildConnectOptions(options: any): any {
    const connectOpts: any = {
        username: options.user || Const.DEFAULT_USER,
        password: options.password || Const.DEFAULT_PASSWORD,
    };
    if (options.role) {
        connectOpts.role = options.role;
    }
    if (options.searchPath) {
        connectOpts.searchPath = options.searchPath;
    } else if (options.defaultSchema) {
        connectOpts.searchPath = [options.defaultSchema, 'PUBLIC'];
    }
    return connectOpts;
}

function mapTransactionOptions(options?: TransactionOptions | Isolation): any {
    if (!options) {
        return undefined;
    }
    const isoArray = Array.isArray(options) ? options : options.isolation;
    const readOnly = !Array.isArray(options) && Boolean(options.readOnly);
    const result: any = {};

    if (readOnly || (isoArray && isoArray.includes(Const.isc_tpb_read))) {
        result.accessMode = 'READ_ONLY';
    } else {
        result.accessMode = 'READ_WRITE';
    }

    if (isoArray) {
        if (isoArray.includes(Const.isc_tpb_consistency)) {
            result.isolation = 'CONSISTENCY';
        } else if (isoArray.includes(Const.isc_tpb_concurrency)) {
            result.isolation = 'SNAPSHOT';
        } else if (isoArray.includes(Const.isc_tpb_read_committed)) {
            result.isolation = 'READ_COMMITTED';
            result.readCommittedMode = isoArray.includes(Const.isc_tpb_no_rec_version)
                ? 'NO_RECORD_VERSION'
                : 'RECORD_VERSION';
        }
    }
    return result;
}

function transformObjectRow(
    rawRow: Record<string, any>,
    lowercaseKeys: boolean,
    transformFn?: (k: string) => string
): Record<string, any> {
    if (!lowercaseKeys && !transformFn) {
        return rawRow;
    }
    const out: Record<string, any> = {};
    for (const rawKey of Object.keys(rawRow)) {
        let key = lowercaseKeys ? rawKey.toLowerCase() : rawKey;
        if (transformFn) {
            try {
                key = transformFn(key);
            } catch {
                // fall back to untransformed key
            }
        }
        out[key] = rawRow[rawKey];
    }
    return out;
}

export class NativeTransaction {
    db: NativeDatabase;
    nativeTx: any;
    connection: any;
    private _sql?: SqlTag;
    private _savepointDepth = 0;

    constructor(db: NativeDatabase, nativeTx: any) {
        this.db = db;
        this.nativeTx = nativeTx;
        this.connection = db.connection;
    }

    get sql(): SqlTag {
        return (
            this._sql ||
            (this._sql = makeSqlTag((text, params, options) =>
                this.queryAsync(text, params, { ...options, namedPlaceholders: false })
            ))
        );
    }

    private _prepareParams(query: string, params: any, options?: QueryOptions): { sql: string; values: any[] } {
        const useNamed =
            options && options.namedPlaceholders !== undefined
                ? Boolean(options.namedPlaceholders)
                : Boolean(this.db.options && this.db.options.namedPlaceholders);

        if (useNamed && params && typeof params === 'object' && !Array.isArray(params)) {
            const parsed = parseNamedPlaceholders(query);
            if (parsed.names) {
                const values = parsed.names.map((n) => params[n]);
                return { sql: parsed.sql, values };
            }
        }

        if (params === undefined || params === null) {
            return { sql: query, values: [] };
        }
        return { sql: query, values: Array.isArray(params) ? params : [params] };
    }

    private async _normalizeInputValues(stmt: any, values: any[]): Promise<any[]> {
        if (!values || values.length === 0) {
            return values;
        }
        const inDescs: Array<{ type: number; subType: number; charSet: number }> | undefined =
            stmt._inDescriptors;
        const normalized = values.slice();
        for (let i = 0; i < normalized.length; i++) {
            const val = normalized[i];
            if (val === null || val === undefined) {
                continue;
            }
            const desc = inDescs && inDescs[i];
            const isBlobParam = desc && desc.type === 520; /* SQL_BLOB */
            if (isBlobParam) {
                let buf: Buffer | null = null;
                if (Buffer.isBuffer(val)) {
                    buf = val;
                } else if (typeof val === 'string') {
                    buf = Buffer.from(val, 'utf8');
                } else if (val instanceof Uint8Array) {
                    buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
                }
                if (buf !== null) {
                    const blobStream = await this.db.attachment.createBlob(this.nativeTx);
                    try {
                        for (let offset = 0; offset < buf.length; offset += 16384) {
                            await blobStream.write(buf.subarray(offset, offset + 16384));
                        }
                        await blobStream.close();
                        normalized[i] = blobStream.blob;
                    } catch (err) {
                        try {
                            await blobStream.cancel();
                        } catch {
                            // ignore cancel error
                        }
                        throw err;
                    }
                }
            }
        }
        return normalized;
    }

    private async _readBlobValue(blobVal: any, subType: number): Promise<Buffer | string> {
        const stream = await this.db.attachment.openBlob(this.nativeTx, blobVal);
        try {
            const chunks: Buffer[] = [];
            const chunkBuf = Buffer.alloc(16384);
            while (true) {
                const bytesRead = await stream.read(chunkBuf);
                if (bytesRead <= 0) break;
                chunks.push(Buffer.from(chunkBuf.subarray(0, bytesRead)));
            }
            const full = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
            return subType === 1 ? full.toString('utf8') : full;
        } finally {
            try {
                await stream.close();
            } catch {
                // ignore close error
            }
        }
    }

    private async _resolveRowBlobs(
        stmt: any,
        row: any,
        asObject: boolean
    ): Promise<any> {
        const outDescs: Array<{ type: number; subType: number; charSet: number; alias: string }> | undefined =
            stmt._outDescriptors;
        if (!outDescs || !stmt._hasOutputBlobs || !row) {
            return row;
        }
        if (asObject) {
            for (let i = 0; i < outDescs.length; i++) {
                const d = outDescs[i];
                if (d.type === 520 /* SQL_BLOB */) {
                    const v = row[d.alias];
                    if (v && typeof v === 'object' && v.id instanceof Uint8Array && v.attachment) {
                        row[d.alias] = await this._readBlobValue(v, d.subType);
                    }
                }
            }
        } else if (Array.isArray(row)) {
            for (let i = 0; i < outDescs.length; i++) {
                const d = outDescs[i];
                if (d.type === 520 /* SQL_BLOB */) {
                    const v = row[i];
                    if (v && typeof v === 'object' && v.id instanceof Uint8Array && v.attachment) {
                        row[i] = await this._readBlobValue(v, d.subType);
                    }
                }
            }
        }
        return row;
    }

    async _runQuery(
        query: string,
        params: any,
        asObject: boolean,
        options?: QueryOptions
    ): Promise<any> {
        const diagStart = hasQuerySubscribers()
            ? publishQueryStart(query, params, this.db.options, this, false)
            : 0;
        const { sql, values: rawValues } = this._prepareParams(query, params, options);
        const stmt = await this.db._acquireStatement(this.nativeTx, sql);
        let shouldCache = true;
        let isSelect = false;
        let resultValue: any;

        try {
            const values = await this._normalizeInputValues(stmt, rawValues);
            const lowercaseKeys = Boolean(this.db.options && this.db.options.lowercase_keys);
            const transformFn = resolveKeyTransform(options, this.db.options);
            const fetchSize = (options && options.fetchSize) || (this.db.options && this.db.options.fetchSize);
            const fetchOpts = fetchSize ? { fetchSize } : undefined;

            if (stmt.hasResultSet) {
                isSelect = true;
                const rs = await stmt.executeQuery(this.nativeTx, values);
                try {
                    const allRows: any[] = [];
                    if (asObject) {
                        while (true) {
                            const chunk = await rs.fetchAsObject(fetchOpts);
                            if (!chunk || chunk.length === 0) break;
                            for (let i = 0; i < chunk.length; i++) {
                                const resolved = await this._resolveRowBlobs(stmt, chunk[i], true);
                                allRows.push(transformObjectRow(resolved, lowercaseKeys, transformFn));
                            }
                        }
                    } else {
                        while (true) {
                            const chunk = await rs.fetch(fetchOpts);
                            if (!chunk || chunk.length === 0) break;
                            for (let i = 0; i < chunk.length; i++) {
                                const resolved = await this._resolveRowBlobs(stmt, chunk[i], false);
                                allRows.push(resolved);
                            }
                        }
                    }
                    if (options && options.withMeta) {
                        const labels: string[] = (await stmt.columnLabels) || [];
                        resultValue = {
                            rows: allRows,
                            fields: labels.map((alias) => ({ alias, field: alias })),
                            affectedRows: allRows.length,
                            warnings: [],
                        };
                    } else {
                        resultValue = allRows;
                    }
                    publishQueryEnd(diagStart, query, params, this.db.options, this, allRows.length, true, false);
                    return resultValue;
                } finally {
                    await rs.close();
                }
            } else {
                const stmtType = await stmt.type;
                if (stmtType === 5 /* StatementType.DDL */) {
                    shouldCache = false;
                }
                // Check if RETURNING / singleton output exists
                const labels: string[] = (await stmt.columnLabels) || [];
                if (labels.length > 0) {
                    if (asObject) {
                        const obj = await stmt.executeSingletonAsObject(this.nativeTx, values);
                        const resolved = await this._resolveRowBlobs(stmt, obj || {}, true);
                        const transformed = transformObjectRow(resolved, lowercaseKeys, transformFn);
                        resultValue = options && options.withMeta
                            ? { rows: [transformed], fields: labels.map((alias) => ({ alias, field: alias })), affectedRows: 1, warnings: [] }
                            : transformed;
                    } else {
                        const arr = await stmt.executeSingleton(this.nativeTx, values);
                        const resolved = await this._resolveRowBlobs(stmt, arr, false);
                        resultValue = options && options.withMeta
                            ? { rows: [resolved], fields: labels.map((alias) => ({ alias, field: alias })), affectedRows: 1, warnings: [] }
                            : resolved;
                    }
                    publishQueryEnd(diagStart, query, params, this.db.options, this, 1, false, false);
                    return resultValue;
                }
                await stmt.execute(this.nativeTx, values);
                if (options && options.withMeta) {
                    resultValue = {
                        rows: [],
                        fields: [],
                        affectedRows: 0,
                        warnings: [],
                    };
                } else {
                    resultValue = undefined;
                }
                publishQueryEnd(diagStart, query, params, this.db.options, this, undefined, isSelect, false);
                return resultValue;
            }
        } catch (err) {
            shouldCache = false;
            const normalizedErr = toError(err);
            publishQueryError(diagStart, query, params, this.db.options, this, normalizedErr, false);
            throw normalizedErr;
        } finally {
            await this.db._releaseStatement(sql, stmt, shouldCache);
        }
    }

    query(query: string, params?: QueryParams | Callback, callback?: any, options?: QueryOptions): void {
        if (typeof params === 'function') {
            options = callback;
            callback = params;
            params = undefined;
        }
        this._runQuery(query, params, true, options).then(
            (res) => callback && callback(undefined, res),
            (err) => callback && callback(toError(err))
        );
    }

    execute(query: string, params?: QueryParams | Callback, callback?: any, options?: QueryOptions): void {
        if (typeof params === 'function') {
            options = callback;
            callback = params;
            params = undefined;
        }
        this._runQuery(query, params, false, options).then(
            (res) => callback && callback(undefined, res),
            (err) => callback && callback(toError(err))
        );
    }

    executeBatch(query: string, rows: QueryParams[], callback?: any, options?: BatchOptions): void {
        this.executeBatchAsync(query, rows, options).then(
            (res) => callback && callback(undefined, res),
            (err) => callback && callback(toError(err))
        );
    }

    async executeBatchAsync(query: string, rows: QueryParams[], _options?: BatchOptions): Promise<BatchResult> {
        const diagStart = hasQuerySubscribers()
            ? publishQueryStart(query, rows, this.db.options, this, true)
            : 0;
        if (!Array.isArray(rows)) {
            const err = new Error('executeBatch expects an array of parameter rows');
            publishQueryError(diagStart, query, rows, this.db.options, this, err, true);
            throw err;
        }
        if (rows.length === 0) {
            publishQueryEnd(diagStart, query, rows, this.db.options, this, 0, false, true);
            return {
                recordCount: 0,
                updateCounts: [],
                errors: [],
                errorRecordNumbers: [],
                success: true,
            };
        }
        const stmt = await this.db._acquireStatement(this.nativeTx, query);
        let shouldCache = true;
        try {
            const updateCounts: number[] = [];
            for (let i = 0; i < rows.length; i++) {
                const rawRowParams = Array.isArray(rows[i]) ? (rows[i] as any[]) : [rows[i]];
                const rowParams = await this._normalizeInputValues(stmt, rawRowParams);
                await stmt.execute(this.nativeTx, rowParams);
                updateCounts.push(1);
            }
            publishQueryEnd(diagStart, query, rows, this.db.options, this, rows.length, false, true);
            return {
                recordCount: rows.length,
                updateCounts,
                errors: [],
                errorRecordNumbers: [],
                success: true,
            };
        } catch (err) {
            shouldCache = false;
            const normalizedErr = toError(err);
            publishQueryError(diagStart, query, rows, this.db.options, this, normalizedErr, true);
            throw normalizedErr;
        } finally {
            await this.db._releaseStatement(query, stmt, shouldCache);
        }
    }

    sequentially(
        query: string,
        params?: any,
        on?: any,
        callback?: any,
        options: QueryOptions | boolean = {}
    ): NativeDatabase {
        if (typeof params === 'function') {
            options = callback;
            callback = on;
            on = params;
            params = undefined;
        }
        const asObject = typeof options === 'boolean' ? !options : (options as any)?.asObject !== false;
        const queryOpts = typeof options === 'object' ? options : undefined;

        (async () => {
            const { sql, values: rawValues } = this._prepareParams(query, params, queryOpts);
            const stmt = await this.db._acquireStatement(this.nativeTx, sql);
            let shouldCache = true;
            try {
                const values = await this._normalizeInputValues(stmt, rawValues);
                const lowercaseKeys = Boolean(this.db.options && this.db.options.lowercase_keys);
                const transformFn = resolveKeyTransform(queryOpts, this.db.options);
                const rs = await stmt.executeQuery(this.nativeTx, values);
                try {
                    let idx = 0;
                    while (true) {
                        const batch = asObject ? await rs.fetchAsObject() : await rs.fetch();
                        if (!batch || batch.length === 0) break;
                        for (let i = 0; i < batch.length; i++) {
                            const resolved = await this._resolveRowBlobs(stmt, batch[i], asObject);
                            const row = asObject
                                ? transformObjectRow(resolved, lowercaseKeys, transformFn)
                                : resolved;
                            if (on.length >= 4) {
                                await new Promise<void>((resolve, reject) => {
                                    on(row, idx++, [], (err?: any) => (err ? reject(err) : resolve()));
                                });
                            } else {
                                on(row, idx++);
                            }
                        }
                    }
                } finally {
                    await rs.close();
                }
            } catch (err) {
                shouldCache = false;
                throw toError(err);
            } finally {
                await this.db._releaseStatement(sql, stmt, shouldCache);
            }
        })().then(
            () => callback && callback(),
            (err) => callback && callback(toError(err))
        );
        return this.db;
    }

    commit(callback?: SimpleCallback): void {
        const diagStart = hasTransactionSubscribers() ? nowMs() : 0;
        this.nativeTx.commit().then(
            () => {
                publishTransaction('commit', diagStart, this.db.options, this);
                if (callback) callback();
            },
            (err: any) => {
                const e = toError(err);
                publishTransaction('commit', diagStart, this.db.options, this, undefined, e);
                if (callback) callback(e);
            }
        );
    }

    commitRetaining(callback?: SimpleCallback): void {
        const diagStart = hasTransactionSubscribers() ? nowMs() : 0;
        this.nativeTx.commitRetaining().then(
            () => {
                publishTransaction('commitRetaining', diagStart, this.db.options, this);
                if (callback) callback();
            },
            (err: any) => {
                const e = toError(err);
                publishTransaction('commitRetaining', diagStart, this.db.options, this, undefined, e);
                if (callback) callback(e);
            }
        );
    }

    rollback(callback?: SimpleCallback): void {
        const diagStart = hasTransactionSubscribers() ? nowMs() : 0;
        this.nativeTx.rollback().then(
            () => {
                publishTransaction('rollback', diagStart, this.db.options, this);
                if (callback) callback();
            },
            (err: any) => {
                const e = toError(err);
                publishTransaction('rollback', diagStart, this.db.options, this, undefined, e);
                if (callback) callback(e);
            }
        );
    }

    rollbackRetaining(callback?: SimpleCallback): void {
        const diagStart = hasTransactionSubscribers() ? nowMs() : 0;
        this.nativeTx.rollbackRetaining().then(
            () => {
                publishTransaction('rollbackRetaining', diagStart, this.db.options, this);
                if (callback) callback();
            },
            (err: any) => {
                const e = toError(err);
                publishTransaction('rollbackRetaining', diagStart, this.db.options, this, undefined, e);
                if (callback) callback(e);
            }
        );
    }

    queryAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]> {
        return fromCallback((cb) => this.query(query, params, cb, options));
    }

    executeAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]> {
        return fromCallback((cb) => this.execute(query, params, cb, options));
    }

    sequentiallyAsync(
        query: string,
        params?: any,
        on?: any,
        options?: QueryOptions | boolean
    ): Promise<void> {
        if (typeof params === 'function') {
            options = on;
            on = params;
            params = undefined;
        }
        return fromCallback((cb) => this.sequentially(query, params, on, cb, options));
    }

    commitAsync(): Promise<void> {
        return fromCallback((cb) => this.commit(cb));
    }

    commitRetainingAsync(): Promise<void> {
        return fromCallback((cb) => this.commitRetaining(cb));
    }

    rollbackAsync(): Promise<void> {
        return fromCallback((cb) => this.rollback(cb));
    }

    rollbackRetainingAsync(): Promise<void> {
        return fromCallback((cb) => this.rollbackRetaining(cb));
    }

    async savepoint<T>(work: (transaction: this) => Promise<T> | T): Promise<T> {
        if (typeof work !== 'function') {
            throw new Error('savepoint(work) expects a function');
        }
        const name = 'NF_SP_' + ++this._savepointDepth;
        try {
            await this.queryAsync('SAVEPOINT ' + name);
            let result: T;
            try {
                result = await work(this);
            } catch (err: any) {
                try {
                    await this.queryAsync('ROLLBACK TO SAVEPOINT ' + name);
                } catch (rollbackErr: any) {
                    if (err && typeof err === 'object') {
                        err.savepointRollbackError = rollbackErr;
                    }
                }
                throw err;
            }
            await this.queryAsync('RELEASE SAVEPOINT ' + name);
            return result;
        } finally {
            this._savepointDepth--;
        }
    }

    withSavepoint<T>(work: (transaction: this) => Promise<T> | T): Promise<T> {
        return this.savepoint(work);
    }
}

export class NativeDatabase extends Events.EventEmitter {
    attachment: any;
    options: any;
    connection: {
        _isClosed: boolean;
        _isDetach: boolean;
        _pooled: boolean;
        _pending: any[];
        _socket: { destroyed: boolean };
        options: any;
        accept: { protocolVersion: number };
        db?: NativeDatabase;
    };
    private _sql?: SqlTag;
    private _statementCacheSize: number;
    private _statementCache: Map<string, any> | null;

    constructor(attachment: any, options: any) {
        super();
        this.attachment = attachment;
        this.options = options || {};
        const cacheSize =
            options && options.statementCacheSize && options.statementCacheSize > 0
                ? Math.floor(options.statementCacheSize)
                : options && options.cacheQuery
                  ? options.maxCachedQuery || 100
                  : 0;
        this._statementCacheSize = cacheSize;
        this._statementCache = cacheSize > 0 ? new Map() : null;

        const self = this;
        this.connection = {
            _isClosed: false,
            _isDetach: false,
            _pooled: Boolean(options && options.isPool),
            _pending: [],
            _socket: {
                get destroyed() {
                    return !self.attachment || !self.attachment.isValid || self.connection._isClosed;
                },
            },
            options: this.options,
            accept: { protocolVersion: Const.PROTOCOL_VERSION20 },
            db: this,
        };
    }

    get statementCache(): Map<string, any> | null {
        return this._statementCache;
    }

    get sql(): SqlTag {
        return (
            this._sql ||
            (this._sql = makeSqlTag((text, params, options) =>
                this.queryAsync(text, params, { ...options, namedPlaceholders: false })
            ))
        );
    }

    escape(value: any): string {
        return escape(value, Const.PROTOCOL_VERSION20);
    }

    async _acquireStatement(nativeTx: any, sql: string): Promise<any> {
        if (this._statementCache) {
            const cached = this._statementCache.get(sql);
            if (cached) {
                this._statementCache.delete(sql);
                if (cached.isValid) {
                    return cached;
                }
            }
        }
        const stmt = await this.attachment.prepare(nativeTx, sql);
        if (this.attachment.client && typeof this.attachment.client.statusAction === 'function') {
            await this.attachment.client.statusAction(async (status: any) => {
                const inMeta = stmt.inMetadata;
                if (inMeta) {
                    const count = inMeta.getCountSync(status);
                    const descs = [];
                    for (let i = 0; i < count; i++) {
                        descs.push({
                            type: inMeta.getTypeSync(status, i),
                            subType: inMeta.getSubTypeSync(status, i),
                            charSet: inMeta.getCharSetSync(status, i),
                        });
                    }
                    stmt._inDescriptors = descs;
                }
                const outMeta = stmt.outMetadata;
                if (outMeta) {
                    const count = outMeta.getCountSync(status);
                    const descs = [];
                    let hasBlobs = false;
                    for (let i = 0; i < count; i++) {
                        const type = outMeta.getTypeSync(status, i);
                        if (type === 520 /* SQL_BLOB */) {
                            hasBlobs = true;
                        }
                        descs.push({
                            type,
                            subType: outMeta.getSubTypeSync(status, i),
                            charSet: outMeta.getCharSetSync(status, i),
                            alias: outMeta.getAliasSync(status, i),
                        });
                    }
                    stmt._outDescriptors = descs;
                    stmt._hasOutputBlobs = hasBlobs;
                }
            });
        }
        return stmt;
    }

    async _releaseStatement(sql: string, stmt: any, canCache: boolean): Promise<void> {
        if (!stmt || !stmt.isValid) {
            return;
        }
        if (
            canCache &&
            this._statementCache &&
            this._statementCacheSize > 0 &&
            !this._statementCache.has(sql)
        ) {
            this._statementCache.set(sql, stmt);
            while (this._statementCache.size > this._statementCacheSize) {
                const oldestKey = this._statementCache.keys().next().value!;
                const oldest = this._statementCache.get(oldestKey);
                this._statementCache.delete(oldestKey);
                if (oldest && oldest.isValid) {
                    try {
                        await oldest.dispose();
                    } catch {
                        // ignore dispose error on eviction
                    }
                }
            }
            return;
        }
        try {
            await stmt.dispose();
        } catch {
            // ignore dispose error
        }
    }

    private async _clearStatementCache(): Promise<void> {
        if (!this._statementCache) return;
        const statements = Array.from(this._statementCache.values());
        this._statementCache.clear();
        for (const stmt of statements) {
            if (stmt && stmt.isValid) {
                try {
                    await stmt.dispose();
                } catch {
                    // ignore
                }
            }
        }
    }

    transaction(options?: TransactionOptions | Isolation | TransactionCallback, callback?: TransactionCallback): this {
        return this.startTransaction(options, callback);
    }

    startTransaction(
        options?: TransactionOptions | Isolation | TransactionCallback,
        callback?: TransactionCallback
    ): this {
        if (typeof options === 'function') {
            callback = options;
            options = undefined;
        }
        const txOpts = mapTransactionOptions(options);
        const diagStart = hasTransactionSubscribers() ? nowMs() : 0;
        this.attachment
            .startTransaction(txOpts)
            .then((nativeTx: any) => {
                const tx = new NativeTransaction(this, nativeTx);
                publishTransaction('start', diagStart, this.options, tx, options);
                this.emit('transaction', options);
                if (callback) (callback as any)(undefined, tx);
            })
            .catch((err: any) => {
                const e = toError(err);
                publishTransaction('start', diagStart, this.options, undefined, options, e);
                if (callback) (callback as any)(e);
            });
        return this;
    }

    query(query: string, params?: QueryParams | Callback, callback?: any, options?: QueryOptions): this {
        if (typeof params === 'function') {
            options = callback;
            callback = params;
            params = undefined;
        }
        this.startTransaction((err, tx: any) => {
            if (err || !tx) {
                if (callback) callback(err);
                return;
            }
            tx.query(
                query,
                params,
                (qErr: any, res: any) => {
                    if (qErr) {
                        tx.rollback(() => callback && callback(qErr));
                        return;
                    }
                    tx.commit((cErr: any) => {
                        if (callback) callback(cErr, res);
                    });
                },
                options
            );
        });
        return this;
    }

    execute(query: string, params?: QueryParams | Callback, callback?: any, options?: QueryOptions): this {
        if (typeof params === 'function') {
            options = callback;
            callback = params;
            params = undefined;
        }
        this.startTransaction((err, tx: any) => {
            if (err || !tx) {
                if (callback) callback(err);
                return;
            }
            tx.execute(
                query,
                params,
                (qErr: any, res: any) => {
                    if (qErr) {
                        tx.rollback(() => callback && callback(qErr));
                        return;
                    }
                    tx.commit((cErr: any) => {
                        if (callback) callback(cErr, res);
                    });
                },
                options
            );
        });
        return this;
    }

    executeBatch(query: string, rows: QueryParams[], callback?: any, options?: BatchOptions): this {
        this.startTransaction((err, tx: any) => {
            if (err || !tx) {
                if (callback) callback(err);
                return;
            }
            tx.executeBatch(
                query,
                rows,
                (bErr: any, res: any) => {
                    if (bErr) {
                        tx.rollback(() => callback && callback(bErr));
                        return;
                    }
                    tx.commit((cErr: any) => {
                        if (callback) callback(cErr, res);
                    });
                },
                options
            );
        });
        return this;
    }

    sequentially(
        query: string,
        params?: any,
        on?: any,
        callback?: any,
        options: QueryOptions | boolean = {}
    ): this {
        if (typeof params === 'function') {
            options = callback;
            callback = on;
            on = params;
            params = undefined;
        }
        this.startTransaction((err, tx: any) => {
            if (err || !tx) {
                if (callback) callback(err);
                return;
            }
            tx.sequentially(
                query,
                params,
                on,
                (sErr: any) => {
                    if (sErr) {
                        tx.rollback(() => callback && callback(sErr));
                        return;
                    }
                    tx.commit((cErr: any) => {
                        if (callback) callback(cErr);
                    });
                },
                options
            );
        });
        return this;
    }

    ping(timeout?: number | SimpleCallback, callback?: SimpleCallback): this {
        if (typeof timeout === 'function') {
            callback = timeout;
            timeout = undefined;
        }
        if (this.connection._isClosed || !this.attachment || !this.attachment.isValid) {
            const err = new Error('Connection is closed.');
            if (callback) callback(err);
            return this;
        }

        let timer: NodeJS.Timeout | null = null;
        let settled = false;
        const finish = (err?: any) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (callback) callback(err ? toError(err) : undefined);
        };

        if (typeof timeout === 'number' && timeout > 0) {
            timer = setTimeout(() => {
                const err: any = new Error('Socket timeout after ' + Math.floor(timeout!) + 'ms');
                err.code = 'ETIMEDOUT';
                this.connection._isClosed = true;
                finish(err);
            }, Math.floor(timeout));
            if (timer.unref) timer.unref();
        }

        this.attachment
            .startTransaction({ accessMode: 'READ_ONLY' })
            .then((tx: any) => tx.commit())
            .then(() => finish(), (err: any) => finish(err));

        return this;
    }

    cancel(kind?: number | SimpleCallback, callback?: SimpleCallback): this {
        if (typeof kind === 'function') {
            callback = kind;
            kind = undefined;
        }
        const forcible = kind === Const.fb_cancel_abort;
        this.attachment
            .cancelOperation(forcible)
            .then(() => callback && callback(), (err: any) => callback && callback(toError(err)));
        return this;
    }

    detach(callback?: SimpleCallback, _force?: boolean): this {
        if (this.connection._pooled) {
            this.emit('detach', false);
            if (callback) callback();
            return this;
        }
        this.connection._isDetach = true;
        this.connection._isClosed = true;
        this._clearStatementCache()
            .then(() => this.attachment.disconnect())
            .then(
                () => {
                    this.emit('detach', false);
                    if (callback) callback();
                },
                (err: any) => {
                    this.emit('detach', false);
                    if (callback) callback(toError(err));
                }
            );
        return this;
    }

    drop(callback?: SimpleCallback): this {
        this.connection._isDetach = true;
        this.connection._isClosed = true;
        this._clearStatementCache()
            .then(() => this.attachment.dropDatabase())
            .then(
                () => {
                    if (callback) callback();
                },
                (err: any) => {
                    if (callback) callback(toError(err));
                }
            );
        return this;
    }

    queryAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]> {
        return fromCallback((cb) => this.query(query, params, cb, options));
    }

    executeAsync<T = any>(query: string, params?: QueryParams, options?: QueryOptions): Promise<T[]> {
        return fromCallback((cb) => this.execute(query, params, cb, options));
    }

    executeBatchAsync(query: string, rows: QueryParams[], options?: BatchOptions): Promise<BatchResult> {
        return fromCallback((cb) => this.executeBatch(query, rows, cb, options));
    }

    sequentiallyAsync(
        query: string,
        params?: any,
        on?: any,
        options?: QueryOptions | boolean
    ): Promise<void> {
        if (typeof params === 'function') {
            options = on;
            on = params;
            params = undefined;
        }
        return fromCallback((cb) => this.sequentially(query, params, on, cb, options));
    }

    transactionAsync(options?: TransactionOptions | Isolation): Promise<any> {
        return fromCallback((cb) => this.startTransaction(options, cb as any));
    }

    startTransactionAsync(options?: TransactionOptions | Isolation): Promise<any> {
        return this.transactionAsync(options);
    }

    pingAsync(timeout?: number): Promise<void> {
        return fromCallback((cb) => this.ping(timeout, cb));
    }

    cancelAsync(kind?: number): Promise<void> {
        return fromCallback((cb) => this.cancel(kind, cb));
    }

    detachAsync(force?: boolean): Promise<void> {
        return fromCallback((cb) => this.detach(cb, force));
    }

    dropAsync(): Promise<void> {
        return fromCallback((cb) => this.drop(cb));
    }

    async withTransaction<T>(
        work: (transaction: any) => Promise<T> | T,
        options?: TransactionOptions | Isolation
    ): Promise<T> {
        const transaction = await this.transactionAsync(options);
        try {
            const result = await work(transaction);
            await transaction.commitAsync();
            return result;
        } catch (err) {
            try {
                await transaction.rollbackAsync();
            } catch {
                // surface original error
            }
            throw err;
        }
    }
}

export function attachNative(options: Options | string, callback: DatabaseCallback): void {
    try {
        const opts: any = normalizeOptions(options);
        const client = getNativeClient(opts.nativeLibrary);
        const uri = formatNativeUri(opts);
        const connectOpts = buildConnectOptions(opts);

        client
            .connect(uri, connectOpts)
            .then((attachment: any) => {
                const db = new NativeDatabase(attachment, opts);
                callback(null as any, db as unknown as Database);
                db.emit('attach', db);
            })
            .catch((err: any) => {
                callback(toError(err), undefined as any);
            });
    } catch (err) {
        callback(toError(err), undefined as any);
    }
}

export function createNative(options: Options | string, callback: DatabaseCallback): void {
    try {
        const opts: any = normalizeOptions(options);
        const client = getNativeClient(opts.nativeLibrary);
        const uri = formatNativeUri(opts);
        const connectOpts = buildConnectOptions(opts);

        client
            .createDatabase(uri, connectOpts)
            .then((attachment: any) => {
                const db = new NativeDatabase(attachment, opts);
                callback(null as any, db as unknown as Database);
                db.emit('attach', db);
            })
            .catch((err: any) => {
                callback(toError(err), undefined as any);
            });
    } catch (err) {
        callback(toError(err), undefined as any);
    }
}

export function attachOrCreateNative(options: Options | string, callback: DatabaseCallback): void {
    attachNative(options, (err, db) => {
        if (!err && db) {
            callback(null as any, db);
            return;
        }
        createNative(options, callback);
    });
}

export function dropNative(options: Options | string, callback: SimpleCallback): void {
    attachNative(options, (err, db) => {
        if (err || !db) {
            callback(err);
            return;
        }
        db.drop(callback);
    });
}

export function poolNative(max: number, options: Options | string): ConnectionPool {
    const normalized = Object.assign({}, normalizeOptions(options), { isPool: true, native: true });
    return new Pool(attachNative as any, max, normalized);
}

export const native = {
    isAvailable: hasNativeDriver,
    loadDriver: loadNativeDriver,
    attach: attachNative,
    create: createNative,
    attachOrCreate: attachOrCreateNative,
    drop: dropNative,
    pool: poolNative,
    attachAsync: (options: Options | string): Promise<Database> =>
        fromCallback((cb) => attachNative(options, cb as any)),
    createAsync: (options: Options | string): Promise<Database> =>
        fromCallback((cb) => createNative(options, cb as any)),
    attachOrCreateAsync: (options: Options | string): Promise<Database> =>
        fromCallback((cb) => attachOrCreateNative(options, cb as any)),
    dropAsync: (options: Options | string): Promise<void> =>
        fromCallback((cb) => dropNative(options, cb)),
};
