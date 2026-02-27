const Firebird = require('../lib');
const Config = require('./config');
const assert = require('assert');

const config = Config.default;

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('Timezone Support (Firebird 4.0+)', () => {
    let db;
    let supportsTimezone = false;

    beforeAll(async () => {
        try {
            db = await fromCallback(cb => Firebird.attach(config, cb));
            // Check if server supports timezone types
            await fromCallback(cb => db.query('SELECT CAST('12:00:00 UTC' AS TIME WITH TIME ZONE) FROM RDB$DATABASE', cb));
            supportsTimezone = true;
        } catch (err) {
            console.warn('Firebird server does not support Timezone types, skipping integration tests.');
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

    it('should select TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE', { skip: !supportsTimezone }, async () => {
        const query = `
            SELECT 
                CAST('12:00:00 UTC' AS TIME WITH TIME ZONE) as T_TZ,
                CAST('2024-01-01 12:00:00 UTC' AS TIMESTAMP WITH TIME ZONE) as TS_TZ
            FROM RDB$DATABASE
        `;
        const rows = await fromCallback(cb => db.query(query, cb));
        const row = rows[0];

        assert.ok(row.t_tz instanceof Date, 'TIME WITH TIME ZONE should be a Date');
        assert.ok(row.ts_tz instanceof Date, 'TIMESTAMP WITH TIME ZONE should be a Date');

        // Firebird returns these in UTC, we represent them in local time
        // 12:00:00 UTC should have 12 hours in UTC
        assert.strictEqual(row.t_tz.getUTCHours(), 12);
        assert.strictEqual(row.ts_tz.getUTCFullYear(), 2024);
        assert.strictEqual(row.ts_tz.getUTCHours(), 12);
    });

    it('should round-trip TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE', { skip: !supportsTimezone }, async () => {
        const table_sql = 'CREATE TABLE TEST_TZ (ID INT, T_TZ TIME WITH TIME ZONE, TS_TZ TIMESTAMP WITH TIME ZONE)';
        await fromCallback(cb => db.query(table_sql, cb));

        try {
            const now = new Date();
            // Reset milliseconds for accurate comparison as Firebird might have different precision
            now.setMilliseconds(0);

            await fromCallback(cb => db.query(
                'INSERT INTO TEST_TZ (ID, T_TZ, TS_TZ) VALUES (?, ?, ?)',
                [1, now, now],
                cb
            ));

            const rows = await fromCallback(cb => db.query('SELECT T_TZ, TS_TZ FROM TEST_TZ WHERE ID = 1', cb));
            const row = rows[0];

            // Compare UTC times to avoid timezone offset issues during comparison
            assert.strictEqual(row.ts_tz.getTime(), now.getTime(), 'Timestamp round-trip mismatch');
            
            // For TIME, we only compare the time part (hours, minutes, seconds)
            assert.strictEqual(row.t_tz.getUTCHours(), now.getUTCHours());
            assert.strictEqual(row.t_tz.getUTCMinutes(), now.getUTCMinutes());
            assert.strictEqual(row.t_tz.getUTCSeconds(), now.getUTCSeconds());

        } finally {
            await fromCallback(cb => db.query('DROP TABLE TEST_TZ', cb)).catch(() => {});
        }
    });

    it('should handle sessionTimeZone option', { skip: !supportsTimezone }, async () => {
        const utcConfig = Object.assign({}, config, { sessionTimeZone: 'UTC' });
        const utcDb = await fromCallback(cb => Firebird.attach(utcConfig, cb));
        try {
            const rows = await fromCallback(cb => utcDb.query('SELECT CURRENT_TIMESTAMP FROM RDB$DATABASE', cb));
            assert.ok(rows[0].current_timestamp instanceof Date);
        } finally {
            await fromCallback(cb => utcDb.detach(cb));
        }
    });
});
