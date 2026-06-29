'use strict';

const assert = require('assert');
const Connection = require('../lib/wire/connection');
const Const = require('../lib/wire/const');

describe('Enhanced Collation Support (Firebird 6.0)', function () {
    // Helper to write an LE word (2 bytes)
    function wordLE(val) {
        return [val & 0xFF, (val >> 8) & 0xFF];
    }

    // Helper to write a BlrReader format integer
    function intLE(val) {
        if (val >= -128 && val <= 127) {
            return [...wordLE(1), val & 0xFF];
        } else if (val >= -32768 && val <= 32767) {
            return [...wordLE(2), val & 0xFF, (val >> 8) & 0xFF];
        } else {
            return [...wordLE(4), val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF];
        }
    }

    // Helper to write a BlrReader format string
    function stringLE(str) {
        const bytes = Buffer.from(str, 'utf8');
        return [...wordLE(bytes.length), ...bytes];
    }

    it('should correctly unpack charSetId and collationId from subType for string/character columns', function () {
        // Construct raw describe bytes for a select statement returning 1 VARCHAR column
        // with charsetId = 4 (UTF8) and collationId = 3 (UNICODE_CI)
        // subType = (3 << 8) | 4 = 772
        const bytes = [
            Const.isc_info_sql_select,
            Const.isc_info_sql_describe_vars,
            ...intLE(0), // readInt() at start of describe_vars is ignored

            // Variable 1
            Const.isc_info_sql_sqlda_seq,
            ...intLE(1),

            Const.isc_info_sql_type,
            ...intLE(Const.SQL_VARYING), // VARCHAR

            Const.isc_info_sql_sub_type,
            ...intLE(772),

            Const.isc_info_sql_field,
            ...stringLE('MY_COLUMN'),

            Const.isc_info_sql_describe_end,

            // Bind section (empty)
            Const.isc_info_sql_bind,
            Const.isc_info_sql_describe_vars,
            ...intLE(0),
            Const.isc_info_sql_describe_end,
            Const.isc_info_end
        ];

        const statement = {
            input: null,
            output: null
        };

        // Call the describe parser
        Connection.describe(Buffer.from(bytes), statement);

        // Verify outputs
        assert.ok(statement.output);
        assert.strictEqual(statement.output.length, 1);

        const col = statement.output[0];
        assert.strictEqual(col.field, 'MY_COLUMN');
        assert.strictEqual(col.type, Const.SQL_VARYING);
        assert.strictEqual(col.subType, 772);
        assert.strictEqual(col.charSetId, 4);
        assert.strictEqual(col.collationId, 3);
    });

    it('should correctly unpack charSetId and collationId from subType for SQL_TEXT columns', function () {
        // Construct raw describe bytes for a select statement returning 1 CHAR column
        // with charsetId = 3 (UNICODE_FSS) and collationId = 0 (default)
        // subType = (0 << 8) | 3 = 3
        const bytes = [
            Const.isc_info_sql_select,
            Const.isc_info_sql_describe_vars,
            ...intLE(0),

            // Variable 1
            Const.isc_info_sql_sqlda_seq,
            ...intLE(1),

            Const.isc_info_sql_type,
            ...intLE(Const.SQL_TEXT), // CHAR

            Const.isc_info_sql_sub_type,
            ...intLE(3),

            Const.isc_info_sql_field,
            ...stringLE('CHAR_COLUMN'),

            Const.isc_info_sql_describe_end,

            // Bind section (empty)
            Const.isc_info_sql_bind,
            Const.isc_info_sql_describe_vars,
            ...intLE(0),
            Const.isc_info_sql_describe_end,
            Const.isc_info_end
        ];

        const statement = {
            input: null,
            output: null
        };

        Connection.describe(Buffer.from(bytes), statement);

        assert.ok(statement.output);
        assert.strictEqual(statement.output.length, 1);

        const col = statement.output[0];
        assert.strictEqual(col.field, 'CHAR_COLUMN');
        assert.strictEqual(col.type, Const.SQL_TEXT);
        assert.strictEqual(col.subType, 3);
        assert.strictEqual(col.charSetId, 3);
        assert.strictEqual(col.collationId, 0);
    });

    it('should not unpack charSetId/collationId for non-string columns', function () {
        // Construct raw describe bytes for 1 INTEGER column
        const bytes = [
            Const.isc_info_sql_select,
            Const.isc_info_sql_describe_vars,
            ...intLE(0),

            // Variable 1
            Const.isc_info_sql_sqlda_seq,
            ...intLE(1),

            Const.isc_info_sql_type,
            ...intLE(Const.SQL_LONG), // INTEGER

            Const.isc_info_sql_sub_type,
            ...intLE(0),

            Const.isc_info_sql_field,
            ...stringLE('INT_COLUMN'),

            Const.isc_info_sql_describe_end,

            // Bind section (empty)
            Const.isc_info_sql_bind,
            Const.isc_info_sql_describe_vars,
            ...intLE(0),
            Const.isc_info_sql_describe_end,
            Const.isc_info_end
        ];

        const statement = {
            input: null,
            output: null
        };

        Connection.describe(Buffer.from(bytes), statement);

        assert.ok(statement.output);
        assert.strictEqual(statement.output.length, 1);

        const col = statement.output[0];
        assert.strictEqual(col.field, 'INT_COLUMN');
        assert.strictEqual(col.type, Const.SQL_LONG);
        assert.strictEqual(col.charSetId, undefined);
        assert.strictEqual(col.collationId, undefined);
    });
});
