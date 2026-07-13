import { describe, it, expect } from 'vitest';
import { msgNumber, getCode, getFacility, getClass } from '../../src/messages';

describe('messages code helpers', () => {
    // 335544321 (arith_except) = 0x14000001: facility 0, code 1, class 1
    it('getCode extracts the low 16 bits', () => {
        expect(getCode(335544321)).toBe(1);
        expect(getCode(0x1400FFFF)).toBe(0xFFFF);
    });

    it('getFacility extracts bits 16-23', () => {
        expect(getFacility(335544321)).toBe(0);
        expect(getFacility(0x14030001)).toBe(3);
    });

    it('getClass extracts the top nibble', () => {
        expect(getClass(335544321)).toBe(1);
        expect(getClass(0x74000001 | 0)).toBe(7);
    });

    it('msgNumber combines facility and code', () => {
        expect(msgNumber(0, 1)).toBe(1);
        expect(msgNumber(3, 17)).toBe(30017);
        expect(msgNumber(getFacility(335544321), getCode(335544321))).toBe(1);
    });
});
