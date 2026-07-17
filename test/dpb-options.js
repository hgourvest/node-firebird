'use strict';

/**
 * Live tests for the FB5/FB6 DPB-tag options: owner, searchPath,
 * defaultSchema, parallelWorkers, maxInlineBlobSize.
 *
 * Regression background: the driver used to serialise these options with the
 * WRONG DPB tags (92/93/94/95 — the Firebird 4 replica/bind/decfloat tags):
 *  - `parallelWorkers` silently switched the attached database into replica
 *    mode (isc_dpb_set_db_replica),
 *  - `searchPath` failed the attach with "Invalid decfloat rounding mode",
 *  - `maxInlineBlobSize` was sent as isc_dpb_set_bind,
 *  - `defaultSchema` used a tag that does not exist in Firebird at all.
 * The real values are 100 (parallel_workers), 102 (owner), 104
 * (max_inline_blob_size) and 105 (search_path); defaultSchema is implemented
 * through the search path (CURRENT_SCHEMA = its first existing schema).
 *
 * Needs a live server (see test/config.js); schema/owner assertions are
 * skipped on pre-6.0 servers.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const Config = require('./config');

function uniqueDatabase(tag) {
    return path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-' + tag + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    );
}

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

/**
 * Create a fresh database and run `work(db, options, reattach)`.
 * `reattach(extra)` detaches the current attachment and attaches again with
 * extra options merged in, returning the new db. Whatever attachment is
 * current at the end is used to drop the database.
 */
async function withFreshDb(tag, createExtra, work) {
    const options = Config.extends(Config.default, { database: uniqueDatabase(tag), ...createExtra });
    let db = await fromCallback(cb => Firebird.create(options, cb));
    const reattach = async (extra) => {
        await fromCallback(cb => db.detach(cb));
        db = await fromCallback(cb => Firebird.attach({ ...options, ...extra }, cb));
        return db;
    };
    try {
        return await work(db, options, reattach);
    } finally {
        await fromCallback(cb => db.drop(cb));
    }
}

describe('FB5/FB6 DPB options', function () {

    it('parallelWorkers must NOT change the replica mode (mistagged as set_db_replica before)', { timeout: 10000 }, async function () {
        await withFreshDb('pw', {}, async (db, options, reattach) => {
            const db2 = await reattach({ parallelWorkers: 2 });
            if (db2.connection.accept.protocolVersion < Const.PROTOCOL_VERSION16) {
                // MON$REPLICA_MODE exists since Firebird 4; on older servers
                // just assert the attach with the option succeeds
                const rows = await db2.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
                assert.strictEqual(Number(rows[0].x), 1);
                return;
            }
            const rows = await db2.queryAsync('SELECT MON$REPLICA_MODE AS RM FROM MON$DATABASE');
            assert.strictEqual(Number(rows[0].rm), 0,
                'attaching with parallelWorkers must not switch the database into replica mode');
        });
    });

    it('searchPath attach works and sets CURRENT_SCHEMA (failed as decfloat_round before)', { timeout: 10000 }, async function (ctx) {
        await withFreshDb('sp', {}, async (db, options, reattach) => {
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION20) {
                return ctx.skip();
            }
            await db.queryAsync('CREATE SCHEMA S1');
            const db2 = await reattach({ searchPath: ['S1', 'PUBLIC'] });
            const rows = await db2.queryAsync(
                "SELECT RDB$GET_CONTEXT('SYSTEM','CURRENT_SCHEMA') AS CS FROM RDB$DATABASE");
            assert.strictEqual(rows[0].cs, 'S1');
        });
    });

    it('defaultSchema sets CURRENT_SCHEMA with PUBLIC as fallback', { timeout: 10000 }, async function (ctx) {
        await withFreshDb('ds', {}, async (db, options, reattach) => {
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION20) {
                return ctx.skip();
            }
            await db.queryAsync('CREATE SCHEMA APPSCHEMA');
            await db.queryAsync('CREATE TABLE PUBTAB (ID INT)'); // lives in PUBLIC
            const db2 = await reattach({ defaultSchema: 'APPSCHEMA' });
            const rows = await db2.queryAsync(
                "SELECT RDB$GET_CONTEXT('SYSTEM','CURRENT_SCHEMA') AS CS FROM RDB$DATABASE");
            assert.strictEqual(rows[0].cs, 'APPSCHEMA');
            // PUBLIC stays on the search path, so unqualified PUBLIC names resolve
            const pub = await db2.queryAsync('SELECT COUNT(*) AS N FROM PUBTAB');
            assert.strictEqual(Number(pub[0].n), 0);
        });
    });

    it('maxInlineBlobSize attach works (mistagged as set_bind before)', { timeout: 10000 }, async function (ctx) {
        await withFreshDb('ib', {}, async (db, options, reattach) => {
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION19) {
                return ctx.skip();
            }
            const db2 = await reattach({ maxInlineBlobSize: 4096 });
            const rows = await db2.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].x), 1);
        });
    });

    describe('database creation with a different owner (firebird#7718)', function () {
        const OWNER = 'NF_TEST_OWNER';

        it('create with owner sets the database owner', { timeout: 15000 }, async function (ctx) {
            // The owner user must exist in the security database first.
            let supported = true;
            await withFreshDb('own-setup', {}, async (db) => {
                if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION20) {
                    supported = false;
                    return;
                }
                await db.queryAsync("CREATE OR ALTER USER " + OWNER + " PASSWORD 'ownerpw'");
            });
            if (!supported) return ctx.skip();

            try {
                await withFreshDb('own', { owner: OWNER }, async (db) => {
                    const rows = await db.queryAsync(
                        "SELECT RDB$OWNER_NAME AS OWNER_NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'RDB$DATABASE'");
                    assert.strictEqual(rows[0].owner_name.trim(), OWNER,
                        'the created database must be owned by ' + OWNER);
                });
            } finally {
                await withFreshDb('own-teardown', {}, async (db) => {
                    await db.queryAsync('DROP USER ' + OWNER);
                });
            }
        });
    });
});
