var Long = require('long');

function align(n) {
    return (n + 3) & ~3;
}

/***************************************
 *
 *   BLR Writer
 *
 ***************************************/

const
    MAX_STRING_SIZE = 255;

class BlrWriter {
    constructor(size) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
    }

    ensure(len) {
        var newlen = this.buffer.length;

        while (newlen < this.pos + len)
            newlen *= 2

        if (this.buffer.length >= newlen)
            return;

        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        delete(this.buffer);
        this.buffer = b;
    }

    addByte(b) {
        this.ensure(1);
        this.buffer.writeUInt8(b, this.pos);
        this.pos++;
    }

    addShort(b) {
        this.ensure(1);
        this.buffer.writeInt8(b, this.pos);
        this.pos++;
    }

    addSmall(b) {
        this.ensure(2);
        this.buffer.writeInt16LE(b, this.pos);
        this.pos += 2;
    }

    addWord(b) {
        this.ensure(2);
        this.buffer.writeUInt16LE(b, this.pos);
        this.pos += 2;
    }

    addInt32(b) {
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
    }

    addByteInt32(c, b) {
        this.addByte(c);
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
    }

    addNumeric(c, v) {
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

    addBytes(b) {
        this.ensure(b.length);
        for (var i = 0, length = b.length; i < length; i++) {
            this.buffer.writeUInt8(b[i], this.pos);
            this.pos++;
        }
    }

    addString(c, s, encoding) {
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

    addBuffer(b) {
        this.addWord(b.length);
        this.ensure(b.length);
        b.copy(this.buffer, this.pos);
        this.pos += b.length;
    }

    addString2(c, s, encoding) {
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

    addMultiblockPart(c, s, encoding) {
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

class BlrReader {
    constructor(buffer) {
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

    readString(encoding) {
        var len = this.buffer.readUInt16LE(this.pos);
        var str;

        this.pos += 2;
        if (len <= 0)
            return '';

        str = this.buffer.toString(encoding, this.pos, this.pos + len);
        this.pos += len;
        return str;
    }

    readSegment() {
        var ret, tmp;
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

class XdrWriter {
    constructor(size) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
    }

    ensure(len) {
        var newlen = this.buffer.length;

        while (newlen < this.pos + len)
            newlen *= 2

        if (this.buffer.length >= newlen)
            return;

        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        delete(this.buffer);
        this.buffer = b;
    }

    addInt(value) {
        this.ensure(4);
        this.buffer.writeInt32BE(value, this.pos);
        this.pos += 4;
    }

    addInt64(value) {
        this.ensure(8);
        var l = Long.fromNumber(value);
        this.buffer.writeInt32BE(l.high, this.pos);
        this.pos += 4;
        this.buffer.writeInt32BE(l.low, this.pos);
        this.pos += 4;
    }

    addInt128(value) {
        this.ensure(16);

        const bigValue = BigInt(value);

        const high = bigValue >> BigInt(64);
        const low = bigValue & BigInt("0xFFFFFFFFFFFFFFFF");

        this.buffer.writeBigUInt64BE(high, this.pos);
        this.pos += 8;
        this.buffer.writeBigUInt64BE(low, this.pos);
        this.pos += 8;
    }

    addDecFloat16(value) {
        // DECFLOAT(16) - IEEE 754 Decimal64 - 8 bytes
        // WARNING: This is a SIMPLIFIED implementation for basic compatibility.
        // It does NOT implement proper IEEE 754 Decimal64 encoding.
        // For production use with DECFLOAT types, a proper IEEE 754 Decimal library is needed.
        // Consider using the 'decimal128' npm package or similar for full IEEE 754 support.
        this.ensure(8);
        
        if (Buffer.isBuffer(value)) {
            // If already encoded as buffer (from Firebird), write directly
            value.copy(this.buffer, this.pos, 0, 8);
            this.pos += 8;
        } else {
            // Simplified encoding: scale to integer and store as BigInt
            // This is NOT IEEE 754 Decimal64 format and will cause data corruption
            // TODO: Implement proper IEEE 754 Decimal64 encoding
            const bigValue = BigInt(Math.round(Number(value) * 1e16));
            this.buffer.writeBigInt64BE(bigValue, this.pos);
            this.pos += 8;
        }
    }

    addDecFloat34(value) {
        // DECFLOAT(34) - IEEE 754 Decimal128 - 16 bytes
        // WARNING: This is a SIMPLIFIED implementation for basic compatibility.
        // It does NOT implement proper IEEE 754 Decimal128 encoding.
        // For production use with DECFLOAT types, a proper IEEE 754 Decimal library is needed.
        // Consider using the 'decimal128' npm package or similar for full IEEE 754 support.
        this.ensure(16);
        
        if (Buffer.isBuffer(value)) {
            // If already encoded as buffer (from Firebird), write directly
            value.copy(this.buffer, this.pos, 0, 16);
            this.pos += 16;
        } else {
            // Simplified encoding: scale to integer and store as BigInt
            // This is NOT IEEE 754 Decimal128 format and will cause data corruption
            // TODO: Implement proper IEEE 754 Decimal128 encoding
            const bigValue = BigInt(Math.round(Number(value) * 1e34));
            const high = bigValue >> BigInt(64);
            const low = bigValue & BigInt("0xFFFFFFFFFFFFFFFF");
            this.buffer.writeBigInt64BE(high, this.pos);
            this.pos += 8;
            this.buffer.writeBigInt64BE(low, this.pos);
            this.pos += 8;
        }
    }

    addUInt(value) {
        this.ensure(4);
        this.buffer.writeUInt32BE(value, this.pos);
        this.pos += 4;
    }

    addString(s, encoding) {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(len, this.pos);
        this.pos += 4;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += alen;
    }

    addText(s, encoding) {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen);
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += alen;
    }

    addBlr(blr) {
        var alen = align(blr.pos);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(blr.pos, this.pos);
        this.pos += 4;
        blr.buffer.copy(this.buffer, this.pos);
        this.pos += alen;
    }

    getData() {
        return this.buffer.slice(0, this.pos);
    }

    addDouble(value) {
        this.ensure(8);
        this.buffer.writeDoubleBE(value, this.pos);
        this.pos += 8;
    }

    addQuad(quad) {
        this.ensure(8);
        var b = this.buffer;
        b.writeInt32BE(quad.high, this.pos);
        this.pos += 4;
        b.writeInt32BE(quad.low, this.pos);
        this.pos += 4;
    }

    addBuffer(buffer) {
        this.ensure(buffer.length);
        buffer.copy(this.buffer, this.pos, 0, buffer.length);
        this.pos += buffer.length;
    }

    addAlignment(len) {
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

class XdrReader {
    constructor(buffer) {
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
        var high = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        var low = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        return new Long(low, high).toNumber();
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
        // WARNING: This is a SIMPLIFIED implementation for basic compatibility.
        // It does NOT implement proper IEEE 754 Decimal64 decoding.
        // For production use with DECFLOAT types, a proper IEEE 754 Decimal library is needed.
        // Consider using the 'decimal128' npm package or similar for full IEEE 754 support.
        const buf = this.buffer.slice(this.pos, this.pos + 8);
        this.pos += 8;
        
        // Simplified decoding: read as BigInt and scale down
        // This is NOT IEEE 754 Decimal64 format and will return incorrect values
        // TODO: Implement proper IEEE 754 Decimal64 decoding
        try {
            const bigValue = this.buffer.readBigInt64BE(this.pos - 8);
            return Number(bigValue) / 1e16;
        } catch (e) {
            // Return buffer if conversion fails - allows application to handle it
            return buf;
        }
    }

    readDecFloat34() {
        // DECFLOAT(34) - IEEE 754 Decimal128 - 16 bytes
        // WARNING: This is a SIMPLIFIED implementation for basic compatibility.
        // It does NOT implement proper IEEE 754 Decimal128 decoding.
        // For production use with DECFLOAT types, a proper IEEE 754 Decimal library is needed.
        // Consider using the 'decimal128' npm package or similar for full IEEE 754 support.
        const buf = this.buffer.slice(this.pos, this.pos + 16);
        this.pos += 16;
        
        // Simplified decoding: read as 128-bit BigInt and scale down
        // This is NOT IEEE 754 Decimal128 format and will return incorrect values
        // TODO: Implement proper IEEE 754 Decimal128 decoding
        try {
            const high = this.buffer.readBigInt64BE(this.pos - 16);
            const low = this.buffer.readBigInt64BE(this.pos - 8);
            const bigValue = (BigInt(high) << BigInt(64)) + BigInt(low);
            // Return as string to preserve precision
            const numStr = bigValue.toString();
            if (numStr.length > 34) {
                const intPart = numStr.slice(0, -34);
                const decPart = numStr.slice(-34);
                return `${intPart}.${decPart}`;
            }
            return (Number(bigValue) / 1e34).toString();
        } catch (e) {
            // Return buffer if conversion fails
            return buf;
        }
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
        var r = this.buffer.slice(this.pos, this.pos + len);
        this.pos += align(len);
        return r;
    }

    readBuffer(len, toAlign = true) {
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

    readString(encoding) {
        var len = this.readInt();
        return this.readText(len, encoding);
    }

    readText(len, encoding) {
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

class BitSet {
    constructor(buffer) {
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

    scale(index) {
        var l = index >>> WORD_LOG;

        for (var i = this.data.length; l >= i; l--) {
            this.data.push(BIT_OFF);
        }
    }

    set(index, value) {
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

    get(index) {
        var n = index >>> WORD_LOG;

        if (n >= this.data.length) {
            return BIT_OFF;
        }

        return (this.data[n] >>> index) & BIT_ON;
    }

    toBuffer() {
        return Buffer.from(this.data);
    }
}

exports.BlrWriter = BlrWriter;
exports.BlrReader = BlrReader;
exports.XdrWriter = XdrWriter;
exports.XdrReader = XdrReader;
exports.BitSet = BitSet;
