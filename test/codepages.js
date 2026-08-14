'use strict';

/**
 * Live tests for single-byte codepage support (issues #422/#319/#301):
 *
 * - #422: text columns the server does not transliterate in describe
 *   (NONE) got their declared fetch length widened, so values longer than
 *   floor(bytes/4) chars no longer fail with "string right truncation"
 *   under the default UTF8 connection.
 * - #319: codepage connection charsets (WIN1253, WIN1251, ISO8859_x,
 *   KOI8, …) now decode AND encode through ICU-backed codecs — columns,
 *   parameters, SQL literals.
 * - #301: blobAsText decodes text blobs in the connection charset (and
 *   no longer risks splitting multi-byte characters across segments).
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

function dbName(tag) {
    return path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-' + tag + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    );
}

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

async function withDb(extra, work) {
    const options = Config.extends(Config.default, { database: dbName('cp'), lowercase_keys: false, ...extra });
    const db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
    try {
        return await work(db);
    } finally {
        await fromCallback(cb => db.drop(cb));
    }
}

describe('single-byte codepage support', function () {
    it('WIN1252 connection round-trips a NONE database without treating it as Latin-1', async function () {
        await withDb({ encoding: 'WIN1252', defaultCharset: 'NONE', blobAsText: true }, async (db) => {
            const text = '€ “Windows” — Œuvre ™ ŠŽŸ';
            await db.queryAsync('CREATE TABLE W (V VARCHAR(80), C CHAR(20), B BLOB SUB_TYPE TEXT)');
            await db.queryAsync('INSERT INTO W VALUES (?, ?, ?)', [text, '€—™', text]);

            const rows = await db.queryAsync('SELECT V, C, B FROM W WHERE V = ?', [text]);
            assert.strictEqual(rows.length, 1);
            assert.strictEqual(rows[0].V, text);
            assert.strictEqual(rows[0].C.trimEnd(), '€—™');
            assert.strictEqual(rows[0].B, text);

            const literal = await db.queryAsync("SELECT COUNT(*) C FROM W WHERE V = '€ “Windows” — Œuvre ™ ŠŽŸ'");
            assert.strictEqual(Number(literal[0].C), 1);
            const charset = await db.queryAsync('SELECT TRIM(RDB$CHARACTER_SET_NAME) CS FROM RDB$DATABASE');
            assert.strictEqual(charset[0].CS, 'NONE');
        });
    });

    it('#422: NONE/ASCII columns read fully under the default UTF8 connection', async function () {
        await withDb({}, async (db) => {
            const r = await db.queryAsync("select cast('abcd' as varchar(15) character set none) v from rdb$database");
            assert.strictEqual(r[0].V, 'abcd'); // was: string right truncation (fits only 3 chars)

            const r2 = await db.queryAsync("select cast('abcdef' as char(10) character set none) v from rdb$database");
            assert.strictEqual(r2[0].V, 'abcdef    '); // CHAR padding intact

            const r3 = await db.queryAsync("select cast('abcdefgh' as varchar(10) character set ascii) v from rdb$database");
            assert.strictEqual(r3[0].V, 'abcdefgh');

            // metadata keeps the native declared length, not the widened buffer
            const r4 = await db.queryAsync("select cast('x' as varchar(15) character set none) v from rdb$database", [], { withMeta: true });
            assert.strictEqual(r4.fields[0].length, 15);
        });
    });

    it('#319: WIN1253 connection round-trips greek through params, literals and CHAR columns', async function () {
        await withDb({ encoding: 'WIN1253' }, async (db) => {
            await db.queryAsync('CREATE TABLE G (NAME VARCHAR(30) CHARACTER SET WIN1253, ADDR CHAR(20) CHARACTER SET WIN1253)');
            const name = 'Γεώργιος Παπαδόπουλος'.slice(0, 20);
            await db.queryAsync('INSERT INTO G VALUES (?, ?)', [name, 'Αθήνα']);

            const r = await db.queryAsync('SELECT NAME, ADDR FROM G WHERE NAME = ?', [name]);
            assert.strictEqual(r.length, 1);
            assert.strictEqual(r[0].NAME, name);
            assert.strictEqual(r[0].ADDR.trimEnd(), 'Αθήνα');

            // greek inside the SQL text itself (query-text encoding)
            const r2 = await db.queryAsync("SELECT COUNT(*) C FROM G WHERE ADDR = 'Αθήνα'");
            assert.strictEqual(Number(r2[0].C), 1);
        });
    });

    it('#301: WIN1251 connection decodes cyrillic varchars and blobAsText blobs', async function () {
        await withDb({ encoding: 'WIN1251', blobAsText: true }, async (db) => {
            await db.queryAsync('CREATE TABLE B (TXT BLOB SUB_TYPE TEXT CHARACTER SET WIN1251, NAME VARCHAR(30) CHARACTER SET WIN1251)');
            const ru = 'Привет, мир! Это кириллица в блобе.';
            await db.queryAsync('INSERT INTO B VALUES (?, ?)', [ru, 'Иванов']);

            const r = await db.queryAsync('SELECT TXT, NAME FROM B');
            assert.strictEqual(r[0].TXT, ru);
            assert.strictEqual(r[0].NAME, 'Иванов');
        });
    });

    it('#301: executeBatch uploads codepage-encoded blob text', async function (ctx) {
        await withDb({ encoding: 'WIN1251', blobAsText: true }, async (db) => {
            const Const = require('../lib/wire/const');
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION16) {
                return ctx.skip(); // batch API is Firebird 4+
            }
            await db.queryAsync('CREATE TABLE B (TXT BLOB SUB_TYPE TEXT CHARACTER SET WIN1251, NAME VARCHAR(30) CHARACTER SET WIN1251)');
            const res = await db.executeBatchAsync('INSERT INTO B VALUES (?, ?)', [['Пакетная вставка', 'Петров']]);
            assert.strictEqual(res.success, true);
            const r = await db.queryAsync('SELECT TXT FROM B');
            assert.strictEqual(r[0].TXT, 'Пакетная вставка');
        });
    });

    it('attachOrCreate honours options.encoding on the CREATE path', async function () {
        // createDatabase used to hardcode UTF8 for both the database default
        // charset and lc_ctype, silently ignoring options.encoding — the
        // root of the 'Malformed string' failures on fresh databases
        await withDb({ encoding: 'WIN1253' }, async (db) => {
            const r = await db.queryAsync(
                "SELECT TRIM(RDB$CHARACTER_SET_NAME) CS FROM RDB$DATABASE");
            assert.strictEqual(r[0].CS, 'WIN1253');
        });
    });

    it('default UTF8 connections are unchanged', async function () {
        await withDb({}, async (db) => {
            await db.queryAsync('CREATE TABLE U (T VARCHAR(30))');
            await db.queryAsync('INSERT INTO U VALUES (?)', ['ütf-8 ção 日本語']);
            const r = await db.queryAsync('SELECT T FROM U WHERE T = ?', ['ütf-8 ção 日本語']);
            assert.strictEqual(r[0].T, 'ütf-8 ção 日本語');
        });
    });
});
