import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeOptions } from '../../src/uri';

const ENV_KEYS = ['ISC_USER', 'ISC_PASSWORD', 'FIREBIRD_HOST', 'FIREBIRD_PORT', 'FIREBIRD_DATABASE', 'FIREBIRD_ROLE'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('environment-variable connection defaults', () => {
    it('fills unset options from ISC_* / FIREBIRD_* variables', () => {
        process.env.ISC_USER = 'ENVUSER';
        process.env.ISC_PASSWORD = 'envpass';
        process.env.FIREBIRD_HOST = 'db.example';
        process.env.FIREBIRD_PORT = '3051';
        process.env.FIREBIRD_DATABASE = '/data/app.fdb';
        process.env.FIREBIRD_ROLE = 'APP';

        const out = normalizeOptions<any>({});
        expect(out).toEqual({
            user: 'ENVUSER', password: 'envpass', host: 'db.example',
            port: 3051, database: '/data/app.fdb', role: 'APP',
        });
    });

    it('explicit options always win over the environment', () => {
        process.env.ISC_USER = 'ENVUSER';
        process.env.FIREBIRD_PORT = '3051';
        const out = normalizeOptions<any>({ user: 'REAL', port: 3050 });
        expect(out.user).toBe('REAL');
        expect(out.port).toBe(3050);
    });

    it('does not mutate the caller-owned options object', () => {
        process.env.ISC_USER = 'ENVUSER';
        const input: any = { database: '/x.fdb' };
        const out = normalizeOptions<any>(input);
        expect(input.user).toBeUndefined();
        expect(out.user).toBe('ENVUSER');
        expect(out).not.toBe(input);
    });

    it('returns the same object untouched when no variables are set', () => {
        const input: any = { user: 'U' };
        expect(normalizeOptions(input)).toBe(input);
    });

    it('applies to connection strings too', () => {
        process.env.ISC_USER = 'ENVUSER';
        const out = normalizeOptions<any>('firebird://localhost/x.fdb');
        expect(out.user).toBe('ENVUSER');
    });

    it('treats empty-string env vars as unset (CI: `export ISC_PASSWORD=`)', () => {
        process.env.ISC_PASSWORD = '';
        process.env.FIREBIRD_ROLE = '';
        const out = normalizeOptions<any>({ database: '/x.fdb' });
        expect(out.password).toBeUndefined();
        expect(out.role).toBeUndefined();
    });

    it('throws on a non-numeric FIREBIRD_PORT instead of silently using 3050', () => {
        process.env.FIREBIRD_PORT = '3051x';
        expect(() => normalizeOptions<any>({})).toThrow(/Invalid FIREBIRD_PORT/);
    });

    it('never injects FIREBIRD_DATABASE into service-manager options', () => {
        // for a service connection, `database` selects the TARGET of
        // backup/restore/drop — a leftover env var must not pick it
        process.env.FIREBIRD_DATABASE = '/data/app.fdb';
        process.env.ISC_USER = 'ENVUSER';
        const out = normalizeOptions<any>({ manager: true });
        expect(out.database).toBeUndefined();
        expect(out.user).toBe('ENVUSER'); // credentials still apply
    });
});
