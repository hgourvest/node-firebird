'use strict';

/**
 * Protocol 20 (Firebird 6.0) integration tests.
 *
 * Regression coverage for the former protocol-20 "prepare hang": since
 * PROTOCOL_PREPARE_FLAG (= protocol 20) the server reads a trailing
 * p_sqlst_flags field from op_prepare_statement; a client that does not send
 * it leaves the server blocked mid-packet and the prepare callback never
 * fires. The driver now sends the field and offers protocol 20 by default.
 *
 * These tests need a live server (see test/config.js). On a pre-6.0 server
 * the protocol-20 assertions are skipped — the prepare path is still
 * exercised at whatever protocol was negotiated.
 */

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const Firebird = require('../lib');
const Const = require('../lib/wire/const');
const Config = require('./config');

function uniqueDatabase() {
    return path.join(
        process.env.FIREBIRD_DATA || Config.testDir,
        'test-p20-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.fdb'
    );
}

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('Protocol 20 negotiation and prepare', function () {

    it('should prepare and execute at the default (highest) protocol', { timeout: 10000 }, async function () {
        const options = Config.extends(Config.default, { database: uniqueDatabase() });
        const db = await fromCallback(cb => Firebird.create(options, cb));
        try {
            const negotiated = db.connection.accept.protocolVersion;

            // The regression: this prepare used to hang forever at protocol 20.
            const rows = await db.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
            assert.strictEqual(rows.length, 1);
            assert.strictEqual(Number(rows[0].x), 1);

            // Parameterized DML exercises describe + execute on the same path.
            await db.queryAsync('CREATE TABLE P20T (ID INT, NAME VARCHAR(20))');
            await db.queryAsync('INSERT INTO P20T (ID, NAME) VALUES (?, ?)', [7, 'proto20']);
            const back = await db.queryAsync('SELECT ID, NAME FROM P20T');
            assert.strictEqual(back.length, 1);
            assert.strictEqual(Number(back[0].id), 7);
            assert.strictEqual(back[0].name, 'proto20');

            if (negotiated >= Const.PROTOCOL_VERSION20) {
                // Firebird 6+: the driver must actually land on protocol 20.
                assert.strictEqual(negotiated, Const.PROTOCOL_VERSION20,
                    'a Firebird 6 server should negotiate protocol 20 by default');
            }
        } finally {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it('should cap negotiation at protocol 19 with maxNegotiatedProtocols: 10', { timeout: 10000 }, async function () {
        const options = Config.extends(Config.default, {
            database: uniqueDatabase(),
            maxNegotiatedProtocols: 10,
        });
        const db = await fromCallback(cb => Firebird.create(options, cb));
        try {
            assert.ok(db.connection.accept.protocolVersion <= Const.PROTOCOL_VERSION19,
                'maxNegotiatedProtocols: 10 must exclude protocol 20');
            const rows = await db.queryAsync('SELECT 1 AS X FROM RDB$DATABASE');
            assert.strictEqual(rows.length, 1);
        } finally {
            await fromCallback(cb => db.drop(cb));
        }
    });

    it('should describe result columns with schema metadata on protocol 20', { timeout: 10000 }, async function (ctx) {
        const options = Config.extends(Config.default, { database: uniqueDatabase() });
        const db = await fromCallback(cb => Firebird.create(options, cb));
        try {
            if (db.connection.accept.protocolVersion < Const.PROTOCOL_VERSION20) {
                return ctx.skip(); // pre-6.0 server: no schema metadata
            }
            await db.queryAsync('CREATE TABLE P20S (ID INT)');
            await db.queryAsync('INSERT INTO P20S (ID) VALUES (1)');

            const transaction = await db.transactionAsync();
            try {
                const statement = await transaction.newStatementAsync('SELECT ID FROM P20S');
                assert.strictEqual(statement.output.length, 1);
                // DESCRIBE_WITH_SCHEMA adds isc_info_sql_relation_schema; on a
                // stock FB6 database unqualified tables live in PUBLIC.
                assert.strictEqual(statement.output[0].relationSchema, 'PUBLIC');
                await fromCallback(cb => statement.drop(cb));
            } finally {
                await transaction.rollbackAsync();
            }
        } finally {
            await fromCallback(cb => db.drop(cb));
        }
    });
});
