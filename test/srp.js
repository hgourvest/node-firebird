var assert = require('assert');
var Srp = require('../lib/srp.js');

const USER = 'SYSDBA';
const PASSWORD = 'masterkey';
const DEBUG_PRIVATE_KEY = BigInt('0x60975527035CF2AD1989806F0407210BC81EDC04E2762A56AFD529DDDA2D4393');
const DEBUG_SALT = '02E268803000000079A478A700000002D1A6979000000026E1601C000000054F';

const EXPECT_CLIENT_KEY = BigInt('0x712c5f8a2db82464c4d640ae971025aa50ab64906d4f044f822e8af8a58adabbdbe1efaba00bccd4cdaa8a955bc43c3600beab9ebb9bd41acc56e37f1a48f17293f24e876b53eea6a60712d3f943769056b63202416827b400e162a8c0938d482274307585e0bc1d9dd52efa7330b28e41b7cfcefd9e8523fd11440ee5de93a8');

// Fixed test vectors for deterministic tests (instead of random keys which are flaky)
const TEST_SALT_1 = 'a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e';
const TEST_CLIENT_1 = BigInt('0x3138bb9bc78df27c473ecfd1410f7bd45ebac1f59cf3ff9cfe4db77aab7aedd3');
const TEST_SALT_2 = 'd91323a5298f3b9f814db29efaa271f24fbdccedfdd062491b8abc8e07b7fb69';
const TEST_CLIENT_2 = BigInt('0xf435f2420b50c70ec80865cf8e20b169874165fb8576b48633caf2a8176d2e4a');

// Additional fixed test vectors
const TEST_SALT_3 = 'b1c2d3e4f5a697887a6b5c4d3e2f1e0bc1d2e3f4a5b697887a6b5c4d3e2f1e0b';
const TEST_CLIENT_3 = BigInt('0x4a5b6c7d8e9fa0b1c2d3e4f5061718192a3b4c5d6e7f8091a2b3c4d5e6f70819');
const TEST_SALT_4 = '1f2e3d4c5b6a79887a6b5c4d3e2f1e0b1f2e3d4c5b6a79887a6b5c4d3e2f1e0b';
const TEST_CLIENT_4 = BigInt('0x9182736450a1b2c3d4e5f6071819202122232425262728293a3b3c3d3e3f4041');

// Fixed server private keys for deterministic full round-trip tests.
// Both values are 256-bit (<<< PRIME.N which is 1024-bit), so a + ux < N
// always holds and the session-key comparison is always deterministic.
const TEST_SERVER_1 = BigInt('0x60975527035cf2ad1989806f0407210bc81edc04e2762a56afd529ddda2d4394');
const TEST_SERVER_2 = BigInt('0x4a5b6c7d8e9fa0b1c2d3e4f5061718192a3b4c5d6e7f8091a2b3c4d5e6f70819');

// Alternative user/password for testing non-SYSDBA authentication
const ALT_USER = 'ALICE';
const ALT_PASSWORD = 'alicepassword';

// ─────────────────────────────────────────────────────────────────
// hexPad helper
// ─────────────────────────────────────────────────────────────────
describe('hexPad helper', function () {
    it('should leave even-length strings unchanged', function () {
        assert.strictEqual(Srp.hexPad('abcd'), 'abcd');
        assert.strictEqual(Srp.hexPad('ab'), 'ab');
        assert.strictEqual(Srp.hexPad('00ff'), '00ff');
    });

    it('should prepend a zero to odd-length hex strings', function () {
        assert.strictEqual(Srp.hexPad('abc'), '0abc');
        assert.strictEqual(Srp.hexPad('a'), '0a');
        assert.strictEqual(Srp.hexPad('1'), '01');
        assert.strictEqual(Srp.hexPad('fff'), '0fff');
    });

    it('should handle the empty string', function () {
        assert.strictEqual(Srp.hexPad(''), '');
    });
});

// ─────────────────────────────────────────────────────────────────
// clientSeed
// ─────────────────────────────────────────────────────────────────
describe('clientSeed', function () {
    it('should return a BigInt public key and preserve the private key', function () {
        var keys = Srp.clientSeed(DEBUG_PRIVATE_KEY);
        assert.strictEqual(typeof keys.public, 'bigint', 'public key must be a native BigInt');
        assert.strictEqual(typeof keys.private, 'bigint', 'private key must be a native BigInt');
        assert.strictEqual(keys.private, DEBUG_PRIVATE_KEY, 'private key must be returned unchanged');
    });

    it('should generate a valid random key pair', function () {
        var keys = Srp.clientSeed();
        assert.strictEqual(typeof keys.public, 'bigint', 'random public key must be a native BigInt');
        assert.strictEqual(typeof keys.private, 'bigint', 'random private key must be a native BigInt');
        assert.ok(keys.public > 0n, 'public key must be positive');
        assert.ok(keys.private > 0n, 'private key must be positive');
    });
});

// ─────────────────────────────────────────────────────────────────
// serverSeed
// ─────────────────────────────────────────────────────────────────
describe('serverSeed', function () {
    it('should return BigInt public and private keys', function () {
        var keys = Srp.serverSeed(USER, PASSWORD, DEBUG_SALT);
        assert.strictEqual(typeof keys.public, 'bigint', 'server public key must be a native BigInt');
        assert.strictEqual(typeof keys.private, 'bigint', 'server private key must be a native BigInt');
        assert.ok(keys.public > 0n, 'server public key must be positive');
    });

    it('should produce a different public key for different passwords', function () {
        var keys1 = Srp.serverSeed(USER, PASSWORD, DEBUG_SALT, BigInt('0x01'));
        var keys2 = Srp.serverSeed(USER, 'differentpassword', DEBUG_SALT, BigInt('0x01'));
        assert.ok(keys1.public !== keys2.public, 'different passwords must yield different server public keys');
    });
});

// ─────────────────────────────────────────────────────────────────
// Full SRP handshake – correctness tests
// ─────────────────────────────────────────────────────────────────
describe('Test Srp client', function () {
    it('should generate client keys', function () {
        var keys = Srp.clientSeed(DEBUG_PRIVATE_KEY);
        assert.ok(keys.public === EXPECT_CLIENT_KEY);
    });

    it('should generate server keys with debug input value', function () {
        testSrp('sha1', DEBUG_SALT, DEBUG_PRIVATE_KEY);
    });

    it('should generate sha1 server keys with fixed test vector 1', function () {
        testSrp('sha1', TEST_SALT_1, TEST_CLIENT_1);
    });

    it('should generate sha256 server keys with fixed test vector 2', function () {
        testSrp('sha256', TEST_SALT_2, TEST_CLIENT_2);
    });

    it('should generate sha384 server keys with fixed test vector 2', function () {
        testSrp('sha384', TEST_SALT_2, TEST_CLIENT_2);
    });

    it('should generate sha512 server keys with fixed test vector 2', function () {
        testSrp('sha512', TEST_SALT_2, TEST_CLIENT_2);
    });

    it('should generate sha1 server keys with fixed test vector 3', function () {
        testSrp('sha1', TEST_SALT_3, TEST_CLIENT_3);
    });

    it('should generate sha256 server keys with fixed test vector 4', function () {
        testSrp('sha256', TEST_SALT_4, TEST_CLIENT_4);
    });

    it('should authenticate a non-SYSDBA user with sha1', function () {
        testSrpUser('sha1', TEST_SALT_1, TEST_CLIENT_1, ALT_USER, ALT_PASSWORD);
    });

    it('should authenticate a non-SYSDBA user with sha256', function () {
        testSrpUser('sha256', TEST_SALT_2, TEST_CLIENT_2, ALT_USER, ALT_PASSWORD);
    });

    it('should authenticate a non-SYSDBA user with sha384', function () {
        testSrpUser('sha384', TEST_SALT_2, TEST_CLIENT_2, ALT_USER, ALT_PASSWORD);
    });

    it('should authenticate a non-SYSDBA user with sha512', function () {
        testSrpUser('sha512', TEST_SALT_2, TEST_CLIENT_2, ALT_USER, ALT_PASSWORD);
    });

    it('should succeed end-to-end with fixed client and server keys (sha1)', function () {
        // Fully deterministic: both client and server private keys are fixed 256-bit
        // values (always << PRIME.N) so the (a + ux) % N reduction never fires.
        testSrp('sha1', TEST_SALT_1, TEST_CLIENT_1, TEST_SERVER_1);
    });

    it('should succeed end-to-end with fixed client and server keys (sha256)', function () {
        testSrp('sha256', TEST_SALT_2, TEST_CLIENT_2, TEST_SERVER_2);
    });

    it('should succeed end-to-end with fixed client and server keys (sha384)', function () {
        testSrp('sha384', TEST_SALT_2, TEST_CLIENT_2, TEST_SERVER_2);
    });

    it('should succeed end-to-end with fixed client and server keys (sha512)', function () {
        testSrp('sha512', TEST_SALT_2, TEST_CLIENT_2, TEST_SERVER_2);
    });

    it('should produce mismatched session keys for a wrong password', function () {
        var clientKeys = Srp.clientSeed(TEST_CLIENT_1);
        var serverKeys = Srp.serverSeed(USER, PASSWORD, TEST_SALT_1);

        var serverSessionKey = Srp.serverSession(
            USER, PASSWORD, TEST_SALT_1,
            clientKeys.public, serverKeys.public, serverKeys.private
        );

        var proof = Srp.clientProof(
            USER, 'wrongpassword', TEST_SALT_1,
            clientKeys.public, serverKeys.public, clientKeys.private,
            'sha1'
        );

        assert.ok(
            proof.clientSessionKey !== serverSessionKey,
            'A wrong password must produce a different client session key (auth should fail)'
        );
    });

    it('should produce mismatched session keys for a wrong username', function () {
        var clientKeys = Srp.clientSeed(TEST_CLIENT_1);
        var serverKeys = Srp.serverSeed(USER, PASSWORD, TEST_SALT_1);

        var serverSessionKey = Srp.serverSession(
            USER, PASSWORD, TEST_SALT_1,
            clientKeys.public, serverKeys.public, serverKeys.private
        );

        var proof = Srp.clientProof(
            'WRONGUSER', PASSWORD, TEST_SALT_1,
            clientKeys.public, serverKeys.public, clientKeys.private,
            'sha1'
        );

        assert.ok(
            proof.clientSessionKey !== serverSessionKey,
            'A wrong username must produce a different client session key (auth should fail)'
        );
    });

    it('should produce mismatched session keys when client and server use different salts', function () {
        var clientKeys = Srp.clientSeed(TEST_CLIENT_1);
        // Server uses TEST_SALT_1; client uses a different salt for clientProof
        var serverKeys = Srp.serverSeed(USER, PASSWORD, TEST_SALT_1);

        var serverSessionKey = Srp.serverSession(
            USER, PASSWORD, TEST_SALT_1,
            clientKeys.public, serverKeys.public, serverKeys.private
        );

        var proof = Srp.clientProof(
            USER, PASSWORD, TEST_SALT_2,   // wrong salt
            clientKeys.public, serverKeys.public, clientKeys.private,
            'sha1'
        );

        assert.ok(
            proof.clientSessionKey !== serverSessionKey,
            'Mismatched salts must produce different session keys'
        );
    });

    /**
     * Standard SRP round-trip using USER/PASSWORD.
     *
     * @param {string} algo     - 'sha1' or 'sha256'
     * @param {string} salt     - hex salt string
     * @param {bigint} [client] - fixed client private key (omit for random)
     * @param {bigint} [server] - fixed server private key (omit for random)
     */
    function testSrp(algo, salt, client, server) {
        var clientKeys = client ? Srp.clientSeed(client) : Srp.clientSeed();
        var serverKeys = server ? Srp.serverSeed(USER, PASSWORD, salt, server, algo) : Srp.serverSeed(USER, PASSWORD, salt, undefined, algo);

        const serverSessionKey = Srp.serverSession(
            USER, PASSWORD, salt,
            clientKeys.public, serverKeys.public, serverKeys.private,
            algo
        );

        const proof = Srp.clientProof(
            USER, PASSWORD, salt,
            clientKeys.public, serverKeys.public, clientKeys.private,
            algo
        );

        assert.ok(proof.clientSessionKey === serverSessionKey, 'Session key mismatch');
    }

    /**
     * SRP round-trip with an explicit user/password pair.
     *
     * @param {string} algo     - 'sha1' or 'sha256'
     * @param {string} salt     - hex salt string
     * @param {bigint} client   - fixed client private key
     * @param {string} user     - username
     * @param {string} password - plaintext password
     */
    function testSrpUser(algo, salt, client, user, password) {
        var clientKeys = Srp.clientSeed(client);
        var serverKeys = Srp.serverSeed(user, password, salt, undefined, algo);

        const serverSessionKey = Srp.serverSession(
            user, password, salt,
            clientKeys.public, serverKeys.public, serverKeys.private,
            algo
        );

        const proof = Srp.clientProof(
            user, password, salt,
            clientKeys.public, serverKeys.public, clientKeys.private,
            algo
        );

        assert.ok(proof.clientSessionKey === serverSessionKey, `Session key mismatch for user ${user}`);
    }
});

// ─────────────────────────────────────────────────────────────────
// Regression tests for Issue #411 / PR #412
// ─────────────────────────────────────────────────────────────────
//
// Bug: clientSeed() generated the 1024-bit random private key a without
// reducing it mod N.  Because N ≈ 0.9 × 2^1024, roughly 10% of random values
// are >= N.  When a >= N the client's public key A = g^a mod N equals
// g^(a mod (N-1)) mod N (Fermat), but clientSession() reduces the exponent
// (a + ux) mod N — a different reduction.  The resulting session keys
// diverge and Firebird rejects the SRP proof, causing attach() to hang.
//
// Fix: default parameter is now `toBigInt(randomBytes(128)) % PRIME.N`,
// guaranteeing a is always in [0, N).

// The SRP prime N — imported from the library so we never diverge from
// the value actually used during authentication.
const PRIME_N = Srp.PRIME_N;

describe('clientSeed – private key reduction (regression #411)', function () {

    it('random private key should always be < PRIME.N', function () {
        // 100 independent draws.  Without the fix, ~10% of 1024-bit random values
        // exceed N, so the probability that all 100 happen to be < N is
        // 0.9^100 ≈ 2.6 × 10^-5 — effectively zero.
        for (var i = 0; i < 100; i++) {
            var keys = Srp.clientSeed();
            assert.ok(
                keys.private < PRIME_N,
                'private key ' + keys.private.toString(16).slice(0, 16) + '… must be < PRIME.N'
            );
        }
    });

    it('private key from clientSeed() should equal itself mod PRIME.N', function () {
        // x < N  ⟺  x % N === x.  Any key >= N would violate this invariant.
        for (var i = 0; i < 50; i++) {
            var keys = Srp.clientSeed();
            assert.strictEqual(
                keys.private % PRIME_N,
                keys.private,
                'private key must already be reduced mod PRIME.N'
            );
        }
    });

});
