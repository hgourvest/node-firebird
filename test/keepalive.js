const net = require('net');

const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

describe('Socket keepalive options', function () {

    const config = Config.extends(Config.default, {
        database: Config.default.database.replace(/\.fdb$/, '-keepalive.fdb'),
    });

    // Capture setKeepAlive calls made by the driver's socket wrapper.
    function withKeepAliveSpy(fn) {
        const calls = [];
        const original = net.Socket.prototype.setKeepAlive;
        net.Socket.prototype.setKeepAlive = function (enable, initialDelay) {
            calls.push({ enable, initialDelay });
            return original.call(this, enable, initialDelay);
        };
        return Promise.resolve()
            .then(() => fn(calls))
            .finally(() => { net.Socket.prototype.setKeepAlive = original; });
    }

    it('defaults to keepalive on with a 60 s initial delay', function () {
        return withKeepAliveSpy(async (calls) => {
            const db = await Firebird.attachOrCreateAsync(config);
            try {
                assert.deepStrictEqual(calls, [{ enable: true, initialDelay: 60000 }]);
            } finally {
                await db.dropAsync();
            }
        });
    });

    it('applies enableKeepAlive: false', function () {
        return withKeepAliveSpy(async (calls) => {
            const db = await Firebird.attachOrCreateAsync(
                Config.extends(config, { enableKeepAlive: false }));
            try {
                assert.strictEqual(calls.length, 1);
                assert.strictEqual(calls[0].enable, false);
                const rows = await db.queryAsync('SELECT 1 AS n FROM rdb$database');
                assert.strictEqual(Number(rows[0].n), 1);
            } finally {
                await db.dropAsync();
            }
        });
    });

    it('applies a custom keepAliveInitialDelay', function () {
        return withKeepAliveSpy(async (calls) => {
            const db = await Firebird.attachOrCreateAsync(
                Config.extends(config, { keepAliveInitialDelay: 5000 }));
            try {
                assert.deepStrictEqual(calls, [{ enable: true, initialDelay: 5000 }]);
            } finally {
                await db.dropAsync();
            }
        });
    });

    it('accepts both options as URI query parameters', function () {
        const o = Firebird.parseConnectionUri(
            'firebird://localhost/employee?enableKeepAlive=false&keepAliveInitialDelay=15000');
        assert.strictEqual(o.enableKeepAlive, false);
        assert.strictEqual(o.keepAliveInitialDelay, 15000);
    });
});
