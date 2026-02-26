const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const { GDSCode } = require('../lib/gdscodes');
const Config = require('./config');

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const config = Config.default;

/**
 * Converts a callback-style function call into a Promise.
 * Usage: const result = await fromCallback(cb => someAsyncFn(arg1, arg2, cb));
 */
function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('Connection', function () {

    it('should attach or create database', async function () {
        const db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        await fromCallback(cb => db.detach(cb));
    });

    it('should reconnect when socket is closed', { timeout: 5000 }, async function () {
        const db = await fromCallback(cb => Firebird.attach(config, cb));

        db.connection._socket.destroy();

        await new Promise((resolve, reject) => {
            var reconnectHandler = function () {
                db.removeListener('error', errorHandler);
                db.detach((err) => err ? reject(err) : resolve());
            };

            var errorHandler = function (err) {
                db.removeListener('reconnect', reconnectHandler);
                reject(err);
            };

            db.on('reconnect', reconnectHandler);
            db.on('error', errorHandler);
        });
    });

    var testCreateConfig = Config.extends(config, {database: config.database.replace(/\.fdb/, '2.fdb')});
    it('should create', async function() {
        const db = await fromCallback(cb => Firebird.create(testCreateConfig, cb));
        await fromCallback(cb => db.detach(cb));
    });

    it('should drop', async function() {
        await fromCallback(cb => Firebird.drop(testCreateConfig, cb));
    });

    // Work only with firebird 3+ for wire compression and firebird 3.0.4+ for context variable WIRE_COMPRESSED
    it.skip('should attachOrCreate with wireCompression', async function() {
        const db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { wireCompression: true }), cb));
        const r = await fromCallback(cb => db.query('select rdb$get_context(\'SYSTEM\', \'WIRE_COMPRESSED\') = \'TRUE\' as compressed from rdb$database', cb));
        assert.ok(r[0].compressed);
        await fromCallback(cb => db.detach(cb));
    });
});

describe('Events', function () {
    const table_sql = 'CREATE TABLE TEST_EVENTS (ID INT NOT NULL CONSTRAINT PK_EVENTS PRIMARY KEY, NAME VARCHAR(50))';

    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        await fromCallback(cb => db.query(table_sql, [], cb));
        await fromCallback(cb => db.query(`CREATE TRIGGER TRG_TEST_TRIGGER FOR TEST_EVENTS AFTER INSERT OR UPDATE AS BEGIN POST_EVENT('TRG_TEST_EVENTS'); END`, [], cb));
        const rows = await fromCallback(cb => db.query('SELECT RDB$TRIGGER_NAME FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME = ?', ['TRG_TEST_TRIGGER'], cb));
        assert.ok(rows.length > 0);
    });

    afterAll(async function () {
        if (db) {
            // Use a timeout to prevent hanging if the connection queue is corrupted
            const detachPromise = fromCallback(cb => db.detach(cb)).catch(() => {});
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
            await Promise.race([detachPromise, timeoutPromise]);
            // Force close the socket if detach didn't complete
            if (db.connection && db.connection._socket && !db.connection._isClosed) {
                db.connection._socket.end();
            }
        }
    });

    it("should create a connection", async function () {
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        await fromCallback(cb => evtmgr.close(cb));
    });

    it("should register an event", async function () {
        console.log('[Test] Starting "should register an event" test');
        const evtmgr = await fromCallback(cb => {
            console.log('[Test] Calling db.attachEvent');
            return db.attachEvent(cb);
        });
        console.log('[Test] Event manager attached, evtmgr:', !!evtmgr, 'eventid:', evtmgr.eventid);
        
        console.log('[Test] Calling registerEvent with TRG_TEST_EVENTS');
        await fromCallback(cb => evtmgr.registerEvent(["TRG_TEST_EVENTS"], cb));
        console.log('[Test] registerEvent completed successfully');
        
        console.log('[Test] Calling evtmgr.close');
        await fromCallback(cb => evtmgr.close(cb));
        console.log('[Test] Test completed successfully');
    });

    it.skip("should receive an event", async function () {
        // TODO: This test has issues when run with other Event tests due to
        // event count accumulation. Needs investigation.
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        await fromCallback(cb => evtmgr.registerEvent(["TRG_TEST_EVENTS"], cb));

        const eventPromise = new Promise((resolve, reject) => {
            evtmgr.on('post_event', (name, count) => {
                try {
                    assert.equal(name, 'TRG_TEST_EVENTS');
                    assert.ok(count > 0); // Count may be > 1 if previous tests have fired events
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });

        // Use a unique ID to avoid primary key conflicts
        const uniqueId = Date.now();
        await fromCallback(cb => db.query('INSERT INTO TEST_EVENTS (ID, NAME) VALUES (?, ?)', [uniqueId, 'xpto'], cb));

        await eventPromise;
        await fromCallback(cb => evtmgr.close(cb));
    });
});

describe('Auth plugin connection', function () {

    // Must be test with firebird 2.5 or higher with Legacy_Auth enabled on server
    it('should attach with legacy plugin', async function () {
        let db;
        try {
            db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_LEGACY }), cb));
        } catch (err) {
            assert.fail('Maybe firebird 3.0 Legacy_Auth plugin not enabled, message : ' + err.message);
        }
        await fromCallback(cb => db.detach(cb));
    });

    // On firebird 2.5 or higher with only Legacy_Auth enabled on server for fallback to Srp on Legacy or Srp connect
    it('should attach on firebird 3.0 and fallback to Legacy or Srp', async function () {
        const db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config), cb));
        await fromCallback(cb => db.detach(cb));
    });

    // Must be test with firebird 2.5 or higher with only Legacy_Auth enabled on server
    it.skip('should attach with srp plugin but support only Legacy', async function () {
        try {
            await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_SRP }), cb));
            assert.fail('Maybe Srp enable');
        } catch (err) {
            assert.ok(err);
            assert.ok(err.message === 'Server don\'t accept plugin : Srp, but support : Legacy_Auth');
        }
    });

    describe('FB3 - Srp', function () {
        // Must be test with firebird 3.0 or higher with Srp enable on server
        it('should attach with srp plugin', async function () {
            const db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_SRP }), cb));
            await fromCallback(cb => db.detach(cb));
        });

        // FB 3.0 : Should be tested with Srp256 enabled on server configuration
        /*it('should attach with srp 256 plugin', async function () {
            const db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_SRP256 }), cb));
            await fromCallback(cb => db.detach(cb));
        });*/
    });
});

describe('Pooling', function () {

    var poolSize = 2;
    var pool;

    beforeAll(async function () {
        // create database if not exists (case of run only this test sequence)
        const db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        await fromCallback(cb => db.detach(cb));
        pool = Firebird.pool(poolSize, config);
    });

    afterAll(async function () {
        await fromCallback(cb => pool.destroy(cb));
    });

    it('should wait when all connections are in use', function () {
        return new Promise((resolve, reject) => {
            for (var i = 0; i < poolSize; i++) {
                pool.get(function (err, db) {
                    if (err) return reject(err);

                    setImmediate(function () {
                        db.detach();
                    });
                });
            }

            pool.get(function(err, db) {
                if (err) return reject(err);

                db.query('SELECT * FROM RDB$DATABASE', function(err, rows) {
                    if (err) return reject(err);
                    assert.equal(rows.length, 1);
                    db.detach(function () {
                        assert.equal(pool.dbinuse, 0);
                        resolve();
                    });
                });
            });

            assert.equal(pool.pending.length, 1);
        });
    });
});

describe('Database', function() {
    const TEST_TABLE = 'CREATE TABLE test (ID INT, PARENT BIGINT, NAME VARCHAR(50), FILE BLOB, CREATED TIMESTAMP)';

    var blobPath = path.join(Config.testDir, 'image.png');
    var blobSize = fs.readFileSync(blobPath).length;
    var db;
    var protocolVersion;

    beforeAll(async function() {
        db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        protocolVersion = db.connection.accept.protocolVersion;
        await fromCallback(cb => db.query(TEST_TABLE, cb));
    });

    afterAll(async function() {
        if (db) {
            await fromCallback(cb => db.detach(cb));
        }
    });

    describe('Select', function() {
        it('should simple select', async function () {
            const row = await fromCallback(cb => db.query('SELECT * FROM RDB$DATABASE', cb));
            assert.ok(row);
            assert.equal(row.length, 1);
            assert.equal(row[0]['rdb$description'], null); // Check null value for FB3 BitSet
        });

        it('should select with param', async function () {
            const d = await fromCallback(cb => db.query('SELECT * FROM RDB$ROLES WHERE RDB$OWNER_NAME = ?', [config.user], cb));
            assert.ok(d);
        });

        it('should select multiple rows', async function () {
            await fromCallback(cb => db.query('SELECT FIRST 100 RDB$FIELD_NAME FROM RDB$FIELDS', cb));
        });

        it('should create table', async function () {
            await fromCallback(cb => db.query('CREATE TABLE T (ID INT)', cb));
        });
    });

    describe('Statement timeout', function(ctx) {
        const skip = protocolVersion < Const.PROTOCOL_VERSION16; // Statement timeout available from protocol v16

        it('should query with sufficient timeout', { skip }, async function (test) {
            await fromCallback(cb => db.query('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
        });

        it('should query throw timeout', { skip }, async function (test) {
            await assert.rejects(async () => {
                await fromCallback(cb => db.query('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
            }, /Operation was cancelled, Statement level timeout expired/);
        });

        it('should execute with sufficient timeout', { skip }, async function (test) {
            await fromCallback(cb => db.execute('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
        });

        it('should execute throw timeout', { skip }, async function (test) {

            await assert.rejects(async () => {
                await fromCallback(cb => db.execute('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
            }, /Operation was cancelled, Statement level timeout expired/);
        });

        it('should sequentially with sufficient timeout', { skip }, async function (test) {
            await fromCallback(cb => db.sequentially('SELECT * FROM RDB$RELATIONS', [], (row, index) => {}, cb, { timeout: 10 }));
        });

        it('should sequentially throw timeout', { skip }, async function (test) {
            await assert.rejects(async () => {
                await fromCallback(cb => db.sequentially('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', [], (row, index) => {}, cb, { timeout: 1000 }));
            }, /Operation was cancelled, Statement level timeout expired/);
        });

        it('should sequentially support backward compatibility for asArray boolean', async function () {
            await fromCallback(cb => db.sequentially('SELECT * FROM RDB$DATABASE', [], (row, index) => {
                assert.ok(Array.isArray(row), 'Row should be an array');
            }, cb, true));
        });
    });

    describe('Insert', function() {
        it('should insert', async function() {
            await fromCallback(cb => db.query(
                'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?)',
                [1, 'Firebird 1', '2014-12-12 13:59', 862304020112911],
                cb));
        });

        it('should insert with returning', async function() {
            const row = await fromCallback(cb => db.query(
                'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?) RETURNING ID',
                [2, 'Firebird 2', Config.currentDate, 862304020112911],
                cb));
            assert.equal(row['id'], 2);
        });

        it('should insert with blob from stream', async function () {
            const row = await fromCallback(cb => db.query(
                'INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID',
                [3, 'Firebird 3', fs.createReadStream(blobPath), '14.12.2014 12:12:12'],
                cb));
            assert.equal(row['id'], 3);
        });

        it('should insert with blob from buffer', async function () {
            const row = await fromCallback(cb => db.query(
                'INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID',
                [4, 'Firebird 4', fs.readFileSync(blobPath), '14.12.2014T12:12:12'],
                cb));
            assert.equal(row['id'], 4);
        });

        it('should insert with null', async function() {
            await fromCallback(cb => db.query(
                'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?)',
                [5, null, '2014-12-12 13:59', null],
                cb));
        });

        describe('verify', function () {
            it('should select data from inserts', async function () {
                const rows = await fromCallback(cb => db.query('SELECT * FROM test', cb));

                var first = rows[0];
                var second = rows[1];
                var third = rows[2];
                var five = rows[4];

                assert.equal(first.created.getMonth(), 11);
                assert.equal(first.created.getDate(), 12);
                assert.equal(first.created.getFullYear(), 2014);
                assert.equal(first.created.getHours(), 13);
                assert.equal(first.created.getMinutes(), 59);

                assert.equal(second.created.getTime(), Config.currentDate.getTime());

                assert.notEqual(third, undefined);
                assert.equal(third.id, 3);
                assert.equal(third.name, 'Firebird 3');
                assert.equal(typeof(third.file), 'function');
                assert.equal(third.created.getMonth(), 11);
                assert.equal(third.created.getDate(), 14);
                assert.equal(third.created.getFullYear(), 2014);
                assert.equal(third.created.getHours(), 12);
                assert.equal(third.created.getMinutes(), 12);

                assert.equal(five.name, null);
                assert.equal(five.parent, null);

                await new Promise((resolve, reject) => {
                    third.file(function(err, name, emitter) {
                        if (err) return reject(err);

                        var count = 0;

                        emitter.on('data', function(buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function() {
                            assert.equal(count, blobSize);
                            resolve();
                        });
                    });
                });
            });
        });
    });

    describe('update', function () {
        it('should update with blob from stream', async function() {
            await fromCallback(cb => db.query(
                'UPDATE test SET NAME = ?, FILE = ? WHERE Id = 1',
                ['Firebird 1 (UPD)', fs.createReadStream(blobPath)],
                cb));
        });

        it('should update with blob from buffer', async function() {
            await fromCallback(cb => db.query('UPDATE test SET NAME = ?, FILE = ? WHERE Id = 2', ['Firebird 2 (UPD)', fs.readFileSync(blobPath)], cb));
        });

        describe('verify', function () {
            it('should select data from update with blob from stream', async function() {
                const rows = await fromCallback(cb => db.query('SELECT * FROM test WHERE ID = 1', cb));

                var row = rows[0];
                assert.notEqual(row, undefined);
                assert.equal(row.id, 1);
                assert.equal(row.name, 'Firebird 1 (UPD)');
                assert.equal(typeof(row.file), 'function');

                await new Promise((resolve, reject) => {
                    row.file(function (err, name, emitter) {
                        if (err) return reject(err);

                        var count = 0;

                        emitter.on('data', function (buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function () {
                            assert.equal(count, 5472);
                            resolve();
                        });
                    });
                });
            });

            it('should select data from update with blob from buffer', async function () {
                const rows = await fromCallback(cb => db.query('SELECT * FROM test WHERE ID = 2', cb));

                var row = rows[0];
                assert.notEqual(row, undefined);
                assert.equal(row.id, 2);
                assert.equal(row.name, 'Firebird 2 (UPD)');
                assert.equal(typeof(row.file), 'function');

                await new Promise((resolve, reject) => {
                    row.file(function (err, name, emitter) {
                        if (err) return reject(err);

                        var count = 0;

                        emitter.on('data', function (buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function () {
                            assert.equal(count, 5472);
                            resolve();
                        });
                    });
                });
            });
        });
    });

    describe('Select - complex', function () {
        it('should select scalar values', async function() {
            const rows = await fromCallback(cb => db.query(
                'SELECT CAST(123 AS NUMERIC(10,2)) As a, MAX(2) AS b, COUNT(*) AS c FROM RDB$DATABASE',
                cb));
            var row = rows[0];
            assert.equal(row.a, 123,
                'CAST returned an unexpected value.');
            assert.equal(row.b, 2,
                'MAX returned an unexpected value.');
            assert.notEqual(row.c, 0,
                'COUNT returned an unexpected value.');
        });

        it('should select rows as arrays', async function() {
            const rows = await fromCallback(cb => db.execute('SELECT COUNT(*), SUM(ID) FROM test', cb));
            var row = rows[0];
            assert.equal(row[0], 5);
            assert.equal(row[1], 15);
        });

        it('should select rows as objects', async function() {
            const rows = await fromCallback(cb => db.query('SELECT COUNT(*), SUM(ID) FROM test', cb));
            var row = rows[0];
            assert.equal(row.count, 5);
            assert.equal(row.sum, 15);
        });

        it('should select rows sequentially as arrays', async function() {
            var sum = 0;
            await new Promise((resolve, reject) => {
                db.sequentially('SELECT Id FROM test', function(row) {
                    sum += row[0];
                }, function() {
                    assert.equal(sum, 15);
                    resolve();
                }, true);
            });
        });

        it('should select rows sequentially as objects', async function() {
            var sum = 0;
            await new Promise((resolve, reject) => {
                db.sequentially('SELECT Id FROM test', function(row) {
                    sum += row.id;
                }, function() {
                    assert.equal(sum, 15);
                    resolve();
                });
            });
        });

        it('should preserve sequential index across fetch batches', async function() {
            const indices = [];
            await new Promise((resolve, reject) => {
                db.sequentially(
                    'SELECT FIRST 450 a.RDB$RELATION_ID AS ID FROM RDB$RELATIONS a, RDB$RELATIONS b',
                    function(row, index) {
                        indices.push(index);
                    },
                    function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        try {
                            assert.equal(indices.length, 450);
                            assert.equal(indices[0], 0);
                            assert.equal(indices[indices.length - 1], indices.length - 1);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });
        });

        it('should not buffer all streamed rows in sequentially callback result', async function() {
            const ids = [];
            await new Promise((resolve, reject) => {
                db.sequentially(
                    'SELECT Id FROM test',
                    function(row) {
                        ids.push(row.id);
                    },
                    function(err, rows) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        try {
                            assert.equal(ids.length, 5);
                            assert.ok(Array.isArray(rows));
                            assert.equal(rows.length, 0);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });
        });
    });

    describe('Fetch', () => {
        it('should fetch contains errors', async () => {
            await fromCallback(cb => db.query(`
                create or alter procedure TEST_FETCH_FAIL
                returns (RET integer)
                as
                begin
                  RET = 10;
                  suspend;
                
                  RET = 10 / 2;
                  suspend;
                
                  RET = 0 / 0;
                  suspend;
                end
            `, cb));

            try {
                await fromCallback(cb => db.query('select RET from TEST_FETCH_FAIL', cb));
                assert.fail('Expected an error');
            } catch (err) {
                assert.ok(err);
                assert.ok(err.message.match(/arithmetic exception, numeric overflow, or string truncation, Integer divide by zero./gi));
            }
        });
    });

    describe('Transaction', function() {
        var db;

        beforeAll(async function() {
            db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        });

        afterAll(async function() {
            if (db) {
                await fromCallback(cb => db.detach(cb));
            }
        });

        it('should create table2', async function() {
            await fromCallback(cb => db.query('EXECUTE BLOCK AS BEGIN ' +
                'if (not exists(select 1 from rdb$relations where rdb$relation_name = \'TEST2\')) then ' +
                'execute statement \'CREATE TABLE test2 (ID INT, NAME VARCHAR(50))\'; ' +
                'END',
                cb));
        });

        it('should rollback', async function() {
            const transaction = await fromCallback(cb => db.transaction(cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [1, 'Transaction 1'], cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [2, 'Transaction 2'], cb));

            try {
                await fromCallback(cb => transaction.query(
                    'INSERT INTO test_fail (ID, NAME) VALUES(?, ?)',
                    [3, 'Transaction 3'], cb));
                assert.fail('Expected an error');
            } catch (err) {
                assert.ok(err);
            }

            await fromCallback(cb => transaction.rollback(cb));
            await verify(0);
        });

        it('should commit', async function() {
            const transaction = await fromCallback(cb => db.transaction(cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [4, 'Transaction 1'], cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [5, 'Transaction 2'], cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [6, 'Transaction 3'], cb));
            await fromCallback(cb => transaction.commit(cb));
            await verify(3);
        });

        it('should start transaction with isolation array', async function () {
            const transaction = await fromCallback(cb => db.transaction(Firebird.ISOLATION_READ_COMMITTED, cb));
            await fromCallback(cb => transaction.commit(cb));
        });

        // For check auto_commit in mon$transactions need to perform a modification in database
        it('should autocommit', async function () {
            const transaction = await fromCallback(cb => db.transaction({ autoCommit: true }, cb));
            await fromCallback(cb => transaction.query(
                'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                [7, 'Transaction 1'], cb));
            const r = await fromCallback(cb => transaction.query(
                'SELECT MON$AUTO_COMMIT AS AUTO_COMMIT FROM MON$TRANSACTIONS WHERE MON$TRANSACTION_ID = CURRENT_TRANSACTION',
                cb));
            assert.equal(r[0].auto_commit, 1);
            await fromCallback(cb => transaction.commit(cb));
            await verify(4);
        });

        it('should autoundo', async function () {
            const transaction = await fromCallback(cb => db.transaction({ autoUndo: false }, cb));
            const r = await fromCallback(cb => transaction.query(
                'SELECT MON$AUTO_UNDO AS AUTO_UNDO FROM MON$TRANSACTIONS WHERE MON$TRANSACTION_ID = CURRENT_TRANSACTION',
                cb));
            assert.equal(r[0].auto_undo, 0);
            await fromCallback(cb => transaction.commit(cb));
        });

        it('should wait', async function () {
            const transaction = await fromCallback(cb => db.transaction({ wait: true }, cb));
            const r = await fromCallback(cb => transaction.query(
                'SELECT MON$LOCK_TIMEOUT AS LOCK_TIMEOUT FROM MON$TRANSACTIONS WHERE MON$TRANSACTION_ID = CURRENT_TRANSACTION',
                cb));
            assert.equal(r[0].lock_timeout, -1);
            await fromCallback(cb => transaction.commit(cb));
        });

        it('should nowait', async function () {
            const transaction = await fromCallback(cb => db.transaction({ wait: false }, cb));
            const r = await fromCallback(cb => transaction.query(
                'SELECT MON$LOCK_TIMEOUT AS LOCK_TIMEOUT FROM MON$TRANSACTIONS WHERE MON$TRANSACTION_ID = CURRENT_TRANSACTION',
                cb));
            assert.equal(r[0].lock_timeout, 0);
            await fromCallback(cb => transaction.commit(cb));
        });

        it('should wait with timeout', async function () {
            const transaction = await fromCallback(cb => db.transaction({ waitTimeout: 10 }, cb));
            const r = await fromCallback(cb => transaction.query(
                'SELECT MON$LOCK_TIMEOUT AS LOCK_TIMEOUT FROM MON$TRANSACTIONS WHERE MON$TRANSACTION_ID = CURRENT_TRANSACTION',
                cb));
            assert.equal(r[0].lock_timeout, 10);
            await fromCallback(cb => transaction.commit(cb));
        });

        describe('Statement timeout', function() {
            it('should query with sufficient timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await fromCallback(cb => transaction.query('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
                await fromCallback(cb => transaction.commit(cb));
            });

            it('should query throw timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await assert.rejects(async () => {
                    await fromCallback(cb => transaction.query('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
                }, /Operation was cancelled, Statement level timeout expired/);
                await fromCallback(cb => transaction.rollback(cb));
            });

            it('should execute with sufficient timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await fromCallback(cb => transaction.execute('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
                await fromCallback(cb => transaction.commit(cb));
            });

            it('should execute throw timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await assert.rejects(async () => {
                    await fromCallback(cb => transaction.execute('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
                }, /Operation was cancelled, Statement level timeout expired/);
                await fromCallback(cb => transaction.rollback(cb));
            });

            it('should sequentially with sufficient timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await fromCallback(cb => transaction.sequentially('SELECT * FROM RDB$RELATIONS', [], (row, index) => {}, cb, { timeout: 10 }));
                await fromCallback(cb => transaction.commit(cb));
            });

            it('should sequentially throw timeout', async function () {
                const protocolVersion = db.connection.accept.protocolVersion;
                if (protocolVersion < Const.PROTOCOL_VERSION16) return;

                const transaction = await fromCallback(cb => db.transaction(cb));
                await assert.rejects(async () => {
                    await fromCallback(cb => transaction.sequentially('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', [], (row, index) => {}, cb, { timeout: 1000 }));
                }, /Operation was cancelled, Statement level timeout expired/);
                await fromCallback(cb => transaction.rollback(cb));
            });
        });

        async function verify(count) {
            const rows = await fromCallback(cb => db.query('SELECT COUNT(*) FROM test2', cb));
            var row = rows[0];
            assert.equal(row.count, count);
        }
    });
});

describe('GDSCode in errors', function () {
    var db;

    beforeAll(async function () {
        var lconfig = Object.assign({}, config);
        lconfig.database = path.join(path.dirname(config.database), 'test.fdb');
        db = await fromCallback(cb => Firebird.attachOrCreate(lconfig, cb));
        // Create table and insert record id=1
        await fromCallback(cb => db.query('RECREATE TABLE test_gdscode (ID INT NOT NULL CONSTRAINT PK_NAME PRIMARY KEY, NAME VARCHAR(50))', [], cb));
        await fromCallback(cb => db.query('insert into test_gdscode(id, name) values (?, ?)', [1, 'xpto'], cb));
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.detach(cb));
        }
    });

    it('should return gdscode', async function () {
        try {
            await fromCallback(cb => db.query('insert into test_gdscode(id, name) values (?, ?)', [1, 'xpto'], cb));
            assert.fail('Must be an error!');
        } catch (err) {
            assert.ok(err, 'Must be an error!');
            assert.strictEqual(err.gdscode, 335544665, 'The numeric code for UNIQUE_KEY_VIOLATION is returned');
        }
    });

    it('should have constants to check gdscode and gdsparams', async function () {
        try {
            await fromCallback(cb => db.query('insert into test_gdscode(id, name) values (?, ?)', [1, 'xpto'], cb));
            assert.fail('Must be an error!');
        } catch (err) {
            assert.ok(err, 'Must be an error!');
            assert.strictEqual(err.gdscode, GDSCode.UNIQUE_KEY_VIOLATION, 'PK violated');
            assert.strictEqual(err.gdsparams[0], 'PK_NAME', 'The PK constraint name')
            assert.strictEqual(err.gdsparams[1], 'TEST_GDSCODE', 'The table name')
        }
    });
});
