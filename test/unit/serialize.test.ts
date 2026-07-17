import { describe, it, expect } from 'vitest';
import { BlrWriter, BlrReader, XdrWriter, XdrReader, BitSet } from '../../src/wire/serialize';

describe('BlrWriter', () => {
    it('writes bytes, words and int32s at the right positions', () => {
        const w = new BlrWriter(4);
        w.addByte(0x01);
        w.addWord(0x0203);      // little-endian
        w.addInt32(0x04050607); // little-endian
        expect(w.pos).toBe(7);
        expect(w.buffer.slice(0, 7).toString('hex')).toBe('01030207060504');
    });

    it('grows its buffer on demand', () => {
        const w = new BlrWriter(2);
        for (let i = 0; i < 100; i++) w.addByte(i & 0xff);
        expect(w.pos).toBe(100);
        expect(w.buffer.length).toBeGreaterThanOrEqual(100);
        expect(w.buffer[99]).toBe(99);
    });

    it('addNumeric uses 1 byte for small values and int32 for large ones', () => {
        const small = new BlrWriter();
        small.addNumeric(0x39, 200);
        expect(small.buffer.slice(0, small.pos).toString('hex')).toBe('3901c8');

        const large = new BlrWriter();
        large.addNumeric(0x39, 0x12345);
        expect(large.buffer.slice(0, large.pos).toString('hex')).toBe('390400012345');
    });

    it('addString writes tag, length and payload', () => {
        const w = new BlrWriter();
        w.addString(0x1c, 'AB', 'utf8');
        expect(w.buffer.slice(0, w.pos).toString('hex')).toBe('1c024142');
    });

    it('addString rejects strings longer than 255 bytes', () => {
        const w = new BlrWriter();
        expect(() => w.addString(1, 'x'.repeat(256), 'utf8')).toThrow(/too big/);
    });

    it('addString2 supports two-byte lengths', () => {
        const w = new BlrWriter();
        const s = 'y'.repeat(300);
        w.addString2(0x1c, s, 'utf8');
        expect(w.buffer[0]).toBe(0x1c);
        expect(w.buffer.readUInt16LE(1)).toBe(300);
        expect(w.pos).toBe(3 + 300);
    });

    it('addMultiblockPart splits long payloads into 254-byte chunks', () => {
        const w = new BlrWriter();
        const s = 'z'.repeat(300);
        w.addMultiblockPart(0x09, s, 'utf8');
        // chunk 1 header: tag, len+1, step
        expect(w.buffer[0]).toBe(0x09);
        expect(w.buffer[1]).toBe(255);  // 254 + 1
        expect(w.buffer[2]).toBe(0);    // step 0
        // chunk 2 header directly after 254 payload bytes
        const off = 3 + 254;
        expect(w.buffer[off]).toBe(0x09);
        expect(w.buffer[off + 1]).toBe(300 - 254 + 1);
        expect(w.buffer[off + 2]).toBe(1); // step 1
        expect(w.pos).toBe(3 + 254 + 3 + 46);
    });
});

describe('BlrReader', () => {
    it('reads byte codes, ints and strings', () => {
        const buf = Buffer.alloc(16);
        buf.writeUInt8(7, 0);            // byte code
        buf.writeUInt16LE(4, 1);         // int length prefix
        buf.writeInt32LE(-123456, 3);    // int value
        buf.writeUInt16LE(2, 7);         // string length
        buf.write('hi', 9);
        const r = new BlrReader(buf);
        expect(r.readByteCode()).toBe(7);
        expect(r.readInt()).toBe(-123456);
        expect(r.readString('utf8')).toBe('hi');
    });

    it('readString with no data returns an empty string', () => {
        const buf = Buffer.alloc(2); // length 0
        expect(new BlrReader(buf).readString('utf8')).toBe('');
    });

    it('readSegment concatenates chained segments', () => {
        const seg1 = Buffer.from('hello ');
        const seg2 = Buffer.from('world');
        const buf = Buffer.alloc(2 + seg1.length + 2 + seg2.length);
        let pos = 0;
        buf.writeUInt16LE(seg1.length, pos); pos += 2;
        seg1.copy(buf, pos); pos += seg1.length;
        buf.writeUInt16LE(seg2.length, pos); pos += 2;
        seg2.copy(buf, pos);
        expect(new BlrReader(buf).readSegment().toString()).toBe('hello world');
    });
});

describe('XdrWriter / XdrReader round-trips', () => {
    it('int32 (big-endian)', () => {
        const w = new XdrWriter();
        w.addInt(-42);
        w.addUInt(0xdeadbeef);
        const r = new XdrReader(w.getData());
        expect(r.readInt()).toBe(-42);
        expect(r.readUInt()).toBe(0xdeadbeef);
    });

    it('int64', () => {
        const w = new XdrWriter();
        w.addInt64(Number.MAX_SAFE_INTEGER);
        w.addInt64(-1);
        const r = new XdrReader(w.getData());
        expect(r.readInt64()).toBe(Number.MAX_SAFE_INTEGER);
        expect(r.readInt64()).toBe(-1);
    });

    it('int128 preserves bigint precision', () => {
        const big = 123456789012345678901234567890n;
        const w = new XdrWriter();
        w.addInt128(big);
        expect(new XdrReader(w.getData()).readInt128()).toBe(big);
    });

    it('readArray recovers Firebird 2.5 sign-extended lengths (issue #312)', () => {
        // FB 2.5 encodes opaque lengths > 32767 sign-extended: 32768 bytes
        // arrive with length 0xFFFF8000. readArray must recover the real
        // length from the low 16 bits instead of corrupting the position.
        const payload = Buffer.alloc(32768, 0xab);
        const buf = Buffer.alloc(4 + payload.length);
        buf.writeInt32BE(-32768, 0); // 0xFFFF8000
        payload.copy(buf, 4);

        const r = new XdrReader(buf);
        const arr = r.readArray()!;
        expect(arr.length).toBe(32768);
        expect(arr[0]).toBe(0xab);
        expect(arr[arr.length - 1]).toBe(0xab);
        expect(r.pos).toBe(4 + 32768); // already 4-aligned

        // sane lengths are unaffected
        const ok = Buffer.alloc(4 + 4);
        ok.writeInt32BE(3, 0);
        ok.write('abc', 4);
        expect(new XdrReader(ok).readArray()!.toString()).toBe('abc');
    });

    it('strings are 4-byte aligned with zero padding', () => {
        const w = new XdrWriter();
        w.addString('abcde', 'utf8'); // 5 bytes -> aligned to 8
        expect(w.pos).toBe(4 + 8);
        const r = new XdrReader(w.getData());
        expect(r.readString('utf8')).toBe('abcde');
        expect(r.pos).toBe(12);
    });

    it('double and quad', () => {
        const w = new XdrWriter();
        w.addDouble(3.14159);
        w.addQuad({ high: 7, low: 9 });
        const r = new XdrReader(w.getData());
        expect(r.readDouble()).toBeCloseTo(3.14159, 10);
        expect(r.readQuad()).toEqual({ low: 9, high: 7 });
    });

    it('DECFLOAT16/34 round-trip through XDR', () => {
        const w = new XdrWriter();
        w.addDecFloat16('123.45');
        w.addDecFloat34('-9876.54321');
        const r = new XdrReader(w.getData());
        expect(r.readDecFloat16()).toBe('123.45');
        expect(r.readDecFloat34()).toBe('-9876.54321');
    });

    it('readBuffer honours the length-prefix form and alignment', () => {
        const w = new XdrWriter();
        w.addInt(3);            // length prefix
        w.addText('xyz9', 'utf8'); // 'xyz' + 1 pad byte consumed as alignment
        const r = new XdrReader(w.getData());
        const buf = r.readBuffer();
        expect(buf!.toString()).toBe('xyz');
        expect(r.pos).toBe(8); // aligned
    });

    it('readText returns empty string for non-positive lengths', () => {
        const r = new XdrReader(Buffer.alloc(4));
        expect(r.readText(0, 'utf8')).toBe('');
        expect(r.readText(-1, 'utf8')).toBe('');
    });

    it('addAlignment pads to a 4-byte boundary with 0xff', () => {
        const w = new XdrWriter();
        w.addAlignment(5); // needs 3 bytes of padding
        expect(w.pos).toBe(3);
        expect(w.getData().toString('hex')).toBe('ffffff');
    });
});

describe('BitSet', () => {
    it('sets and gets individual bits', () => {
        const b = new BitSet();
        b.set(0);
        b.set(3, true);
        b.set(5, false);
        expect(b.get(0)).toBe(1);
        expect(b.get(3)).toBe(1);
        expect(b.get(5)).toBe(0);
        expect(b.get(100)).toBe(0); // out of range reads as 0
    });

    it('clears bits when value is false', () => {
        const b = new BitSet();
        b.set(2);
        expect(b.get(2)).toBe(1);
        b.set(2, false);
        expect(b.get(2)).toBe(0);
    });

    it('serializes to a buffer (null-indicator bitmap)', () => {
        const b = new BitSet();
        b.set(0);
        b.set(7);
        expect(b.toBuffer()[0]).toBe(0b10000001);
    });

    it('loads bits from a buffer', () => {
        const b = new BitSet(Buffer.from([0b00000101]));
        expect(b.get(0)).toBe(1);
        expect(b.get(1)).toBe(0);
        expect(b.get(2)).toBe(1);
    });
});
