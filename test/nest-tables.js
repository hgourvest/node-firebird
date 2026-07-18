'use strict';

/**
 * Live tests for the mysql2-style `nestTables` option (connection-level and
 * per-query): `true` nests each object row by source table
 * (`row[table][column]`), a string separator flattens to qualified keys
 * (`row['table' + sep + 'column']`). The table qualifier is the query's
 * relation alias when one is used (requested via isc_info_sql_relation_alias,
 * Firebird 2.0+), the relation name otherwise; expression columns nest under
 * `''` (like mysql2) or keep their bare alias in separator mode.
 *
 * Without the option, JOINed columns sharing a name silently overwrite each
 * other in object rows — the first test pins that (unchanged) behavior.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-nesttables-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    blobAsText: true,
    // Config.default has lowercase_keys: true; keep server-cased keys here so
    // assertions read like the SQL. The lowercase interplay has its own test.
    lowercase_keys: false,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

const JOIN_SQL = 'SELECT EMP.ID, EMP.NAME, DEPT.ID, DEPT.NAME, DEPT.NOTES ' +
    'FROM EMP JOIN DEPT ON DEPT.ID = EMP.DEPT_ID WHERE EMP.ID = 10';

describe('nestTables', function () {
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await db.queryAsync('CREATE TABLE DEPT (ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(20), NOTES BLOB SUB_TYPE TEXT, BDATA BLOB)');
        await db.queryAsync('CREATE TABLE EMP (ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(20), DEPT_ID INT, BOSS_ID INT)');
        await db.queryAsync("INSERT INTO DEPT VALUES (1, 'Engineering', 'dept blob text', ?)",
            [Buffer.from('raw bytes')]);
        await db.queryAsync("INSERT INTO EMP VALUES (10, 'Ada', 1, NULL)");
        await db.queryAsync("INSERT INTO EMP VALUES (11, 'Grace', 1, 10)");
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it('without nestTables, duplicate JOIN column names still collide (pinned behavior)', async function () {
        const rows = await db.queryAsync(JOIN_SQL);
        assert.deepStrictEqual(Object.keys(rows[0]), ['ID', 'NAME', 'NOTES']);
    });

    it('nestTables: true nests object rows by source table', async function () {
        const rows = await db.queryAsync(JOIN_SQL, [], { nestTables: true });
        assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['DEPT', 'EMP']);
        assert.deepStrictEqual(rows[0].EMP, { ID: 10, NAME: 'Ada' });
        assert.strictEqual(rows[0].DEPT.ID, 1);
        assert.strictEqual(rows[0].DEPT.NAME, 'Engineering');
    });

    it('resolves blobAsText blobs inside nested sub-objects', async function () {
        const rows = await db.queryAsync(JOIN_SQL, [], { nestTables: true });
        assert.strictEqual(rows[0].DEPT.NOTES, 'dept blob text');
    });

    it('a string separator flattens to table-qualified keys', async function () {
        const rows = await db.queryAsync(JOIN_SQL, [], { nestTables: '_' });
        assert.deepStrictEqual(Object.keys(rows[0]),
            ['EMP_ID', 'EMP_NAME', 'DEPT_ID', 'DEPT_NAME', 'DEPT_NOTES']);
        assert.strictEqual(rows[0].EMP_NAME, 'Ada');
        assert.strictEqual(rows[0].DEPT_NAME, 'Engineering');
    });

    it('self-joins nest under query aliases; NULLs and expressions handled', async function () {
        const sql = 'SELECT E.NAME, B.NAME, E.BOSS_ID, 40 + 2 AS ANSWER ' +
            'FROM EMP E LEFT JOIN EMP B ON B.ID = E.BOSS_ID ORDER BY E.ID';
        const rows = await db.queryAsync(sql, [], { nestTables: true });
        assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['', 'B', 'E']);
        assert.strictEqual(rows[0].E.NAME, 'Ada');
        assert.strictEqual(rows[0].B.NAME, null); // NULL lands in the sub-object
        assert.strictEqual(rows[0][''].ANSWER, 42); // expression under '' (mysql2)
        assert.strictEqual(rows[1].B.NAME, 'Ada');

        // expression columns get the bare separator prefix (mysql2 behavior) —
        // a bare alias could collide with a real 'table<sep>column' key
        const flat = await db.queryAsync(sql, [], { nestTables: ':' });
        assert.deepStrictEqual(Object.keys(flat[0]), ['E:NAME', 'B:NAME', 'E:BOSS_ID', ':ANSWER']);
    });

    it('db.execute array rows are unaffected', async function () {
        const rows = await db.executeAsync(JOIN_SQL, [], { nestTables: true });
        assert.ok(Array.isArray(rows[0]));
        assert.strictEqual(rows[0].length, 5);
    });

    it('sequentially nests rows and materializes nested blobs', async function () {
        const seen = [];
        await new Promise((resolve, reject) => {
            db.sequentially(JOIN_SQL, [], (row) => { seen.push(row); }, (err) => {
                err ? reject(err) : resolve();
            }, { nestTables: true });
        });
        assert.deepStrictEqual(Object.keys(seen[0]).sort(), ['DEPT', 'EMP']);
        assert.strictEqual(typeof seen[0].DEPT.NOTES, 'string');
        assert.strictEqual(seen[0].EMP.NAME, 'Ada');
    });

    it('duplicate blob aliases collapse onto one cell and are read once (sequentially)', async function () {
        // both columns share the alias BDATA, so they land on the same row
        // cell; the blob resolver must read that cell exactly once (the old
        // Object.keys-aligned code deduplicated implicitly)
        const seen = [];
        await new Promise((resolve, reject) => {
            db.sequentially('SELECT D.BDATA, D.BDATA FROM DEPT D', [], (row) => { seen.push(row); }, (err) => {
                err ? reject(err) : resolve();
            }, {});
        });
        assert.ok(Buffer.isBuffer(seen[0].BDATA));
        assert.strictEqual(seen[0].BDATA.toString(), 'raw bytes');
    });

    it('queryStream forwards nestTables', async function () {
        const out = [];
        await new Promise((resolve, reject) => {
            db.queryStream(JOIN_SQL, [], { nestTables: '_' })
                .on('data', r => out.push(r))
                .on('end', resolve)
                .on('error', reject);
        });
        assert.strictEqual(out[0].EMP_ID, 10);
        assert.strictEqual(out[0].DEPT_NAME, 'Engineering');
    });

    it('connection-level nestTables applies, honours lowercase_keys, and per-query false overrides it', async function () {
        const db2 = await fromCallback(cb => Firebird.attach({
            ...options, nestTables: true, lowercase_keys: true,
        }, cb));
        try {
            let rows = await db2.queryAsync(JOIN_SQL);
            assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['dept', 'emp']);
            assert.deepStrictEqual(rows[0].emp, { id: 10, name: 'Ada' });

            rows = await db2.queryAsync(JOIN_SQL, [], { nestTables: false });
            assert.deepStrictEqual(Object.keys(rows[0]), ['id', 'name', 'notes']);
        } finally {
            await fromCallback(cb => db2.detach(cb));
        }
    });

    it('works inside an explicit transaction', async function () {
        const tx = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const rows = await tx.queryAsync(JOIN_SQL, [], { nestTables: true });
            assert.strictEqual(rows[0].EMP.ID, 10);
            assert.strictEqual(rows[0].DEPT.NAME, 'Engineering');
        } finally {
            await tx.commitAsync();
        }
    });
});
