'use strict';

const os = require('node:os');
const path = require('node:path');
if (!process.env.FIREBIRD_LOCK) {
    process.env.FIREBIRD_LOCK = os.tmpdir();
}

const Firebird = require('../lib');
const Config = require('./config');

describe('Optional native driver support (node-firebird-driver-native)', () => {
    const hasNative = Firebird.hasNativeDriver();
    const baseCfg = Config.default;
    const dbPath = path.join(
        process.env.FIREBIRD_DATA || '/tmp',
        `node-firebird-native-test-${process.pid}.fdb`
    );
    const nativeOpts = {
        ...baseCfg,
        database: dbPath,
        native: true,
        lowercase_keys: false,
        statementCacheSize: 50,
    };

    test('exposes hasNativeDriver(), loadNativeDriver(), and Firebird.native namespace', () => {
        expect(typeof Firebird.hasNativeDriver).toBe('function');
        expect(typeof Firebird.loadNativeDriver).toBe('function');
        expect(typeof hasNative).toBe('boolean');
        expect(Firebird.native).toBeDefined();
        expect(typeof Firebird.native.attach).toBe('function');
        expect(typeof Firebird.native.attachAsync).toBe('function');
        expect(typeof Firebird.native.create).toBe('function');
        expect(typeof Firebird.native.createAsync).toBe('function');
        expect(typeof Firebird.native.attachOrCreate).toBe('function');
        expect(typeof Firebird.native.attachOrCreateAsync).toBe('function');
        expect(typeof Firebird.native.drop).toBe('function');
        expect(typeof Firebird.native.dropAsync).toBe('function');
        expect(typeof Firebird.native.pool).toBe('function');
    });

    const describeIfNative = hasNative ? describe : describe.skip;

    describeIfNative('when node-firebird-driver-native is available', () => {
        let db;

        beforeAll(async () => {
            db = await Firebird.createAsync(nativeOpts);
            await db.queryAsync(`
                CREATE TABLE NATIVE_ITEMS (
                    ID INTEGER NOT NULL PRIMARY KEY,
                    NAME VARCHAR(64) NOT NULL,
                    SCORE NUMERIC(10, 2) NOT NULL,
                    NOTES BLOB SUB_TYPE TEXT,
                    RAW_DATA BLOB SUB_TYPE BINARY
                )
            `);
        });

        afterAll(async () => {
            if (db) {
                try {
                    await db.dropAsync();
                } catch {
                    // ignore cleanup error
                }
            }
        });

        test('pingAsync() and server info work on NativeDatabase', async () => {
            await expect(db.pingAsync()).resolves.toBeUndefined();
        });

        test('queryAsync, executeAsync, namedPlaceholders, and statement cache work', async () => {
            await db.queryAsync(
                'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE, NOTES, RAW_DATA) VALUES (?, ?, ?, ?, ?)',
                [1, 'Alpha', 42.5, 'Hello native world', Buffer.from([1, 2, 3, 4])]
            );

            // Second execution hits the LRU statement cache
            await db.queryAsync(
                'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE, NOTES, RAW_DATA) VALUES (?, ?, ?, ?, ?)',
                [2, 'Beta', 99.25, 'Second row', Buffer.from([5, 6, 7, 8])]
            );
            expect(db.statementCache.size).toBeGreaterThan(0);

            const rows = await db.queryAsync(
                'SELECT ID, NAME, SCORE, NOTES, RAW_DATA FROM NATIVE_ITEMS WHERE ID = :id',
                { id: 1 },
                { namedPlaceholders: true }
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].ID).toBe(1);
            expect(rows[0].NAME).toBe('Alpha');
            expect(Number(rows[0].SCORE)).toBeCloseTo(42.5, 2);
            expect(rows[0].NOTES).toBe('Hello native world');
            expect(Buffer.isBuffer(rows[0].RAW_DATA)).toBe(true);
            expect(Array.from(rows[0].RAW_DATA)).toEqual([1, 2, 3, 4]);

            const arrRows = await db.executeAsync(
                'SELECT ID, NAME FROM NATIVE_ITEMS ORDER BY ID'
            );
            expect(arrRows).toEqual([
                [1, 'Alpha'],
                [2, 'Beta'],
            ]);
        });

        test('db.sql tagged template and RETURNING work', async () => {
            const inserted = await db.queryAsync(
                'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE) VALUES (?, ?, ?) RETURNING ID, NAME',
                [3, 'Gamma', 10.0]
            );
            expect(inserted).toEqual({ ID: 3, NAME: 'Gamma' });

            const taggedRows = await db.sql`SELECT ID, NAME FROM NATIVE_ITEMS WHERE ID = ${3}`;
            expect(taggedRows).toEqual([{ ID: 3, NAME: 'Gamma' }]);
        });

        test('executeBatchAsync inserts multiple rows atomically', async () => {
            const batchResult = await db.executeBatchAsync(
                'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE) VALUES (?, ?, ?)',
                [
                    [10, 'Batch10', 1.0],
                    [11, 'Batch11', 2.0],
                    [12, 'Batch12', 3.0],
                ]
            );
            expect(batchResult.success).toBe(true);
            expect(batchResult.recordCount).toBe(3);
            expect(batchResult.updateCounts).toEqual([1, 1, 1]);
        });

        test('withTransaction commits and rolls back on error, including savepoints', async () => {
            await db.withTransaction(async (tx) => {
                await tx.queryAsync(
                    'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE) VALUES (?, ?, ?)',
                    [20, 'Tx20', 20.0]
                );
                await expect(
                    tx.withSavepoint(async () => {
                        await tx.queryAsync(
                            'INSERT INTO NATIVE_ITEMS (ID, NAME, SCORE) VALUES (?, ?, ?)',
                            [21, 'RolledBackSavepoint', 21.0]
                        );
                        throw new Error('abort savepoint');
                    })
                ).rejects.toThrow('abort savepoint');
            });

            const rows20 = await db.queryAsync('SELECT ID FROM NATIVE_ITEMS WHERE ID IN (20, 21)');
            expect(rows20).toEqual([{ ID: 20 }]);
        });

        test('Firebird.pool works with { native: true }', async () => {
            const pool = Firebird.pool(2, nativeOpts);
            try {
                const pooledDb = await pool.getAsync();
                const res = await pooledDb.queryAsync('SELECT COUNT(*) AS CNT FROM NATIVE_ITEMS');
                expect(Number(res[0].CNT)).toBeGreaterThanOrEqual(6);
                await pooledDb.detachAsync();
            } finally {
                await pool.destroyAsync();
            }
        });
    });
});
