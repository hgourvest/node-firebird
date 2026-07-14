import Const from './const';
import type { XdrReader, XdrWriter, BlrWriter } from './serialize';

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
const FirebirdToNodeEncoding = Object.freeze({
    UTF8:        'utf8',
    UNICODE_FSS: 'utf8',
    WIN1252:     'latin1',
    ISO8859_1:   'latin1',
    LATIN1:      'latin1',
    ASCII:       'ascii',
    NONE:        'latin1',   // unspecified charset – treat as binary-safe latin1
});

const FirebirdCharsetWidths = {
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
    type: number;
    subType: number;
    scale: number;
    length: number;
    nullable: boolean;
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
