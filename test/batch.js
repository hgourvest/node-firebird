const Firebird = require('../lib');
const Config = require('./config');
const Const = require('../lib/wire/const');

const assert = require('assert');

const config = Config.extends(Config.default, {
    database: Config.default.database.replace(/\.fdb$/, '-batch.fdb'),
});

const INSERT = 'INSERT INTO batch_t (id, name, amount, created, active, big) VALUES (?, ?, ?, ?, ?, ?)';

// The batch API needs wire protocol 16+ (Firebird 4.0). Detected once in
// beforeAll; every test skips itself on older servers (e.g. Firebird 3 CI).
let batchSupported = true;

// it() wrapper that skips when the server has no batch support
const itBatch = (name, fn) => it(name, function (ctx) {
    if (!batchSupported) return ctx.skip();
    return fn.call(this, ctx);
});

describe('Batch API (op_batch_create/msg/exec, Firebird 4+)', function () {
    let db;

    beforeAll(async function () {
        const probe = await Firebird.attachOrCreateAsync(config);
        batchSupported = probe.connection.accept.protocolVersion >= Const.PROTOCOL_VERSION16;
        await probe.detachAsync();
    });

    beforeEach(async function () {
        if (!batchSupported) return;
        db = await Firebird.attachOrCreateAsync(config);
        await db.executeAsync(`RECREATE TABLE batch_t (
            id INT NOT NULL PRIMARY KEY,
            name VARCHAR(40),
            amount NUMERIC(12,2),
            created TIMESTAMP,
            active BOOLEAN,
            big BIGINT
        )`);
    });

    afterEach(async function () {
        if (db) await db.detachAsync();
        db = null;
    });

    itBatch('should insert many rows with mixed types and nulls', async function () {
        const rows = [];
        for (let i = 1; i <= 300; i++) {
            rows.push([
                i,
                i % 7 === 0 ? null : 'name-' + i,
                i * 1.25,
                new Date(2026, 0, 1 + (i % 28)),
                i % 2 === 0,
                i % 5 === 0 ? null : BigInt(i) * 1000000000n,
            ]);
        }

        const res = await db.executeBatchAsync(INSERT, rows);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.recordCount, 300);
        assert.strictEqual(res.updateCounts.length, 300);
        assert.ok(res.updateCounts.every((c) => c === 1));
        assert.deepStrictEqual(res.errors, []);

        const check = await db.queryAsync('SELECT COUNT(*) AS n, SUM(amount) AS s FROM batch_t');
        assert.strictEqual(check[0].n, 300);
        // sum of i*1.25 for 1..300 = 1.25 * 300*301/2
        assert.strictEqual(Number(check[0].s), 1.25 * (300 * 301) / 2);

        const row7 = await db.queryAsync('SELECT name, big, active FROM batch_t WHERE id = 7');
        assert.strictEqual(row7[0].name, null);
        assert.strictEqual(Number(row7[0].big), 7000000000);
        assert.strictEqual(row7[0].active, false);
    });

    itBatch('should round-trip booleans and timestamps', async function () {
        const created = new Date(2026, 3, 15, 12, 30, 45);
        await db.executeBatchAsync(INSERT, [
            [1, 'yes', 1, created, true, 1n],
            [2, 'no', 2, created, false, 2n],
            [3, 'none', 3, created, null, 3n],
        ]);

        const rows = await db.queryAsync('SELECT id, active, created FROM batch_t ORDER BY id');
        assert.strictEqual(rows[0].active, true);
        assert.strictEqual(rows[1].active, false);
        assert.strictEqual(rows[2].active, null);
        assert.strictEqual(rows[0].created.getTime(), created.getTime());
    });

    itBatch('should chunk large batches into multiple op_batch_msg packets', async function () {
        const rows = [];
        for (let i = 1; i <= 120; i++) {
            rows.push([i, 'chunked-' + i, i, new Date(), true, null]);
        }

        // chunkSize 50 → 3 op_batch_msg packets for 120 rows
        const res = await db.executeBatchAsync(INSERT, rows, { chunkSize: 50 });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.recordCount, 120);

        const check = await db.queryAsync('SELECT COUNT(*) AS n FROM batch_t');
        assert.strictEqual(check[0].n, 120);
    });

    itBatch('should roll back everything on error at database level (all-or-nothing)', async function () {
        const badRows = [
            [1, 'a', 1, new Date(), true, 1n],
            [2, 'b', 2, new Date(), true, 2n],
            [2, 'dup', 3, new Date(), true, 3n], // duplicate PK
            [4, 'd', 4, new Date(), true, 4n],
        ];

        await assert.rejects(
            db.executeBatchAsync(INSERT, badRows),
            (err) => {
                assert.ok(err.gdscode, 'expected a gdscode on the error');
                assert.ok(err.batchCompletion, 'expected the completion state on the error');
                assert.deepStrictEqual(err.batchCompletion.errorRecordNumbers, [2]);
                return true;
            }
        );

        const after = await db.queryAsync('SELECT COUNT(*) AS n FROM batch_t');
        assert.strictEqual(after[0].n, 0);
    });

    itBatch('should report partial success at transaction level (multiError)', async function () {
        const badRows = [
            [1, 'a', 1, new Date(), true, 1n],
            [2, 'b', 2, new Date(), true, 2n],
            [2, 'dup', 3, new Date(), true, 3n], // duplicate PK
            [4, 'd', 4, new Date(), true, 4n],
        ];

        const tr = await db.transactionAsync();
        try {
            const res = await tr.executeBatchAsync(INSERT, badRows);
            assert.strictEqual(res.success, false);
            assert.deepStrictEqual(res.errorRecordNumbers, [2]);
            assert.strictEqual(res.errors.length, 1);
            assert.strictEqual(res.errors[0].recordNumber, 2);
            assert.ok(res.errors[0].error.gdscode, 'expected a gdscode on the record error');
            await tr.commitAsync();
        } catch (e) {
            await tr.rollbackAsync().catch(() => {});
            throw e;
        }

        const after = await db.queryAsync('SELECT id FROM batch_t ORDER BY id');
        assert.deepStrictEqual(after.map((r) => r.id), [1, 2, 4]);
    });

    itBatch('should resolve immediately for empty rows', async function () {
        const res = await db.executeBatchAsync(INSERT, []);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.recordCount, 0);
        assert.deepStrictEqual(res.updateCounts, []);
    });

    itBatch('should reject rows that do not match the parameter count', async function () {
        await assert.rejects(
            db.executeBatchAsync(INSERT, [[1, 'a']]),
            /row 0 must be an array of 6 values/
        );
    });

    itBatch('should reject string truncation server-side', async function () {
        // 41 chars fit in VARCHAR(40)'s utf8 byte capacity, so the overflow
        // is caught by the server. Firebird 6 reports it per record in the
        // batch completion state; Firebird 4/5 fail the batch as a whole
        // with the truncation error.
        const rows = [[1, 'x'.repeat(41), 1, new Date(), true, 1n]];
        await assert.rejects(
            db.executeBatchAsync(INSERT, rows),
            (err) => {
                if (err.batchCompletion) {
                    assert.deepStrictEqual(err.batchCompletion.errorRecordNumbers, [0]);
                } else {
                    // FB4/5 wrap it in a DSQL_ERROR status vector, so match
                    // the message instead of a specific leading gdscode
                    assert.match(err.message, /string right truncation/i,
                        'unexpected batch error: ' + err.message);
                }
                return true;
            }
        );

        // no record may have been committed either way
        const after = await db.queryAsync('SELECT COUNT(*) AS n FROM batch_t');
        assert.strictEqual(after[0].n, 0);
    });

    itBatch('should reject values over the wire capacity before sending anything', async function () {
        // 161 bytes exceed VARCHAR(40) utf8's 160-byte wire slot: the client
        // must fail the whole batch without writing a single packet
        const rows = [[1, 'x'.repeat(161), 1, new Date(), true, 1n]];
        await assert.rejects(
            db.executeBatchAsync(INSERT, rows),
            /column 2/
        );

        // the connection must remain usable
        const ping = await db.queryAsync('SELECT 1 AS one FROM rdb$database');
        assert.strictEqual(ping[0].one, 1);
    });

    itBatch('should work with the callback API on a statement', function () {
        return new Promise(function (resolve, reject) {
            db.transaction(function (err, tr) {
                if (err) return reject(err);
                tr.newStatement(INSERT, function (err, st) {
                    if (err) return reject(err);
                    st.executeBatch(tr, [[1, 'cb', 1, new Date(), true, 1n]], function (err, res) {
                        if (err) return reject(err);
                        st.release(function () {
                            tr.commit(function (err) {
                                if (err) return reject(err);
                                try {
                                    assert.strictEqual(res.success, true);
                                    assert.strictEqual(res.recordCount, 1);
                                } catch (e) {
                                    return reject(e);
                                }
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    });
});
