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

describe('Driver Events', function () {
    // Driver events are notifications emitted directly on the Database object
    // for connection-level operations: attach, detach, transaction, commit,
    // rollback, query, row, result, error, and reconnect.
    // These are distinct from Firebird database POST_EVENT notifications, which
    // are received via db.attachEvent() and the FbEventManager class.

    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
    });

    afterAll(async function () {
        if (db) {
            await fromCallback(cb => db.detach(cb)).catch(() => {});
        }
    });

    it('should emit "attach" event when a database connection is established', async function () {
        // The 'attach' event fires synchronously after the Firebird.attach
        // user callback returns (same call-stack tick as the socket data
        // handler). Registering the listener inside the user callback is
        // sufficient – it is already in place when the event is emitted.
        let adb;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('attach event timed out')), 5000);
            Firebird.attach(config, function (err, db) {
                if (err) { clearTimeout(timer); reject(err); return; }
                adb = db;
                db.once('attach', () => { clearTimeout(timer); resolve(); });
            });
        });
        if (adb) await fromCallback(cb => adb.detach(cb));
    });

    it('should emit "detach" event when a database connection is closed', async function () {
        const adb = await fromCallback(cb => Firebird.attach(config, cb));

        const detachPromise = new Promise((resolve) => { adb.once('detach', resolve); });
        await fromCallback(cb => adb.detach(cb));
        await detachPromise;
    });

    it('should emit "transaction" event when a transaction starts', async function () {
        const txPromise = new Promise((resolve) => { db.once('transaction', resolve); });
        const transaction = await fromCallback(cb => db.startTransaction(cb));
        await txPromise;
        await fromCallback(cb => transaction.commit(cb));
    });

    it('should emit "commit" event when a transaction is committed', async function () {
        const transaction = await fromCallback(cb => db.startTransaction(cb));
        const commitPromise = new Promise((resolve) => { db.once('commit', resolve); });
        await fromCallback(cb => transaction.commit(cb));
        await commitPromise;
    });

    it('should emit "rollback" event when a transaction is rolled back', async function () {
        const transaction = await fromCallback(cb => db.startTransaction(cb));
        const rollbackPromise = new Promise((resolve) => { db.once('rollback', resolve); });
        await fromCallback(cb => transaction.rollback(cb));
        await rollbackPromise;
    });

    it('should emit "query" event with the SQL string when a query is executed', async function () {
        const sql = 'SELECT 1 FROM RDB$DATABASE';
        const queryPromise = new Promise((resolve) => { db.once('query', resolve); });
        await fromCallback(cb => db.query(sql, cb));
        const emittedSql = await queryPromise;
        assert.equal(emittedSql, sql);
    });

    it('should emit "row" event for each row returned by a query', async function () {
        const rowEvents = [];
        const rowHandler = (row) => rowEvents.push(row);
        db.on('row', rowHandler);
        try {
            await fromCallback(cb => db.query('SELECT * FROM RDB$DATABASE', cb));
        } finally {
            db.removeListener('row', rowHandler);
        }
        assert.ok(rowEvents.length > 0, 'Expected at least one row event');
    });

    it('should emit "result" event with the full result array when a query completes', async function () {
        const resultPromise = new Promise((resolve) => { db.once('result', resolve); });
        await fromCallback(cb => db.query('SELECT * FROM RDB$DATABASE', cb));
        const rows = await resultPromise;
        assert.ok(Array.isArray(rows), 'result event should emit an array');
        assert.ok(rows.length > 0, 'result array should not be empty');
    });

    it('should emit "error" event on connection-level errors', async function () {
        const adb = await fromCallback(cb => Firebird.attach(config, cb));

        const errorPromise = new Promise((resolve) => { adb.once('error', resolve); });

        // Trigger the throwClosed() code-path in Connection, which emits 'error'
        // on the Database object and then calls the provided callback with the
        // same error. We absorb the callback error to avoid an unhandled rejection.
        // This is the standard driver path for connection-level errors (socket
        // closed, etc.) and avoids the complexity of destroying a live socket.
        adb.connection._isClosed = true;
        adb.connection.startTransaction(() => {});

        const err = await errorPromise;
        assert.ok(err instanceof Error);
        assert.match(err.message, /Connection is closed/);

        // Restore and clean up
        adb.connection._isClosed = false;
        await fromCallback(cb => adb.detach(cb));
    });
});

describe('Firebird Database Events (POST_EVENT)', function () {
    // Real Firebird database events are asynchronous notifications triggered
    // by POST_EVENT calls inside PSQL triggers or stored procedures.
    // They are accessed via db.attachEvent() which returns a FbEventManager.
    // Use FbEventManager.registerEvent() to subscribe to named events and
    // listen for the 'post_event' emitter event to receive notifications.
    //
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

    it('should create an event manager connection and verify initial state via getState()', async function () {
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        try {
            // After attachEvent: IDLE – EventConnection open, no active subscription
            const idleState = evtmgr.getState();
            assert.equal(idleState.state, 'IDLE');
            assert.equal(idleState.hasActiveSubscription, false);
            assert.deepStrictEqual(idleState.registeredEvents, {});
            assert.equal(idleState.isEventConnectionOpen, true);
            assert.equal(idleState.isDatabaseConnectionClosed, false);
        } finally {
            await fromCallback(cb => evtmgr.close(cb));
        }
    });

    it('should register a named event subscription', async function () {
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        try {
            await fromCallback(cb => evtmgr.registerEvent(['TRG_TEST_EVENTS'], cb));
            const subscribedState = evtmgr.getState();
            assert.equal(subscribedState.state, 'SUBSCRIBED');
            assert.equal(subscribedState.hasActiveSubscription, true);
            assert.deepStrictEqual(Object.keys(subscribedState.registeredEvents), ['TRG_TEST_EVENTS']);
            assert.ok(subscribedState.registeredEvents.TRG_TEST_EVENTS >= 0);
        } finally {
            await fromCallback(cb => evtmgr.close(cb));
        }
    });

    it('should unregister a named event subscription', async function () {
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        try {
            await fromCallback(cb => evtmgr.registerEvent(['TRG_TEST_EVENTS'], cb));
            await fromCallback(cb => evtmgr.unregisterEvent(['TRG_TEST_EVENTS'], cb));
            const idleState = evtmgr.getState();
            assert.equal(idleState.state, 'IDLE');
            assert.equal(idleState.hasActiveSubscription, false);
            assert.deepStrictEqual(idleState.registeredEvents, {});
        } finally {
            await fromCallback(cb => evtmgr.close(cb));
        }
    });

    it('should receive a post_event notification when the database fires an event', async function () {
        const evtmgr = await fromCallback(cb => db.attachEvent(cb));
        const fireDb = await fromCallback(cb => Firebird.attach(config, cb));
        try {
            await fromCallback(cb => evtmgr.registerEvent(['TRG_TEST_EVENTS'], cb));

            const eventPromise = new Promise((resolve, reject) => {
                evtmgr.on('post_event', (name, count) => {
                    try {
                        assert.equal(name, 'TRG_TEST_EVENTS');
                        assert.ok(count > 0);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timed out waiting for post_event notification')), 5000);
            });

            const uniqueId = (Date.now() % 1000000000) + Math.floor(Math.random() * 1000);
            await fromCallback(cb => fireDb.query('INSERT INTO TEST_EVENTS (ID, NAME) VALUES (?, ?)', [uniqueId, 'xpto'], cb));

            await Promise.race([eventPromise, timeoutPromise]);
        } finally {
            await fromCallback(cb => fireDb.detach(cb)).catch(() => {});
            await fromCallback(cb => evtmgr.close(cb));
        }
    });
});

describe('Auth plugin connection', function () {

    // Must be test with firebird 2.5 or higher with Legacy_Auth enabled on server
    it('should attach with legacy plugin', async function () {
        let db;
        try {
            db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_LEGACY }), cb));
        } catch (err) {
            if (err.message.indexOf("Server don't accept plugin") !== -1 || err.message.indexOf("Legacy_Auth") !== -1) {
                console.log("Skipping legacy plugin test: unsupported by server");
                return;
            }
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
        it('should attach with srp plugin', { timeout: 120000 }, async function () {
            let db;
            try {
                db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_SRP }), cb));
            } catch (err) {
                if (err.message.indexOf("Server don't accept plugin") !== -1 || err.message.indexOf("Srp") !== -1) {
                    console.log("Skipping Srp plugin test: unsupported by server");
                    return;
                }
                throw err;
            }
            await fromCallback(cb => db.detach(cb));
        });

        // FB 3.0 : Should be tested with Srp256 enabled on server configuration
        it('should attach with srp 256 plugin', { timeout: 20000 }, async function () {
            try {
                const db = await fromCallback(cb => Firebird.attachOrCreate(Config.extends(config, { pluginName: Firebird.AUTH_PLUGIN_SRP256 }), cb));
                await fromCallback(cb => db.detach(cb));
            } catch (e) {
                if (e.message.indexOf('Server don\'t accept plugin : Srp256') !== -1) {
                    console.log('Skipping test: Server does not support Srp256');
                    return;
                }
                throw e;
            }
        });
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
            const d = await fromCallback(cb => db.query('SELECT RDB$ROLE_NAME, RDB$OWNER_NAME FROM RDB$ROLES WHERE RDB$OWNER_NAME = ?', [config.user], cb));
            assert.ok(d);
        });

        it('should select multiple rows', async function () {
            await fromCallback(cb => db.query('SELECT FIRST 100 RDB$FIELD_NAME FROM RDB$FIELDS', cb));
        });

        it('should create table', async function () {
            await fromCallback(cb => db.query('CREATE TABLE T (ID INT)', cb));
        });
    });

    describe('Statement timeout', function() {
        // Statement timeout is only available from protocol v16 (Firebird 4+).
        // protocolVersion is set in beforeAll, so skip must be evaluated lazily
        // inside beforeEach (not at describe-block setup time) to avoid running
        // the infinite-loop test on Firebird 3 which would permanently block the queue.
        beforeEach(({ skip }) => {
            if (protocolVersion < Const.PROTOCOL_VERSION16) skip();
        });

        it('should query with sufficient timeout', async function (test) {
            await fromCallback(cb => db.query('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
        });

        it('should query throw timeout', async function (test) {
            await assert.rejects(async () => {
                await fromCallback(cb => db.query('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
            }, /Operation was cancelled, Statement level timeout expired/);
        });

        it('should execute with sufficient timeout', async function (test) {
            await fromCallback(cb => db.execute('SELECT * FROM RDB$RELATIONS FOR UPDATE', cb, { timeout: 10 }));
        });

        it('should execute throw timeout', async function (test) {
            await assert.rejects(async () => {
                await fromCallback(cb => db.execute('EXECUTE BLOCK AS BEGIN WHILE(0=0) DO BEGIN END END', cb, { timeout: 1000 }));
            }, /Operation was cancelled, Statement level timeout expired/);
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
            const cleanParam0 = err.gdsparams[0] ? err.gdsparams[0].replace(/^"|"$/g, '') : '';
            let cleanParam1 = err.gdsparams[1] || '';
            if (cleanParam1.indexOf('.') !== -1) {
                cleanParam1 = cleanParam1.split('.').pop();
            }
            cleanParam1 = cleanParam1.replace(/^"|"$/g, '');
            assert.strictEqual(cleanParam0, 'PK_NAME', 'The PK constraint name')
            assert.strictEqual(cleanParam1, 'TEST_GDSCODE', 'The table name')
        }
    });

    describe('Issue #387 - 100 rows with large text BLOBs and blobAsText: true', function () {
        const testConfig = Config.extends(config, { blobAsText: true });
        
        beforeAll(async function () {
            // Setup table
            const setupDb = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
            try {
                await fromCallback(cb => setupDb.query('DROP TABLE test_large_blobs', cb));
            } catch (e) {}
            await fromCallback(cb => setupDb.query('CREATE TABLE test_large_blobs (id INTEGER, val BLOB SUB_TYPE 1)', cb));
            
            // Insert 100 rows of large text blobs
            const largeText = 'A'.repeat(5000); // 5 KB text blob
            for (let i = 1; i <= 100; i++) {
                await fromCallback(cb => setupDb.query('INSERT INTO test_large_blobs (id, val) VALUES (?, ?)', [i, largeText], cb));
            }
            await fromCallback(cb => setupDb.detach(cb));
        });

        afterAll(async function () {
            const cleanupDb = await fromCallback(cb => Firebird.attach(config, cb));
            try {
                await fromCallback(cb => cleanupDb.query('DROP TABLE test_large_blobs', cb));
            } catch (e) {}
            await fromCallback(cb => cleanupDb.detach(cb));
        });

        it('should retrieve 100 rows with large text BLOBs sequentially without deadlocking', async function () {
            const dbText = await fromCallback(cb => Firebird.attach(testConfig, cb));
            try {
                const rows = await fromCallback(cb => dbText.query('SELECT * FROM test_large_blobs ORDER BY id ASC', cb));
                assert.strictEqual(rows.length, 100);
                const largeText = 'A'.repeat(5000);
                for (let i = 0; i < 100; i++) {
                    assert.strictEqual(rows[i].id, i + 1);
                    assert.strictEqual(rows[i].val, largeText);
                }
            } finally {
                await fromCallback(cb => dbText.detach(cb));
            }
        });
    });

    describe('Bidirectional Cursors (Firebird 5+)', function () {
        it('should support bidirectional scrollable cursors', async function ({ skip }) {
            const db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION18) {
                await fromCallback(cb => db.detach(cb));
                skip();
                return;
            }

            let tx;
            let statement;
            try {
                // Setup test table
                try {
                    await fromCallback(cb => db.query('DROP TABLE TEST_SCROLL', cb));
                } catch (e) {}
                await fromCallback(cb => db.query('CREATE TABLE TEST_SCROLL (ID INT, VAL VARCHAR(10))', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_SCROLL (ID, VAL) VALUES (1, \'one\')', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_SCROLL (ID, VAL) VALUES (2, \'two\')', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_SCROLL (ID, VAL) VALUES (3, \'three\')', cb));

                tx = await fromCallback(cb => db.transaction(cb));
                statement = await fromCallback(cb => tx.newStatement('SELECT ID, VAL FROM TEST_SCROLL ORDER BY ID', cb));

                // Execute with scrollable: true
                await fromCallback(cb => statement.execute(tx, [], cb, { scrollable: true }));

                // 1. Fetch NEXT (row 1)
                let res = await fromCallback(cb => statement.fetchScroll(tx, 'NEXT', 0, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 1);

                // 2. Fetch NEXT (row 2)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'NEXT', 0, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 2);

                // 3. Fetch PRIOR (row 1)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'PRIOR', 0, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 1);

                // 4. Fetch LAST (row 3)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'LAST', 0, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 3);

                // 5. Fetch FIRST (row 1)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'FIRST', 0, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 1);

                // 6. Fetch ABSOLUTE with position 2 (row 2)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'ABSOLUTE', 2, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 2);

                // 7. Fetch RELATIVE with offset 1 (row 3)
                res = await fromCallback(cb => statement.fetchScroll(tx, 'RELATIVE', 1, 1, cb));
                assert.strictEqual(res.data.length, 1);
                assert.strictEqual(res.data[0].ID || res.data[0][0], 3);

                statement.release();
                statement = null;
                await fromCallback(cb => tx.commit(cb));
                tx = null;

                // Cleanup table
                await fromCallback(cb => db.query('DROP TABLE TEST_SCROLL', cb));
            } catch (err) {
                if (statement) {
                    try { statement.release(); } catch(e) {}
                }
                if (tx) {
                    try { await fromCallback(cb => tx.rollback(cb)); } catch(e) {}
                }
                throw err;
            } finally {
                await fromCallback(cb => db.detach(cb));
            }
        });
    });

    describe('DML Returning Multiple Rows (Firebird 5+)', function () {
        it('should support UPDATE and DELETE RETURNING multiple rows', async function ({ skip }) {
            const db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION18) {
                await fromCallback(cb => db.detach(cb));
                skip();
                return;
            }

            try {
                // Setup test table
                try {
                    await fromCallback(cb => db.query('DROP TABLE TEST_RET_MULT', cb));
                } catch (e) {}
                await fromCallback(cb => db.query('CREATE TABLE TEST_RET_MULT (ID INT, VAL VARCHAR(10))', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_RET_MULT (ID, VAL) VALUES (1, \'one\')', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_RET_MULT (ID, VAL) VALUES (2, \'two\')', cb));
                await fromCallback(cb => db.query('INSERT INTO TEST_RET_MULT (ID, VAL) VALUES (3, \'three\')', cb));

                // 1. UPDATE RETURNING (updates two rows: ID 2 and 3)
                const updateRes = await fromCallback(cb => db.query(
                    'UPDATE TEST_RET_MULT SET VAL = VAL || \'!\' WHERE ID > 1 RETURNING ID, VAL',
                    [],
                    cb
                ));

                // Assertions
                assert.ok(Array.isArray(updateRes), 'Result should be an array of objects');
                assert.strictEqual(updateRes.length, 2);
                
                // Sort by ID to ensure order
                updateRes.sort((a, b) => (a.id || a.ID) - (b.id || b.ID));
                assert.strictEqual(updateRes[0].id || updateRes[0].ID, 2);
                assert.strictEqual(updateRes[0].val || updateRes[0].VAL, 'two!');
                assert.strictEqual(updateRes[1].id || updateRes[1].ID, 3);
                assert.strictEqual(updateRes[1].val || updateRes[1].VAL, 'three!');

                // 2. DELETE RETURNING (deletes all rows)
                const deleteRes = await fromCallback(cb => db.query(
                    'DELETE FROM TEST_RET_MULT RETURNING ID',
                    [],
                    cb
                ));

                assert.ok(Array.isArray(deleteRes), 'Result should be an array of objects');
                assert.strictEqual(deleteRes.length, 3);
                
                const ids = deleteRes.map(row => row.id || row.ID).sort();
                assert.deepStrictEqual(ids, [1, 2, 3]);

                // Cleanup table
                await fromCallback(cb => db.query('DROP TABLE TEST_RET_MULT', cb));
            } finally {
                await fromCallback(cb => db.detach(cb));
            }
        });
    });

    describe('SKIP LOCKED (Firebird 5+)', function () {
        it('should support SELECT WITH LOCK SKIP LOCKED', async function ({ skip }) {
            const db1 = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
            if (db1.connection.accept.protocolVersion < Const.PROTOCOL_VERSION18) {
                await fromCallback(cb => db1.detach(cb));
                skip();
                return;
            }

            let db2;
            let tx1;
            let tx2;
            try {
                // Setup test table
                try {
                    await fromCallback(cb => db1.query('DROP TABLE TEST_SKIP_LOCK', cb));
                } catch (e) {}
                await fromCallback(cb => db1.query('CREATE TABLE TEST_SKIP_LOCK (ID INT, VAL VARCHAR(10))', cb));
                await fromCallback(cb => db1.query('INSERT INTO TEST_SKIP_LOCK (ID, VAL) VALUES (1, \'one\')', cb));
                await fromCallback(cb => db1.query('INSERT INTO TEST_SKIP_LOCK (ID, VAL) VALUES (2, \'two\')', cb));

                // Connection 2
                db2 = await fromCallback(cb => Firebird.attach(config, cb));

                // Transaction 1 locks ID 1
                tx1 = await fromCallback(cb => db1.transaction(cb));
                const lockedRows = await fromCallback(cb => tx1.query(
                    'SELECT ID, VAL FROM TEST_SKIP_LOCK WHERE ID = 1 WITH LOCK',
                    [],
                    cb
                ));
                assert.strictEqual(lockedRows.length, 1);

                // Transaction 2 tries to select rows WITH LOCK SKIP LOCKED.
                // It should skip ID 1 (locked by tx1) and only return ID 2!
                tx2 = await fromCallback(cb => db2.transaction(cb));
                const skipLockedRows = await fromCallback(cb => tx2.query(
                    'SELECT ID, VAL FROM TEST_SKIP_LOCK WITH LOCK SKIP LOCKED',
                    [],
                    cb
                ));

                // Assertions
                assert.strictEqual(skipLockedRows.length, 1);
                assert.strictEqual(skipLockedRows[0].id || skipLockedRows[0].ID, 2);

                // Clean up Transaction 2
                await fromCallback(cb => tx2.commit(cb));
                tx2 = null;

                // Clean up Transaction 1
                await fromCallback(cb => tx1.commit(cb));
                tx1 = null;

                // Cleanup table
                await fromCallback(cb => db1.query('DROP TABLE TEST_SKIP_LOCK', cb));
            } catch (err) {
                if (tx1) {
                    try { await fromCallback(cb => tx1.rollback(cb)); } catch (e) {}
                }
                if (tx2) {
                    try { await fromCallback(cb => tx2.rollback(cb)); } catch (e) {}
                }
                throw err;
            } finally {
                if (db2) {
                    try { await fromCallback(cb => db2.detach(cb)); } catch (e) {}
                }
                await fromCallback(cb => db1.detach(cb));
            }
        });
    });

    describe('Parallel Workers (Firebird 5+)', function () {
        it('should support setting parallelWorkers in DPB', async function ({ skip }) {
            const db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION18) {
                await fromCallback(cb => db.detach(cb));
                skip();
                return;
            }
            await fromCallback(cb => db.detach(cb));

            const parallelConfig = Config.extends(config, { parallelWorkers: 2 });
            const db2 = await fromCallback(cb => Firebird.attach(parallelConfig, cb));

            try {
                const res = await fromCallback(cb => db2.query(
                    "SELECT CAST(RDB$GET_CONTEXT('SYSTEM', 'PARALLEL_WORKERS') AS INTEGER) AS PW FROM RDB$DATABASE",
                    [],
                    cb
                ));
                assert.ok(res.length > 0);
                const pw = res[0].pw || res[0].PW;
                assert.ok(pw === 1 || pw === 2, 'Should return parallel workers (capped by MaxParallelWorkers, which defaults to 1)');
            } finally {
                await fromCallback(cb => db2.detach(cb));
            }
        });
    });
});
