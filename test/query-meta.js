'use strict';

/**
 * Live tests for result metadata (roadmap #13) and server warnings (#15):
 *
 * - `withMeta: true` (per-query, callback and promise APIs) delivers
 *   { rows, fields, affectedRows, recordCounts, warnings } instead of the
 *   bare rows. For DML, affectedRows comes from the server
 *   (isc_info_sql_records via op_info_sql — one extra info request, hence
 *   opt-in); for SELECT it is rows.length with no extra round-trip.
 * - isc_arg_warning entries on any op_response are emitted as 'warning'
 *   events on the Database (they used to be parsed and dropped). The
 *   emission is next-tick, so a listener registered in the attach callback
 *   still catches attach-time warnings.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const options = Config.extends(Config.default, {
    database: path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-querymeta-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    ),
    lowercase_keys: false,
});

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('withMeta result metadata (#13)', function () {
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await db.queryAsync('CREATE TABLE T (ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(20))');
        await db.queryAsync('INSERT INTO T VALUES (1, ?)', ['a']);
        await db.queryAsync('INSERT INTO T VALUES (2, ?)', ['b']);
        await db.queryAsync('INSERT INTO T VALUES (3, ?)', ['c']);
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it('INSERT reports affectedRows and recordCounts', async function () {
        const r = await db.queryAsync('INSERT INTO T VALUES (10, ?)', ['x'], { withMeta: true });
        assert.strictEqual(r.affectedRows, 1);
        assert.strictEqual(r.recordCounts.insertCount, 1);
        assert.strictEqual(r.rows, undefined);
        assert.ok(Array.isArray(r.warnings));
    });

    it('UPDATE reports the number of rows the server changed', async function () {
        const r = await db.queryAsync("UPDATE T SET NAME = 'u' WHERE ID < 3", [], { withMeta: true });
        assert.strictEqual(r.affectedRows, 2);
        assert.strictEqual(r.recordCounts.updateCount, 2);

        const zero = await db.queryAsync("UPDATE T SET NAME = 'z' WHERE ID = 999", [], { withMeta: true });
        assert.strictEqual(zero.affectedRows, 0);
    });

    it('DELETE reports affectedRows', async function () {
        const r = await db.queryAsync('DELETE FROM T WHERE ID = 10', [], { withMeta: true });
        assert.strictEqual(r.affectedRows, 1);
        assert.strictEqual(r.recordCounts.deleteCount, 1);
    });

    it('INSERT ... RETURNING delivers the row and counts', async function () {
        const r = await db.queryAsync("INSERT INTO T VALUES (11, 'y') RETURNING ID, NAME", [], { withMeta: true });
        assert.strictEqual(r.affectedRows, 1);
        assert.deepStrictEqual(r.rows, { ID: 11, NAME: 'y' });
        assert.deepStrictEqual(r.fields.map(f => f.alias), ['ID', 'NAME']);
        await db.queryAsync('DELETE FROM T WHERE ID = 11');
    });

    it('SELECT: affectedRows = rows.length, fields carry column metadata, no extra round-trip counts', async function () {
        const r = await db.queryAsync('SELECT ID, NAME FROM T ORDER BY ID', [], { withMeta: true });
        assert.strictEqual(r.rows.length, 3);
        assert.strictEqual(r.affectedRows, 3);
        assert.strictEqual(r.recordCounts, undefined);
        const name = r.fields[1];
        assert.strictEqual(name.alias, 'NAME');
        assert.strictEqual(name.field, 'NAME');
        assert.strictEqual(name.relation, 'T');
        assert.strictEqual(name.typeName, 'VARYING');
        assert.strictEqual(name.nullable, true);
    });

    it('DDL: affectedRows 0, no recordCounts', async function () {
        const r = await db.queryAsync('CREATE TABLE T_DDL (ID INT)', [], { withMeta: true });
        assert.strictEqual(r.affectedRows, 0);
        assert.strictEqual(r.recordCounts, undefined);
        await db.queryAsync('DROP TABLE T_DDL');
    });

    it('works on the callback API and inside explicit transactions', async function () {
        const res = await new Promise((resolve, reject) => {
            db.query('SELECT COUNT(*) CNT FROM T', [], (err, r) => err ? reject(err) : resolve(r), { withMeta: true });
        });
        assert.strictEqual(typeof res.affectedRows, 'number');
        assert.strictEqual(res.fields[0].alias, 'CNT');

        const tx = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
        try {
            const r = await tx.queryAsync('INSERT INTO T VALUES (12, ?)', ['t'], { withMeta: true });
            assert.strictEqual(r.affectedRows, 1);
        } finally {
            await tx.rollbackAsync();
        }
    });

    it('withMeta is ignored on the streaming APIs (rows bypass the result there)', async function () {
        const seen = [];
        const completion = await new Promise((resolve, reject) => {
            db.sequentially('SELECT ID FROM T ORDER BY ID', [], (row) => { seen.push(row); },
                (err, result) => err ? reject(err) : resolve(result), { withMeta: true });
        });
        assert.strictEqual(seen.length, 3);
        // completion must NOT carry a bogus { rows: [], affectedRows: 0 } object
        assert.strictEqual(completion === undefined || Array.isArray(completion), true);
    });

    it('without withMeta the result shape is unchanged', async function () {
        const rows = await db.queryAsync('SELECT ID FROM T ORDER BY ID');
        assert.ok(Array.isArray(rows));
        assert.strictEqual(typeof rows[0].ID, 'number');
    });
});

describe("server warnings surfaced as 'warning' events (#15)", function () {
    it('parallelWorkers above the server maximum emits a warning on attach', async function (ctx) {
        // "parallel workers value capped" arrives as isc_arg_warning on the
        // attach op_response; emission is next-tick so this listener —
        // registered in the attach callback — receives it
        const warningDb = path.join(
            process.env.FIREBIRD_DATA || Config.testDir,
            'test-warn-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
        );
        const db = await fromCallback(cb => Firebird.create({ ...options, database: warningDb }, cb));
        await fromCallback(cb => db.detach(cb));

        const warnings = [];
        const db2 = await fromCallback(cb =>
            Firebird.attach({ ...options, database: warningDb, parallelWorkers: 99 }, (err, d) => {
                if (!err) {
                    d.on('warning', w => warnings.push(w));
                }
                cb(err, d);
            }));
        try {
            const Const = require('../lib/wire/const');
            if (db2.connection.accept.protocolVersion < Const.PROTOCOL_VERSION18) {
                // pre-FB5 servers ignore the parallel_workers DPB tag, so no
                // warning is produced — nothing to assert
                return ctx.skip();
            }
            await new Promise(res => setTimeout(res, 200));
            assert.ok(warnings.length >= 1, 'expected a warning event');
            assert.strictEqual(typeof warnings[0].gdscode, 'number');
            assert.ok(warnings[0].message && warnings[0].message.length > 0);
        } finally {
            await fromCallback(cb => db2.drop(cb));
        }
    });
});
