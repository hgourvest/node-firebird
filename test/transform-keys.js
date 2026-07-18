'use strict';

/**
 * Live tests for the transformKeys option (roadmap #19, Postgres.js
 * `transform` counterpart): 'camel' or a custom mapper rewrites object-row
 * keys, composing with lowercase_keys, nestTables and blob resolution.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-transform-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    lowercase_keys: false,
    blobAsText: true,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('transformKeys', function () {
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await db.queryAsync('CREATE TABLE EMP_INFO (EMP_ID INT NOT NULL PRIMARY KEY, FIRST_NAME VARCHAR(20), NOTES BLOB SUB_TYPE TEXT)');
        await db.queryAsync("INSERT INTO EMP_INFO VALUES (1, 'Ada', 'note text')");
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it("'camel' rewrites keys per query", async function () {
        const rows = await db.queryAsync('SELECT EMP_ID, FIRST_NAME, NOTES FROM EMP_INFO', [], { transformKeys: 'camel' });
        assert.deepStrictEqual(Object.keys(rows[0]), ['empId', 'firstName', 'notes']);
        assert.strictEqual(rows[0].firstName, 'Ada');
        assert.strictEqual(rows[0].notes, 'note text'); // blob resolved under the transformed key
    });

    it('accepts a custom mapper and applies it at connection level', async function () {
        const db2 = await fromCallback(cb => Firebird.attach({
            ...options,
            transformKeys: (key) => 'k_' + key.toLowerCase(),
        }, cb));
        try {
            const rows = await db2.queryAsync('SELECT EMP_ID FROM EMP_INFO');
            assert.deepStrictEqual(Object.keys(rows[0]), ['k_emp_id']);

            // per-query override wins
            const plain = await db2.queryAsync('SELECT EMP_ID FROM EMP_INFO', [], { transformKeys: 'camel' });
            assert.deepStrictEqual(Object.keys(plain[0]), ['empId']);
        } finally {
            await fromCallback(cb => db2.detach(cb));
        }
    });

    it('composes with nestTables (both parts transformed)', async function () {
        const rows = await db.queryAsync('SELECT E.EMP_ID, E.FIRST_NAME FROM EMP_INFO E', [],
            { nestTables: true, transformKeys: 'camel' });
        assert.deepStrictEqual(Object.keys(rows[0]), ['e']);
        assert.deepStrictEqual(Object.keys(rows[0].e), ['empId', 'firstName']);
    });

    it('sequentially resolves blobs under transformed keys', async function () {
        const seen = [];
        await new Promise((resolve, reject) => {
            db.sequentially('SELECT NOTES FROM EMP_INFO', [], (row) => { seen.push(row); }, (err) => {
                err ? reject(err) : resolve();
            }, { transformKeys: 'camel' });
        });
        assert.strictEqual(typeof seen[0].notes, 'string');
    });

    it('a throwing custom mapper falls back to the untransformed key', async function () {
        const rows = await db.queryAsync('SELECT EMP_ID FROM EMP_INFO', [], {
            transformKeys: () => { throw new Error('mapper bug'); },
        });
        assert.deepStrictEqual(Object.keys(rows[0]), ['EMP_ID']);
    });
});
