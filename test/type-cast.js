const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

describe('typeCast hook', function () {

    // each test installs its own hook; null means "defaults"
    let hook = null;

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-typecast.fdb'),
        blobAsText: true,
        typeCast: (column, next) => (hook ? hook(column, next) : next()),
    });

    let db;

    beforeAll(async function () {
        db = await Firebird.attachOrCreateAsync(config);
        await db.queryAsync(
            'CREATE TABLE cast_test (id INT NOT NULL PRIMARY KEY, name VARCHAR(20), ' +
            'big BIGINT, price NUMERIC(10,2), born DATE, note BLOB SUB_TYPE TEXT)');
        await db.queryAsync(
            'INSERT INTO cast_test (id, name, big, price, born, note) VALUES (?, ?, ?, ?, ?, ?)',
            [1, 'alice', 123456789012345, 12.34, '2000-01-02', 'hello blob']);
        await db.queryAsync(
            'INSERT INTO cast_test (id, name, big, price, born, note) VALUES (?, ?, ?, ?, ?, ?)',
            [2, 'bob', 42, null, null, null]);
        await db.queryAsync(
            'CREATE TABLE numeric_mode_test (id INT NOT NULL PRIMARY KEY, ' +
            'amount DECIMAL(15,4), raw_big BIGINT)');
        await db.queryAsync(
            'INSERT INTO numeric_mode_test VALUES (1, 900719925474.0991, 9007199254740991)');
        await db.queryAsync(
            'INSERT INTO numeric_mode_test VALUES (2, 900719925474.0992, 9007199254740992)');
        await db.queryAsync(
            'INSERT INTO numeric_mode_test VALUES (3, 900719925474.0993, 9223372036854775807)');
        await db.queryAsync(
            'INSERT INTO numeric_mode_test VALUES (4, -900719925474.0993, -9223372036854775808)');
        await db.queryAsync(
            'INSERT INTO numeric_mode_test VALUES (5, 42.0000, 42)');
    });

    afterAll(async function () {
        if (db) await db.dropAsync();
    });

    afterEach(function () {
        hook = null;
    });

    it('is not applied when returning next() (identity)', async function () {
        hook = (column, next) => next();
        const withHook = await db.queryAsync('SELECT id, name FROM cast_test ORDER BY id');
        hook = null;
        const withoutHook = await db.queryAsync('SELECT id, name FROM cast_test ORDER BY id');
        assert.deepStrictEqual(withHook, withoutHook);
    });

    it('receives column metadata (type, typeName, names, scale)', async function () {
        const seen = {};
        hook = (column, next) => {
            seen[column.alias] = column;
            return next();
        };
        await db.queryAsync(
            'SELECT name AS the_name, big, price FROM cast_test WHERE id = 1');

        assert.strictEqual(seen.THE_NAME.typeName, 'VARYING');
        assert.strictEqual(seen.THE_NAME.type, Firebird.SQL_TYPES.SQL_VARYING);
        assert.strictEqual(seen.THE_NAME.field, 'NAME');
        assert.match(seen.THE_NAME.relation, /CAST_TEST/);
        assert.strictEqual(seen.BIG.typeName, 'INT64');
        assert.strictEqual(seen.PRICE.scale, -2);
    });

    it('overrides value decoding per type (BIGINT as string)', async function () {
        hook = (column, next) =>
            column.typeName === 'INT64' && !column.scale ? String(next()) : next();
        const rows = await db.queryAsync(
            'SELECT big, name FROM cast_test ORDER BY id');
        assert.strictEqual(rows[0].big, '123456789012345');
        assert.strictEqual(typeof rows[1].big, 'string');
        assert.strictEqual(rows[0].name, 'alice'); // untouched
    });

    it('safe numeric mode preserves unsafe INT64-backed values exactly', async function () {
        const safeDb = await Firebird.attachAsync(Config.extends(config, {
            numericMode: Firebird.NUMERIC_MODE_SAFE,
        }));
        try {
            const rows = await safeDb.queryAsync(
                'SELECT id, amount, raw_big, CAST(amount AS VARCHAR(40)) expected_amount, ' +
                'CAST(raw_big AS VARCHAR(40)) expected_big FROM numeric_mode_test ORDER BY id');

            assert.strictEqual(rows[0].amount, 900719925474.0991);
            assert.strictEqual(rows[0].raw_big, 9007199254740991);
            for (const row of rows.slice(1, 4)) {
                assert.strictEqual(row.amount, row.expected_amount.trim());
                assert.strictEqual(row.raw_big, row.expected_big.trim());
            }
            assert.strictEqual(rows[4].amount, 42);
            assert.strictEqual(rows[4].raw_big, 42);
        } finally {
            await safeDb.detachAsync();
        }
    });

    it('string numeric mode gives INT64-backed columns a stable exact type', async function () {
        const stringDb = await Firebird.attachAsync(Config.extends(config, {
            numericMode: Firebird.NUMERIC_MODE_STRING,
        }));
        try {
            const rows = await stringDb.queryAsync(
                'SELECT amount, raw_big FROM numeric_mode_test ORDER BY id');
            assert.deepStrictEqual(rows[0], {
                amount: '900719925474.0991',
                raw_big: '9007199254740991',
            });
            assert.deepStrictEqual(rows[4], { amount: '42.0000', raw_big: '42' });
        } finally {
            await stringDb.detachAsync();
        }
    });

    it('casts DATE columns to strings', async function () {
        hook = (column, next) => {
            if (column.typeName === 'DATE') {
                const v = next();
                return v === null ? null : v.toISOString().slice(0, 10);
            }
            return next();
        };
        const rows = await db.queryAsync('SELECT born FROM cast_test ORDER BY id');
        assert.strictEqual(rows[0].born, '2000-01-02');
        assert.strictEqual(rows[1].born, null);
    });

    it('is called for NULL values', async function () {
        hook = (column, next) => (next() === null ? '<null>' : next());
        const rows = await db.queryAsync(
            'SELECT price FROM cast_test WHERE id = 2');
        assert.strictEqual(rows[0].price, '<null>');
    });

    it('sees the resolved text for blobAsText columns', async function () {
        const typeNames = [];
        hook = (column, next) => {
            typeNames.push(column.typeName);
            const v = next();
            return typeof v === 'string' ? v.toUpperCase() : v;
        };
        const rows = await db.queryAsync('SELECT note FROM cast_test WHERE id = 1');
        assert.strictEqual(rows[0].note, 'HELLO BLOB');
        assert.ok(typeNames.includes('BLOB'));
    });

    it('falls back to the default value when the hook throws', async function () {
        hook = (column, next) => {
            if (column.alias === 'NAME') throw new Error('boom');
            return next();
        };
        // must neither reject nor desync the connection
        const rows = await db.queryAsync('SELECT id, name FROM cast_test WHERE id = 1');
        assert.strictEqual(rows[0].name, 'alice');
        hook = null;
        const again = await db.queryAsync('SELECT COUNT(*) AS cnt FROM cast_test');
        assert.strictEqual(Number(again[0].cnt), 2);
    });

    it('applies inside explicit transactions and array rows (execute)', async function () {
        hook = (column, next) =>
            column.typeName === 'VARYING' ? next().toUpperCase() : next();

        const viaTx = await db.withTransaction((tx) =>
            tx.queryAsync('SELECT name FROM cast_test WHERE id = 1'));
        assert.strictEqual(viaTx[0].name, 'ALICE');

        const viaExecute = await new Promise((resolve, reject) => {
            db.execute('SELECT name FROM cast_test WHERE id = 2', (err, rows) =>
                err ? reject(err) : resolve(rows));
        });
        assert.deepStrictEqual(viaExecute[0], ['BOB']);
    });
});
