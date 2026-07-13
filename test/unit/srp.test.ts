import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import * as srp from '../../src/srp';

const USER = 'SYSDBA';
const PASSWORD = 'masterkey';

describe('srp key generation', () => {
    it('clientSeed returns a key pair with private key in [0, N)', () => {
        const pair = srp.clientSeed();
        expect(typeof pair.public).toBe('bigint');
        expect(typeof pair.private).toBe('bigint');
        expect(pair.private >= 0n).toBe(true);
        expect(pair.private < srp.PRIME_N).toBe(true);
    });

    it('clientSeed is deterministic for a fixed private key', () => {
        const a = 12345678901234567890n;
        const p1 = srp.clientSeed(a);
        const p2 = srp.clientSeed(a);
        expect(p1.public).toBe(p2.public);
        expect(p1.private).toBe(a);
    });

    it('serverSeed accepts a hash algorithm in place of the private key', () => {
        const salt = crypto.randomBytes(32);
        const pair = srp.serverSeed(USER, PASSWORD, salt, 'sha256');
        expect(typeof pair.public).toBe('bigint');
        expect(typeof pair.private).toBe('bigint');
    });

    it('hexPad prepends a zero to odd-length hex strings', () => {
        expect(srp.hexPad('abc')).toBe('0abc');
        expect(srp.hexPad('ab')).toBe('ab');
        expect(srp.hexPad('')).toBe('');
    });

    it('PRIME_N is the 1024-bit Firebird modulus', () => {
        expect(typeof srp.PRIME_N).toBe('bigint');
        expect(srp.PRIME_N.toString(16).length).toBe(256); // 1024 bits = 256 hex digits
    });
});

describe('srp session agreement', () => {
    function handshake(hashAlgo: string) {
        const salt = crypto.randomBytes(32);
        const client = srp.clientSeed();
        const server = srp.serverSeed(USER, PASSWORD, salt);

        const proof = srp.clientProof(
            USER, PASSWORD, salt,
            client.public, server.public, client.private,
            hashAlgo,
        );
        const serverKey = srp.serverSession(
            USER, PASSWORD, salt,
            client.public, server.public, server.private,
            hashAlgo,
        );
        return { proof, serverKey };
    }

    it('client and server derive the same session key (Srp/sha1)', () => {
        const { proof, serverKey } = handshake('sha1');
        expect(proof.clientSessionKey).toBe(serverKey);
        expect(typeof proof.authData).toBe('bigint');
    });

    it('client and server derive the same session key (Srp256)', () => {
        const { proof, serverKey } = handshake('sha256');
        expect(proof.clientSessionKey).toBe(serverKey);
    });

    it('proofs differ between hash algorithms', () => {
        const salt = crypto.randomBytes(32);
        const client = srp.clientSeed();
        const server = srp.serverSeed(USER, PASSWORD, salt);
        const m1 = srp.clientProof(USER, PASSWORD, salt, client.public, server.public, client.private, 'sha1');
        const m2 = srp.clientProof(USER, PASSWORD, salt, client.public, server.public, client.private, 'sha256');
        expect(m1.authData).not.toBe(m2.authData);
        // but the session key is derived with sha1 in both cases (Firebird behaviour)
        expect(m1.clientSessionKey).toBe(m2.clientSessionKey);
    });

    it('a wrong password breaks the agreement', () => {
        const salt = crypto.randomBytes(32);
        const client = srp.clientSeed();
        const server = srp.serverSeed(USER, PASSWORD, salt);
        const proof = srp.clientProof(USER, 'wrongpass', salt, client.public, server.public, client.private, 'sha1');
        const serverKey = srp.serverSession(USER, PASSWORD, salt, client.public, server.public, server.private, 'sha1');
        expect(proof.clientSessionKey).not.toBe(serverKey);
    });

    it('different salts yield different session keys', () => {
        const client = srp.clientSeed();
        const s1 = crypto.randomBytes(32);
        const s2 = crypto.randomBytes(32);
        const srv1 = srp.serverSeed(USER, PASSWORD, s1);
        const srv2 = srp.serverSeed(USER, PASSWORD, s2);
        const k1 = srp.clientProof(USER, PASSWORD, s1, client.public, srv1.public, client.private, 'sha1');
        const k2 = srp.clientProof(USER, PASSWORD, s2, client.public, srv2.public, client.private, 'sha1');
        expect(k1.clientSessionKey).not.toBe(k2.clientSessionKey);
    });
});
