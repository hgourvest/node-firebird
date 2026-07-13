const Firebird = require('../lib');
const { GDSCode } = require('../lib/gdscodes');
const Config = require('./config');

const assert = require('assert');

const config = Config.extends(Config.default, {
    database: Config.default.database.replace(/\.fdb$/, '-cancel.fdb'),
});

// A server-side loop that runs for minutes unless cancelled.
const LONG_QUERY = `EXECUTE BLOCK RETURNS (n BIGINT) AS
BEGIN
  n = 0;
  WHILE (n < 2000000000) DO n = n + 1;
  SUSPEND;
END`;

describe('Query cancellation (op_cancel + AbortSignal)', function () {
    let db;

    beforeEach(async function () {
        db = await Firebird.attachOrCreateAsync(config);
    });

    afterEach(async function () {
        if (db) await db.detachAsync();
    });

    it('should cancel a running query when the signal fires', async function () {
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 200);

        await assert.rejects(
            db.queryAsync(LONG_QUERY, [], { signal: controller.signal }),
            (err) => {
                assert.strictEqual(err.gdscode, GDSCode.CANCELLED);
                return true;
            }
        );
        // Uncancelled the query runs for minutes; cancelled it must fail fast.
        assert.ok(Date.now() - started < 3000, 'query was not cancelled promptly');
    });

    it('should leave the connection usable after a cancellation', async function () {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 200);
        await db.queryAsync(LONG_QUERY, [], { signal: controller.signal }).catch(() => {});

        const rows = await db.queryAsync('SELECT 1 AS ok FROM RDB$DATABASE');
        assert.strictEqual(rows[0].ok, 1);
    });

    it('should cancel a transaction-level query too', async function () {
        const transaction = await db.transactionAsync();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 200);

        await assert.rejects(
            transaction.queryAsync(LONG_QUERY, [], { signal: controller.signal }),
            (err) => err.gdscode === GDSCode.CANCELLED
        );
        await transaction.rollbackAsync();
    });

    it('should reject immediately without contacting the server when already aborted', async function () {
        await assert.rejects(
            db.queryAsync('SELECT 1 FROM RDB$DATABASE', [], { signal: AbortSignal.abort() }),
            (err) => {
                assert.strictEqual(err.name, 'AbortError');
                return true;
            }
        );
    });

    it('should run normally when the signal never fires', async function () {
        const controller = new AbortController();
        const rows = await db.queryAsync('SELECT 2 AS ok FROM RDB$DATABASE', [], { signal: controller.signal });
        assert.strictEqual(rows[0].ok, 2);
    });

    it('should treat db.cancelAsync() on an idle connection as harmless', async function () {
        await db.cancelAsync();
        const rows = await db.queryAsync('SELECT 3 AS ok FROM RDB$DATABASE');
        assert.strictEqual(rows[0].ok, 3);
    });

    it('should support callback-style cancellation via db.cancel()', async function () {
        const failure = new Promise((resolve) => {
            db.query(LONG_QUERY, [], (err) => resolve(err));
        });
        setTimeout(() => db.cancel(), 200);

        const err = await failure;
        assert.ok(err, 'expected the cancelled query to fail');
        assert.strictEqual(err.gdscode, GDSCode.CANCELLED);
    });
});
