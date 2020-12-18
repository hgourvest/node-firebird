var assert = require('assert');
var Srp = require('../lib/srp.js');
var BigInt = require('big-integer');
var crypto = require('crypto');

const USER = 'SYSDBA';
const PASSWORD = 'masterkey';
const DEBUG_PRIVATE_KEY = BigInt('60975527035CF2AD1989806F0407210BC81EDC04E2762A56AFD529DDDA2D4393', 16);
const DEBUG_SALT = '02E268803000000079A478A700000002D1A6979000000026E1601C000000054F';

const EXPECT_CLIENT_KEY = BigInt('712c5f8a2db82464c4d640ae971025aa50ab64906d4f044f822e8af8a58adabbdbe1efaba00bccd4cdaa8a955bc43c3600beab9ebb9bd41acc56e37f1a48f17293f24e876b53eea6a60712d3f943769056b63202416827b400e162a8c0938d482274307585e0bc1d9dd52efa7330b28e41b7cfcefd9e8523fd11440ee5de93a8', 16);

describe('Test Srp client', function () {
    it('should generate client keys', function(done) {
        var keys = Srp.clientSeed(DEBUG_PRIVATE_KEY);

        assert.ok(keys.public.equals(EXPECT_CLIENT_KEY));
        done();
    });

    it('should generate server keys with debug input value', function(done) {
        testSrp(done, 'sha1', DEBUG_SALT, DEBUG_PRIVATE_KEY);
    });

    it('should generate sha1 server keys with random keys', function(done) {
        testSrp(done, 'sha1', crypto.randomBytes(32).toString('hex'));
    });

    it('should generate sha256 server keys with random keys', function(done) {
        testSrp(done, 'sha256', crypto.randomBytes(32).toString('hex'));
    });

    /**
     * Test function
     */
    function testSrp(done, algo, salt, client, server) {
        var clientKeys = client ? Srp.clientSeed(client) : Srp.clientSeed();
        var serverKeys = Srp.serverSeed(USER, PASSWORD, salt);

        const serverSessionKey = Srp.serverSession(
          USER, PASSWORD, salt,
          clientKeys.public, serverKeys.public, serverKeys.private
        );

        const proof = Srp.clientProof(
          USER, PASSWORD, salt,
          clientKeys.public, serverKeys.public, clientKeys.private,
          algo
        );

        assert.ok(proof.clientSessionKey.equals(serverSessionKey), 'Session key mismatch');
        done();
    }
});
