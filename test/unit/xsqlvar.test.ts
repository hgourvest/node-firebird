import { describe, it, expect } from 'vitest';
import { XdrWriter, XdrReader, BlrWriter } from '../../src/wire/serialize';
import * as Xsql from '../../src/wire/xsqlvar';
import Const from '../../src/wire/const';

function reader(write: (w: XdrWriter) => void): XdrReader {
    const w = new XdrWriter();
    write(w);
    return new XdrReader(w.getData());
}

function signedInt128Reader(value: bigint): XdrReader {
    const buffer = Buffer.alloc(16);
    buffer.writeBigInt64BE(value >> 64n, 0);
    buffer.writeBigUInt64BE(value & 0xFFFFFFFFFFFFFFFFn, 8);
    return new XdrReader(buffer);
}

describe('SQLVar decoding (protocol 13+, lowerV13=false)', () => {
    it('SQLVarInt applies negative scale as a divisor', () => {
        const v = new Xsql.SQLVarInt();
        v.scale = -2;
        expect(v.decode(reader(w => w.addInt(12345)), false)).toBe(123.45);
    });

    it('SQLVarInt without scale returns the raw integer', () => {
        const v = new Xsql.SQLVarInt();
        v.scale = 0;
        expect(v.decode(reader(w => w.addInt(-7)), false)).toBe(-7);
    });

    it('SQLVarInt64 applies scale', () => {
        const v = new Xsql.SQLVarInt64();
        v.scale = -3;
        expect(v.decode(reader(w => w.addInt64(1234567)), false)).toBe(1234.567);
    });

    it('legacy mode remains the default for unsafe INT64 values', () => {
        const v = new Xsql.SQLVarInt64();
        v.scale = -4;
        expect(v.decode(reader(w => w.addInt64(9007199254740993n)), false))
            .toBe(900719925474.0992);
        expect(v.decode(reader(w => w.addInt64(9007199254740993n)), false,
            { numericMode: 'legacy' })).toBe(900719925474.0992);
    });

    it.each([
        [-9007199254740992n, 0, '-9007199254740992'],
        [-9007199254740991n, 0, -9007199254740991],
        [9007199254740991n, 0, 9007199254740991],
        [9007199254740992n, 0, '9007199254740992'],
        [-9223372036854775808n, -4, '-922337203685477.5808'],
        [9223372036854775807n, -4, '922337203685477.5807'],
        [9007199254740992n, -2, '90071992547409.92'],
        [-9007199254741000n, -4, '-900719925474.1000'],
    ])('safe mode preserves INT64 coefficient %s at scale %s', (coefficient, scale, expected) => {
        const v = new Xsql.SQLVarInt64();
        v.scale = scale;
        expect(v.decode(reader(w => w.addInt64(coefficient)), false, { numericMode: 'safe' }))
            .toBe(expected);
    });

    it('string mode returns safe INT64 values as scale-preserving strings', () => {
        const v = new Xsql.SQLVarInt64();
        v.scale = -4;
        expect(v.decode(reader(w => w.addInt64(420000n)), false, { numericMode: 'string' }))
            .toBe('42.0000');
        expect(v.decode(reader(w => w.addInt64(0n)), false, { numericMode: 'string' }))
            .toBe('0.0000');

        v.scale = 0;
        expect(v.decode(reader(w => w.addInt64(42n)), false, { numericMode: 'string' }))
            .toBe('42');
    });

    it('SQLVarInt128 returns a decimal string for values beyond MAX_SAFE_INTEGER', () => {
        const v = new Xsql.SQLVarInt128();
        v.scale = -2;
        const big = 123456789012345678901n; // > 2^53
        expect(v.decode(reader(w => w.addInt128(big)), false)).toBe('1234567890123456789.01');
    });

    it('SQLVarInt128 returns a number for small values', () => {
        const v = new Xsql.SQLVarInt128();
        v.scale = -2;
        expect(v.decode(reader(w => w.addInt128(12345n)), false)).toBe(123.45);
    });

    it('safe mode formats signed INT128 values exactly', () => {
        const v = new Xsql.SQLVarInt128();
        v.scale = -4;
        expect(v.decode(signedInt128Reader(-123456789012345678901n), false,
            { numericMode: 'safe' })).toBe('-12345678901234567.8901');

        v.scale = 0;
        expect(v.decode(signedInt128Reader(-(1n << 127n)), false,
            { numericMode: 'safe' })).toBe('-170141183460469231731687303715884105728');
        expect(v.decode(reader(w => w.addInt128((1n << 127n) - 1n)), false,
            { numericMode: 'safe' })).toBe('170141183460469231731687303715884105727');
    });

    it('string mode returns safe INT128 values as strings', () => {
        const v = new Xsql.SQLVarInt128();
        v.scale = -4;
        expect(v.decode(signedInt128Reader(-42n), false, { numericMode: 'string' }))
            .toBe('-0.0042');
    });

    it('numeric modes preserve null indicators', () => {
        const v = new Xsql.SQLVarInt64();
        v.scale = 0;
        expect(v.decode(reader(w => { w.addInt64(9223372036854775807n); w.addInt(1); }), true,
            { numericMode: 'safe' })).toBeNull();
    });

    it('SQLVarBoolean decodes to true/false', () => {
        const v = new Xsql.SQLVarBoolean();
        expect(v.decode(reader(w => w.addInt(1)), false)).toBe(true);
        expect(v.decode(reader(w => w.addInt(0)), false)).toBe(false);
    });

    it('SQLVarDouble and SQLVarFloat decode IEEE values', () => {
        const d = new Xsql.SQLVarDouble();
        expect(d.decode(reader(w => w.addDouble(2.5)), false)).toBe(2.5);
    });

    it('SQLVarText decodes CHAR(n) respecting UTF8 byte width', () => {
        const v = new Xsql.SQLVarText();
        v.subType = 0;
        v.length = 20; // CHAR(5) in UTF8 = 20 bytes on the wire
        const r = reader(w => w.addText('hello'.padEnd(20, ' '), 'utf8'));
        expect(v.decode(r, false, {})).toBe('hello');
    });

    it('SQLVarString decodes VARCHAR payloads', () => {
        const v = new Xsql.SQLVarString();
        v.subType = 0;
        const r = reader(w => w.addString('varying', 'utf8'));
        expect(v.decode(r, false, {})).toBe('varying');
    });

    it('legacy protocol (lowerV13=true) uses the trailing null flag', () => {
        const v = new Xsql.SQLVarInt();
        v.scale = 0;
        // value followed by null indicator = 1 -> NULL
        expect(v.decode(reader(w => { w.addInt(55); w.addInt(1); }), true)).toBeNull();
        // null indicator = 0 -> value
        expect(v.decode(reader(w => { w.addInt(55); w.addInt(0); }), true)).toBe(55);
    });

    it('SQLVarDate/SQLVarTimeStamp round-trip through SQLParamDate', () => {
        const date = new Date(2024, 5, 15, 12, 30, 45, 500);
        const param = new Xsql.SQLParamDate(date);
        const r = reader(w => param.encode(w));
        const v = new Xsql.SQLVarTimeStamp();
        const decoded = v.decode(r, false) as Date;
        expect(decoded).toBeInstanceOf(Date);
        expect(decoded.getTime()).toBe(date.getTime());
    });
});

describe('SQLParam encoding', () => {
    it('SQLParamInt writes the value, or a null marker', () => {
        const r1 = reader(w => new Xsql.SQLParamInt(99).encode(w));
        expect(r1.readInt()).toBe(99);

        const r2 = reader(w => new Xsql.SQLParamInt(null).encode(w));
        expect(r2.readInt()).toBe(0); // placeholder
        expect(r2.readInt()).toBe(1); // null indicator
    });

    it('SQLParamInt64 and SQLParamInt128 encode without precision loss', () => {
        const r = reader(w => new Xsql.SQLParamInt64(Number.MAX_SAFE_INTEGER).encode(w));
        expect(r.readInt64()).toBe(Number.MAX_SAFE_INTEGER);

        const big = 170141183460469231731687303715884105n;
        const r2 = reader(w => new Xsql.SQLParamInt128(big).encode(w));
        expect(r2.readInt128()).toBe(big);
    });

    it('SQLParamBool encodes 1/0', () => {
        expect(reader(w => new Xsql.SQLParamBool(true).encode(w)).readInt()).toBe(1);
        expect(reader(w => new Xsql.SQLParamBool(false).encode(w)).readInt()).toBe(0);
    });

    it('SQLParamString writes aligned text', () => {
        const r = reader(w => new Xsql.SQLParamString('abc').encode(w));
        expect(r.readText(3, 'utf8')).toBe('abc');
    });

    it('SQLParamQuad encodes blob ids', () => {
        const r = reader(w => new Xsql.SQLParamQuad({ high: 1, low: 2 }).encode(w));
        expect(r.readInt()).toBe(1);
        expect(r.readInt()).toBe(2);
    });
});

describe('SQLVar/SQLParam BLR generation', () => {
    function blrOf(item: { calcBlr(blr: BlrWriter): void }): number[] {
        const blr = new BlrWriter();
        item.calcBlr(blr);
        return Array.from(blr.buffer.slice(0, blr.pos));
    }

    it('emits the right BLR type codes', () => {
        const text = new Xsql.SQLVarText();
        text.length = 10;
        expect(blrOf(text)[0]).toBe(Const.blr_text);

        const varying = new Xsql.SQLVarString();
        varying.length = 10;
        expect(blrOf(varying)[0]).toBe(Const.blr_varying);

        const int = new Xsql.SQLVarInt();
        int.scale = 0;
        expect(blrOf(int)[0]).toBe(Const.blr_long);

        expect(blrOf(new Xsql.SQLParamInt64(1))[0]).toBe(Const.blr_int64);
        expect(blrOf(new Xsql.SQLParamInt128(1n))[0]).toBe(Const.blr_int128);
        expect(blrOf(new Xsql.SQLParamDate(new Date()))[0]).toBe(Const.blr_timestamp);
        expect(blrOf(new Xsql.SQLParamBool(true))[0]).toBe(Const.blr_short);
        expect(blrOf(new Xsql.SQLParamDouble(1.5))[0]).toBe(Const.blr_double);
    });

    it('SQLParamString sizes the BLR by byte length', () => {
        const p = new Xsql.SQLParamString('héllo'); // 6 bytes in UTF-8
        const blr = new BlrWriter();
        p.calcBlr(blr);
        expect(blr.buffer[0]).toBe(Const.blr_text);
        expect(blr.buffer.readUInt16LE(1)).toBe(6);
    });
});
