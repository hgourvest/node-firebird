
import { encodeDecimal64, decodeDecimal64, encodeDecimal128, decodeDecimal128 } from '../ieee754-decimal';

function align(n: number): number {
    return (n + 3) & ~3;
}

/***************************************
 *
 *   BLR Writer
 *
 ***************************************/

const
    MAX_STRING_SIZE = 255;

export class BlrWriter {
    buffer: Buffer;
    pos: number;

    constructor(size?: number) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
    }

    ensure(len: number): void {
        var newlen = this.buffer.length;

        while (newlen < this.pos + len)
            newlen *= 2

        if (this.buffer.length >= newlen)
            return;

        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        this.buffer = b;
    }

    addByte(b: number): void {
        this.ensure(1);
        this.buffer.writeUInt8(b, this.pos);
        this.pos++;
    }

    addShort(b: number): void {
        this.ensure(1);
        this.buffer.writeInt8(b, this.pos);
        this.pos++;
    }

    addSmall(b: number): void {
        this.ensure(2);
        this.buffer.writeInt16LE(b, this.pos);
        this.pos += 2;
    }

    addWord(b: number): void {
        this.ensure(2);
        this.buffer.writeUInt16LE(b, this.pos);
        this.pos += 2;
    }

    addInt32(b: number): void {
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
    }

    addByteInt32(c: number, b: number): void {
        this.addByte(c);
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
    }

    addNumeric(c: number, v: number): void {
        if (v < 256){
            this.ensure(3);
            this.buffer.writeUInt8(c, this.pos);
            this.pos++;
            this.buffer.writeUInt8(1, this.pos);
            this.pos++;
            this.buffer.writeUInt8(v, this.pos);
            this.pos++;
            return;
        }

        this.ensure(6);
        this.buffer.writeUInt8(c, this.pos);
        this.pos++;
        this.buffer.writeUInt8(4, this.pos);
        this.pos++;
        this.buffer.writeInt32BE(v, this.pos);
        this.pos += 4;
    }

    addBytes(b: number[] | Buffer): void {
        this.ensure(b.length);
        for (var i = 0, length = b.length; i < length; i++) {
            this.buffer.writeUInt8(b[i], this.pos);
            this.pos++;
        }
    }

    addString(c: number, s: string, encoding: BufferEncoding): void {
        this.addByte(c);

        var len = Buffer.byteLength(s, encoding);
        if (len > MAX_STRING_SIZE)
            throw new Error('blr string is too big');

        this.ensure(len + 1);
        this.buffer.writeUInt8(len, this.pos);
        this.pos++;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += len;
    }

    addBuffer(b: Buffer): void {
        this.addWord(b.length);
        this.ensure(b.length);
        b.copy(this.buffer, this.pos);
        this.pos += b.length;
    }

    addString2(c: number, s: string, encoding: BufferEncoding): void {
        this.addByte(c);

        var len = Buffer.byteLength(s, encoding);
        if (len > MAX_STRING_SIZE* MAX_STRING_SIZE)
            throw new Error('blr string is too big');

        this.ensure(len + 2);
        this.buffer.writeUInt16LE(len, this.pos);
        this.pos += 2;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += len;
    }

    addMultiblockPart(c: number, s: string, encoding: BufferEncoding): void {
        var buff = Buffer.from(s, encoding);
        var remaining = buff.length;
        var step = 0;

        while (remaining > 0) {
            var toWrite = Math.min(remaining, 254);

            this.addByte(c);
            this.addByte(toWrite + 1);
            this.addByte(step);

            this.ensure(toWrite);
            buff.copy(this.buffer, this.pos, step * 254, (step * 254) + toWrite);

            step++;
            remaining -= toWrite;
            this.pos += toWrite;
        }
    }
}

/***************************************
 *
 *   BLR Reader
 *
 ***************************************/

export class BlrReader {
    buffer: Buffer;
    pos: number;

    constructor(buffer: Buffer) {
        this.buffer = buffer;
        this.pos = 0;
    }

    readByteCode() {
        return this.buffer.readUInt8(this.pos++);
    }

    readInt32() {
        var value = this.buffer.readUInt32LE(this.pos);
        this.pos += 4;
        return value;
    }

    readInt() {
        var len = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
        var value;
        switch (len) {
            case 1:
                value = this.buffer.readInt8(this.pos);
                break;
            case 2:
                value = this.buffer.readInt16LE(this.pos);
                break;
            case 4:
                value = this.buffer.readInt32LE(this.pos)
        }
        this.pos += len;
        return value;
    }

    readString(encoding?: BufferEncoding): string {
        var len = this.buffer.readUInt16LE(this.pos);
        var str;

        this.pos += 2;
        if (len <= 0)
            return '';

        str = this.buffer.toString(encoding, this.pos, this.pos + len);
        this.pos += len;
        return str;
    }

    readSegment(): Buffer {
        var ret: Buffer | undefined, tmp: Buffer;
        var len = this.buffer.readUInt16LE(this.pos);

        this.pos += 2;

        while (len > 0) {

            if (ret) {
                tmp = ret;
                ret = Buffer.alloc(tmp.length + len);
                tmp.copy(ret);
                this.buffer.copy(ret, tmp.length, this.pos, this.pos + len);
            } else {
                ret = Buffer.alloc(len);
                this.buffer.copy(ret, 0, this.pos, this.pos + len);
            }

            this.pos += len;

            if (this.pos === this.buffer.length)
                break;

            len = this.buffer.readUInt16LE(this.pos);
            this.pos += 2;
        }

        return ret ? ret : Buffer.alloc(0);
    }
}

/***************************************
 *
 *   XDR Writer
 *
 ***************************************/

export class XdrWriter {
    buffer: Buffer;
    pos: number;

    constructor(size?: number) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
    }

    ensure(len: number): void {
        var newlen = this.buffer.length;

        while (newlen < this.pos + len)
            newlen *= 2

        if (this.buffer.length >= newlen)
            return;

        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        this.buffer = b;
    }

    addInt(value: number): void {
        this.ensure(4);
        this.buffer.writeInt32BE(value, this.pos);
        this.pos += 4;
    }

    addInt64(value: number | bigint): void {
        this.ensure(8);
        // Note: for numbers, precision is limited to Number.MAX_SAFE_INTEGER
        // (±2^53-1); values outside this range lose precision, which matches
        // the previous Long.fromNumber() behaviour. BigInts keep full precision.
        this.buffer.writeBigInt64BE(typeof value === 'bigint' ? value : BigInt(Math.trunc(value)), this.pos);
        this.pos += 8;
    }

    addInt128(value: number | bigint | string): void {
        this.ensure(16);

        const bigValue = BigInt(value);

        const high = bigValue >> BigInt(64);
        const low = bigValue & BigInt("0xFFFFFFFFFFFFFFFF");

        this.buffer.writeBigUInt64BE(high, this.pos);
        this.pos += 8;
        this.buffer.writeBigUInt64BE(low, this.pos);
        this.pos += 8;
    }

    addDecFloat16(value: number | string | bigint): void {
        // DECFLOAT(16) - IEEE 754 Decimal64 - 8 bytes
        // Full IEEE 754-2008 Decimal64 implementation
        this.ensure(8);
        
        const encoded = encodeDecimal64(value);
        encoded.copy(this.buffer, this.pos, 0, 8);
        this.pos += 8;
    }

    addDecFloat34(value: number | string | bigint): void {
        // DECFLOAT(34) - IEEE 754 Decimal128 - 16 bytes
        // Full IEEE 754-2008 Decimal128 implementation
        this.ensure(16);
        
        const encoded = encodeDecimal128(value);
        encoded.copy(this.buffer, this.pos, 0, 16);
        this.pos += 16;
    }

    addUInt(value: number): void {
        this.ensure(4);
        this.buffer.writeUInt32BE(value, this.pos);
        this.pos += 4;
    }

    addString(s: string, encoding: BufferEncoding): void {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(len, this.pos);
        this.pos += 4;
        this.buffer.write(s, this.pos, len, encoding);
        this.buffer.fill(0, this.pos + len, this.pos + alen);
        this.pos += alen;
    }

    addText(s: string, encoding: BufferEncoding): void {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen);
        this.buffer.write(s, this.pos, len, encoding);
        this.buffer.fill(0, this.pos + len, this.pos + alen);
        this.pos += alen;
    }

    addParamBuffer(b: Buffer): void {
        var len = b.length;
        var alen = align(len);
        this.ensure(alen);
        b.copy(this.buffer, this.pos);
        this.buffer.fill(0, this.pos + len, this.pos + alen);
        this.pos += alen;
    }


    addBlr(blr: BlrWriter): void {
        var alen = align(blr.pos);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(blr.pos, this.pos);
        this.pos += 4;
        blr.buffer.copy(this.buffer, this.pos, 0, blr.pos);
        this.buffer.fill(0, this.pos + blr.pos, this.pos + alen);
        this.pos += alen;
    }

    getData(): Buffer {
        return this.buffer.slice(0, this.pos);
    }

    addDouble(value: number): void {
        this.ensure(8);
        this.buffer.writeDoubleBE(value, this.pos);
        this.pos += 8;
    }

    addFloat(value: number): void {
        this.ensure(4);
        this.buffer.writeFloatBE(value, this.pos);
        this.pos += 4;
    }

    addQuad(quad: { low: number; high: number }): void {
        this.ensure(8);
        var b = this.buffer;
        b.writeInt32BE(quad.high, this.pos);
        this.pos += 4;
        b.writeInt32BE(quad.low, this.pos);
        this.pos += 4;
    }

    addBuffer(buffer: Buffer): void {
        this.ensure(buffer.length);
        buffer.copy(this.buffer, this.pos, 0, buffer.length);
        this.pos += buffer.length;
    }

    addAlignment(len: number): void {
        var alen = (4 - len) & 3;

        this.ensure(alen);
        this.buffer.write('ffffff', this.pos, alen, 'hex');
        this.pos += alen;
    }
}

/***************************************
 *
 *   XDR Reader
 *
 ***************************************/

export class XdrReader {
    buffer: Buffer;
    pos: number;

    // Row-decode scratch state used by decodeResponse (connection.ts) while
    // decoding op_fetch_response / op_sql_response. Only meaningful within a
    // single decode call: incomplete packets are re-decoded from scratch on
    // a fresh XdrReader, and decodeResponse clears these at branch entry so
    // nothing leaks between packets sharing a data event (issue #341).
    /** opcode carried over for a resumed decode (vestigial, see connection.ts) */
    r?: number | null;
    /** partial fetch-op flag (vestigial) */
    fop?: boolean;
    /** fetch status of the current row batch (100 = end of cursor) */
    fstatus?: number;
    /** rows remaining in the current packet */
    fcount?: number;
    /** column index the row decode stopped at */
    fcolumn?: number;
    /** row currently being decoded (object or array) */
    frow?: any;
    /** rows decoded so far in this call */
    frows?: any[];
    /** cached object-row keys (column aliases, qualified when nestTables is set) */
    fcols?: string[];
    /** cached per-column table keys when nestTables === true */
    ftables?: string[];

    constructor(buffer: Buffer) {
        this.buffer = buffer;
        this.pos = 0;
    }

    readInt() {
        var r = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        return r;
    }

    readUInt() {
        var r = this.buffer.readUInt32BE(this.pos);
        this.pos += 4;
        return r;
    }

    readInt64() {
        // Note: precision is limited to Number.MAX_SAFE_INTEGER (±2^53-1).
        // Values outside this range lose precision, which matches the previous
        // Long(low, high).toNumber() behaviour.
        const result = Number(this.buffer.readBigInt64BE(this.pos));
        this.pos += 8;
        return result;
    }

    readInt128() {
        var high = this.buffer.readBigUInt64BE(this.pos)
        this.pos += 8

        var low = this.buffer.readBigUInt64BE(this.pos)
        this.pos += 8

        return (BigInt(high) << BigInt(64)) + BigInt(low)
    }

    readDecFloat16() {
        // DECFLOAT(16) - IEEE 754 Decimal64 - 8 bytes
        // Full IEEE 754-2008 Decimal64 implementation
        const buf = this.buffer.slice(this.pos, this.pos + 8);
        this.pos += 8;
        
        return decodeDecimal64(buf);
    }

    readDecFloat34() {
        // DECFLOAT(34) - IEEE 754 Decimal128 - 16 bytes
        // Full IEEE 754-2008 Decimal128 implementation
        const buf = this.buffer.slice(this.pos, this.pos + 16);
        this.pos += 16;
        
        return decodeDecimal128(buf);
    }

    readShort() {
        var r = this.buffer.readInt16BE(this.pos);
        this.pos += 2;
        return r;
    }

    readQuad() {
        var b = this.buffer;
        var high = b.readInt32BE(this.pos);
        this.pos += 4;
        var low = b.readInt32BE(this.pos);
        this.pos += 4;
        return {low: low, high: high}
    }

    readFloat() {
        var r = this.buffer.readFloatBE(this.pos);
        this.pos += 4;
        return r;
    }

    readDouble() {
        var r = this.buffer.readDoubleBE(this.pos);
        this.pos += 8;
        return r;
    }

    readArray() {
        var len = this.readInt();
        if (!len)
            return;
        // Firebird 2.5 sign-extends XDR opaque lengths above 32767: a
        // 32768-byte array arrives as length 0xFFFF8000. A negative length
        // is never valid, so recover the real length from the low 16 bits
        // instead of corrupting the read position (issue #312 — hang when
        // preparing a statement with very many parameters on FB 2.5).
        if (len < 0)
            len &= 0xFFFF;
        var r = this.buffer.slice(this.pos, this.pos + len);
        this.pos += align(len);
        return r;
    }

    readBuffer(len?: number, toAlign = true): Buffer | undefined {
        if (!arguments.length) {
            len = this.readInt();
        }

        if (len !== null && len !== undefined) {

            if (len <= 0){
                return Buffer.alloc(0);
            }

            var r = this.buffer.slice(this.pos, this.pos + len);
            this.pos += toAlign ? align(len) : len;
            return r;
        }
    }

    readString(encoding: BufferEncoding): string {
        var len = this.readInt();
        return this.readText(len, encoding);
    }

    readText(len: number, encoding: BufferEncoding): string {
        if (len <= 0)
            return '';

        var r = this.buffer.toString(encoding, this.pos, this.pos + len);
        this.pos += align(len);
        return r;
    }
}

/***************************************
 *
 *   BitSet
 *
 ***************************************/
var WORD_LOG = 5;
var BUFFER_BITS = 8;
var BIT_ON = 1;
var BIT_OFF = 0;

export class BitSet {
    data: number[];

    constructor(buffer?: Buffer) {
        this.data = [];

        if (buffer) {
            this.scale(buffer.length * BUFFER_BITS);

            for (var i = 0; i < buffer.length; i++) {
                var n = buffer[i];

                for (var j = 0; j < BUFFER_BITS; j++) {
                    var k = i * BUFFER_BITS + j;
                    this.data[k >>> WORD_LOG] |= (n >> j & BIT_ON) << k;
                }
            }
        }
    }

    scale(index: number): void {
        var l = index >>> WORD_LOG;

        for (var i = this.data.length; l >= i; l--) {
            this.data.push(BIT_OFF);
        }
    }

    set(index: number, value?: boolean | number): void {
        let pos = index >>> 3;

        for (let i = this.data.length; pos >= i; pos--) {
            this.data.push(BIT_OFF);
        }

        pos = index >>> 3;

        if (value === undefined || value) {
            this.data[pos] |= (1 << (index % BUFFER_BITS));
        } else {
            this.data[pos] &= ~(1 << (index % BUFFER_BITS));
        }
    }

    get(index: number): number {
        var n = index >>> WORD_LOG;

        if (n >= this.data.length) {
            return BIT_OFF;
        }

        return (this.data[n] >>> index) & BIT_ON;
    }

    toBuffer(): Buffer {
        return Buffer.from(this.data);
    }
}
