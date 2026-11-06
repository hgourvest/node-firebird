'use strict';

/**
 * Head-to-head comparative benchmark across the three Node.js Firebird drivers:
 *   1. `node-firebird` (ours — pure JS wire protocol)
 *   2. `node-firebird-driver-native` (C++ N-API binding over `libfbclient`)
 *   3. `node-firebird-driver-wire` (their pure JS wire protocol driver)
 *
 * Also benchmarks `node-firebird` with `{ native: true }` adapter mode when
 * `node-firebird-driver-native` is available.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.env.FIREBIRD_LOCK) {
    process.env.FIREBIRD_LOCK = os.tmpdir();
}

function ensureFirebirdLockPermissions() {
    try {
        for (const name of fs.readdirSync('/tmp/firebird')) {
            try {
                fs.chmodSync(path.join('/tmp/firebird', name), 0o666);
            } catch {
                // ignore files not owned by current user
            }
        }
    } catch {
        // ignore if /tmp/firebird does not exist
    }
}
const Firebird = require('../lib');
const { benchAsync, printTable, formatNumber, formatDurationNs } = require('./harness');

function tryLoadExternalWireDriver() {
    const candidates = [];
    if (process.env.FIREBIRD_WIRE_DRIVER_PATH) {
        candidates.push(process.env.FIREBIRD_WIRE_DRIVER_PATH);
    }
    candidates.push('node-firebird-driver-wire');
    candidates.push(
        path.resolve(__dirname, '../../node-firebird-drivers/packages/node-firebird-driver-wire')
    );

    for (const candidate of candidates) {
        try {
            const mod = require(candidate);
            if (mod && typeof mod.createWireClient === 'function') {
                // Work around a Protocol 20 framing bug in node-firebird-driver-wire where
                // writePrepareStatementFields() appends an extra 4-byte inlineBlobMaxSize
                // field to op_prepare_statement, causing Firebird 6.0 to drop the socket.
                try {
                    const constPath = require.resolve(path.join(candidate, 'dist/lib/constants'));
                    const wireConsts = require(constPath);
                    if (
                        wireConsts &&
                        wireConsts.wireProtocol &&
                        Array.isArray(wireConsts.wireProtocol.supportedProtocols)
                    ) {
                        wireConsts.wireProtocol.supportedProtocols =
                            wireConsts.wireProtocol.supportedProtocols.filter(
                                (v) => v !== wireConsts.wireProtocol.version20
                            );
                    }
                } catch {
                    // ignore if internal path layout differs
                }
                return mod;
            }
        } catch {
            // try next candidate
        }
    }
    return null;
}

function getCompareConfig() {
    const dataDir = process.env.FIREBIRD_DATA || '/tmp';
    return {
        host: process.env.ISC_HOST || '127.0.0.1',
        port: Number(process.env.ISC_PORT) || 3050,
        database: path.join(dataDir, `node-firebird-compare-${process.pid}.fdb`),
        user: process.env.ISC_USER || 'SYSDBA',
        password: process.env.ISC_PASSWORD || 'masterkey',
    };
}

/**
 * Print a side-by-side comparison matrix across drivers for each workload.
 */
function printComparisonSummary(workloads, driverNames, byDriver) {
    console.log('\n=== Head-to-Head Driver Comparison Summary ===');
    const colWidth = 24;
    const nameWidth = Math.max(44, ...workloads.map((w) => w.label.length));
    const header =
        'Workload'.padEnd(nameWidth) +
        driverNames.map((d) => (' │ ' + d.padStart(colWidth))).join('');
    const rule = '─'.repeat(header.length);
    console.log(rule);
    console.log(header);
    console.log(rule);

    for (const w of workloads) {
        const cells = driverNames.map((dName) => {
            const list = byDriver[dName] || [];
            const entry = list.find((r) => r.workloadKey === w.key);
            if (!entry) return ' │ ' + 'N/A'.padStart(colWidth);
            const decimals = entry.throughput >= 100 ? 0 : 2;
            const text = `${formatNumber(entry.throughput, decimals)} ${entry.unit} (${formatDurationNs(entry.meanNs)})`;
            return ' │ ' + text.padStart(colWidth);
        });
        console.log(w.label.padEnd(nameWidth) + cells.join(''));
    }
    console.log(rule);
}

async function runDriverComparison(options = {}) {
    ensureFirebirdLockPermissions();
    const cfg = getCompareConfig();
    const nativeMod = Firebird.loadNativeDriver();
    const extWireMod = tryLoadExternalWireDriver();

    let setupDb;
    try {
        setupDb = await Firebird.createAsync({
            ...cfg,
            lowercase_keys: false,
            statementCacheSize: 100,
        });
    } catch (err) {
        if (!options.json) {
            console.log(
                `\n[Driver Comparison] Skipped — could not create temporary database at ${cfg.host}:${cfg.port}:${cfg.database}`
            );
            console.log(`  Reason: ${err && err.message ? err.message : String(err)}\n`);
        }
        return [];
    }

    const workloads = [
        { key: 'point_cached', label: 'Point SELECT by PK (prepared / cached stmt)' },
        { key: 'point_uncached', label: 'Point SELECT by PK (prepare + exec + dispose)' },
        { key: 'select_1000_obj', label: 'SELECT 1,000 rows -> Objects' },
        { key: 'select_1000_arr', label: 'SELECT 1,000 rows -> Arrays' },
        { key: 'insert_200_batch', label: 'Bulk INSERT 200 rows (single transaction)' },
        { key: 'blob_64k_write', label: 'BLOB 64 KB write round-trip' },
    ];

    const byDriver = {};
    const driverNames = [];

    try {
        await setupDb.queryAsync(`
            CREATE TABLE BENCH_ITEMS (
                ID INTEGER NOT NULL PRIMARY KEY,
                CODE VARCHAR(32) NOT NULL,
                TITLE VARCHAR(128) NOT NULL,
                AMOUNT NUMERIC(15, 2) NOT NULL,
                ACTIVE SMALLINT NOT NULL,
                CREATED_AT TIMESTAMP NOT NULL
            )
        `);
        await setupDb.queryAsync(`
            CREATE TABLE BENCH_BATCH (
                ID INTEGER NOT NULL,
                NAME VARCHAR(64) NOT NULL,
                SCORE INTEGER NOT NULL
            )
        `);
        await setupDb.queryAsync(`
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
            new Date(Date.UTC(2026, 0, 1, 12, 0, i % 60)),
        ]);
        await setupDb.executeBatchAsync(
            'INSERT INTO BENCH_ITEMS (ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT) VALUES (?, ?, ?, ?, ?, ?)',
            seedRows
        );

        const blobPayload64K = Buffer.alloc(64 * 1024, 0x61);
        await setupDb.queryAsync('INSERT INTO BENCH_BLOBS (ID, DATA) VALUES (?, ?)', [1, blobPayload64K]);

        // Detach setupDb before running benchmarks so every driver runs with a
        // single exclusive attachment (avoiding multi-attachment lock-manager
        // contention in Classic/SuperClassic modes).
        await setupDb.detachAsync();
        setupDb = null;

        const batchRows200 = Array.from({ length: 200 }, (_, i) => [
            i + 1,
            `BatchUser-${i + 1}`,
            (i + 1) * 10,
        ]);

        const pointSql = 'SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS WHERE ID = ?';
        const select1000Sql = 'SELECT ID, CODE, TITLE, AMOUNT, ACTIVE, CREATED_AT FROM BENCH_ITEMS';
        const insertBatchSql = 'INSERT INTO BENCH_BATCH (ID, NAME, SCORE) VALUES (?, ?, ?)';
        const updateBlobSql = 'UPDATE BENCH_BLOBS SET DATA = ? WHERE ID = 1';

        // ===================================================================
        // 1. Helper for node-firebird API (wire mode & { native: true } mode)
        // ===================================================================
        async function benchmarkNodeFirebird(label, extraOptions) {
            ensureFirebirdLockPermissions();
            driverNames.push(label);
            const results = [];
            const cachedDb = await Firebird.attachAsync({
                ...cfg,
                lowercase_keys: false,
                statementCacheSize: 100,
                ...extraOptions,
            });

            try {
                const txCached = await cachedDb.transactionAsync(Firebird.ISOLATION_READ_COMMITTED_READ_ONLY);
                try {
                    let id = 1;
                    const r = await benchAsync(
                        workloads[0].label,
                        async () => {
                            id = (id % 1000) + 1;
                            await txCached.queryAsync(pointSql, [id]);
                        },
                        { warmupIterations: 5, iterations: 40, itemsPerOp: 1, unit: 'queries/s' }
                    );
                    r.workloadKey = 'point_cached';
                    results.push(r);
                } finally {
                    await txCached.commitAsync();
                }

                const rObj = await benchAsync(
                    workloads[2].label,
                    async () => {
                        await cachedDb.queryAsync(select1000Sql);
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                );
                rObj.workloadKey = 'select_1000_obj';
                results.push(rObj);

                const rArr = await benchAsync(
                    workloads[3].label,
                    async () => {
                        await cachedDb.executeAsync(select1000Sql);
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                );
                rArr.workloadKey = 'select_1000_arr';
                results.push(rArr);

                const rBatch = await benchAsync(
                    workloads[4].label,
                    async () => {
                        await cachedDb.executeBatchAsync(insertBatchSql, batchRows200);
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 200, unit: 'rows/s' }
                );
                rBatch.workloadKey = 'insert_200_batch';
                results.push(rBatch);

                const rBlob = await benchAsync(
                    workloads[5].label,
                    async () => {
                        await cachedDb.queryAsync(updateBlobSql, [blobPayload64K]);
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 64 / 1024, unit: 'MB/s' }
                );
                rBlob.workloadKey = 'blob_64k_write';
                results.push(rBlob);
            } finally {
                await cachedDb.detachAsync();
            }

            ensureFirebirdLockPermissions();
            const uncachedDb = await Firebird.attachAsync({
                ...cfg,
                lowercase_keys: false,
                statementCacheSize: 0,
                ...extraOptions,
            });
            try {
                const txUncached = await uncachedDb.transactionAsync(Firebird.ISOLATION_READ_COMMITTED_READ_ONLY);
                try {
                    let id = 1;
                    const r = await benchAsync(
                        workloads[1].label,
                        async () => {
                            id = (id % 1000) + 1;
                            await txUncached.queryAsync(pointSql, [id]);
                        },
                        { warmupIterations: 5, iterations: 40, itemsPerOp: 1, unit: 'queries/s' }
                    );
                    r.workloadKey = 'point_uncached';
                    results.splice(1, 0, r);
                } finally {
                    await txUncached.commitAsync();
                }
            } finally {
                await uncachedDb.detachAsync();
            }

            if (!options.json) {
                printTable(`Driver: ${label}`, results);
            }
            byDriver[label] = results;
        }

        await benchmarkNodeFirebird('node-firebird (wire)', { native: false });
        if (nativeMod) {
            await benchmarkNodeFirebird('node-firebird (native)', { native: true });
        }

        // ===================================================================
        // 2. Helper for node-firebird-driver API (native & their wire driver)
        // ===================================================================
        async function benchmarkExternalDriver(label, client, uri) {
            ensureFirebirdLockPermissions();
            driverNames.push(label);
            const results = [];
            const attachment = await client.connect(uri, {
                username: cfg.user,
                password: cfg.password,
            });

            try {
                // 2a. Point SELECT by PK (reused prepared statement in read-only tx)
                const txRead = await attachment.startTransaction({ accessMode: 'READ_ONLY' });
                const prepPoint = await attachment.prepare(txRead, pointSql);
                try {
                    let id = 1;
                    const r = await benchAsync(
                        workloads[0].label,
                        async () => {
                            id = (id % 1000) + 1;
                            const rs = await prepPoint.executeQuery(txRead, [id]);
                            await rs.fetchAsObject();
                            await rs.close();
                        },
                        { warmupIterations: 5, iterations: 40, itemsPerOp: 1, unit: 'queries/s' }
                    );
                    r.workloadKey = 'point_cached';
                    results.push(r);
                } finally {
                    await prepPoint.dispose();
                    await txRead.commit();
                }

                // 2b. Point SELECT by PK (prepare + executeQuery + close/dispose per call)
                const txUncached = await attachment.startTransaction({ accessMode: 'READ_ONLY' });
                try {
                    let id = 1;
                    const r = await benchAsync(
                        workloads[1].label,
                        async () => {
                            id = (id % 1000) + 1;
                            const rs = await attachment.executeQuery(txUncached, pointSql, [id]);
                            await rs.fetchAsObject();
                            await rs.close();
                        },
                        { warmupIterations: 5, iterations: 40, itemsPerOp: 1, unit: 'queries/s' }
                    );
                    r.workloadKey = 'point_uncached';
                    results.push(r);
                } finally {
                    await txUncached.commit();
                }

                // 2c. SELECT 1,000 rows -> Objects
                const rObj = await benchAsync(
                    workloads[2].label,
                    async () => {
                        const tx = await attachment.startTransaction({ accessMode: 'READ_ONLY' });
                        try {
                            const rs = await attachment.executeQuery(tx, select1000Sql);
                            try {
                                while (true) {
                                    const chunk = await rs.fetchAsObject();
                                    if (!chunk || chunk.length === 0) break;
                                }
                            } finally {
                                await rs.close();
                            }
                        } finally {
                            await tx.commit();
                        }
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                );
                rObj.workloadKey = 'select_1000_obj';
                results.push(rObj);

                // 2d. SELECT 1,000 rows -> Arrays
                const rArr = await benchAsync(
                    workloads[3].label,
                    async () => {
                        const tx = await attachment.startTransaction({ accessMode: 'READ_ONLY' });
                        try {
                            const rs = await attachment.executeQuery(tx, select1000Sql);
                            try {
                                while (true) {
                                    const chunk = await rs.fetch();
                                    if (!chunk || chunk.length === 0) break;
                                }
                            } finally {
                                await rs.close();
                            }
                        } finally {
                            await tx.commit();
                        }
                    },
                    { warmupIterations: 3, iterations: 15, itemsPerOp: 1000, unit: 'rows/s' }
                );
                rArr.workloadKey = 'select_1000_arr';
                results.push(rArr);

                // 2e. Bulk INSERT 200 rows in single transaction
                const rBatch = await benchAsync(
                    workloads[4].label,
                    async () => {
                        const tx = await attachment.startTransaction();
                        const stmt = await attachment.prepare(tx, insertBatchSql);
                        try {
                            for (let i = 0; i < batchRows200.length; i++) {
                                await stmt.execute(tx, batchRows200[i]);
                            }
                            await stmt.dispose();
                            await tx.commit();
                        } catch (e) {
                            try {
                                await stmt.dispose();
                            } catch {
                                // ignore
                            }
                            await tx.rollback();
                            throw e;
                        }
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 200, unit: 'rows/s' }
                );
                rBatch.workloadKey = 'insert_200_batch';
                results.push(rBatch);

                // 2f. BLOB 64 KB write round-trip
                // Note: node-firebird-driver-wire's BlobStream.write() does not
                // auto-split buffers >= 64 KB (uint16 segment limit), so write
                // in 16 KB chunks to keep the wire protocol valid.
                const rBlob = await benchAsync(
                    workloads[5].label,
                    async () => {
                        const tx = await attachment.startTransaction();
                        try {
                            const blobStream = await attachment.createBlob(tx);
                            for (let offset = 0; offset < blobPayload64K.length; offset += 16384) {
                                await blobStream.write(blobPayload64K.subarray(offset, offset + 16384));
                            }
                            await blobStream.close();
                            await attachment.execute(tx, updateBlobSql, [blobStream.blob]);
                            await tx.commit();
                        } catch (e) {
                            await tx.rollback();
                            throw e;
                        }
                    },
                    { warmupIterations: 2, iterations: 10, itemsPerOp: 64 / 1024, unit: 'MB/s' }
                );
                rBlob.workloadKey = 'blob_64k_write';
                results.push(rBlob);
            } finally {
                try {
                    await attachment.disconnect();
                } catch {
                    // ignore disconnect error if socket already closed after a benchmark error
                }
            }

            if (!options.json) {
                printTable(`Driver: ${label}`, results);
            }
            byDriver[label] = results;
        }

        const remoteUri = `${cfg.host}/${cfg.port}:${cfg.database}`;

        // Run node-firebird-driver-native if available
        if (nativeMod) {
            const nativeClient = nativeMod.createNativeClient(nativeMod.getDefaultLibraryFilename());
            try {
                await benchmarkExternalDriver('node-firebird-driver-native', nativeClient, remoteUri);
            } finally {
                await nativeClient.dispose();
            }
        } else if (!options.json) {
            console.log('\n[Driver Comparison] node-firebird-driver-native not found — skipping native driver column.');
        }

        // Run node-firebird-driver-wire if available
        if (extWireMod) {
            const wireClient = extWireMod.createWireClient();
            try {
                await benchmarkExternalDriver('node-firebird-driver-wire', wireClient, remoteUri);
            } finally {
                await wireClient.dispose();
            }
        } else if (!options.json) {
            console.log('\n[Driver Comparison] node-firebird-driver-wire not found — skipping external wire driver column.');
        }

        if (!options.json && driverNames.length > 1) {
            printComparisonSummary(workloads, driverNames, byDriver);
        }

        return driverNames.map((name) => ({
            driver: name,
            results: byDriver[name],
        }));
    } finally {
        try {
            if (setupDb) {
                await setupDb.dropAsync();
            } else {
                await Firebird.dropAsync(cfg);
            }
        } catch {
            // ignore cleanup error
        }
    }
}

if (require.main === module) {
    runDriverComparison().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = {
    runDriverComparison,
};
