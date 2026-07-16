const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

describe('Named placeholders (:name)', function () {

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-named.fdb'),
        namedPlaceholders: true,
    });

    let db;

    beforeAll(async function () {
        db = await Firebird.attachOrCreateAsync(config);
        await db.queryAsync(
            'CREATE TABLE named_test (id INT NOT NULL PRIMARY KEY, name VARCHAR(50), score INT)');
        await db.queryAsync(
            'INSERT INTO named_test (id, name, score) VALUES (?, ?, ?)', [1, 'alice', 10]);
        await db.queryAsync(
            'INSERT INTO named_test (id, name, score) VALUES (?, ?, ?)', [2, 'bob', 20]);
    });

    afterAll(async function () {
        if (db) await db.dropAsync();
    });

    it('binds an object onto :name markers (promise API)', async function () {
        const rows = await db.queryAsync(
            'SELECT name FROM named_test WHERE id = :id', { id: 2 });
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].name, 'bob');
    });

    it('binds an object onto :name markers (callback API)', function () {
        return new Promise(function (resolve, reject) {
            db.query('SELECT id FROM named_test WHERE name = :name', { name: 'alice' },
                function (err, rows) {
                    if (err) return reject(err);
                    try {
                        assert.strictEqual(rows[0].id, 1);
                        resolve();
                    } catch (e) { reject(e); }
                });
        });
    });

    it('binds a repeated name once per occurrence', async function () {
        // :v binds twice: id = 2 matches bob, score = 2 * 5 matches alice
        const rows = await db.queryAsync(
            'SELECT id FROM named_test WHERE id = :v OR score = :v * 5 ORDER BY id',
            { v: 2 });
        assert.deepStrictEqual(rows.map(r => r.id), [1, 2]);
    });

    it('keeps positional arrays working with the option enabled', async function () {
        const rows = await db.queryAsync(
            'SELECT name FROM named_test WHERE id = ?', [1]);
        assert.strictEqual(rows[0].name, 'alice');
    });

    it('leaves :text inside string literals alone', async function () {
        const rows = await db.queryAsync(
            "SELECT ':id' AS lit, name FROM named_test WHERE id = :id", { id: 1 });
        assert.strictEqual(rows[0].lit, ':id');
        assert.strictEqual(rows[0].name, 'alice');
    });

    it('fails with a clear error when a name is missing', async function () {
        await assert.rejects(
            db.queryAsync('SELECT * FROM named_test WHERE id = :id', { wrong: 1 }),
            /Missing value for named placeholder\(s\): id/);
    });

    it('works inside an explicit transaction', async function () {
        const rows = await db.withTransaction((tx) =>
            tx.queryAsync('SELECT score FROM named_test WHERE id = :id', { id: 2 }));
        assert.strictEqual(rows[0].score, 20);
    });

    it('works with prepared statements (newStatement / execute)', async function () {
        const statement = await db.newStatementAsync(
            'SELECT name FROM named_test WHERE id = :id');
        const transaction = await db.transactionAsync();
        try {
            await statement.executeAsync(transaction, { id: 1 });
            const rows = await statement.fetchAllAsync(transaction);
            assert.strictEqual(rows.length, 1);
        } finally {
            await transaction.commitAsync();
            await statement.dropAsync();
        }
    });

    it('binds object rows in executeBatch (Firebird 4.0+)', async function (ctx) {
        // Skip on servers without the batch API (protocol < 16)
        if (db.connection.accept.protocolVersion < 16) return ctx.skip();

        const result = await db.executeBatchAsync(
            'INSERT INTO named_test (id, name, score) VALUES (:id, :name, :score)',
            [
                { id: 100, name: 'batch-a', score: 1 },
                { id: 101, name: 'batch-b', score: 2 },
            ]);
        assert.strictEqual(result.success, true);

        const rows = await db.queryAsync(
            'SELECT COUNT(*) AS cnt FROM named_test WHERE id >= :low', { low: 100 });
        assert.strictEqual(Number(rows[0].cnt), 2);
    });

    it('can be disabled per query (namedPlaceholders: false)', async function () {
        // An EXECUTE BLOCK body uses :variable for PSQL references — the
        // per-query override keeps those out of the rewriter's hands.
        const rows = await db.queryAsync(
            'EXECUTE BLOCK RETURNS (doubled INT) AS ' +
            'DECLARE n INT = 21; ' +
            'BEGIN doubled = :n * 2; SUSPEND; END',
            [], { namedPlaceholders: false });
        assert.strictEqual(rows[0].doubled, 42);
    });

    it('stays off by default (no connection option)', async function () {
        const plain = await Firebird.attachAsync(Config.extends(config, {
            namedPlaceholders: undefined,
        }));
        try {
            // Without the option, :id is sent to the server as-is → DSQL error
            await assert.rejects(
                plain.queryAsync('SELECT * FROM named_test WHERE id = :id', { id: 1 }));
        } finally {
            await plain.detachAsync();
        }
    });

    it('can be enabled through a connection URI', async function () {
        const uri = 'firebird://' +
            encodeURIComponent(config.user) + ':' + encodeURIComponent(config.password) +
            '@' + config.host + ':' + config.port + '/' + config.database +
            '?namedPlaceholders=true&lowercase_keys=true';
        const udb = await Firebird.attachAsync(uri);
        try {
            const rows = await udb.queryAsync(
                'SELECT name FROM named_test WHERE id = :id', { id: 2 });
            assert.strictEqual(rows[0].name, 'bob');
        } finally {
            await udb.detachAsync();
        }
    });
});
