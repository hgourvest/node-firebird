'use strict';

/**
 * Offline encoding tests for PR #416
 * ====================================
 * Verifies that SQLVarText and SQLVarString decode raw bytes using the
 * Node.js Buffer encoding that matches the Firebird connection charset,
 * instead of always defaulting to UTF-8.
 *
 * These tests are fully offline – no Firebird server is required.
 * Data is encoded with XdrWriter and decoded through the SQLVar classes
 * exactly as the real driver path does.
 */

const assert = require('assert');
const { SQLVarText, SQLVarString } = require('../lib/wire/xsqlvar');
const { XdrReader, XdrWriter } = require('../lib/wire/serialize');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an XdrReader whose buffer starts with `text` written in `nodeEncoding`
 * followed by an int(0) null-indicator (used by lowerV13 decoding).
 *
 * addText writes the raw bytes without a length prefix, aligned to 4 bytes.
 * addString writes a 4-byte big-endian length prefix then the bytes (aligned).
 */
function makeTextReader(text, nodeEncoding) {
    const w = new XdrWriter(256);
    w.addText(text, nodeEncoding);
    w.addInt(0); // null-indicator: 0 = not null
    return new XdrReader(w.getData());
}

function makeStringReader(text, nodeEncoding) {
    const w = new XdrWriter(256);
    w.addString(text, nodeEncoding);
    w.addInt(0); // null-indicator: 0 = not null
    return new XdrReader(w.getData());
}

// ---------------------------------------------------------------------------
// resolveTextEncoding unit tests (via SQLVarText as a proxy)
// ---------------------------------------------------------------------------

describe('resolveTextEncoding (via SQLVarText.decode)', function () {

    it('defaults to utf8 when no options are provided', function () {
        // UTF-8 multi-byte character: '€' = 0xE2 0x82 0xAC
        const text = '€';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 4; // UTF8 char width = 4

        const reader = makeTextReader(text + ' ', 'utf8');
        const result = sqlVar.decode(reader, false /* lowerV13=false */, null);
        assert.strictEqual(result, text);
    });

    it('defaults to utf8 when options object has no encoding property', function () {
        const text = 'Héllo';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 20; // 5 chars * 4 width

        const reader = makeTextReader(text + ' '.repeat(14), 'utf8');
        const result = sqlVar.decode(reader, false, {});
        assert.strictEqual(result, text);
    });

    it('maps WIN1252 → latin1 and decodes special characters correctly', function () {
        // These chars exist in WIN1252 / ISO-8859-1 but need latin1 decoding.
        const text = 'Ç Ã É Ú';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('maps ISO8859_1 → latin1', function () {
        const text = 'àáâãäå';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'ISO8859_1' });
        assert.strictEqual(result, text);
    });

    it('maps LATIN1 → latin1', function () {
        const text = 'àáâãäå';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'LATIN1' });
        assert.strictEqual(result, text);
    });

    it('maps ASCII → ascii', function () {
        const text = 'Hello World';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'ascii');

        const reader = makeTextReader(text, 'ascii');
        const result = sqlVar.decode(reader, false, { encoding: 'ASCII' });
        assert.strictEqual(result, text);
    });

    it('maps NONE → latin1 (treat as binary-safe 8-bit)', function () {
        const text = 'abc';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'NONE' });
        assert.strictEqual(result, text);
    });

    it('maps UTF8 → utf8', function () {
        const text = 'Héllo wörld';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 44; // 11 chars * 4 width

        const reader = makeTextReader(text + ' '.repeat(31), 'utf8');
        const result = sqlVar.decode(reader, false, { encoding: 'UTF8' });
        assert.strictEqual(result, text);
    });

    it('maps UNICODE_FSS → utf8', function () {
        const text = 'Héllo';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 15; // 5 chars * 3 width

        const reader = makeTextReader(text + ' '.repeat(9), 'utf8');
        const result = sqlVar.decode(reader, false, { encoding: 'UNICODE_FSS' });
        assert.strictEqual(result, text);
    });

    it('is case-insensitive for encoding option (lower-case input)', function () {
        const text = 'Çàé';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'win1252' });
        assert.strictEqual(result, text);
    });

    it('falls back to utf8 for unknown/unsupported Firebird charsets', function () {
        const text = 'Hello';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'utf8');

        const reader = makeTextReader(text, 'utf8');
        const result = sqlVar.decode(reader, false, { encoding: 'SJIS_0208' });
        assert.strictEqual(result, text);
    });
});

// ---------------------------------------------------------------------------
// SQLVarText.decode – subType variants
// ---------------------------------------------------------------------------

describe('SQLVarText.decode – subType variants', function () {

    it('subType > 1 (column charset defined): decodes WIN1252 correctly', function () {
        const text = 'TESTE NCM COM Ç Ã É Ú';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 2;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('subType === 0 (no charset): decodes WIN1252 correctly', function () {
        const text = 'TESTE NCM COM Ç Ã É Ú';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('subType < 0 (binary): returns raw Buffer', function () {
        const bytes = Buffer.from([0x01, 0x02, 0xFE, 0xFF]);
        const w = new XdrWriter(64);
        w.addBuffer(bytes);
        w.addInt(0); // null-indicator
        // For binary subtype, readBuffer uses this.length
        const sqlVar = new SQLVarText();
        sqlVar.subType = -1;
        sqlVar.length = bytes.length;

        const reader = new XdrReader(w.getData());
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.ok(Buffer.isBuffer(result));
        assert.ok(result.equals(bytes));
    });

    it('lowerV13=true with null-indicator=1 returns null', function () {
        const text = 'test';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const w = new XdrWriter(64);
        w.addText(text, 'latin1');
        w.addInt(1); // null-indicator: 1 = NULL
        const reader = new XdrReader(w.getData());

        const result = sqlVar.decode(reader, true /* lowerV13 */, { encoding: 'WIN1252' });
        assert.strictEqual(result, null);
    });

    it('lowerV13=true with null-indicator=0 returns value', function () {
        const text = 'notNull';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 28; // 7 chars * 4 width

        const reader = makeTextReader(text + ' '.repeat(21), 'utf8');
        const result = sqlVar.decode(reader, true /* lowerV13 */, { encoding: 'UTF8' });
        assert.strictEqual(result, text);
    });

    it('truncates to charLength based on charset byte width', function () {
        // UTF8 is 4 bytes/char max. If length=8 we expect at most 2 UTF-8 chars.
        // Use ASCII chars so each is 1 byte in utf8 too.
        const text = 'ABCDEFGH'; // 8 bytes in ASCII
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = 8;

        const reader = makeTextReader(text, 'utf8');
        const result = sqlVar.decode(reader, false, { encoding: 'UTF8' });
        // charLength = floor(8 / 4) = 2 chars for UTF8
        assert.strictEqual(result, 'AB');
    });
});

// ---------------------------------------------------------------------------
// SQLVarString.decode – the main fix (missing options param in original)
// ---------------------------------------------------------------------------

describe('SQLVarString.decode – respects connection encoding', function () {

    it('subType > 1: decodes WIN1252 bytes correctly', function () {
        const text = 'TESTE NCM COM Ç Ã É Ú';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 2;

        const reader = makeStringReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('subType === 0: decodes WIN1252 bytes correctly', function () {
        const text = 'TESTE NCM COM Ç Ã É Ú';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const reader = makeStringReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('subType < 0: returns raw Buffer regardless of encoding', function () {
        const bytes = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
        // SQLVarString binary path calls readBuffer() with no length arg
        // readBuffer() calls readInt() first to get the length
        const w = new XdrWriter(64);
        w.addInt(bytes.length);    // length prefix for readBuffer()
        w.addBuffer(bytes);
        w.addInt(0); // null-indicator
        const sqlVar = new SQLVarString();
        sqlVar.subType = -1;

        const reader = new XdrReader(w.getData());
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.ok(Buffer.isBuffer(result));
        assert.ok(result.slice(0, bytes.length).equals(bytes));
    });

    it('defaults to utf8 when no options passed', function () {
        const text = 'Hello UTF-8: ✓';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const reader = makeStringReader(text, 'utf8');
        const result = sqlVar.decode(reader, false);
        assert.strictEqual(result, text);
    });

    it('lowerV13=true with null-indicator=1 returns null', function () {
        const text = 'test';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const w = new XdrWriter(64);
        w.addString(text, 'latin1');
        w.addInt(1); // null-indicator: 1 = NULL
        const reader = new XdrReader(w.getData());

        const result = sqlVar.decode(reader, true, { encoding: 'WIN1252' });
        assert.strictEqual(result, null);
    });

    it('lowerV13=true with null-indicator=0 returns value', function () {
        const text = 'notNull';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const reader = makeStringReader(text, 'utf8');
        const result = sqlVar.decode(reader, true, { encoding: 'UTF8' });
        assert.strictEqual(result, text);
    });

    it('ISO8859_1: correctly decodes extended latin characters', function () {
        const text = 'ñoño'; // in ISO-8859-1 / latin1
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const reader = makeStringReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'ISO8859_1' });
        assert.strictEqual(result, text);
    });

    it('pure ASCII: same result regardless of encoding (ascii vs latin1 vs utf8)', function () {
        const text = 'hello world';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        ['ASCII', 'WIN1252', 'UTF8', 'NONE'].forEach(enc => {
            const reader = makeStringReader(text, 'ascii');
            const result = sqlVar.decode(reader, false, { encoding: enc });
            assert.strictEqual(result, text, `failed for encoding ${enc}`);
        });
    });

    it('decodes empty string correctly', function () {
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        const reader = makeStringReader('', 'utf8');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, '');
    });
});

// ---------------------------------------------------------------------------
// Regression: wrong encoding produces garbled output (demonstrates the bug)
// ---------------------------------------------------------------------------

describe('Regression: wrong encoding produces garbled text', function () {

    it('WIN1252 bytes decoded as UTF-8 give garbled output (shows pre-fix behaviour)', function () {
        // This test documents *why* the fix matters: if WIN1252 bytes for 'Ç' (0xC7)
        // are decoded as UTF-8, we get garbled characters.
        const originalText = 'Ç';   // 0xC7 in WIN1252 / latin1

        // Encode with latin1 (correct for WIN1252 data from Firebird)
        const buf = Buffer.from(originalText, 'latin1');

        // Decoding as utf8 should NOT equal the original
        const garbled = buf.toString('utf8');
        assert.notStrictEqual(garbled, originalText,
            'latin1 bytes decoded as utf8 should be garbled (not equal to original)');

        // But decoding with latin1 should be correct
        const correct = buf.toString('latin1');
        assert.strictEqual(correct, originalText,
            'latin1 bytes decoded as latin1 should equal the original');
    });

    it('SQLVarString with WIN1252 produces correct text (post-fix)', function () {
        // Full end-to-end through SQLVarString.decode with the fix applied
        const text = 'Ç Ã É Ú Ñ';
        const sqlVar = new SQLVarString();
        sqlVar.subType = 0;

        // Bytes as Firebird would send them for a WIN1252 connection
        const reader = makeStringReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });

    it('SQLVarText with WIN1252 produces correct text (post-fix)', function () {
        const text = 'Ç Ã É Ú Ñ';
        const sqlVar = new SQLVarText();
        sqlVar.subType = 0;
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const reader = makeTextReader(text, 'latin1');
        const result = sqlVar.decode(reader, false, { encoding: 'WIN1252' });
        assert.strictEqual(result, text);
    });
});
