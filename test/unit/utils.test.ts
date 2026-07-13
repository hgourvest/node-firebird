import { describe, it, expect } from 'vitest';
import { escape, parseDate, lookupMessages, noop } from '../../src/utils';
import Const from '../../src/wire/const';

describe('utils.escape', () => {
    it('escapes null and undefined as NULL', () => {
        expect(escape(null)).toBe('NULL');
        expect(escape(undefined)).toBe('NULL');
    });

    it('escapes booleans as true/false on protocol 13+', () => {
        expect(escape(true)).toBe('true');
        expect(escape(false)).toBe('false');
        expect(escape(true, Const.PROTOCOL_VERSION13)).toBe('true');
    });

    it('escapes booleans as 1/0 on legacy protocols', () => {
        expect(escape(true, Const.PROTOCOL_VERSION10)).toBe('1');
        expect(escape(false, Const.PROTOCOL_VERSION10)).toBe('0');
        expect(escape(true, Const.PROTOCOL_VERSION12)).toBe('1');
    });

    it('escapes numbers verbatim', () => {
        expect(escape(0)).toBe('0');
        expect(escape(123)).toBe('123');
        expect(escape(-1.5)).toBe('-1.5');
    });

    it('doubles single quotes in strings', () => {
        expect(escape("O'Reilly")).toBe("'O''Reilly'");
        expect(escape("''")).toBe("''''''");
    });

    it('escapes backslashes in strings', () => {
        expect(escape('a\\b')).toBe("'a\\\\b'");
    });

    it('formats Date values with zero padding and milliseconds', () => {
        const d = new Date(2024, 0, 5, 7, 8, 9, 12);
        expect(escape(d)).toBe("'2024-01-05 07:08:09.012'");
    });

    it('throws for non-primitive values', () => {
        expect(() => escape({})).toThrow('Escape supports only primitive values.');
        expect(() => escape([1, 2])).toThrow();
    });
});

describe('utils.parseDate', () => {
    it('parses ISO-ish yyyy-mm-dd hh:mm:ss', () => {
        const d = parseDate('2024-01-15 10:30:45');
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(10);
        expect(d.getMinutes()).toBe(30);
        expect(d.getSeconds()).toBe(45);
    });

    it('parses T-separated timestamps', () => {
        const d = parseDate('2024-06-30T23:59:58');
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(5);
        expect(d.getDate()).toBe(30);
        expect(d.getHours()).toBe(23);
        expect(d.getSeconds()).toBe(58);
    });

    it('parses dd.mm.yyyy dates (day first)', () => {
        const d = parseDate('15.01.2024 08:05:03');
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(0);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(8);
    });

    it('parses date without time as midnight', () => {
        const d = parseDate('2024-03-20');
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(2);
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    it('parses fractional seconds', () => {
        const d = parseDate('2024-01-15 10:30:45.5');
        expect(d.getSeconds()).toBe(45);
    });
});

describe('utils.lookupMessages', () => {
    it('resolves a known gdscode to its message', () => {
        expect(lookupMessages([{ gdscode: 335544321 }]))
            .toBe('Arithmetic exception, numeric overflow, or string truncation');
    });

    it('substitutes @n placeholders with params', () => {
        expect(lookupMessages([{ gdscode: 335544343, params: [42] }]))
            .toBe('Invalid request BLR at offset 42');
    });

    it('joins multiple status entries with a comma', () => {
        const text = lookupMessages([
            { gdscode: 335544321 },
            { gdscode: 335544343, params: [7] },
        ]);
        expect(text).toBe('Arithmetic exception, numeric overflow, or string truncation, Invalid request BLR at offset 7');
    });

    it('falls back to "Unknow error" for unknown codes', () => {
        expect(lookupMessages([{ gdscode: 1 }])).toBe('Unknow error');
    });
});

describe('utils.noop', () => {
    it('is a function returning undefined', () => {
        expect(noop()).toBeUndefined();
    });
});
