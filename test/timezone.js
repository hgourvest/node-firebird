var assert = require('assert');
var Firebird = require('../lib/index');
var config = require('./config');

/**
 * These tests require Firebird 4.0 or higher.
 */
describe('Firebird 4.0 Time Zone support', function() {
    
    it('should select and insert TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE', function() {
        return new Promise(function(resolve, reject) {
            var options = Object.assign({}, config.default, {
                sessionTimeZone: 'UTC'
            });

            Firebird.attach(options, function(err, db) {
                if (err) {
                    // If the server doesn't support Firebird 4.0+, we skip the test
                    if (err.message && (err.message.indexOf('Column unknown') !== -1 || err.message.indexOf('Dynamic SQL Error') !== -1 || err.message.indexOf('ECONNREFUSED') !== -1)) {
                        console.warn('Skipping Firebird 4.0 Time Zone tests (unsupported by server or connection failed)');
                        return resolve();
                    }
                    return reject(err);
                }

                // Check version
                db.query('SELECT rdb$get_context(\'SYSTEM\', \'ENGINE_VERSION\') AS FB_VERSION FROM RDB$DATABASE', function(err, rows) {
                    if (err) {
                        db.detach();
                        console.warn('Skipping Firebird 4.0 Time Zone tests (rdb$get_context missing or incompatible)');
                        return resolve();
                    }

                    var version = rows[0].fb_version || '';
                    var majorVersion = parseInt(version.split('.')[0]);

                    if (majorVersion < 4) {
                        db.detach();
                        console.warn('Skipping Firebird 4.0 Time Zone tests (Firebird ' + version + ' detected)');
                        return resolve();
                    }

                    // 1. Check if we can select TIME WITH TIME ZONE and TIMESTAMP WITH TIME ZONE
                    db.query('SELECT CAST(\'12:00:00.0000 UTC\' AS TIME WITH TIME ZONE) AS t_tz, ' +
                             'CAST(\'2023-01-01 12:00:00.0000 UTC\' AS TIMESTAMP WITH TIME ZONE) AS ts_tz ' +
                             'FROM RDB$DATABASE', function(err, rows) {
                        
                        if (err) {
                            db.detach();
                            if (err.message && (err.message.indexOf('Token unknown') !== -1 || err.message.indexOf('WITH TIME ZONE') !== -1 || err.message.indexOf('dialect 1') !== -1)) {
                                console.warn('Skipping Firebird 4.0 Time Zone tests (unsupported syntax or Dialect 1)');
                                return resolve();
                            }
                            return reject(err);
                        }

                    var row = rows[0];
                    
                    try {
                        // Verify t_tz
                        assert.ok(row.t_tz instanceof Date, 't_tz should be an instance of Date');
                        
                        // UTC 12:00 is 43200000ms from midnight
                        var t_ms = row.t_tz.getTime();
                        assert.strictEqual(t_ms, 43200000, 'Expected 12:00:00 UTC (43200000ms)');
                        assert.strictEqual(row.t_tz.timeZoneId, 65535, 'Expected TZ ID 65535 (UTC)');

                        // Verify ts_tz
                        assert.ok(row.ts_tz instanceof Date, 'ts_tz should be an instance of Date');
                        
                        // 2023-01-01 12:00:00 UTC
                        var ts_expected = new Date('2023-01-01T12:00:00.000Z').getTime();
                        assert.strictEqual(row.ts_tz.getTime(), ts_expected, 'Timestamp value mismatch');
                    } catch (e) {
                        db.detach();
                        return reject(e);
                    }

                    // 2. Test inserting with parameters
                    db.execute('CREATE TABLE TEST_TZ (ID INT, T_TZ TIME WITH TIME ZONE, TS_TZ TIMESTAMP WITH TIME ZONE)', [], function(err) {
                        if (err) {
                            db.detach();
                            return reject(err);
                        }

                        var insertT = new Date(0);
                        insertT.setUTCHours(15);
                        insertT.timeZoneId = 65535;

                        var insertTS = new Date('2024-05-20T10:00:00.000Z');
                        insertTS.timeZoneId = 65535;

                        db.query('INSERT INTO TEST_TZ (ID, T_TZ, TS_TZ) VALUES (?, ?, ?)', [1, insertT, insertTS], function(err) {
                            if (err) {
                                db.detach();
                                return reject(err);
                            }

                            db.query('SELECT T_TZ, TS_TZ FROM TEST_TZ WHERE ID = 1', function(err, rows) {
                                if (err) {
                                    db.detach();
                                    return reject(err);
                                }

                                var res = rows[0];
                                try {
                                    assert.strictEqual(res.t_tz.getTime(), 15 * 3600 * 1000, 'Parameter insertion for TIME WITH TIME ZONE failed');
                                    assert.strictEqual(res.ts_tz.getTime(), insertTS.getTime(), 'Parameter insertion for TIMESTAMP WITH TIME ZONE failed');
                                } catch (e) {
                                    db.detach();
                                    return reject(e);
                                }

                                db.query('DROP TABLE TEST_TZ', function(err) {
                                    db.detach();
                                    if (err) return reject(err);
                                    resolve();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});
