import Const from './const';
import { BlrReader } from './serialize';
import type { XdrReader, XdrWriter, BlrWriter } from './serialize';
import type { RecordCounts } from '../types';

/***************************************
 *
 *   SQLVar
 *
 ***************************************/

const
    ScaleDivisor = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000, 100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
const
    DateOffset = 40587,
    TimeCoeff = 86400000,
    MsPerMinute = 60000;

/**
 * Maps Firebird character-set names (upper-case) to the Node.js Buffer
 * encoding string used by Buffer.toString() / Buffer.from().
 *
 * Firebird stores CHAR/VARCHAR data in the on-wire character set of the
 * column (or the connection character set for NONE/unspecified columns).
 * We must decode raw bytes with the matching Node.js encoding so that
 * characters outside ASCII are reproduced correctly.
 *
 * Commonly used Firebird charsets not listed here fall back to the
 * connection-level DEFAULT_ENCODING (typically 'utf8').
 */
const FirebirdToNodeEncoding: Readonly<Record<string, string>> = Object.freeze({
    UTF8:        'utf8',
    UNICODE_FSS: 'utf8',
    WIN1252:     'latin1',
    ISO8859_1:   'latin1',
    LATIN1:      'latin1',
    ASCII:       'ascii',
    NONE:        'latin1',   // unspecified charset – treat as binary-safe latin1
});

const FirebirdCharsetWidths: Record<string, number> = {
    'UTF8': 4,
    'UNICODE_FSS': 3,
    'SJIS': 2,
    'EUCJ': 2
};

function getFirebirdCharsetWidth(charset?: string): number {
    if (!charset) return 4;
    const upper = charset.toUpperCase();
    return FirebirdCharsetWidths[upper] || 1;
}

/**
 * Resolve the Node.js Buffer encoding to use when decoding text from a
 * Firebird response buffer.
 *
 * @param {object|null} options  Connection options object (may be falsy).
 * @returns {string}             A Node.js-compatible encoding string.
 */
function resolveTextEncoding(options?: any): BufferEncoding {
    const encoding = (options && options.encoding)
        ? options.encoding.toUpperCase()
        : Const.DEFAULT_ENCODING;
    return (FirebirdToNodeEncoding[encoding] || Const.DEFAULT_ENCODING.toLowerCase()) as BufferEncoding;
}

//------------------------------------------------------

/**
 * Common shape of all SQLVar descriptor objects.  The metadata properties
 * are populated externally (in connection.ts) from the op_prepare_statement
 * describe response before decode()/calcBlr() are called.
 */
export abstract class SQLVarBase {
    // populated externally (see the doc comment above), hence the definite
    // assignment assertions
    type!: number;
    subType!: number;
    scale!: number;
    length!: number;
    nullable!: boolean;
    field?: string;
    relation?: string;
    relationSchema?: string;
    alias?: string;
    relationAlias?: string;
    owner?: string;
    charSetId?: number;
    collationId?: number;

    abstract decode(data: XdrReader, lowerV13: boolean, options?: any): any;
    abstract calcBlr(blr: BlrWriter): void;
}

//------------------------------------------------------

/** Effective object-row key(s) of one output column (see computeColumnKeys). */
export interface ColumnKey {
    /** Top-level table key when nestTables === true; undefined otherwise. */
    table?: string;
    /** Property key: the column alias, or 'table<sep>alias' in separator mode. */
    key: string;
}

/**
 * Compute the object-row property keys for a statement's output columns,
 * honouring the nestTables and lowercase_keys options. The table qualifier
 * is the query's relation alias when one is used (relationAlias, requested
 * via isc_info_sql_relation_alias), the relation name otherwise, so
 * self-joins nest under their query aliases. Expression columns (no source
 * relation) qualify as '' exactly like mysql2: they nest under the '' key,
 * and in separator mode become '<sep>alias' — always prefixing keeps
 * qualified keys collision-free (a bare expression alias could otherwise
 * collide with a real column's 'table<sep>column' key). Used by the fetch
 * decoder and by fetchBlobSyncRow, which must agree on where each column
 * landed in the row.
 */
export function computeColumnKeys(
    output: SQLVarBase[],
    nestTables: boolean | string | undefined,
    lowercaseKeys: boolean | undefined,
    transform?: (key: string) => string
): ColumnKey[] {
    return output.map((column) => {
        let key = column.alias || '';
        if (lowercaseKeys) {
            key = key.toLowerCase();
        }
        if (transform) {
            key = transform(key);
        }
        if (nestTables !== true && typeof nestTables !== 'string') {
            return { key };
        }
        let table = column.relationAlias || column.relation || '';
        if (lowercaseKeys) {
            table = table.toLowerCase();
        }
        if (transform) {
            table = transform(table);
        }
        if (nestTables === true) {
            return { table, key };
        }
        return { key: table + nestTables + key };
    });
}

/** transformKeys option value: the built-in 'camel', or a custom mapper. */
export type KeyTransform = 'camel' | ((key: string) => string);

/** FIRST_NAME → firstName (the transformKeys: 'camel' built-in). */
export function camelizeKey(key: string): string {
    const parts = String(key).toLowerCase().split('_');
    let out = parts[0] || '';
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (part) {
            out += part.charAt(0).toUpperCase() + part.slice(1);
        }
    }
    return out;
}

/**
 * Resolve the effective transformKeys value (per-query wins over the
 * connection option) into a callable mapper, or undefined when off.
 * A custom mapper is guarded like the typeCast hook: a throw inside the
 * row-decode loop would be mistaken for an incomplete packet and desync
 * the response queue, so failures fall back to the untransformed key.
 */
export function resolveKeyTransform(
    queryOptions: { transformKeys?: KeyTransform } | undefined,
    connectionOptions: { transformKeys?: KeyTransform } | undefined
): ((key: string) => string) | undefined {
    const value = resolveQueryOption<KeyTransform>('transformKeys', queryOptions, connectionOptions);
    if (value === 'camel') {
        return camelizeKey;
    }
    if (typeof value !== 'function') {
        return undefined;
    }
    return (key: string) => {
        try {
            return String(value(key));
        } catch (err: any) {
            console.warn('[node-firebird] transformKeys mapper threw for key "%s": %s — using the untransformed key',
                key, err && err.message);
            return key;
        }
    };
}

/**
 * Shared precedence rule for per-query-overridable connection options:
 * the per-query value wins whenever it is present (even if falsy), the
 * connection option applies otherwise.
 */
function resolveQueryOption<T>(
    name: string,
    queryOptions: Record<string, any> | undefined,
    connectionOptions: Record<string, any> | undefined
): T | undefined {
    if (queryOptions && queryOptions[name] !== undefined) {
        return queryOptions[name];
    }
    return connectionOptions ? connectionOptions[name] : undefined;
}

/**
 * Resolve the effective nestTables value: the per-query option wins over
 * the connection option. The decoder and fetchBlobSyncRow both use this —
 * they must agree on whether nesting is active or blob cells are looked
 * up in the wrong place.
 */
export function resolveNestTables(
    queryOptions: { nestTables?: boolean | string } | undefined,
    connectionOptions: { nestTables?: boolean | string } | undefined
): boolean | string | undefined {
    return resolveQueryOption('nestTables', queryOptions, connectionOptions);
}

/**
 * The object a column's value lives in: the row itself, or — when the
 * column carries a nestTables table qualifier — the row's per-table
 * sub-object, created on first use. Every site that reads or writes a
 * cell by ColumnKey must resolve it through here.
 */
export function nestCell(row: any, table: string | undefined) {
    if (table === undefined) {
        return row;
    }
    return row[table] || (row[table] = {});
}

//------------------------------------------------------

/** Human-readable names for the SQL_* wire type codes. */
export const SQL_TYPE_NAMES: Record<number, string> = {
    [Const.SQL_TEXT]: 'TEXT',
    [Const.SQL_VARYING]: 'VARYING',
    [Const.SQL_SHORT]: 'SHORT',
    [Const.SQL_LONG]: 'LONG',
    [Const.SQL_FLOAT]: 'FLOAT',
    [Const.SQL_DOUBLE]: 'DOUBLE',
    [Const.SQL_D_FLOAT]: 'D_FLOAT',
    [Const.SQL_TIMESTAMP]: 'TIMESTAMP',
    [Const.SQL_BLOB]: 'BLOB',
    [Const.SQL_ARRAY]: 'ARRAY',
    [Const.SQL_QUAD]: 'QUAD',
    [Const.SQL_TYPE_TIME]: 'TIME',
    [Const.SQL_TYPE_DATE]: 'DATE',
    [Const.SQL_INT64]: 'INT64',
    [Const.SQL_INT128]: 'INT128',
    [Const.SQL_TIMESTAMP_TZ]: 'TIMESTAMP_TZ',
    [Const.SQL_TIMESTAMP_TZ_EX]: 'TIMESTAMP_TZ_EX',
    [Const.SQL_TIME_TZ]: 'TIME_TZ',
    [Const.SQL_TIME_TZ_EX]: 'TIME_TZ_EX',
    [Const.SQL_DEC16]: 'DEC16',
    [Const.SQL_DEC34]: 'DEC34',
    [Const.SQL_BOOLEAN]: 'BOOLEAN',
    [Const.SQL_NULL]: 'NULL',
};

/**
 * Public column-metadata shape for one output descriptor: the vocabulary
 * both the typeCast hook and withMeta `fields` deliver. Keep the two in
 * lockstep by building both through here.
 */
export function describeField(meta: Partial<SQLVarBase>) {
    return {
        type: meta.type!,
        typeName: SQL_TYPE_NAMES[meta.type!] || 'UNKNOWN',
        subType: meta.subType,
        scale: meta.scale,
        length: meta.length,
        nullable: meta.nullable,
        field: meta.field,
        relation: meta.relation,
        relationAlias: meta.relationAlias,
        relationSchema: meta.relationSchema,
        alias: meta.alias,
    };
}

/**
 * Map a statement's output descriptors to the column-metadata array
 * delivered in withMeta results ({ rows, fields, ... }).
 */
export function describeFields(output: SQLVarBase[]) {
    return (output || []).map(describeField);
}

/**
 * Parse the op_info_sql response buffer of a Const.RECORDS_INFO request
 * into per-verb row counts. The buffer holds an isc_info_sql_records
 * cluster (2-byte total length, then nested isc_info_req_*_count items,
 * each 2-byte length + little-endian integer) terminated by isc_info_end.
 */
export function parseRecordCounts(buffer: Buffer | undefined): RecordCounts {
    const counts = { selectCount: 0, insertCount: 0, updateCount: 0, deleteCount: 0 };
    if (!buffer || !buffer.length) {
        return counts;
    }
    // this runs inside a response callback — a malformed/truncated buffer
    // must yield partial counts, never a throw
    try {
        const br = new BlrReader(buffer);
        while (br.pos < br.buffer.length) {
            const item = br.readByteCode();
            if (item === Const.isc_info_end || item === Const.isc_info_truncated) {
                break;
            }
            if (item === Const.isc_info_sql_records) {
                br.pos += 2; // skip the cluster's total length; nested items follow
                continue;
            }
            switch (item) {
                case Const.isc_info_req_select_count: counts.selectCount = br.readInt() || 0; break;
                case Const.isc_info_req_insert_count: counts.insertCount = br.readInt() || 0; break;
                case Const.isc_info_req_update_count: counts.updateCount = br.readInt() || 0; break;
                case Const.isc_info_req_delete_count: counts.deleteCount = br.readInt() || 0; break;
                default:
                    // unknown item: its 2-byte length prefix tells us how far to skip
                    br.pos += 2 + br.buffer.readUInt16LE(br.pos);
            }
        }
    } catch (e) {
        // fall through with whatever was parsed so far
    }
    return counts;
}

//------------------------------------------------------

export class SQLVarText extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean, options?: any) {
        let ret;
        const textEncoding = resolveTextEncoding(options);
        if (this.subType > 1) {
            // ToDo: with column charset
            ret = data.readText(this.length, textEncoding);
            const encoding = options && options.encoding ? options.encoding : 'UTF8';
            const width = getFirebirdCharsetWidth(encoding);
            const charLength = Math.floor(this.length / width);
            if (ret.length > charLength) {
                ret = ret.substring(0, charLength);
            }
        } else if (this.subType === 0) {
            // without charset definition
            ret = data.readText(this.length, textEncoding);
            const encoding = options && options.encoding ? options.encoding : 'UTF8';
            const width = getFirebirdCharsetWidth(encoding);
            const charLength = Math.floor(this.length / width);
            if (ret.length > charLength) {
                ret = ret.substring(0, charLength);
            }
        } else {
            ret = data.readBuffer(this.length);
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_text);
        blr.addWord(this.length);
    }
}

//------------------------------------------------------

export class SQLVarNull extends SQLVarText {
}

//------------------------------------------------------

export class SQLVarString extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean, options?: any) {
        let ret;
        const textEncoding = resolveTextEncoding(options);
        if (this.subType > 1) {
            // ToDo: with column charset
            ret = data.readString(textEncoding);
        } else if (this.subType === 0) {
            // without charset definition
            ret = data.readString(textEncoding);
        } else {
            ret = data.readBuffer();
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_varying);
        blr.addWord(this.length);
    }
}

//------------------------------------------------------

export class SQLVarQuad extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readQuad();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_quad);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

export class SQLVarBlob extends SQLVarQuad {
    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

export class SQLVarArray extends SQLVarQuad {
    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

export class SQLVarInt extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readInt();

        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_long);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

export class SQLVarShort extends SQLVarInt {
    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_short);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

export class SQLVarInt64 extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readInt64();

        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_int64);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

export class SQLVarInt128 extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var retBigInt = BigInt(data.readInt128())
        let ret: string | number;

        if (retBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
            ret = retBigInt.toString();

            var integerPart = ret.slice(0, Math.abs(this.scale) * -1)
            var decimalPart = ret.slice(Math.abs(this.scale) * -1)

            if (integerPart === '') integerPart = '0'

            ret = `${integerPart}.${decimalPart}`
        } else {
            ret = Number(retBigInt);
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_int128);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

export class SQLVarDecFloat16 extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readDecFloat16();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_dec64);
        blr.addShort(0);
    }
}

//------------------------------------------------------

export class SQLVarDecFloat34 extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readDecFloat34();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_dec128);
        blr.addShort(0);
    }
}

//------------------------------------------------------

export class SQLVarFloat extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readFloat();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_float);
    }
}

//------------------------------------------------------

export class SQLVarDouble extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readDouble();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_double);
    }
}

//------------------------------------------------------

export class SQLVarDate extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((ret - DateOffset) * TimeCoeff + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_sql_date);
    }
}

//------------------------------------------------------

export class SQLVarTime extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readUInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds(Math.floor(ret / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_sql_time);
    }
}

//------------------------------------------------------

export class SQLVarTimeStamp extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var date = data.readInt();
        var time = data.readUInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_timestamp);
    }
}

//------------------------------------------------------

export class SQLVarTimeTz extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var time = data.readUInt();
        data.readInt(); // skip timezone info

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds(Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_sql_time_tz);
    }
}

//------------------------------------------------------

export class SQLVarTimeTzEx extends SQLVarTimeTz {
    decode(data: XdrReader, lowerV13: boolean) {
        var time = data.readUInt();
        data.readInt(); // skip timezone info
        data.readInt(); // skip ext_offset

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds(Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_ex_time_tz);
    }
}

//------------------------------------------------------

export class SQLVarTimeStampTz extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var date = data.readInt();
        var time = data.readUInt();
        data.readInt(); // skip timezone info

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_timestamp_tz);
    }
}

//------------------------------------------------------

export class SQLVarTimeStampTzEx extends SQLVarTimeStampTz {
    decode(data: XdrReader, lowerV13: boolean) {
        var date = data.readInt();
        var time = data.readUInt();
        data.readInt(); // skip timezone info
        data.readInt(); // skip ext_offset

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_ex_timestamp_tz);
    }
}

//------------------------------------------------------

export class SQLVarBoolean extends SQLVarBase {
    decode(data: XdrReader, lowerV13: boolean) {
        var ret = data.readInt();

        if (!lowerV13 || !data.readInt()) {
            return Boolean(ret);
        }
        return null;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_bool);
    }
}

//------------------------------------------------------

export class SQLParamInt {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_long);
        blr.addShort(0);
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addInt(this.value);
        } else {
            data.addInt(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

export class SQLParamInt64 {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_int64);
        blr.addShort(0);
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addInt64(this.value);
        } else {
            data.addInt64(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

export class SQLParamInt128 {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_int128);
        blr.addShort(0);
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addInt128(this.value);
        } else {
            data.addInt128(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

export class SQLParamDecFloat16 {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_dec64);
        blr.addShort(0);
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addDecFloat16(this.value);
        } else {
            data.addDecFloat16(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

export class SQLParamDecFloat34 {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_dec128);
        blr.addShort(0);
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addDecFloat34(this.value);
        } else {
            data.addDecFloat34(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

export class SQLParamDouble {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addDouble(this.value);
        } else {
            data.addDouble(0);
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_double);
    }
}

//------------------------------------------------------

export class SQLParamString {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addText(this.value, Const.DEFAULT_ENCODING);
        } else {
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_text);
        var len = this.value ? Buffer.byteLength(this.value, Const.DEFAULT_ENCODING) : 0;
        blr.addWord(len);
    }
}

//------------------------------------------------------

export class SQLParamBuffer {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addParamBuffer(this.value);
        } else {
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_text);
        var len = this.value ? this.value.length : 0;
        blr.addWord(len);
    }
}

//------------------------------------------------------

/**
 * Split a JS Date into the Firebird wire representation used by
 * TIMESTAMP/DATE/TIME columns: `date` is the modified-Julian day number and
 * `time` the count of 100-microsecond units since midnight (local time).
 */
export function encodeDateTimeParts(value: Date): { date: number; time: number } {
    var ms = value.getTime() - value.getTimezoneOffset() * MsPerMinute;
    var time = ms % TimeCoeff;
    var date = (ms - time) / TimeCoeff + DateOffset;
    time *= 10;

    // check overflow (dates before the epoch)
    if (time < 0) {
        date--;
        time = TimeCoeff * 10 + time;
    }

    return { date: date, time: time };
}

//------------------------------------------------------

export class SQLParamQuad {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addInt(this.value.high);
            data.addInt(this.value.low);
        } else {
            data.addInt(0);
            data.addInt(0);
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

export class SQLParamDate {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            var parts = encodeDateTimeParts(this.value);
            data.addInt(parts.date);
            data.addUInt(parts.time);
        } else {
            data.addInt(0);
            data.addUInt(0);
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_timestamp);
    }
}

//------------------------------------------------------

export class SQLParamBool {
    value: any;

    constructor(value: any) {
        this.value = value;
    }

    encode(data: XdrWriter): void {
        if (this.value != null) {
            data.addInt(this.value ? 1 : 0);
        } else {
            data.addInt(0);
            data.addInt(1);
        }
    }

    calcBlr(blr: BlrWriter): void {
        blr.addByte(Const.blr_short);
        blr.addShort(0);
    }
}
