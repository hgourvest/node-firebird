import { describe, it, expect } from 'vitest';
import {
    encodeDecimal64,
    decodeDecimal64,
    encodeDecimal128,
    decodeDecimal128,
} from '../../src/ieee754-decimal';

// Hex vectors generated with the original pre-TypeScript
// lib/ieee754-decimal.js implementation.
describe('Decimal64 (DECFLOAT 16)', () => {
    it('matches legacy encoding vectors', () => {
        expect(encodeDecimal64('123.45').toString('hex')).toBe('2230000000003039');
        expect(encodeDecimal64('-0.001').toString('hex')).toBe('a22c000000000001');
        expect(encodeDecimal64(0).toString('hex')).toBe('0000000000000000');
    });

    it('round-trips decimal strings', () => {
        for (const v of ['999.99', '0.5', '-12345.6789', '1', '-1', '9999999999999999']) {
            expect(decodeDecimal64(encodeDecimal64(v))).toBe(v);
        }
    });

    it('round-trips plain numbers', () => {
        expect(decodeDecimal64(encodeDecimal64(42))).toBe('42');
        expect(decodeDecimal64(encodeDecimal64(-7.25))).toBe('-7.25');
    });

    it('encodes null/undefined as an all-zero buffer', () => {
        expect(encodeDecimal64(null).equals(Buffer.alloc(8))).toBe(true);
        expect(encodeDecimal64(undefined).equals(Buffer.alloc(8))).toBe(true);
    });

    it('handles NaN and infinities', () => {
        expect(Number.isNaN(decodeDecimal64(encodeDecimal64(NaN)))).toBe(true);
        expect(decodeDecimal64(encodeDecimal64(Infinity))).toBe(Infinity);
        expect(decodeDecimal64(encodeDecimal64(-Infinity))).toBe(-Infinity);
    });

    it('rejects buffers that are not 8 bytes', () => {
        expect(() => decodeDecimal64(Buffer.alloc(7))).toThrow(/8 bytes/);
        expect(() => decodeDecimal64(Buffer.alloc(16))).toThrow(/8 bytes/);
    });
});

describe('Decimal128 (DECFLOAT 34)', () => {
    it('matches legacy encoding vectors', () => {
        expect(encodeDecimal128('12345678901234567890.123').toString('hex'))
            .toBe('220740000000029d42b64e76714244cb');
    });

    it('round-trips high-precision values', () => {
        for (const v of [
            '-42',
            '0.1',
            '9999999999999999999999999999999999',
            '-0.000000000000000000000000000000001',
            '12345678901234567890.123',
        ]) {
            expect(decodeDecimal128(encodeDecimal128(v))).toBe(v);
        }
    });

    it('encodes null/undefined as an all-zero buffer', () => {
        expect(encodeDecimal128(null).equals(Buffer.alloc(16))).toBe(true);
    });

    it('handles NaN and infinities', () => {
        expect(Number.isNaN(decodeDecimal128(encodeDecimal128(NaN)))).toBe(true);
        expect(decodeDecimal128(encodeDecimal128(Infinity))).toBe(Infinity);
        expect(decodeDecimal128(encodeDecimal128(-Infinity))).toBe(-Infinity);
    });

    it('rejects buffers that are not 16 bytes', () => {
        expect(() => decodeDecimal128(Buffer.alloc(8))).toThrow(/16 bytes/);
    });
});
