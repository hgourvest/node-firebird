var assert = require('assert');
var Const = require('../lib/wire/const');
var Firebird = require('../lib');

describe('Test Firebird 3.0 and 4.0 protocol support', function () {
    it('should define protocol versions 14, 15, 16, and 17', function () {
        assert.ok(Const.PROTOCOL_VERSION14, 'PROTOCOL_VERSION14 should be defined');
        assert.ok(Const.PROTOCOL_VERSION15, 'PROTOCOL_VERSION15 should be defined');
        assert.ok(Const.PROTOCOL_VERSION16, 'PROTOCOL_VERSION16 should be defined');
        assert.ok(Const.PROTOCOL_VERSION17, 'PROTOCOL_VERSION17 should be defined');
        assert.strictEqual(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_MASK, 14);
        assert.strictEqual(Const.PROTOCOL_VERSION15 & Const.FB_PROTOCOL_MASK, 15);
        assert.strictEqual(Const.PROTOCOL_VERSION16 & Const.FB_PROTOCOL_MASK, 16);
        assert.strictEqual(Const.PROTOCOL_VERSION17 & Const.FB_PROTOCOL_MASK, 17);
        assert.ok(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION15 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION16 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION17 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
    });

    it('should include protocols 14, 15, 16, and 17 in SUPPORTED_PROTOCOL', function () {
        var versions = Const.SUPPORTED_PROTOCOL.map(function (p) { return p[0]; });
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION14) !== -1, 'Protocol 14 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION15) !== -1, 'Protocol 15 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION16) !== -1, 'Protocol 16 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION17) !== -1, 'Protocol 17 should be supported');
        assert.strictEqual(Const.SUPPORTED_PROTOCOL.length, 8, 'Should support 8 protocol versions');
    });

    it('should support Srp256 authentication plugin', function () {
        assert.strictEqual(Const.AUTH_PLUGIN_SRP256, 'Srp256');
        assert.ok(Const.AUTH_PLUGIN_LIST.indexOf('Srp256') !== -1, 'Srp256 should be in AUTH_PLUGIN_LIST');
        assert.ok(Const.AUTH_PLUGIN_SRP_LIST.indexOf('Srp256') !== -1, 'Srp256 should be in AUTH_PLUGIN_SRP_LIST');
    });

    it('should prefer Srp256 over Srp', function () {
        var srp256Index = Const.AUTH_PLUGIN_LIST.indexOf('Srp256');
        var srpIndex = Const.AUTH_PLUGIN_LIST.indexOf('Srp');
        assert.ok(srp256Index < srpIndex, 'Srp256 should come before Srp in plugin list');
    });

    it('should export AUTH_PLUGIN_SRP256 from main module', function () {
        assert.strictEqual(Firebird.AUTH_PLUGIN_SRP256, 'Srp256');
    });

    it('should export wire crypt constants', function () {
        assert.strictEqual(Firebird.WIRE_CRYPT_ENABLE, 1);
        assert.strictEqual(Firebird.WIRE_CRYPT_DISABLE, 0);
    });

    it('should define op_crypt opcode', function () {
        assert.strictEqual(Const.op_crypt, 96);
    });

    it('should define op_crypt_key_callback opcode', function () {
        assert.strictEqual(Const.op_crypt_key_callback, 97);
    });

    it('should define DECFLOAT data type constants', function () {
        assert.strictEqual(Const.SQL_DEC16, 32760, 'SQL_DEC16 should be 32760');
        assert.strictEqual(Const.SQL_DEC34, 32762, 'SQL_DEC34 should be 32762');
    });

    it('should define DECFLOAT BLR constants', function () {
        assert.strictEqual(Const.blr_dec64, 24, 'blr_dec64 should be 24');
        assert.strictEqual(Const.blr_dec128, 25, 'blr_dec128 should be 25');
    });

    it('should define INT128 data type constants', function () {
        assert.strictEqual(Const.SQL_INT128, 32752, 'SQL_INT128 should be 32752');
        assert.strictEqual(Const.blr_int128, 26, 'blr_int128 should be 26');
    });
});
