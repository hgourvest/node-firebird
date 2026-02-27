const Firebird = require('../lib');
const Config = require('./config');
const assert = require('assert');

const config = Config.default;

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('DECFLOAT Support Integration (Firebird 4.0+)', () => {
    let db;
    let supportsDecFloat = false;

    beforeAll(async () => {
        try {
            db = await fromCallback(cb => Firebird.attach(config, cb));
            // Check if server supports DECFLOAT types
            await fromCallback(cb => db.query('SELECT CAST(123.45 AS DECFLOAT(16)) FROM RDB$DATABASE', cb));
            supportsDecFloat = true;
        } catch (err) {
            console.warn('Firebird server does not support DECFLOAT types, skipping integration tests.');
            if (db) {
                await fromCallback(cb => db.detach(cb));
                db = null;
            }
        }
    });

    afterAll(async () => {
        if (db) {
            await fromCallback(cb => db.detach(cb));
        }
    });

    it('should select DECFLOAT(16) and DECFLOAT(34)', { skip: !supportsDecFloat }, async () => {
        const query = `
            SELECT 
                CAST(123.45 AS DECFLOAT(16)) as D16,
                CAST(123.4567890123456789012345678901234 AS DECFLOAT(34)) as D34
            FROM RDB$DATABASE
        `;
        const rows = await fromCallback(cb => db.query(query, cb));
        const row = rows[0];

        assert.ok(row.d16 instanceof Buffer, 'DECFLOAT(16) should be a Buffer');
        assert.ok(row.d34 instanceof Buffer, 'DECFLOAT(34) should be a Buffer');
        assert.strictEqual(row.d16.length, 8);
        assert.strictEqual(row.d34.length, 16);
    });

    it('should round-trip DECFLOAT(16) and DECFLOAT(34) as Buffers', { skip: !supportsDecFloat }, async () => {
        const table_sql = 'CREATE TABLE TEST_DEC (ID INT, D16 DECFLOAT(16), D34 DECFLOAT(34))';
        await fromCallback(cb => db.query(table_sql, cb));

        try {
            // We use raw buffers for round-trip since we don't have a decoder/encoder yet
            // This verifies that the driver can handle the binary data correctly.
            const d16_val = Buffer.alloc(8, 0x11);
            const d34_val = Buffer.alloc(16, 0x22);

            await fromCallback(cb => db.query(
                'INSERT INTO TEST_DEC (ID, D16, D34) VALUES (?, ?, ?)',
                [1, d16_val, d34_val],
                cb
            ));

            const rows = await fromCallback(cb => db.query('SELECT D16, D34 FROM TEST_DEC WHERE ID = 1', cb));
            const row = rows[0];

            assert.ok(row.d16.equals(d16_val), 'DECFLOAT(16) round-trip mismatch');
            assert.ok(row.d34.equals(d34_val), 'DECFLOAT(34) round-trip mismatch');

        } finally {
            await fromCallback(cb => db.query('DROP TABLE TEST_DEC', cb)).catch(() => {});
        }
    });

    it('should handle INSERT ... RETURNING with DECFLOAT', { skip: !supportsDecFloat }, async () => {
        const table_sql = 'CREATE TABLE TEST_DEC_RET (ID INT, D16 DECFLOAT(16))';
        await fromCallback(cb => db.query(table_sql, cb));

        try {
            const d16_val = Buffer.alloc(8, 0x33);

            const row = await fromCallback(cb => db.query(
                'INSERT INTO TEST_DEC_RET (ID, D16) VALUES (?, ?) RETURNING D16',
                [1, d16_val],
                cb
            ));

            assert.ok(row.d16 instanceof Buffer);
            assert.ok(row.d16.equals(d16_val), 'DECFLOAT RETURNING mismatch');
        } finally {
            await fromCallback(cb => db.query('DROP TABLE TEST_DEC_RET', cb)).catch(() => {});
        }
    });

    it('should handle NULL values in DECFLOAT columns', { skip: !supportsDecFloat }, async () => {
        const table_sql = 'CREATE TABLE TEST_DEC_NULL (ID INT, D16 DECFLOAT(16), D34 DECFLOAT(34))';
        await fromCallback(cb => db.query(table_sql, cb));

        try {
            await fromCallback(cb => db.query(
                'INSERT INTO TEST_DEC_NULL (ID, D16, D34) VALUES (?, ?, ?)',
                [1, null, null],
                cb
            ));

            const rows = await fromCallback(cb => db.query('SELECT D16, D34 FROM TEST_DEC_NULL WHERE ID = 1', cb));
            const row = rows[0];

            assert.strictEqual(row.d16, null, 'DECFLOAT(16) should be null');
            assert.strictEqual(row.d34, null, 'DECFLOAT(34) should be null');
        } finally {
            await fromCallback(cb => db.query('DROP TABLE TEST_DEC_NULL', cb)).catch(() => {});
        }
    });
});
