const Firebird = require('../lib');
const Config = require('./config');
const Pool = require('../lib/pool');

const assert = require('assert');

const config = Config.extends(Config.default, {
    database: Config.default.database.replace(/\.fdb$/, '-pool-obs.fdb'),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Pool observability (events + metrics)', function () {
    let seedDb;

    beforeAll(async function () {
        // make sure the database exists before pooled attaches race to create it
        seedDb = await Firebird.attachOrCreateAsync(config);
    });

    afterAll(async function () {
        if (seedDb) await seedDb.detachAsync();
    });

    it('should start with zeroed metrics', function () {
        const pool = Firebird.pool(3, config);
        assert.strictEqual(pool.totalCount, 0);
        assert.strictEqual(pool.idleCount, 0);
        assert.strictEqual(pool.activeCount, 0);
        assert.strictEqual(pool.waitingCount, 0);
        return pool.destroyAsync();
    });

    it('should emit connect/acquire/release and track counts through a lifecycle', async function () {
        const pool = Firebird.pool(3, config);
        const events = [];
        for (const ev of ['connect', 'acquire', 'release', 'remove']) {
            pool.on(ev, () => events.push(ev));
        }

        try {
            const db = await pool.getAsync();
            assert.deepStrictEqual(events, ['connect', 'acquire']);
            assert.strictEqual(pool.totalCount, 1);
            assert.strictEqual(pool.activeCount, 1);
            assert.strictEqual(pool.idleCount, 0);

            await new Promise((resolve) => db.detach(resolve));
            assert.deepStrictEqual(events, ['connect', 'acquire', 'release']);
            assert.strictEqual(pool.totalCount, 1);
            assert.strictEqual(pool.activeCount, 0);
            assert.strictEqual(pool.idleCount, 1);

            // second acquisition reuses the idle connection: no new 'connect'
            const db2 = await pool.getAsync();
            assert.deepStrictEqual(events, ['connect', 'acquire', 'release', 'acquire']);
            assert.strictEqual(pool.idleCount, 0);
            await new Promise((resolve) => db2.detach(resolve));
        } finally {
            await pool.destroyAsync();
        }
        // destroy closes the idle physical connection
        assert.ok(events.includes('remove'));
        assert.strictEqual(pool.idleCount, 0);
    });

    it('should count callers waiting for a slot', async function () {
        const pool = Firebird.pool(1, config);
        try {
            const db = await pool.getAsync();
            const waiter = pool.getAsync(); // queued: pool is exhausted
            await sleep(50);
            assert.strictEqual(pool.waitingCount, 1);
            assert.strictEqual(pool.activeCount, 1);

            await new Promise((resolve) => db.detach(resolve));
            const db2 = await waiter;
            assert.strictEqual(pool.waitingCount, 0);
            await new Promise((resolve) => db2.detach(resolve));
        } finally {
            await pool.destroyAsync();
        }
    });

    it('should reap idle connections after idleTimeoutMillis (issue #329)', async function () {
        const pool = Firebird.pool(3, Object.assign({}, config, { idleTimeoutMillis: 300 }));
        const removed = [];
        pool.on('remove', (db) => removed.push(db));

        try {
            const db = await pool.getAsync();
            await new Promise((resolve) => db.detach(resolve));
            assert.strictEqual(pool.idleCount, 1);

            await sleep(900); // > idleTimeoutMillis + sweep interval
            assert.strictEqual(pool.idleCount, 0);
            assert.strictEqual(pool.totalCount, 0);
            assert.strictEqual(removed.length, 1);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('should keep min connections alive through the reaper', async function () {
        const pool = Firebird.pool(3, Object.assign({}, config, { idleTimeoutMillis: 200, min: 1 }));
        try {
            const a = await pool.getAsync();
            const b = await pool.getAsync();
            await new Promise((resolve) => a.detach(resolve));
            await new Promise((resolve) => b.detach(resolve));
            assert.strictEqual(pool.idleCount, 2);

            await sleep(700);
            assert.strictEqual(pool.totalCount, 1, 'reaper must stop at min');
            assert.strictEqual(pool.idleCount, 1);

            // the surviving connection must still work
            const rows = await pool.withConnection((db) =>
                db.queryAsync('SELECT 1 AS one FROM rdb$database'));
            assert.strictEqual(rows[0].one, 1);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('should evict dead idle connections on the sweep (issue #343)', function () {
        // note: against a live server the driver auto-reconnects dropped
        // sockets (retryConnectionInterval); the sweep eviction matters when
        // reconnection is unavailable or has failed, so craft that state.
        const pool = new Pool(() => {}, 3, { idleTimeoutMillis: 60000 });
        const removed = [];
        pool.on('remove', () => removed.push(1));

        // long idle timeout: the eviction is due to death, not idleness
        const dead = {
            connection: { _isClosed: true, _socket: { destroyed: true } },
            __poolIdleSince: Date.now(),
        };
        pool.internaldb.push(dead);
        pool.pooldb.push(dead);

        pool._reap();
        assert.strictEqual(pool.idleCount, 0);
        assert.strictEqual(pool.totalCount, 0);
        assert.strictEqual(removed.length, 1);
        pool.destroy();
    });

    it('should hand out a fresh connection when the idle one died (issue #343)', async function () {
        const pool = Firebird.pool(3, config);
        try {
            const db = await pool.getAsync();
            await new Promise((resolve) => db.detach(resolve));
            db.connection._socket.destroy();
            await sleep(50);

            // get() discards the dead connection and attaches a new one
            const rows = await pool.withConnection((fresh) =>
                fresh.queryAsync('SELECT 1 AS one FROM rdb$database'));
            assert.strictEqual(rows[0].one, 1);
            assert.strictEqual(pool.totalCount, 1);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('should not crash on reaper errors when no error listener is attached', function () {
        const pool = new Pool(() => {}, 2, { idleTimeoutMillis: 100 });

        // craft an expired idle connection whose detach fails
        const db = {
            detach: (dcb) => dcb(new Error('detach boom')),
            connection: { _socket: {} },
            __poolIdleSince: 0,
        };
        pool.internaldb.push(db);
        pool.pooldb.push(db);

        pool._reap(); // must not throw despite the failing detach
        assert.strictEqual(pool.pooldb.length, 0);
        assert.strictEqual(pool.totalCount, 0);
        pool.destroy();
    });

    it('should emit reaper errors when a listener is attached', function () {
        const pool = new Pool(() => {}, 2, { idleTimeoutMillis: 100 });
        const errors = [];
        pool.on('error', (err) => errors.push(err));

        const db = {
            detach: (dcb) => dcb(new Error('detach boom')),
            connection: { _socket: {} },
            __poolIdleSince: 0,
        };
        pool.internaldb.push(db);
        pool.pooldb.push(db);

        pool._reap();
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].message, 'detach boom');
        pool.destroy();
    });

    it('should stop the reaper timer on destroy', function () {
        const pool = Firebird.pool(2, Object.assign({}, config, { idleTimeoutMillis: 100 }));
        assert.ok(pool._reaper);
        return pool.destroyAsync().then(() => {
            assert.strictEqual(pool._reaper, null);
        });
    });
});
