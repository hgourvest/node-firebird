const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

describe('Prepared-statement cache (statementCacheSize)', function () {

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-stmtcache.fdb'),
        statementCacheSize: 3,
    });

    let db;
    const cache = () => db.connection._statementCache;

    beforeAll(async function () {
        db = await Firebird.attachOrCreateAsync(config);
        await db.queryAsync(
            'CREATE TABLE cache_test (id INT NOT NULL PRIMARY KEY, name VARCHAR(20))');
        await db.queryAsync('INSERT INTO cache_test VALUES (1, ?)', ['alice']);
        await db.queryAsync('INSERT INTO cache_test VALUES (2, ?)', ['bob']);
    });

    afterAll(async function () {
        if (db) await db.dropAsync();
    });

    it('reuses the prepared statement across queries (same object identity)', async function () {
        const SQL = 'SELECT name FROM cache_test WHERE id = ?';
        const tx = await db.transactionAsync();
        try {
            const st1 = await tx.newStatementAsync(SQL);
            await st1.releaseAsync();
            assert.ok(cache().has(SQL), 'statement should be cached after release');

            const st2 = await tx.newStatementAsync(SQL);
            assert.strictEqual(st2, st1, 'cache hit should return the same statement');
            assert.ok(!cache().has(SQL), 'statement in use should leave the cache');
            await st2.releaseAsync();
        } finally {
            await tx.commitAsync();
        }
    });

    it('returns correct results across repeated cached runs', async function () {
        for (let i = 0; i < 10; i++) {
            const id = (i % 2) + 1;
            const rows = await db.queryAsync('SELECT name FROM cache_test WHERE id = ?', [id]);
            assert.strictEqual(rows[0].name, id === 1 ? 'alice' : 'bob');
        }
        assert.ok(cache().size >= 1);
    });

    it('evicts the least-recently-used statement over the limit', async function () {
        // fill the cache (size 3) with distinct queries
        const sqls = [11, 22, 33, 44].map((n) => `SELECT ${n} AS v FROM rdb$database`);
        for (const sql of sqls.slice(0, 3)) {
            await db.queryAsync(sql);
        }
        for (const sql of sqls.slice(0, 3)) {
            assert.ok(cache().has(sql), sql + ' should be cached');
        }
        const evicted = cache().keys().next().value; // current LRU

        await db.queryAsync(sqls[3]); // exceeds the limit
        assert.strictEqual(cache().size, 3);
        assert.ok(cache().has(sqls[3]));
        assert.ok(!cache().has(evicted), 'LRU entry should have been evicted');

        // the evicted query still works (fresh prepare)
        const rows = await db.queryAsync(evicted);
        assert.ok(rows.length === 1);
    });

    it('does not cache failed statements', async function () {
        const SQL = 'INSERT INTO cache_test VALUES (1, ?)'; // PK conflict
        await assert.rejects(db.queryAsync(SQL, ['dup']), /PRIMARY or UNIQUE KEY/);
        assert.ok(!cache().has(SQL), 'failed statement must not be cached');
        // connection unaffected
        const rows = await db.queryAsync('SELECT COUNT(*) AS cnt FROM cache_test');
        assert.strictEqual(Number(rows[0].cnt), 2);
    });

    it('keeps concurrent runs of the same SQL isolated', async function () {
        const SQL = 'SELECT name FROM cache_test WHERE id = ? ORDER BY id';
        const results = await Promise.all([
            db.queryAsync(SQL, [1]),
            db.queryAsync(SQL, [2]),
            db.queryAsync(SQL, [1]),
        ]);
        assert.strictEqual(results[0][0].name, 'alice');
        assert.strictEqual(results[1][0].name, 'bob');
        assert.strictEqual(results[2][0].name, 'alice');
        assert.strictEqual(cache().size <= 3, true);
    });

    it('supports the legacy cacheQuery/maxCachedQuery options', async function () {
        const legacy = await Firebird.attachAsync(Config.extends(config, {
            statementCacheSize: 0,
            cacheQuery: true,
            maxCachedQuery: 2,
        }));
        try {
            assert.strictEqual(legacy.connection._statementCacheSize, 2);
            await legacy.queryAsync('SELECT 1 AS a FROM rdb$database');
            assert.strictEqual(legacy.connection._statementCache.size, 1);
        } finally {
            await legacy.detachAsync();
        }
    });

    it('is disabled by default', async function () {
        const plain = await Firebird.attachAsync(Config.extends(config, {
            statementCacheSize: undefined,
        }));
        try {
            assert.strictEqual(plain.connection._statementCache, null);
            const rows = await plain.queryAsync('SELECT 1 AS a FROM rdb$database');
            assert.strictEqual(Number(rows[0].a), 1);
        } finally {
            await plain.detachAsync();
        }
    });
});
