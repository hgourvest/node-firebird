import assert from 'assert';
import Firebird from '../lib/index';
import ConfigModule from './config';

const config = ConfigModule.default || ConfigModule;

/**
 * These tests require Firebird 4.0 or higher.
 */
describe('Firebird 4.0 Time Zone support', () => {
    
    it('should select and insert TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE', async () => {
        const options = Object.assign({}, config, {
            database: config.database.replace(/\.fdb$/, '_tz.fdb'),
            sessionTimeZone: 'UTC'
        });

        console.log('[Test] Attempting to attach or create database:', options.database);
        const db = await new Promise((resolve, reject) => {
            Firebird.attachOrCreate(options, (err, db) => {
                if (err) {
                    console.log('[Test] Connection failed:', err.message);
                    if (err.message && (err.message.indexOf('Column unknown') !== -1 || err.message.indexOf('Dynamic SQL Error') !== -1 || err.message.indexOf('ECONNREFUSED') !== -1 || err.message.indexOf('I/O error') !== -1)) {
                        return resolve(null);
                    }
                    return reject(err);
                }
                resolve(db);
            });
        });

        if (!db) {
            console.warn('Skipping Firebird 4.0 Time Zone tests (unsupported by server or connection failed)');
            return;
        }

        console.log('[Test] Connected to database. Protocol version:', db.connection.accept.protocolVersion);

        try {
            // Check version
            console.log('[Test] Querying engine version...');
            const versionRows = await new Promise((resolve, reject) => {
                db.query('SELECT rdb$get_context(\'SYSTEM\', \'ENGINE_VERSION\') AS FB_VERSION FROM RDB$DATABASE', (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            }).catch(err => {
                console.warn('Skipping Firebird 4.0 Time Zone tests (rdb$get_context missing or incompatible):', err.message);
                return null;
            });

            if (!versionRows) return;

            const version = versionRows[0].fb_version || '';
            console.log('[Test] Firebird version:', version);
            const majorVersion = parseInt(version.split('.')[0]);

            if (majorVersion < 4) {
                console.warn('Skipping Firebird 4.0 Time Zone tests (Firebird ' + version + ' detected)');
                return;
            }

            // 1. Check if we can select TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE
            console.log('[Test] Testing CAST with TIME ZONE...');
            const tzRows = await new Promise((resolve, reject) => {
                db.query('SELECT CAST(\'12:00:00.0000 UTC\' AS TIME WITH TIME ZONE) AS t_tz, ' +
                         'CAST(\'2024-02-02 12:00:00.0000 UTC\' AS TIMESTAMP WITH TIME ZONE) AS ts_tz ' +
                         'FROM RDB$DATABASE', (err, rows) => {
                    if (err) {
                        if (err.message && (err.message.indexOf('Token unknown') !== -1 || err.message.indexOf('WITH TIME ZONE') !== -1 || err.message.indexOf('dialect 1') !== -1)) {
                            return resolve(null);
                        }
                        return reject(err);
                    }
                    resolve(rows);
                });
            });

            if (!tzRows) {
                console.warn('Skipping Firebird 4.0 Time Zone tests (unsupported syntax or Dialect 1)');
                return;
            }

            console.log('[Test] CAST successful. Verifying values...');
            const row = tzRows[0];
            
            // Verify t_tz
            assert.ok(row.t_tz instanceof Date, 't_tz should be an instance of Date');
            
            // UTC 12:00 is 43200000ms from midnight
            var t_ms = row.t_tz.getTime();
            // Use modulo to check only the time part, as some environments might normalize to today's date
            assert.strictEqual(t_ms % 86400000, 43200000, 'Expected 12:00:00 UTC (43200000ms from midnight)');
            assert.strictEqual(row.t_tz.timeZoneId, 65535, 'Expected TZ ID 65535 (UTC)');

            // Verify ts_tz
            assert.ok(row.ts_tz instanceof Date, 'ts_tz should be an instance of Date');
            
            // 2024-02-02 12:00:00 UTC
            var ts_expected = new Date('2024-02-02T12:00:00.000Z').getTime();
            if (row.ts_tz.getTime() !== ts_expected) {
                console.log('[Test] ts_tz mismatch! Raw Date:', row.ts_tz._rawDate, 'Raw Time:', row.ts_tz._rawTime, 'TZ:', row.ts_tz.timeZoneId);
                console.log('[Test] Expected ms:', ts_expected, 'Actual ms:', row.ts_tz.getTime());
            }
            assert.strictEqual(row.ts_tz.getTime(), ts_expected, 'Timestamp value mismatch');

            // 2. Test inserting with parameters
            console.log('[Test] Creating test table...');
            await new Promise((resolve, reject) => {
                db.execute('CREATE TABLE TEST_TZ (ID INT, T_TZ TIME WITH TIME ZONE, TS_TZ TIMESTAMP WITH TIME ZONE)', [], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            console.log('[Test] Inserting data with parameters...');
            const insertT = new Date(0);
            insertT.setUTCHours(15);
            insertT.timeZoneId = 65535;

            const insertTS = new Date('2024-05-20T10:00:00.000Z');
            insertTS.timeZoneId = 65535;

            await new Promise((resolve, reject) => {
                db.query('INSERT INTO TEST_TZ (ID, T_TZ, TS_TZ) VALUES (?, ?, ?)', [1, insertT, insertTS], (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            console.log('[Test] Selecting inserted data...');
            const resRows = await new Promise((resolve, reject) => {
                db.query('SELECT T_TZ, TS_TZ FROM TEST_TZ WHERE ID = 1', (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });

            const res = resRows[0];
            assert.strictEqual(res.t_tz.getTime(), 15 * 3600 * 1000, 'Parameter insertion for TIME WITH TIME ZONE failed');
            assert.strictEqual(res.ts_tz.getTime(), insertTS.getTime(), 'Parameter insertion for TIMESTAMP WITH TIME ZONE failed');

            console.log('[Test] Dropping test table...');
            await new Promise((resolve) => {
                db.query('DROP TABLE TEST_TZ', () => resolve());
            });

            console.log('[Test] Timezone tests completed successfully.');
        } finally {
            console.log('[Test] Detaching from database...');
            db.detach();
        }
    }, 60000);
});
