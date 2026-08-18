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

    it('exports numeric result modes', () => {
        expect(Firebird.NUMERIC_MODE_LOSSY).toBe('lossy');
        expect(Firebird.NUMERIC_MODE_SAFE).toBe('safe');
        expect(Firebird.NUMERIC_MODE_STRING).toBe('string');

        const options: Firebird.Options = { numericMode: Firebird.NUMERIC_MODE_SAFE };
        expect(options.numericMode).toBe('safe');
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

    it('escape does not double backslashes (Firebird literals have no backslash escapes, #156)', () => {
        expect(Firebird.escape('a\\b')).toBe("'a\\b'");
        expect(Firebird.escape("path\\to's")).toBe("'path\\to''s'");
    });

    it('re-exports GDSCode', () => {
        expect(Firebird.GDSCode.ARITH_EXCEPT).toBe(335544321);
    });

    it('exports DPB constants including isc_dpb_search_path', () => {
        expect(Firebird.isc_dpb_search_path).toBe(105);
        expect(Firebird.isc_dpb_owner).toBe(102);
        expect(Firebird.isc_dpb_parallel_workers).toBe(100);
        expect(Firebird.isc_dpb_max_inline_blob_size).toBe(104);
        expect(Firebird.isc_dpb_user_name).toBe(28);
        expect(Firebird.isc_dpb_password).toBe(29);
        expect(Firebird.isc_dpb_page_size).toBe(4);
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
