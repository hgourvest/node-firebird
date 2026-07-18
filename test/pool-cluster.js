'use strict';

/**
 * Live tests for multi-host pooling (roadmap #12): Firebird.poolCluster —
 * named nodes each backed by a regular pool, glob patterns, selectors,
 * connection-failure failover, error-based offlining with restoration.
 * Uses two live "nodes" pointing at the local server plus dead nodes on
 * an unused port for the failure paths.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const dbPath = path.join(
    process.env.FIREBIRD_DATA || Config.testDir,
    'test-cluster-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
);
const DEAD_PORT = 39999; // nothing listens here — fast ECONNREFUSED

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

function release(db) {
    return new Promise((resolve) => db.detach(() => resolve()));
}

describe('poolCluster (multi-host pooling)', function () {
    beforeAll(async function () {
        const db = await fromCallback(cb => Firebird.attachOrCreate(
            Config.extends(Config.default, { database: dbPath }), cb));
        await fromCallback(cb => db.detach(cb));
    });

    afterAll(async function () {
        await fromCallback(cb => Firebird.drop(
            Config.extends(Config.default, { database: dbPath }), cb));
    });

    function makeCluster(extra) {
        return Firebird.poolCluster({
            defaults: Config.extends(Config.default, { database: dbPath, connectTimeout: 3000 }),
            nodes: {
                primary: {},
                replica1: {},
                replica2: {},
            },
            max: 2,
            ...extra,
        });
    }

    it('round-robins across matching nodes and runs queries', async function () {
        const cluster = makeCluster({});
        try {
            for (let i = 0; i < 4; i++) {
                await cluster.withConnection('replica*', async (db) => {
                    const r = await db.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
                    assert.strictEqual(Number(r[0].x), 1);
                });
            }
            const status = cluster.status();
            // both replicas served (rr) — each pool created at least one connection
            assert.ok(status.replica1.totalCount >= 1);
            assert.ok(status.replica2.totalCount >= 1);
            assert.strictEqual(status.primary.totalCount, 0, 'primary not matched by replica*');
        } finally {
            await cluster.destroyAsync();
        }
    });

    it('of() facade binds a pattern; order selector picks the first online node', async function () {
        const cluster = makeCluster({});
        try {
            const primary = cluster.of('primary', 'order');
            await primary.withConnection(async (db) => {
                const r = await db.queryAsync('SELECT 2 AS X FROM RDB$DATABASE');
                assert.strictEqual(Number(r[0].x), 2);
            });
            assert.strictEqual(cluster.status().primary.totalCount, 1);
        } finally {
            await cluster.destroyAsync();
        }
    });

    it('fails over from a dead node and eventually takes it offline', async function () {
        const cluster = Firebird.poolCluster({
            defaults: Config.extends(Config.default, { database: dbPath, connectTimeout: 2000 }),
            nodes: {
                dead: { port: DEAD_PORT },
                live: {},
            },
            selector: 'order', // 'dead' sorts first — always tried first
            removeNodeErrorCount: 2,
            restoreNodeTimeout: 0,
        });
        const offline = [];
        cluster.on('offline', (name) => offline.push(name));
        try {
            // each get tries 'dead' (fails, counted) then fails over to 'live'
            for (let i = 0; i < 2; i++) {
                const db = await cluster.getAsync();
                const r = await db.queryAsync('SELECT 3 AS X FROM RDB$DATABASE');
                assert.strictEqual(Number(r[0].x), 3);
                await release(db);
            }
            assert.deepStrictEqual(offline, ['dead'], 'dead node offlined after 2 failures');
            assert.strictEqual(cluster.status().dead.online, false);

            // subsequent gets skip the offline node entirely
            const db = await cluster.getAsync();
            await release(db);
            assert.strictEqual(cluster.status().dead.errorCount, 2, 'no further attempts on offline node');
        } finally {
            await cluster.destroyAsync();
        }
    });

    it('errors when no online node matches; restore() brings a node back', async function () {
        const cluster = Firebird.poolCluster({
            defaults: Config.extends(Config.default, { database: dbPath, connectTimeout: 2000 }),
            nodes: { only: { port: DEAD_PORT } },
            removeNodeErrorCount: 1,
            restoreNodeTimeout: 0,
        });
        try {
            await assert.rejects(cluster.getAsync(), /ECONNREFUSED|refused|lost|timeout/i);
            assert.strictEqual(cluster.status().only.online, false);

            // now every node is offline → pattern error
            await assert.rejects(cluster.getAsync(), /no online node matches/);

            const online = [];
            cluster.on('online', (n) => online.push(n));
            cluster.restore('only');
            assert.deepStrictEqual(online, ['only']);
            assert.strictEqual(cluster.status().only.online, true);
        } finally {
            await cluster.destroyAsync();
        }
    });

    it('add() and remove() manage nodes dynamically', async function () {
        const cluster = makeCluster({});
        try {
            cluster.add('extra', {});
            const db = await cluster.getAsync('extra');
            const r = await db.queryAsync('SELECT 4 AS X FROM RDB$DATABASE');
            assert.strictEqual(Number(r[0].x), 4);
            await release(db);

            const removed = [];
            cluster.on('remove', (n) => removed.push(n));
            await fromCallback(cb => cluster.remove('extra', cb));
            assert.deepStrictEqual(removed, ['extra']);
            await assert.rejects(cluster.getAsync('extra'), /no online node matches/);
        } finally {
            await cluster.destroyAsync();
        }
    });

    it('destroy() closes every node pool and rejects further use', async function () {
        const cluster = makeCluster({});
        const db = await cluster.getAsync('primary');
        await release(db);
        await cluster.destroyAsync();
        await assert.rejects(cluster.getAsync(), /destroyed/);
    });
});
