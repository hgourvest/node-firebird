import { describe, it, expect } from 'vitest';
import { parseNamedPlaceholders, bindNamedParams, isNamedParamsObject } from '../../src/named-params';

describe('named-params.parseNamedPlaceholders', () => {
    it('rewrites named placeholders to positional markers', () => {
        const p = parseNamedPlaceholders('SELECT * FROM t WHERE id = :id AND name = :name');
        expect(p.sql).toBe('SELECT * FROM t WHERE id = ? AND name = ?');
        expect(p.names).toEqual(['id', 'name']);
    });

    it('returns names: null and the original SQL when there are none', () => {
        const sql = 'SELECT * FROM t WHERE id = ?';
        const p = parseNamedPlaceholders(sql);
        expect(p.sql).toBe(sql);
        expect(p.names).toBeNull();
    });

    it('records repeated names once per occurrence', () => {
        const p = parseNamedPlaceholders('SELECT :a + :b + :a FROM rdb$database');
        expect(p.sql).toBe('SELECT ? + ? + ? FROM rdb$database');
        expect(p.names).toEqual(['a', 'b', 'a']);
    });

    it('allows digits, underscores and $ in names', () => {
        const p = parseNamedPlaceholders('SELECT :a1_b$, :_x FROM rdb$database');
        expect(p.names).toEqual(['a1_b$', '_x']);
    });

    it('ignores colons inside string literals', () => {
        const p = parseNamedPlaceholders("SELECT ':not_a_param', :real FROM rdb$database");
        expect(p.sql).toBe("SELECT ':not_a_param', ? FROM rdb$database");
        expect(p.names).toEqual(['real']);
    });

    it('honors doubled-quote escapes inside string literals', () => {
        const p = parseNamedPlaceholders("SELECT 'it''s :not', :yes FROM rdb$database");
        expect(p.sql).toBe("SELECT 'it''s :not', ? FROM rdb$database");
        expect(p.names).toEqual(['yes']);
    });

    it('ignores colons inside quoted identifiers', () => {
        const p = parseNamedPlaceholders('SELECT "weird:column" FROM t WHERE x = :x');
        expect(p.sql).toBe('SELECT "weird:column" FROM t WHERE x = ?');
        expect(p.names).toEqual(['x']);
    });

    it('ignores colons inside line comments', () => {
        const p = parseNamedPlaceholders('SELECT :a FROM t -- not :here\nWHERE b = :b');
        expect(p.sql).toBe('SELECT ? FROM t -- not :here\nWHERE b = ?');
        expect(p.names).toEqual(['a', 'b']);
    });

    it('ignores colons inside block comments', () => {
        const p = parseNamedPlaceholders('SELECT :a /* skip :this\n:too */ , :b FROM t');
        expect(p.sql).toBe('SELECT ? /* skip :this\n:too */ , ? FROM t');
        expect(p.names).toEqual(['a', 'b']);
    });

    it('ignores colons inside q-literals (Firebird 3+ alternative strings)', () => {
        const p = parseNamedPlaceholders("SELECT q'{a :b 'c'}' , :d FROM t");
        expect(p.sql).toBe("SELECT q'{a :b 'c'}' , ? FROM t");
        expect(p.names).toEqual(['d']);
    });

    it('uses the same character as q-literal closer when it is not a bracket', () => {
        const p = parseNamedPlaceholders("SELECT Q'!x :y!' , :z FROM t");
        expect(p.sql).toBe("SELECT Q'!x :y!' , ? FROM t");
        expect(p.names).toEqual(['z']);
    });

    it("does not mistake an identifier ending in q for a q-literal", () => {
        const p = parseNamedPlaceholders("SELECT freq, 'a:b', :c FROM t");
        expect(p.sql).toBe("SELECT freq, 'a:b', ? FROM t");
        expect(p.names).toEqual(['c']);
    });

    it('does not treat a colon before a non-identifier as a placeholder', () => {
        const sql = 'SELECT arr[1:5], t.x FROM t';
        const p = parseNamedPlaceholders(sql);
        expect(p.sql).toBe(sql);
        expect(p.names).toBeNull();
    });

    it('survives an unterminated string literal without hanging', () => {
        const p = parseNamedPlaceholders("SELECT :a, 'oops");
        expect(p.sql).toBe("SELECT ?, 'oops");
        expect(p.names).toEqual(['a']);
    });
});

describe('named-params.bindNamedParams', () => {
    it('maps names to a positional array, repeats included', () => {
        expect(bindNamedParams(['a', 'b', 'a'], { a: 1, b: 'x' })).toEqual([1, 'x', 1]);
    });

    it('passes null values through (NULL parameter)', () => {
        expect(bindNamedParams(['a'], { a: null })).toEqual([null]);
    });

    it('throws listing every missing name', () => {
        expect(() => bindNamedParams(['a', 'b', 'c'], { b: 1 }))
            .toThrow(/Missing value for named placeholder\(s\): a, c/);
    });

    it('does not read inherited properties', () => {
        expect(() => bindNamedParams(['toString'], {})).toThrow(/toString/);
    });
});

describe('named-params.isNamedParamsObject', () => {
    it('accepts plain objects', () => {
        expect(isNamedParamsObject({ a: 1 })).toBe(true);
    });

    it('rejects arrays, Buffers, Dates, null and scalars', () => {
        expect(isNamedParamsObject([1])).toBe(false);
        expect(isNamedParamsObject(Buffer.from('x'))).toBe(false);
        expect(isNamedParamsObject(new Date())).toBe(false);
        expect(isNamedParamsObject(null)).toBe(false);
        expect(isNamedParamsObject('x')).toBe(false);
        expect(isNamedParamsObject(42)).toBe(false);
        expect(isNamedParamsObject(undefined)).toBe(false);
    });
});
