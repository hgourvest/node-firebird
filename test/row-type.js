'use strict';

const assert = require('assert');
const Database = require('../lib/wire/database');
const Connection = require('../lib/wire/connection');

describe('SQL-Standard ROW Type Support (Firebird 6.0)', function () {
    let capturedSql = null;
    let capturedParams = null;

    // A mock connection to test statement parameter mapping
    const mockConnection = {
        accept: {
            protocolVersion: 0x8014 // Protocol 20 (Firebird 6.0)
        },
        _pending: []
    };

    const db = new Database(mockConnection);

    db.execute = function (sql, params, callback) {
        capturedSql = sql;
        capturedParams = params;
        if (callback) {
            callback(null, []);
        }
        return this;
    };

    beforeEach(function () {
        capturedSql = null;
        capturedParams = null;
    });

    describe('Row Value Expressions and Constructors', function () {
        it('should correctly execute queries using standard ROW value expressions', function () {
            const sql = 'SELECT * FROM USERS WHERE (ID, ROLE) = (ROW(?, ?))';
            const params = [42, 'admin'];

            db.execute(sql, params, function (err, result) {
                assert.strictEqual(err, null);
                assert.deepStrictEqual(result, []);
            });

            assert.strictEqual(capturedSql, sql);
            assert.deepStrictEqual(capturedParams, params);
        });

        it('should correctly execute queries using tuple-based ROW constructors', function () {
            const sql = 'SELECT * FROM USERS WHERE (ID, ROLE) = (?, ?)';
            const params = [42, 'admin'];

            db.execute(sql, params, function (err, result) {
                assert.strictEqual(err, null);
                assert.deepStrictEqual(result, []);
            });

            assert.strictEqual(capturedSql, sql);
            assert.deepStrictEqual(capturedParams, params);
        });
    });
});
