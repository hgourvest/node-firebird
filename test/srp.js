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

    it('salt', function(done) {
        var salt = 'A7A32132C0B85CE63BD6916B008E13577C14E60DBF11BBEB1E85D8AD44866397';
        var serverPublic = BigInt('1F988BB7A6C5AC7A6280BC9B0C44E211F51C3D1E0E6FA04C1B853A70EB87F2DC27C287DECE205DEF6B1B11191F11E2A10BFA78B810B58D626980BC356C9ABF6B9C29C409E7941CD64D4368A0E7F32C9B02C34DD9E26ECFD7B522571F8855A1D809FA365D4752FCADFDC0A791CC100AAA0FC82BBD0809E48BB7286929C9CD8AB0', 16);

        var clientKeys = Srp.clientSeed(BigInt("84316857F47914F838918D5C12CE3A3E7A9B2D7C9486346809E9EEFCE8DE7CD4259D8BE4FD0BCC2D259553769E078FA61EE2977025E4DA42F7FD97914D8A33723DFAFBC00770B7DA0C2E3778A05790F0C0F33C32A19ED88A12928567749021B3FD45DCD1CE259C45325067E3DDC972F87867349BA82C303CCCAA9B207218007B", 16));

        var proof = Srp.clientProof(
          USER, PASSWORD, salt,
          clientKeys.public, serverPublic, clientKeys.private,
          'sha1'
        );

        assert.ok(proof.clientSessionKey.equals(BigInt('18e921cb847ee15621b6b5abbfd4a125a0a02016', 16)));
        assert.ok(proof.authData.equals(BigInt('17ABA9042E652628F71C64F188CA714298D678A0', 16)));
        done();
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
