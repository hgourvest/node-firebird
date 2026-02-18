var assert = require('assert');
var Srp = require('../lib/srp.js');
var crypto = require('crypto');

const USER = 'SYSDBA';
const PASSWORD = 'masterkey';
const DEBUG_PRIVATE_KEY = BigInt('0x60975527035CF2AD1989806F0407210BC81EDC04E2762A56AFD529DDDA2D4393');
const DEBUG_SALT = '02E268803000000079A478A700000002D1A6979000000026E1601C000000054F';

const EXPECT_CLIENT_KEY = BigInt('0x712c5f8a2db82464c4d640ae971025aa50ab64906d4f044f822e8af8a58adabbdbe1efaba00bccd4cdaa8a955bc43c3600beab9ebb9bd41acc56e37f1a48f17293f24e876b53eea6a60712d3f943769056b63202416827b400e162a8c0938d482274307585e0bc1d9dd52efa7330b28e41b7cfcefd9e8523fd11440ee5de93a8');

// Fixed test vectors
const TEST_SALT_1 = 'a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e';
const TEST_CLIENT_1 = BigInt('0x3138bb9bc78df27c473ecfd1410f7bd45ebac1f59cf3ff9cfe4db77aab7aedd3');
const TEST_SALT_2 = 'd91323a5298f3b9f814db29efaa271f24fbdccedfdd062491b8abc8e07b7fb69';
const TEST_CLIENT_2 = BigInt('0xf435f2420b50c70ec80865cf8e20b169874165fb8576b48633caf2a8176d2e4a');

describe('Test Srp client', function () {
    it('should generate client keys', function() {
        var keys = Srp.clientSeed(DEBUG_PRIVATE_KEY);

        assert.ok(keys.public === EXPECT_CLIENT_KEY);
    });

    it('should generate server keys with debug input value', function() {
        testSrp('sha1', DEBUG_SALT, DEBUG_PRIVATE_KEY);
    });

    it('should generate sha1 server keys with fixed test vector 1', function() {
        testSrp('sha1', TEST_SALT_1, TEST_CLIENT_1);
    });

    it('should generate sha256 server keys with fixed test vector 2', function() {
        testSrp('sha256', TEST_SALT_2, TEST_CLIENT_2);
    });

    it('should generate sha1 server keys with random keys (stress test)', function() {
        // Run multiple times to ensure no flakiness with random keys
        for (let i = 0; i < 50; i++) {
            testSrp('sha1', crypto.randomBytes(32).toString('hex'));
        }
    });

    /**
     * Test function
     */
    function testSrp(algo, salt, client, server) {
        var clientKeys = client ? Srp.clientSeed(client) : Srp.clientSeed();
        var serverKeys = server ? Srp.serverSeed(USER, PASSWORD, salt, server) : Srp.serverSeed(USER, PASSWORD, salt);

        const serverSessionKey = Srp.serverSession(
          USER, PASSWORD, salt,
          clientKeys.public, serverKeys.public, serverKeys.private
        );

        const proof = Srp.clientProof(
          USER, PASSWORD, salt,
          clientKeys.public, serverKeys.public, clientKeys.private,
          algo
        );

        if (proof.clientSessionKey !== serverSessionKey) {
            console.log('Mismatch!');
            console.log('Client Key:', proof.clientSessionKey.toString(16));
            console.log('Server Key:', serverSessionKey.toString(16));
        }
        assert.ok(proof.clientSessionKey === serverSessionKey, 'Session key mismatch');
    }
});
