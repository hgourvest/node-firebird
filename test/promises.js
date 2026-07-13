const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

const config = Config.extends(Config.default, {
    database: Config.default.database.replace(/\.fdb$/, '-promises.fdb'),
});

describe('Promise / async-await API', function () {

    describe('module-level', function () {

        it('should attachOrCreateAsync and detachAsync', async function () {
            const db = await Firebird.attachOrCreateAsync(config);
            assert.ok(db);
            await db.detachAsync();
        });

        it('should attachAsync an existing database', async function () {
            const db = await Firebird.attachAsync(config);
            assert.ok(db);
            await db.detachAsync();
        });

        it('should reject with an Error when the database does not exist', async function () {
            await assert.rejects(
                Firebird.attachAsync(Config.extends(config, { database: '/no/such/dir/nope.fdb' })),
                (err) => {
                    assert.ok(err instanceof Error);
                    return true;
                }
            );
        });
    });

    describe('database', function () {
        let db;

        beforeEach(async function () {
            db = await Firebird.attachOrCreateAsync(config);
            await db.executeAsync('RECREATE TABLE t_promise (id INT, name VARCHAR(50))');
            await db.executeAsync('INSERT INTO t_promise (id, name) VALUES (?, ?)', [1, 'Alice']);
            await db.executeAsync('INSERT INTO t_promise (id, name) VALUES (?, ?)', [2, 'Bob']);
        });

        afterEach(async function () {
            if (db) await db.detachAsync();
        });

        it('should queryAsync rows as objects', async function () {
            const rows = await db.queryAsync('SELECT id, name FROM t_promise ORDER BY id');
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(rows[0].id, 1);
            assert.strictEqual(rows[0].name, 'Alice');
        });

        it('should executeAsync rows as arrays', async function () {
            const rows = await db.executeAsync('SELECT id, name FROM t_promise ORDER BY id');
            assert.strictEqual(rows.length, 2);
            assert.deepStrictEqual(rows[1], [2, 'Bob']);
        });

        it('should reject queryAsync on SQL errors', async function () {
            await assert.rejects(
                db.queryAsync('SELECT * FROM no_such_table'),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.ok(typeof err.gdscode === 'number');
                    return true;
                }
            );
        });

        it('should sequentiallyAsync visit every row in order', async function () {
            const seen = [];
            await db.sequentiallyAsync('SELECT id FROM t_promise ORDER BY id', [], (row) => {
                seen.push(row.id);
            });
            assert.deepStrictEqual(seen, [1, 2]);
        });

        it('should sequentiallyAsync without a params array', async function () {
            const seen = [];
            await db.sequentiallyAsync('SELECT id FROM t_promise ORDER BY id', (row) => {
                seen.push(row.id);
            });
            assert.deepStrictEqual(seen, [1, 2]);
        });

        it('should newStatementAsync a reusable statement', async function () {
            const statement = await db.newStatementAsync('SELECT name FROM t_promise WHERE id = ?');
            const transaction = await db.transactionAsync();
            try {
                await statement.executeAsync(transaction, [2]);
                // Statement-level fetches return rows as arrays by default.
                const ret = await statement.fetchAllAsync(transaction);
                assert.deepStrictEqual(ret, [['Bob']]);
            } finally {
                await statement.releaseAsync();
                await transaction.commitAsync();
            }
        });
    });

    describe('transactions', function () {
        let db;

        beforeEach(async function () {
            db = await Firebird.attachOrCreateAsync(config);
            await db.executeAsync('RECREATE TABLE t_trx (id INT)');
        });

        afterEach(async function () {
            if (db) await db.detachAsync();
        });

        it('should transactionAsync + commitAsync persist changes', async function () {
            const transaction = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED);
            await transaction.executeAsync('INSERT INTO t_trx (id) VALUES (?)', [1]);
            await transaction.commitAsync();

            const rows = await db.queryAsync('SELECT id FROM t_trx');
            assert.strictEqual(rows.length, 1);
        });

        it('should transactionAsync + rollbackAsync discard changes', async function () {
            const transaction = await db.transactionAsync();
            await transaction.executeAsync('INSERT INTO t_trx (id) VALUES (?)', [1]);
            await transaction.rollbackAsync();

            const rows = await db.queryAsync('SELECT id FROM t_trx');
            assert.strictEqual(rows.length, 0);
        });

        it('should withTransaction commit on success and return the result', async function () {
            const result = await db.withTransaction(async (transaction) => {
                await transaction.executeAsync('INSERT INTO t_trx (id) VALUES (?)', [7]);
                const rows = await transaction.queryAsync('SELECT id FROM t_trx');
                return rows.length;
            });
            assert.strictEqual(result, 1);

            const rows = await db.queryAsync('SELECT id FROM t_trx');
            assert.strictEqual(rows.length, 1);
        });

        it('should withTransaction roll back and rethrow on failure', async function () {
            await assert.rejects(
                db.withTransaction(async (transaction) => {
                    await transaction.executeAsync('INSERT INTO t_trx (id) VALUES (?)', [8]);
                    throw new Error('boom');
                }),
                /boom/
            );

            const rows = await db.queryAsync('SELECT id FROM t_trx');
            assert.strictEqual(rows.length, 0);
        });
    });

    describe('pool', function () {

        it('should getAsync, use, detach, and destroyAsync', async function () {
            const pool = Firebird.pool(2, config);
            const db = await pool.getAsync();
            const rows = await db.queryAsync('SELECT 1 AS one FROM RDB$DATABASE');
            assert.strictEqual(rows[0].one, 1);
            await db.detachAsync();
            await pool.destroyAsync();
        });

        it('should withConnection release the connection even on error', async function () {
            const pool = Firebird.pool(1, config);

            await assert.rejects(
                pool.withConnection(async () => { throw new Error('work failed'); }),
                /work failed/
            );

            // The single slot must be free again — this hangs if it leaked.
            const value = await pool.withConnection(async (db) => {
                const rows = await db.queryAsync('SELECT 2 AS two FROM RDB$DATABASE');
                return rows[0].two;
            });
            assert.strictEqual(value, 2);

            await pool.destroyAsync();
        });
    });
});
