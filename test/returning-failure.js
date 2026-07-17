const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const Config = require('./config');

const assert = require('assert');

// Issue #341: a failing INSERT ... RETURNING (PK/FK violation, deadlock, ...)
// left the trailing op_response of op_execute2 unconsumed, shifting every
// later response to the wrong callback and poisoning the connection.
describe('Failing RETURNING statements (issue #341)', function () {

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-returning.fdb'),
    });

    const INSERT = 'INSERT INTO ret_test (id, name) VALUES (?, ?) RETURNING id';

    let db;

    beforeAll(async function () {
        db = await Firebird.attachOrCreateAsync(config);
        await db.queryAsync(
            'CREATE TABLE ret_test (id INT NOT NULL PRIMARY KEY, name VARCHAR(50))');
    });

    afterAll(async function () {
        if (db) await db.dropAsync();
    });

    it('reports the constraint error and keeps the transaction usable', async function () {
        const tx = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const first = await tx.queryAsync(INSERT, [1, 'first']);
            assert.strictEqual(first.id, 1);

            await assert.rejects(tx.queryAsync(INSERT, [1, 'dup']), function (err) {
                assert.match(err.message, /PRIMARY or UNIQUE KEY/);
                return true;
            });

            // the same transaction must still accept statements
            const third = await tx.queryAsync(INSERT, [2, 'second']);
            assert.strictEqual(third.id, 2);

            const count = await tx.queryAsync('SELECT COUNT(*) AS cnt FROM ret_test');
            assert.strictEqual(Number(count[0].cnt), 2);

            await tx.commitAsync();
        } catch (e) {
            await tx.rollbackAsync().catch(function () {});
            throw e;
        }

        // and so must the connection, outside the transaction
        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM ret_test');
        assert.strictEqual(Number(rows[0].cnt), 2);
    });

    it('recovers on db-level queries (implicit transaction)', async function () {
        await assert.rejects(db.queryAsync(INSERT, [1, 'dup']), /PRIMARY or UNIQUE KEY/);
        const row = await db.queryAsync(INSERT, [3, 'third']);
        assert.strictEqual(row.id, 3);
    });

    it('returns no row (not an error) for a zero-row UPDATE ... RETURNING', async function () {
        const result = await db.queryAsync(
            'UPDATE ret_test SET name = ? WHERE id = ? RETURNING id', ['x', 999]);
        if (db.connection.accept.protocolVersion >= Const.PROTOCOL_VERSION18) {
            // FB5+ executes RETURNING through a real cursor: zero rows
            assert.deepStrictEqual(result, []);
        } else {
            // Pre-protocol-18 servers answer the singleton op_execute2 with
            // an all-NULL output message when no row matched — the driver
            // faithfully reports it (the wire cannot distinguish it from a
            // matched row whose returned columns are NULL)
            assert.deepStrictEqual(result, { id: null });
        }
        // connection still in sync
        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM ret_test');
        assert.strictEqual(Number(rows[0].cnt), 3);
    });

    it('survives repeated failures back-to-back', async function () {
        for (let i = 0; i < 3; i++) {
            await assert.rejects(db.queryAsync(INSERT, [1, 'dup' + i]), /PRIMARY or UNIQUE KEY/);
        }
        const row = await db.queryAsync(INSERT, [4, 'fourth']);
        assert.strictEqual(row.id, 4);
    });

    it('keeps pipelined statements in sync around a failure', async function () {
        // fire everything without awaiting in between, so the responses can
        // share TCP segments (this also exercised stale f* decode state)
        const settle = (p) => p.then((r) => ({ r }), (e) => ({ e }));
        const results = await Promise.all([
            settle(db.queryAsync(INSERT, [5, 'five'])),
            settle(db.queryAsync(INSERT, [1, 'dup-pipe'])),
            settle(db.queryAsync(INSERT, [6, 'six'])),
            settle(db.queryAsync('SELECT COUNT(*) AS cnt FROM ret_test')),
        ]);

        assert.strictEqual(results[0].r.id, 5);
        assert.match(results[1].e.message, /PRIMARY or UNIQUE KEY/);
        assert.strictEqual(results[2].r.id, 6);
        assert.ok(Array.isArray(results[3].r));
    });
});
