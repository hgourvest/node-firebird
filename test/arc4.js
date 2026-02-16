var assert = require('assert');
var { Arc4 } = require('../lib/wire/socket');

describe('Test Arc4 cipher', function () {
    it('should encrypt and decrypt symmetrically', function (done) {
        var key = Buffer.from('TestKey123');
        var plaintext = Buffer.from('Hello, World! This is a test message.');

        var encCipher = new Arc4(key);
        var encrypted = encCipher.transform(plaintext);

        var decCipher = new Arc4(key);
        var decrypted = decCipher.transform(encrypted);

        assert.ok(!plaintext.equals(encrypted), 'Encrypted data should differ from plaintext');
        assert.ok(plaintext.equals(decrypted), 'Decrypted data should match plaintext');
        done();
    });

    it('should produce correct keystream for known test vector', function (done) {
        // RFC 6229 test vector: Key = 0x0102030405
        var key = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
        var cipher = new Arc4(key);
        var zeros = Buffer.alloc(16);
        var keystream = cipher.transform(zeros);

        assert.strictEqual(
            keystream.toString('hex'),
            'b2396305f03dc027ccc3524a0a1118a8',
            'RC4 keystream should match RFC 6229 expected output'
        );
        done();
    });

    it('should maintain state across multiple transforms', function (done) {
        var key = Buffer.from('StateTest');

        // Encrypt in two chunks
        var cipher1 = new Arc4(key);
        var part1 = cipher1.transform(Buffer.from('Hello'));
        var part2 = cipher1.transform(Buffer.from('World'));

        // Encrypt as one chunk
        var cipher2 = new Arc4(key);
        var full = cipher2.transform(Buffer.from('HelloWorld'));

        // Concatenated parts should equal full encryption
        var combined = Buffer.concat([part1, part2]);
        assert.ok(combined.equals(full), 'Chunked encryption should match full encryption');
        done();
    });

    it('should handle empty buffer', function (done) {
        var key = Buffer.from('EmptyTest');
        var cipher = new Arc4(key);
        var result = cipher.transform(Buffer.alloc(0));

        assert.strictEqual(result.length, 0, 'Empty input should produce empty output');
        done();
    });

    it('should work with SRP-like session key', function (done) {
        // Simulate a session key similar to what SRP would produce
        var sessionKey = Buffer.from('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', 'hex');
        var data = Buffer.from('SELECT * FROM RDB$DATABASE');

        var encCipher = new Arc4(sessionKey);
        var encrypted = encCipher.transform(data);

        var decCipher = new Arc4(sessionKey);
        var decrypted = decCipher.transform(encrypted);

        assert.ok(data.equals(decrypted), 'Should work with hex session key');
        done();
    });
});
