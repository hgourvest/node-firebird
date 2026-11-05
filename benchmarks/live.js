'use strict';

const path = require('node:path');
const Firebird = require('../lib');
const { benchAsync, printTable } = require('./harness');

function getLiveConfig() {
    const dataDir = process.env.FIREBIRD_DATA || '/tmp';
    return {
        host: process.env.ISC_HOST || '127.0.0.1',
        port: Number(process.env.ISC_PORT) || 3050,
        database: path.join(dataDir, `node-firebird-bench-${process.pid}.fdb`),
        user: process.env.ISC_USER || 'SYSDBA',
        password: process.env.ISC_PASSWORD || 'masterkey',
        lowercase_keys: false,
        statementCacheSize: 100
    };
}

async function runLiveBenchmarks(options = {}) {
    const config = getLiveConfig();
    let db;

    try {
        db = await Firebird.createAsync(config);
    } catch (err) {
        if (!options.json) {
            console.log(`\n[Live Benchmarks] Skipped — could not create temporary database at ${config.host}:${config.port}:${config.database}`);
            console.log(`  Reason: ${err && err.message ? err.message : String(err)}`);
            console.log('  Set ISC_HOST, ISC_PORT, ISC_USER, ISC_PASSWORD, and FIREBIRD_DATA to run against a reachable Firebird instance.\n');
        }
        return [];
    }

    try {
        await db.queryAsync(`
            CREATE TABLE BENCH_ITEMS (
                ID INTEGER NOT NULL PRIMARY KEY,
                CODE VARCHAR(32) NOT NULL,
                TITLE VARCHAR(128) NOT NULL,
                AMOUNT NUMERIC(15, 2) NOT NULL,
                ACTIVE SMALLINT NOT NULL,
                CREATED_AT TIMESTAMP NOT NULL
            )
        `);
        await db.queryAsync(`
            CREATE TABLE BENCH_BATCH (
                ID INTEGER NOT NULL,
                NAME VARCHAR(64) NOT NULL,
                SCORE INTEGER NOT NULL
            )
        `);
        await db.queryAsync(`
            CREATE TABLE BENCH_BLOBS (
                ID INTEGER NOT NULL PRIMARY KEY,
                DATA BLOB SUB_TYPE BINARY
            )
        `);

        const seedRows = Array.from({ length: 1000 }, (_, i) => [
            i + 1,
            `CODE-${String(i + 1).padStart(5, '0')}`,
            `Benchmark Item Title #${i + 1} with realistic description text`,
            Number(((i + 1) * 13.37).toFixed(2)),
            i % 2,
            new Date(Date.UTC(2026, 0, 1, 12, 0, i % 60))
        ]);
        await db.executeBatchAsync(
            'INSERT INTO BENCH_ITEMS (ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT) VALUES (?, ?, ?, ?, ?, ?)',
            seedRows
        );

        const blobPayload64K = Buffer.alloc(64 * 1024, 0x61);
        await db.queryAsync('INSERT INTO BENCH_BLOBS (ID, DATA) VALUES (?, ?)', [1, blobPayload64K]);

        const uncachedDb = await Firebird.attachAsync(Object.assign({}, config, { statementCacheSize: 0 }));
        const liveResults = [];

        try {
            const txCached = await db.transactionAsync(Firebird.ISOLATION_READ_COMMITTED_READ_ONLY);
            try {
                let lookupId = 1;
                liveResults.push(
                    await benchAsync(
                        'Point SELECT by PK (cached prepared statement)',
                        async () => {
                            lookupId = (lookupId % 1000) + 1;
                            await txCached.queryAsync(
                                'SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS WHERE ID = ?',
                                [lookupId]
                            );
                        },
                        { warmupIterations: 5, iterations: 50, itemsPerOp: 1, unit: 'queries/s' }
                    )
                );
            } finally {
                await txCached.commitAsync();
            }

            const txUncached = await uncachedDb.transactionAsync(Firebird.ISOLATION_READ_COMMITTED_READ_ONLY);
            try {
                let uncachedId = 1;
                liveResults.push(
                    await benchAsync(
                        'Point SELECT by PK (uncached prepare + execute + drop)',
                        async () => {
                            uncachedId = (uncachedId % 1000) + 1;
                            await txUncached.queryAsync(
                                'SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS WHERE ID = ?',
                                [uncachedId]
                            );
                        },
                        { warmupIterations: 5, iterations: 50, itemsPerOp: 1, unit: 'queries/s' }
                    )
                );
            } finally {
                await txUncached.commitAsync();
            }

            liveResults.push(
                await benchAsync(
                    'SELECT 1,000 rows -> Objects (queryAsync)',
                    async () => {
                        await db.queryAsync('SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS');
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                )
            );

            liveResults.push(
                await benchAsync(
                    'SELECT 1,000 rows -> Arrays (executeAsync)',
                    async () => {
                        await db.executeAsync('SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS');
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                )
            );

            const batchRows200 = Array.from({ length: 200 }, (_, i) => [
                i + 1,
                `BatchUser-${i + 1}`,
                (i + 1) * 10
            ]);
            liveResults.push(
                await benchAsync(
                    'INSERT 200 rows via executeBatchAsync',
                    async () => {
                        await db.executeBatchAsync(
                            'INSERT INTO BENCH_BATCH (ID, NAME, SCORE) VALUES (?, ?, ?)',
                            batchRows200
                        );
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 200, unit: 'rows/s' }
                )
            );

            liveResults.push(
                await benchAsync(
                    'BLOB 64 KB write round-trip',
                    async () => {
                        await db.queryAsync('UPDATE BENCH_BLOBS SET DATA = ? WHERE ID = 1', [blobPayload64K]);
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 64 / 1024, unit: 'MB/s' }
                )
            );

            if (!options.json) {
                printTable('Live Firebird Server Benchmarks', liveResults);
            }
            return liveResults;
        } finally {
            try {
                await uncachedDb.detachAsync();
            } catch {
                // ignore detach error on cleanup
            }
        }
    } finally {
        try {
            await db.dropAsync();
        } catch {
            // ignore drop error on cleanup
        }
    }
}

module.exports = {
    runLiveBenchmarks
};
