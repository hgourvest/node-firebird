'use strict';

const assert = require('assert');
const Database = require('../lib/wire/database');

describe('Tablespaces and Schema Partitioning Support', function () {
    let capturedSql = null;
    let capturedParams = null;

    // A mock connection object to pass to Database constructor
    const mockConnection = {
        accept: {
            protocolVersion: 0x8014 // Protocol 20 (Firebird 6.0)
        },
        _pending: []
    };

    // Instantiate Database
    const db = new Database(mockConnection);

    // Mock execute method to capture inputs
    db.execute = function (sql, params, callback) {
        capturedSql = sql;
        capturedParams = params;
        if (callback) {
            callback(null, 'OK');
        }
        return this;
    };

    beforeEach(function () {
        capturedSql = null;
        capturedParams = null;
    });

    describe('Physical Tablespace Controls', function () {
        it('should generate correct DDL for createTablespace', function () {
            db.createTablespace('FAST_TS', '/ssd/fast_data.ts', function (err, result) {
                assert.strictEqual(err, null);
                assert.strictEqual(result, 'OK');
            });
            assert.strictEqual(capturedSql, "CREATE TABLESPACE FAST_TS FILE '/ssd/fast_data.ts'");
            assert.deepStrictEqual(capturedParams, []);
        });

        it('should generate correct DDL for alterTablespace', function () {
            db.alterTablespace('FAST_TS', '/ssd/new_fast_data.ts', function (err, result) {
                assert.strictEqual(err, null);
                assert.strictEqual(result, 'OK');
            });
            assert.strictEqual(capturedSql, "ALTER TABLESPACE FAST_TS SET FILE TO '/ssd/new_fast_data.ts'");
            assert.deepStrictEqual(capturedParams, []);
        });

        it('should generate correct DDL for dropTablespace', function () {
            db.dropTablespace('FAST_TS', function (err, result) {
                assert.strictEqual(err, null);
                assert.strictEqual(result, 'OK');
            });
            assert.strictEqual(capturedSql, "DROP TABLESPACE FAST_TS");
            assert.deepStrictEqual(capturedParams, []);
        });
    });

    describe('Schema Partitioning Namespaces', function () {
        it('should generate correct DDL for createSchema without tablespace', function () {
            db.createSchema('MYSCHEMA', function (err, result) {
                assert.strictEqual(err, null);
                assert.strictEqual(result, 'OK');
            });
            assert.strictEqual(capturedSql, "CREATE SCHEMA MYSCHEMA");
            assert.deepStrictEqual(capturedParams, []);
        });

        it('should generate correct DDL for createSchema with tablespace mapping', function () {
            db.createSchema('MYSCHEMA', 'FAST_TS', function (err, result) {
                assert.strictEqual(err, null);
                assert.strictEqual(result, 'OK');
            });
            assert.strictEqual(capturedSql, "CREATE SCHEMA MYSCHEMA TABLESPACE FAST_TS");
            assert.deepStrictEqual(capturedParams, []);
        });
    });
});
