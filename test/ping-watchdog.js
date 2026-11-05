'use strict';

/**
 * Tests for Connection ping() API (op_ping / op_info_database fallback),
 * client-side request watchdog (socketTimeout), and pool checkout health
 * verification (pingIntervalMillis) — ROADMAP Round 3 item #11.
 */

const assert = require('assert');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const Config = require('./config');

const dbPath = path.join(
    process.env.FIREBIRD_DATA || Config.testDir,
    'test-ping-watchdog-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
);
const options = Config.extends(Config.default, { database: dbPath });

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => (err ? reject(err) : resolve(result)));
    });
}

function releaseToPool(db) {
    return new Promise((resolve) => {
        db.detach(() => resolve());
    });
}

describe('Connection ping() API & client-side request watchdog', function () {
    beforeAll(async function () {
        const db = await fromCallback((cb) => Firebird.attachOrCreate(options, cb));
        await fromCallback((cb) => db.detach(cb));
    });

    afterAll(async function () {
        await fromCallback((cb) => Firebird.drop(options, cb));
    });

    it('parses socketTimeout, pingIntervalMillis, and pingTimeoutMillis in connection URIs', function () {
        const parsed = Firebird.parseConnectionUri(
            'firebird://SYSDBA:masterkey@127.0.0.1:3050/tmp/test.fdb?socketTimeout=3000&pingIntervalMillis=15000&pingTimeoutMillis=2000'
        );
        assert.strictEqual(parsed.socketTimeout, 3000);
        assert.strictEqual(parsed.pingIntervalMillis, 15000);
        assert.strictEqual(parsed.pingTimeoutMillis, 2000);
    });

    it('db.ping() and db.pingAsync() succeed on an attached connection via op_ping', async function () {
        const db = await Firebird.attachAsync(options);
        try {
            await fromCallback((cb) => db.ping(cb));
            await db.pingAsync();
            await db.pingAsync(2000);

            const rows = await db.queryAsync('SELECT 1 AS OK FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].ok), 1);
        } finally {
            await db.detachAsync();
        }
    });

    it('db.ping() falls back to op_info_database when protocolVersion < PROTOCOL_VERSION13', async function () {
        const db = await Firebird.attachAsync(options);
        try {
            const origVersion = db.connection.accept.protocolVersion;
            try {
                db.connection.accept.protocolVersion = Const.PROTOCOL_VERSION12;
                await db.pingAsync();
            } finally {
                db.connection.accept.protocolVersion = origVersion;
            }
            const rows = await db.queryAsync('SELECT 1 AS OK FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].ok), 1);
        } finally {
            await db.detachAsync();
        }
    });

    it('db.ping(timeout) rejects with ETIMEDOUT when the server stops responding', async function () {
        const db = await Firebird.attachAsync({ ...options, isPool: true });
        try {
            // Simulate a blackholed socket by swallowing outbound writes
            db.connection._socket.write = function () {};

            const t0 = Date.now();
            await assert.rejects(
                () => db.pingAsync(150),
                (err) => {
                    assert.strictEqual(err.code, 'ETIMEDOUT');
                    assert.match(err.message, /Socket timeout after 150ms/);
                    return true;
                }
            );
            const elapsed = Date.now() - t0;
            assert.ok(elapsed >= 120 && elapsed < 1500, `expected ~150ms timeout, got ${elapsed}ms`);
            assert.strictEqual(db.connection._isClosed, true);
        } finally {
            try {
                await db.detachAsync(true);
            } catch {
                // already closed
            }
        }
    });

    it('socketTimeout watchdog rejects stalled in-flight queries and closes the dead socket', async function () {
        const db = await Firebird.attachAsync({ ...options, socketTimeout: 200, isPool: true });
        try {
            // Normal fast query succeeds and clears the watchdog timer
            const rows = await db.queryAsync('SELECT 42 AS ANSWER FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].answer), 42);
            assert.strictEqual(db.connection._watchdogTimer, null);

            // Now blackhole the socket and verify the next request times out deterministically
            db.connection._socket.write = function () {};
            const emittedErrors = [];
            db.on('error', (e) => emittedErrors.push(e));

            await assert.rejects(
                () => db.queryAsync('SELECT 1 FROM RDB$DATABASE'),
                (err) => {
                    assert.strictEqual(err.code, 'ETIMEDOUT');
                    assert.match(err.message, /Socket timeout after 200ms/);
                    return true;
                }
            );
            assert.strictEqual(emittedErrors.length, 1);
            assert.strictEqual(emittedErrors[0].code, 'ETIMEDOUT');
            assert.strictEqual(db.connection._isClosed, true);
        } finally {
            try {
                await db.detachAsync(true);
            } catch {
                // already closed
            }
        }
    });

    it('socketTimeout watchdog fails attach() against a blackholed TCP peer without double-invoking callback', async function () {
        const sockets = [];
        const blackholeServer = net.createServer((sock) => {
            sockets.push(sock);
            // Accept TCP connection, read and discard bytes, never answer op_connect
            sock.on('data', () => {});
        });

        await new Promise((resolve) => blackholeServer.listen(0, '127.0.0.1', resolve));
        const port = blackholeServer.address().port;

        try {
            let callbackCount = 0;
            await new Promise((resolve) => {
                Firebird.attach(
                    {
                        ...options,
                        host: '127.0.0.1',
                        port,
                        socketTimeout: 150,
                    },
                    (err) => {
                        callbackCount++;
                        assert.ok(err);
                        assert.strictEqual(err.code, 'ETIMEDOUT');
                        setTimeout(resolve, 100);
                    }
                );
            });
            assert.strictEqual(callbackCount, 1, 'attach callback must be invoked exactly once');
        } finally {
            for (const s of sockets) s.destroy();
            await new Promise((resolve) => blackholeServer.close(resolve));
        }
    });

    it('pool pingIntervalMillis verifies idle connections on checkout and replaces dead ones', async function () {
        const pool = Firebird.pool(2, {
            ...options,
            pingIntervalMillis: 80,
            pingTimeoutMillis: 150,
        });
        const removed = [];
        const poolErrors = [];
        pool.on('remove', (db) => removed.push(db));
        pool.on('error', (err) => poolErrors.push(err));

        try {
            const first = await pool.getAsync();
            await releaseToPool(first);

            // Immediate checkout (< 80ms idle) reuses connection without needing a ping
            const immediate = await pool.getAsync();
            assert.strictEqual(immediate, first);
            await releaseToPool(immediate);

            // Wait past pingIntervalMillis (80ms) — healthy connection passes ping and is reused
            await new Promise((r) => setTimeout(r, 120));
            const healthyAfterIdle = await pool.getAsync();
            assert.strictEqual(healthyAfterIdle, first);
            await releaseToPool(healthyAfterIdle);

            // Now simulate a blackholed idle connection and wait past pingIntervalMillis
            first.connection._socket.write = function () {};
            await new Promise((r) => setTimeout(r, 120));

            const replacement = await pool.getAsync();
            assert.notStrictEqual(replacement, first, 'dead connection should be evicted and replaced');
            assert.strictEqual(removed.length, 1);
            assert.strictEqual(removed[0], first);
            assert.strictEqual(poolErrors.length, 1);
            assert.strictEqual(poolErrors[0].code, 'ETIMEDOUT');

            const rows = await replacement.queryAsync('SELECT 1 AS OK FROM RDB$DATABASE');
            assert.strictEqual(Number(rows[0].ok), 1);
            await releaseToPool(replacement);
        } finally {
            await pool.destroyAsync();
        }
    });
});
