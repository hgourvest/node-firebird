'use strict';

/**
 * Live tests for pool connection recycling (roadmap #18): maxUses retires a
 * physical connection after N checkouts (pg's maxUses), maxLifetimeMillis
 * retires it T ms after creation (Postgres.js's max_lifetime) — closed for
 * good on return to the pool (or by the sweep) and replaced on demand.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Config = require('./config');

const dbPath = path.join(
    process.env.FIREBIRD_DATA || Config.testDir,
    'test-recycle-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
);
const options = Config.extends(Config.default, { database: dbPath });

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

function releaseToPool(db) {
    return new Promise((resolve) => { db.detach(() => resolve()); });
}

describe('pool connection recycling', function () {
    beforeAll(async function () {
        const db = await fromCallback(cb => Firebird.attachOrCreate(options, cb));
        await fromCallback(cb => db.detach(cb));
    });

    afterAll(async function () {
        await fromCallback(cb => Firebird.drop(options, cb));
    });

    it('maxUses retires the connection after N checkouts and replaces it', async function () {
        const pool = Firebird.pool(2, { ...options, maxUses: 2 });
        const removed = [];
        pool.on('remove', db => removed.push(db));
        try {
            const first = await pool.getAsync();
            await releaseToPool(first); // use 1 → still pooled

            const second = await pool.getAsync();
            assert.strictEqual(second, first, 'connection is reused below maxUses');
            await releaseToPool(second); // use 2 → worn out, retired

            assert.strictEqual(removed.length, 1);
            assert.strictEqual(removed[0], first);
            assert.strictEqual(pool.idleCount, 0, 'retired connection is not idle');

            // the pool creates a fresh replacement on demand
            const third = await pool.getAsync();
            assert.notStrictEqual(third, first);
            const rows = await third.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].x), 1);
            await releaseToPool(third);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('maxLifetimeMillis retires an idle connection via the sweep', async function () {
        const pool = Firebird.pool(2, { ...options, maxLifetimeMillis: 300 });
        const removed = [];
        pool.on('remove', db => removed.push(db));
        try {
            const db = await pool.getAsync();
            await releaseToPool(db);
            assert.strictEqual(pool.idleCount, 1);

            // sweep runs at max(basis/2, 100)ms; give it room
            await new Promise(res => setTimeout(res, 700));
            assert.strictEqual(removed.length, 1, 'over-lifetime idle connection retired');
            assert.strictEqual(pool.idleCount, 0);

            const fresh = await pool.getAsync();
            assert.notStrictEqual(fresh, db);
            await releaseToPool(fresh);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('maxLifetimeMillis also retires on return to the pool', async function () {
        const pool = Firebird.pool(2, { ...options, maxLifetimeMillis: 200 });
        const removed = [];
        pool.on('remove', db => removed.push(db));
        try {
            const db = await pool.getAsync();
            await new Promise(res => setTimeout(res, 300)); // outlive the limit while in use
            await releaseToPool(db);
            assert.strictEqual(removed.length, 1, 'expired connection retired at release');
            assert.strictEqual(pool.idleCount, 0);
        } finally {
            await pool.destroyAsync();
        }
    });

    it('without recycling options, connections are reused indefinitely (unchanged)', async function () {
        const pool = Firebird.pool(1, { ...options });
        try {
            let first = null;
            for (let i = 0; i < 5; i++) {
                const db = await pool.getAsync();
                if (!first) first = db;
                else assert.strictEqual(db, first);
                await releaseToPool(db);
            }
        } finally {
            await pool.destroyAsync();
        }
    });
});
