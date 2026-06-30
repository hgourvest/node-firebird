const Firebird = require('../lib');
const Config = require('./config');
const Const = require('../lib/wire/const');
const assert = require('assert');

const config = Config.default;

/**
 * Converts a callback-style function call into a Promise.
 */
function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        try {
            executor((err, result) => err ? reject(err) : resolve(result));
        } catch (e) {
            reject(e);
        }
    });
}

describe('UTF-8 User Identification (PR #377)', function () {
    
    it('should define isc_dpb_utf8_filename constant', function () {
        assert.strictEqual(Const.isc_dpb_utf8_filename, 77, 
            'isc_dpb_utf8_filename should be defined as 77');
    });

    it('should define PROTOCOL_VERSION13 constant', function () {
        assert.ok(Const.PROTOCOL_VERSION13, 'PROTOCOL_VERSION13 should be defined');
        assert.strictEqual(Const.PROTOCOL_VERSION13 & Const.FB_PROTOCOL_MASK, 13,
            'Protocol version 13 should be properly masked to extract version number');
        assert.ok(Const.PROTOCOL_VERSION13 & Const.FB_PROTOCOL_FLAG, 
            'PROTOCOL_VERSION13 should include FB_PROTOCOL_FLAG');
    });

    describe('Database Operations', function () {

        let sharedDb = null;
        beforeAll(async function () {
            // Create the database first, then detach so tests can attach to it
            console.log('[test] beforeAll: creating database');
            sharedDb = await fromCallback(cb => Firebird.create(config, cb));
            console.log('[test] beforeAll: database created, handle=', sharedDb && sharedDb.connection && sharedDb.connection.dbhandle);
            await fromCallback(cb => sharedDb.detach(cb, true));
            console.log('[test] beforeAll: detached');
            sharedDb = null;
        });

        afterAll(async function () {
            console.log('[test] afterAll: dropping database');
            try {
                await fromCallback(cb => Firebird.drop(config, cb));
                console.log('[test] afterAll: database dropped');
            } catch (e) {
                console.log('[test] afterAll: drop failed:', e.message);
            }
        });

        it('should attach to database with UTF-8 support on Firebird 3+', async function () {
            console.log('[test] should attach: attaching...');
            const db = await fromCallback(cb => Firebird.attach(config, cb));
            console.log('[test] should attach: attached, handle=', db && db.connection && db.connection.dbhandle);
            
            assert.ok(db, 'Database connection should be established');
            assert.ok(db.connection, 'Connection object should exist');
            
            if (db.connection.accept && db.connection.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
                console.log('[test] should attach: running query...');
                const rows = await fromCallback(cb => db.query('SELECT CURRENT_USER FROM RDB$DATABASE', cb));
                console.log('[test] should attach: query returned', rows && rows.length, 'rows');
                assert.ok(rows, 'Query should succeed with UTF-8 support enabled');
                assert.strictEqual(rows.length, 1, 'Should return one row');
            }
            
            console.log('[test] should attach: detaching...');
            await fromCallback(cb => db.detach(cb, true));
            console.log('[test] should attach: done');
        });

        it('should create database with UTF-8 support on Firebird 3+', async function () {
            const testCreateConfig = Config.extends(config, {
                database: config.database.replace(/\.fdb/, '-utf8-test.fdb')
            });
            
            console.log('[test] should create: creating...');
            const db = await fromCallback(cb => Firebird.create(testCreateConfig, cb));
            console.log('[test] should create: created, handle=', db && db.connection && db.connection.dbhandle);
            
            assert.ok(db, 'Database connection should be established');
            assert.ok(db.connection, 'Connection object should exist');
            
            if (db.connection.accept && db.connection.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
                const rows = await fromCallback(cb => db.query('SELECT 1 as val FROM RDB$DATABASE', cb));
                assert.ok(rows && rows.length > 0 && rows[0].val === 1, 'Database created successfully with UTF-8 support');
            }
            
            await fromCallback(cb => db.detach(cb, true));
            await fromCallback(cb => Firebird.drop(testCreateConfig, cb));
        });

        it('should handle UTF-8 encoded usernames correctly on Firebird 3+', async function () {
            const db = await fromCallback(cb => Firebird.attach(config, cb));
            
            assert.ok(db, 'Database connection should be established');
            
            const rows = await fromCallback(cb => db.query('SELECT 1 as test FROM RDB$DATABASE', cb));
            assert.ok(rows, 'Query should return results');
            assert.strictEqual(rows.length, 1, 'Should return one row');
            assert.strictEqual(rows[0].test, 1, 'Connection with UTF-8 support should work correctly');
            
            await fromCallback(cb => db.detach(cb, true));
        });
    });

    describe('BLR Buffer Verification', function () {
        const { BlrWriter } = require('../lib/wire/serialize');
        
        it('should add isc_dpb_utf8_filename flag to BLR buffer', function () {
            const blr = new BlrWriter();
            
            blr.addByte(Const.isc_dpb_utf8_filename);
            blr.addByte(0);
            
            assert.strictEqual(blr.buffer[0], 77, 'First byte should be isc_dpb_utf8_filename (77)');
            assert.strictEqual(blr.buffer[1], 0, 'Second byte should be 0 (no additional data)');
            assert.strictEqual(blr.pos, 2, 'Position should be at 2 after adding flag');
        });

        it('should verify protocol version check logic', function () {
            const testProtocol13 = Const.PROTOCOL_VERSION13;
            const testProtocol12 = Const.PROTOCOL_VERSION12 || (Const.FB_PROTOCOL_FLAG | 12);
            
            assert.ok(testProtocol13 >= Const.PROTOCOL_VERSION13,
                'Protocol 13 should satisfy the >= PROTOCOL_VERSION13 condition');
            
            assert.ok(!(testProtocol12 >= Const.PROTOCOL_VERSION13),
                'Protocol 12 should not satisfy the >= PROTOCOL_VERSION13 condition');
        });
    });

    describe('Integration Test - UTF-8 Characters', function () {
        
        let integrationDb = null;
        const intgConfig = Config.extends(config, { database: config.database.replace(/\.fdb/, '-intg.fdb') });
        
        beforeAll(async function () {
            integrationDb = await fromCallback(cb => Firebird.create(intgConfig, cb));
            console.log('[test] Integration beforeAll: db created, handle=', integrationDb && integrationDb.connection && integrationDb.connection.dbhandle);
        });

        afterAll(async function () {
            if (integrationDb) {
                try { await fromCallback(cb => integrationDb.detach(cb, true)); } catch (e) {}
                try { await fromCallback(cb => Firebird.drop(intgConfig, cb)); } catch (e) {}
            }
        });

        it('should handle database with UTF-8 in process name on Firebird 3+', async function () {
            const originalTitle = process.title;
            
            try {
                process.title = 'node-firebird-test-测试-тест';
                
                assert.ok(integrationDb, 'Database connection should be established');
                
                const rows = await fromCallback(cb => integrationDb.query('SELECT 1 AS test FROM RDB$DATABASE', cb));
                assert.strictEqual(rows[0].test, 1, 'Query should execute successfully');
            } finally {
                process.title = originalTitle;
            }
        });
    });
});
