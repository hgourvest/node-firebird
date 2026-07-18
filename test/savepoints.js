'use strict';

/**
 * Live tests for transaction.savepoint(work) (roadmap #16): released on
 * resolve, rolled back TO on reject (undoing only work's changes while the
 * transaction stays usable), nestable via generated names.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-savepoint-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    lowercase_keys: false,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('transaction.savepoint', function () {
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await db.queryAsync('CREATE TABLE SP (ID INT NOT NULL PRIMARY KEY)');
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    async function ids(runner) {
        const rows = await runner.queryAsync('SELECT ID FROM SP ORDER BY ID');
        return rows.map(r => Number(r.ID));
    }

    beforeEach(async function () {
        await db.queryAsync('DELETE FROM SP');
    });

    it('releases the savepoint and returns the work result on success', async function () {
        await db.withTransaction(async (tx) => {
            await tx.sql`INSERT INTO SP VALUES (${1})`;
            const out = await tx.savepoint(async () => {
                await tx.sql`INSERT INTO SP VALUES (${2})`;
                return 'done';
            });
            assert.strictEqual(out, 'done');
        });
        assert.deepStrictEqual(await ids(db), [1, 2]);
    });

    it('rolls back only the savepoint work on failure; the transaction stays usable', async function () {
        await db.withTransaction(async (tx) => {
            await tx.sql`INSERT INTO SP VALUES (${1})`;

            await assert.rejects(
                tx.savepoint(async () => {
                    await tx.sql`INSERT INTO SP VALUES (${2})`;
                    await tx.sql`INSERT INTO SP VALUES (${1})`; // PK violation
                }),
                (err) => typeof err.gdscode === 'number'
            );

            // the failed savepoint's insert of 2 is undone, 1 survives,
            // and the transaction accepts further work
            await tx.sql`INSERT INTO SP VALUES (${3})`;
        });
        assert.deepStrictEqual(await ids(db), [1, 3]);
    });

    it('nests: an inner rollback leaves outer savepoint work intact', async function () {
        await db.withTransaction(async (tx) => {
            await tx.savepoint(async () => {
                await tx.sql`INSERT INTO SP VALUES (${10})`;
                await assert.rejects(tx.savepoint(async () => {
                    await tx.sql`INSERT INTO SP VALUES (${11})`;
                    throw new Error('undo inner');
                }), /undo inner/);
                await tx.sql`INSERT INTO SP VALUES (${12})`;
            });
        });
        assert.deepStrictEqual(await ids(db), [10, 12]);
    });

    it('propagates the work error unchanged', async function () {
        const tx = await db.transactionAsync();
        try {
            const boom = new Error('boom');
            await assert.rejects(tx.savepoint(() => { throw boom; }), (err) => err === boom);
        } finally {
            await tx.rollbackAsync();
        }
    });
});
