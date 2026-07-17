const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');
const { pipeline } = require('stream/promises');
const { Writable } = require('stream');

const ROWS = 200;

describe('queryStream (object-mode Readable)', function () {

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-qstream.fdb'),
        typeCast: (column, next) =>
            column.alias === 'CASTED' ? `#${next()}` : next(),
    });

    let db;

    beforeAll(async function () {
        db = await Firebird.attachOrCreateAsync(config);
        await db.queryAsync(
            'CREATE TABLE stream_test (id INT NOT NULL PRIMARY KEY, name VARCHAR(20))');
        const rows = [];
        for (let i = 1; i <= ROWS; i++) rows.push([i, 'row' + i]);
        await db.executeBatchAsync('INSERT INTO stream_test VALUES (?, ?)', rows);
    });

    afterAll(async function () {
        if (db) await db.dropAsync();
    });

    it('emits all rows in order and ends', async function () {
        const seen = [];
        for await (const row of db.queryStream('SELECT id, name FROM stream_test ORDER BY id')) {
            seen.push(row);
        }
        assert.strictEqual(seen.length, ROWS);
        assert.strictEqual(seen[0].id, 1);
        assert.strictEqual(seen[ROWS - 1].name, 'row' + ROWS);
    });

    it('supports query parameters and array rows (asObject: false)', async function () {
        const seen = [];
        const stream = db.queryStream(
            'SELECT id FROM stream_test WHERE id <= ? ORDER BY id', [3], { asObject: false });
        for await (const row of stream) seen.push(row);
        assert.deepStrictEqual(seen, [[1], [2], [3]]);
    });

    it('applies backpressure with a slow consumer', async function () {
        let consumed = 0;
        const slow = new Writable({
            objectMode: true,
            highWaterMark: 1,
            write(_row, _enc, cb) {
                consumed++;
                setTimeout(cb, 1);
            },
        });
        await pipeline(
            db.queryStream('SELECT id FROM stream_test ORDER BY id', [], { highWaterMark: 2 }),
            slow);
        assert.strictEqual(consumed, ROWS);
    });

    it('emits an error for a failing query and leaves the connection usable', async function () {
        const stream = db.queryStream('SELECT bogus FROM nowhere');
        await assert.rejects((async () => {
            for await (const _row of stream) { /* drain */ }
        })(), /Table unknown/);

        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM stream_test');
        assert.strictEqual(Number(rows[0].cnt), ROWS);
    });

    it('aborts the fetch on early destroy and stays usable', async function () {
        const stream = db.queryStream('SELECT id, name FROM stream_test ORDER BY id');
        const seen = [];
        await new Promise((resolve, reject) => {
            stream.on('data', (row) => {
                seen.push(row);
                if (seen.length === 5) stream.destroy();
            });
            stream.on('close', resolve);
            stream.on('error', reject);
        });
        assert.strictEqual(seen.length, 5);

        // connection must be fully usable afterwards
        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM stream_test');
        assert.strictEqual(Number(rows[0].cnt), ROWS);
    });

    it('composes with the typeCast hook', async function () {
        const seen = [];
        for await (const row of db.queryStream(
            'SELECT id, name AS casted FROM stream_test WHERE id = 7')) {
            seen.push(row);
        }
        assert.strictEqual(seen[0].casted, '#row7');
    });

    it('works inside an explicit transaction (uncommitted reads)', async function () {
        const tx = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
        try {
            await tx.queryAsync('INSERT INTO stream_test VALUES (?, ?)', [1000, 'tx-only']);
            const seen = [];
            for await (const row of tx.queryStream(
                'SELECT name FROM stream_test WHERE id = ?', [1000])) {
                seen.push(row);
            }
            assert.strictEqual(seen[0].name, 'tx-only');
        } finally {
            await tx.rollbackAsync();
        }
        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM stream_test WHERE id = 1000');
        assert.strictEqual(Number(rows[0].cnt), 0);
    });
});
