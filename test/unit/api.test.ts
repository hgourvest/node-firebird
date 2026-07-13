import { describe, it, expect } from 'vitest';
import * as Firebird from '../../src/index';
import Pool from '../../src/pool';
import { escape as utilsEscape } from '../../src/utils';

describe('public API surface', () => {
    it('exports the connection entry points', () => {
        expect(typeof Firebird.attach).toBe('function');
        expect(typeof Firebird.create).toBe('function');
        expect(typeof Firebird.attachOrCreate).toBe('function');
        expect(typeof Firebird.drop).toBe('function');
        expect(typeof Firebird.pool).toBe('function');
    });

    it('exports the auth plugin names', () => {
        expect(Firebird.AUTH_PLUGIN_LEGACY).toBe('Legacy_Auth');
        expect(Firebird.AUTH_PLUGIN_SRP).toBe('Srp');
        expect(Firebird.AUTH_PLUGIN_SRP256).toBe('Srp256');
        expect(Firebird.AUTH_PLUGIN_SRP384).toBe('Srp384');
        expect(Firebird.AUTH_PLUGIN_SRP512).toBe('Srp512');
    });

    it('exports wire crypt flags', () => {
        expect(Firebird.WIRE_CRYPT_DISABLE).toBe(0);
        expect(Firebird.WIRE_CRYPT_ENABLE).toBe(1);
    });

    it('exports isolation level arrays', () => {
        for (const iso of [
            Firebird.ISOLATION_READ_UNCOMMITTED,
            Firebird.ISOLATION_READ_COMMITTED,
            Firebird.ISOLATION_REPEATABLE_READ,
            Firebird.ISOLATION_SERIALIZABLE,
            Firebird.ISOLATION_READ_COMMITTED_READ_ONLY,
        ]) {
            expect(Array.isArray(iso)).toBe(true);
            expect(iso.length).toBeGreaterThan(0);
        }
    });

    it('escape is the utils implementation', () => {
        expect(Firebird.escape).toBe(utilsEscape);
        expect(Firebird.escape("it's")).toBe("'it''s'");
    });

    it('re-exports GDSCode', () => {
        expect(Firebird.GDSCode.ARITH_EXCEPT).toBe(335544321);
    });

    it('pool() returns a Pool marked as pooled', () => {
        const p = Firebird.pool(3, {} as any) as any;
        expect(p).toBeInstanceOf(Pool);
        expect(p.max).toBe(3);
        expect(p.options.isPool).toBe(true);
        expect(typeof p.get).toBe('function');
        expect(typeof p.destroy).toBe('function');
    });
});
