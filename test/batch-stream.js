'use strict';

/**
 * Live tests for roadmap #20: BLOB batch parameters and the bulk-insert
 * Writable stream (Firebird 4.0+ batch API, protocol 16+; skipped on
 * older servers).
 *
 * - executeBatch now accepts Buffers/strings on BLOB columns: values are
 *   uploaded as transaction blobs (pipelined) and the batch messages
 *   reference their quad ids.
 * - db.batchStream(sql) is the COPY FROM analogue: an object-mode
 *   Writable flushing parameter rows in chunks through one prepared
 *   statement, all-or-nothing in its own transaction.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-batchstream-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    lowercase_keys: false,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('BLOB batch params + batchStream (Firebird 4.0+)', function () {
    let db;
    let supported = true;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        supported = db.connection.accept.protocolVersion >= Const.PROTOCOL_VERSION16;
        await db.queryAsync('CREATE TABLE BS (ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(20), NOTES BLOB SUB_TYPE TEXT)');
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    beforeEach(async function () {
        await db.queryAsync('DELETE FROM BS');
    });

    it('executeBatch uploads Buffer/string BLOB values', async function (ctx) {
        if (!supported) return ctx.skip();
        const big = 'y'.repeat(5000);
        const res = await db.executeBatchAsync('INSERT INTO BS VALUES (?, ?, ?)', [
            [1, 'a', 'text note'],
            [2, 'b', null],
            [3, 'c', Buffer.from(big)],
        ]);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.recordCount, 3);

        const db2 = await fromCallback(cb => Firebird.attach({ ...options, blobAsText: true }, cb));
        try {
            const rows = await db2.queryAsync('SELECT ID, NOTES FROM BS ORDER BY ID');
            assert.strictEqual(rows[0].NOTES, 'text note');
            assert.strictEqual(rows[1].NOTES, null);
            assert.strictEqual(rows[2].NOTES.length, 5000);
        } finally {
            await fromCallback(cb => db2.detach(cb));
        }
    });

    it('batchStream inserts rows across multiple flushes and reports totals', async function (ctx) {
        if (!supported) return ctx.skip();
        const stream = db.batchStream('INSERT INTO BS VALUES (?, ?, ?)', { flushRows: 100 });
        await pipeline(
            Readable.from(Array.from({ length: 250 }, (_, i) => [i + 1, 'n' + i, i % 10 === 0 ? 'blob ' + i : null])),
            stream
        );
        assert.strictEqual(stream.recordCount, 250);
        assert.strictEqual(stream.affectedRows, 250);

        const rows = await db.queryAsync('SELECT COUNT(*) CNT FROM BS');
        assert.strictEqual(Number(rows[0].CNT), 250);
    });

    it('batchStream is all-or-nothing: a bad row rolls the whole stream back', async function (ctx) {
        if (!supported) return ctx.skip();
        const stream = db.batchStream('INSERT INTO BS VALUES (?, ?, ?)', { flushRows: 10 });
        const rows = Array.from({ length: 25 }, (_, i) => [i + 1, 'n' + i, null]);
        rows.push([5, 'dup', null]); // PK violation in the last flush

        await assert.rejects(
            pipeline(Readable.from(rows), stream),
            (err) => err.batchCompletion !== undefined || typeof err.gdscode === 'number'
        );

        const out = await db.queryAsync('SELECT COUNT(*) CNT FROM BS');
        assert.strictEqual(Number(out[0].CNT), 0, 'everything rolled back');
    });

    it('transaction.batchStream leaves the transaction with the caller', async function (ctx) {
        if (!supported) return ctx.skip();
        const tx = await db.transactionAsync();
        try {
            const stream = tx.batchStream('INSERT INTO BS VALUES (?, ?, ?)');
            await pipeline(Readable.from([[1, 'a', null], [2, 'b', null]]), stream);

            // visible inside the transaction, then discarded by rollback
            const inTx = await tx.queryAsync('SELECT COUNT(*) CNT FROM BS');
            assert.strictEqual(Number(inTx[0].CNT), 2);
        } finally {
            await tx.rollbackAsync();
        }
        const out = await db.queryAsync('SELECT COUNT(*) CNT FROM BS');
        assert.strictEqual(Number(out[0].CNT), 0);
    });

    it('an empty stream finishes cleanly without touching the server', async function (ctx) {
        if (!supported) return ctx.skip();
        const stream = db.batchStream('INSERT INTO BS VALUES (?, ?, ?)');
        await pipeline(Readable.from([]), stream);
        assert.strictEqual(stream.recordCount, 0);
    });

    it('destroying the stream mid-load rolls back', async function (ctx) {
        if (!supported) return ctx.skip();
        const stream = db.batchStream('INSERT INTO BS VALUES (?, ?, ?)', { flushRows: 5 });
        await new Promise((resolve) => {
            let written = 0;
            const writeNext = () => {
                if (written >= 12) {
                    stream.destroy();
                    // 'close' fires after _destroy's cleanup ran
                    stream.on('close', resolve);
                    return;
                }
                written++;
                stream.write([written, 'x', null], writeNext);
            };
            writeNext();
        });
        const out = await db.queryAsync('SELECT COUNT(*) CNT FROM BS');
        assert.strictEqual(Number(out[0].CNT), 0, 'destroyed stream must not commit');
    });
});
