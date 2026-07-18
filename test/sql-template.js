'use strict';

/**
 * Live tests for the tagged-template query API (roadmap #14, Postgres.js
 * style): db.sql`...` / tx.sql`...` compile interpolations to positional
 * params (injection-safe by construction), compose fragments, quote
 * identifiers via sql('NAME'), expand arrays for IN lists, and execute
 * lazily (once, on await). .withMeta() ties into the #13 result shape.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-sqltag-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    lowercase_keys: false,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('tagged-template sql API', function () {
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await db.queryAsync('CREATE TABLE EMP (ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(20))');
        await db.sql`INSERT INTO EMP VALUES (${1}, ${'Ada'})`;
        await db.sql`INSERT INTO EMP VALUES (${2}, ${'Grace'})`;
        await db.sql`INSERT INTO EMP VALUES (${3}, ${'Edsger'})`;
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it('runs parametrized selects', async function () {
        const rows = await db.sql`SELECT NAME FROM EMP WHERE ID = ${2}`;
        assert.deepStrictEqual(rows, [{ NAME: 'Grace' }]);
    });

    it('is injection-safe: values are bound, not concatenated', async function () {
        const evil = "' OR '1'='1";
        const rows = await db.sql`SELECT NAME FROM EMP WHERE NAME = ${evil}`;
        assert.deepStrictEqual(rows, []);
    });

    it('expands arrays for IN lists', async function () {
        const rows = await db.sql`SELECT NAME FROM EMP WHERE ID IN (${[1, 3]}) ORDER BY ID`;
        assert.deepStrictEqual(rows.map(r => r.NAME), ['Ada', 'Edsger']);
    });

    it('quotes identifiers via sql(name)', async function () {
        const col = 'NAME';
        const rows = await db.sql`SELECT ${db.sql(col)} FROM ${db.sql('EMP')} WHERE ID = ${1}`;
        assert.deepStrictEqual(rows, [{ NAME: 'Ada' }]);
    });

    it('composes fragments with their parameters', async function () {
        const filter = db.sql`ID > ${1} AND ID < ${3}`;
        const rows = await db.sql`SELECT NAME FROM EMP WHERE ${filter}`;
        assert.deepStrictEqual(rows, [{ NAME: 'Grace' }]);
    });

    it('.withMeta() resolves the full result shape', async function () {
        const r = await db.sql`UPDATE EMP SET NAME = NAME WHERE ID <= ${2}`.withMeta();
        assert.strictEqual(r.affectedRows, 2);
        assert.strictEqual(r.recordCounts.updateCount, 2);
    });

    it('works inside explicit transactions', async function () {
        const tx = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
        try {
            await tx.sql`INSERT INTO EMP VALUES (${99}, ${'Tmp'})`;
            const rows = await tx.sql`SELECT COUNT(*) CNT FROM EMP`;
            assert.strictEqual(Number(rows[0].CNT), 4);
        } finally {
            await tx.rollbackAsync();
        }
        const rows = await db.sql`SELECT COUNT(*) CNT FROM EMP`;
        assert.strictEqual(Number(rows[0].CNT), 3);
    });

    it('is immune to the namedPlaceholders rewriter (PSQL :vars stay intact)', async function () {
        // with namedPlaceholders: true on the connection, the :V reference in
        // this EXECUTE BLOCK would be rewritten into a bogus ? placeholder if
        // the tag did not force namedPlaceholders: false
        const db2 = await fromCallback(cb => Firebird.attach({ ...options, namedPlaceholders: true }, cb));
        try {
            const row = await db2.sql`EXECUTE BLOCK (X INT = ${41}) RETURNS (R INT) AS DECLARE V INT; BEGIN V = X; R = :V + 1; SUSPEND; END`;
            assert.strictEqual(Number(row.R !== undefined ? row.R : row[0].R), 42);
        } finally {
            await fromCallback(cb => db2.detach(cb));
        }
    });

    it('executes exactly once for multiple awaits', async function () {
        const q = db.sql`SELECT COUNT(*) CNT FROM EMP`;
        const [a, b] = await Promise.all([q, q]);
        assert.strictEqual(Number(a[0].CNT), Number(b[0].CNT));
    });
});
