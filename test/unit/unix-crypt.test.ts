import { describe, it, expect } from 'vitest';
import { crypt } from '../../src/unix-crypt';
import Const from '../../src/wire/const';

// Reference vectors generated with the original pre-TypeScript
// lib/unix-crypt.js implementation to guarantee behavioural equivalence.
describe('unix-crypt.crypt', () => {
    it('matches the legacy implementation for the Firebird auth salt', () => {
        expect(crypt('masterkey', '9z')).toBe('9zQP3LMZ/MJh.');
    });

    it('matches the legacy implementation for other salts', () => {
        expect(crypt('password', 'ab')).toBe('abJnggxhB/yWI');
        expect(crypt('', 'xy')).toBe('xyw1.V0rbu5mQ');
    });

    it('is deterministic', () => {
        expect(crypt('secret', '9z')).toBe(crypt('secret', '9z'));
    });

    it('accepts Buffer input for the password', () => {
        expect(crypt(Buffer.from('masterkey'), '9z')).toBe('9zQP3LMZ/MJh.');
    });

    it('uses only the first 8 characters of the password (DES)', () => {
        expect(crypt('masterke', '9z')).toBe(crypt('masterkey', '9z'));
        expect(crypt('masterk', '9z')).not.toBe(crypt('masterkey', '9z'));
    });

    it('throws on a missing salt', () => {
        expect(() => crypt('x', '' as any)).toThrow(/Invalid salt/);
    });

    it('produces the LegacyAuth wire value used by connection.ts', () => {
        // connection.ts sends crypt(password, LEGACY_AUTH_SALT).substring(2)
        const wire = crypt('masterkey', Const.LEGACY_AUTH_SALT).substring(2);
        expect(wire).toBe('QP3LMZ/MJh.');
        expect(wire).not.toContain(Const.LEGACY_AUTH_SALT);
    });
});
