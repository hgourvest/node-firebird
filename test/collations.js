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

    describe('Truncated describe pagination (issue #446)', function () {
        function bindVarBytes(seq, type, subType, scale, len) {
            return [
                Const.isc_info_sql_sqlda_seq, ...intLE(seq),
                Const.isc_info_sql_type, ...intLE(type),
                Const.isc_info_sql_sub_type, ...intLE(subType),
                Const.isc_info_sql_scale, ...intLE(scale),
                Const.isc_info_sql_length, ...intLE(len),
                Const.isc_info_sql_describe_end,
            ];
        }

        function selectColBytes(seq, fieldName, type) {
            return [
                Const.isc_info_sql_sqlda_seq, ...intLE(seq),
                Const.isc_info_sql_type, ...intLE(type),
                Const.isc_info_sql_sub_type, ...intLE(0),
                Const.isc_info_sql_scale, ...intLE(0),
                Const.isc_info_sql_length, ...intLE(4),
                Const.isc_info_sql_field, ...stringLE(fieldName),
                Const.isc_info_sql_relation, ...stringLE('T'),
                Const.isc_info_sql_relation_alias, ...stringLE(''),
                Const.isc_info_sql_alias, ...stringLE(fieldName),
                Const.isc_info_sql_describe_end,
            ];
        }

        it('describe returns truncation info instead of throwing and merges continuation buffers', function () {
            // Buffer 1: stmt_type + 1 output column + bind vars 1..2 + partial var 3 + isc_info_truncated
            const buf1 = Buffer.from([
                Const.isc_info_sql_stmt_type, ...intLE(Const.isc_info_sql_stmt_select),
                Const.isc_info_sql_select,
                Const.isc_info_sql_describe_vars, ...intLE(1),
                ...selectColBytes(1, 'ID', Const.SQL_LONG),
                Const.isc_info_sql_bind,
                Const.isc_info_sql_describe_vars, ...intLE(4),
                ...bindVarBytes(1, Const.SQL_LONG, 0, 0, 4),
                ...bindVarBytes(2, Const.SQL_INT64, 0, 0, 8),
                // Variable 3 truncated mid-item before describe_end
                Const.isc_info_sql_sqlda_seq, ...intLE(3),
                Const.isc_info_sql_type, ...intLE(Const.SQL_VARYING),
                Const.isc_info_truncated,
            ]);

            const statement = { input: null, output: null };
            const trunc1 = Connection.describe(buf1, statement);
            assert.deepStrictEqual(trunc1, {
                section: Const.isc_info_sql_bind,
                nextIndex: 3,
            });
            assert.strictEqual(statement.output.length, 1);
            assert.strictEqual(statement.input.length, 2);

            // Buffer 2: bind vars 3..4 complete
            const buf2 = Buffer.from([
                Const.isc_info_sql_bind,
                Const.isc_info_sql_describe_vars, ...intLE(2),
                ...bindVarBytes(3, Const.SQL_VARYING, 4, 0, 40),
                ...bindVarBytes(4, Const.SQL_SHORT, 0, 0, 2),
                Const.isc_info_end,
            ]);

            const trunc2 = Connection.describe(buf2, statement);
            assert.strictEqual(trunc2, null);
            assert.strictEqual(statement.output.length, 1);
            assert.strictEqual(statement.input.length, 4);
            assert.strictEqual(statement.input[0].type, Const.SQL_LONG);
            assert.strictEqual(statement.input[1].type, Const.SQL_INT64);
            assert.strictEqual(statement.input[2].type, Const.SQL_VARYING);
            assert.strictEqual(statement.input[2].charSetId, 4);
            assert.strictEqual(statement.input[3].type, Const.SQL_SHORT);
        });

        it('_finishPrepare pages truncated bind and select descriptions via statementInfo (#446)', async function () {
            const totalParams = 2500;
            const pageSize = 1000;

            // Initial prepare buffer: 1 select col + first 1000 bind vars + partial 1001 + truncated
            const initialBytes = [
                Const.isc_info_sql_stmt_type, ...intLE(Const.isc_info_sql_stmt_select),
                Const.isc_info_sql_select,
                Const.isc_info_sql_describe_vars, ...intLE(1),
                ...selectColBytes(1, 'RDB$RELATION_ID', Const.SQL_SHORT),
                Const.isc_info_sql_bind,
                Const.isc_info_sql_describe_vars, ...intLE(totalParams),
            ];
            for (let i = 1; i <= pageSize; i++) {
                initialBytes.push(...bindVarBytes(i, Const.SQL_LONG, 0, 0, 4));
            }
            // Partial 1001st variable
            initialBytes.push(
                Const.isc_info_sql_sqlda_seq, ...intLE(pageSize + 1),
                Const.isc_info_truncated
            );

            const infoRequests = [];
            const fakeCnx = Object.create(Connection.prototype);
            fakeCnx.accept = { protocolVersion: Const.PROTOCOL_VERSION18 };
            fakeCnx.options = { encoding: 'UTF8' };
            fakeCnx.db = { emit: function () {} };
            fakeCnx.statementInfo = function (stmt, items, cb) {
                infoRequests.push(items);
                // Decode start index from [isc_info_sql_sqlda_start, 2, lo, hi, ...]
                assert.strictEqual(items[0], Const.isc_info_sql_sqlda_start);
                assert.strictEqual(items[1], 2);
                const startIdx = items[2] | (items[3] << 8);
                const endIdx = Math.min(startIdx + pageSize - 1, totalParams);
                const reply = [
                    Const.isc_info_sql_bind,
                    Const.isc_info_sql_describe_vars, ...intLE(totalParams - startIdx + 1),
                ];
                for (let i = startIdx; i <= endIdx; i++) {
                    reply.push(...bindVarBytes(i, Const.SQL_LONG, 0, 0, 4));
                }
                if (endIdx < totalParams) {
                    reply.push(Const.isc_info_truncated);
                } else {
                    reply.push(Const.isc_info_end);
                }
                process.nextTick(() => cb(null, { buffer: Buffer.from(reply) }));
            };

            const stmt = { connection: fakeCnx, handle: 7 };
            const prepared = await new Promise((resolve, reject) => {
                fakeCnx._finishPrepare(stmt, Buffer.from(initialBytes), 'SELECT ...', (err, res) => {
                    if (err) reject(err);
                    else resolve(res);
                });
            });

            assert.strictEqual(prepared, stmt);
            assert.strictEqual(infoRequests.length, 2); // 1001..2000, 2001..2500
            assert.strictEqual(stmt.output.length, 1);
            assert.strictEqual(stmt.input.length, totalParams);
            for (let i = 0; i < totalParams; i++) {
                assert.ok(stmt.input[i], 'param ' + (i + 1) + ' should be described');
                assert.strictEqual(stmt.input[i].type, Const.SQL_LONG);
            }
        });

        it('_finishPrepare pages truncated select columns and then fetches bind parameters', async function () {
            // Initial buffer truncated inside select at column 2
            const initialBytes = [
                Const.isc_info_sql_stmt_type, ...intLE(Const.isc_info_sql_stmt_select),
                Const.isc_info_sql_select,
                Const.isc_info_sql_describe_vars, ...intLE(2),
                ...selectColBytes(1, 'COL_1', Const.SQL_LONG),
                Const.isc_info_sql_sqlda_seq, ...intLE(2),
                Const.isc_info_truncated,
            ];

            const infoRequests = [];
            const fakeCnx = Object.create(Connection.prototype);
            fakeCnx.accept = { protocolVersion: Const.PROTOCOL_VERSION20 };
            fakeCnx.options = { encoding: 'UTF8' };
            fakeCnx.db = { emit: function () {} };
            fakeCnx.statementInfo = function (stmt, items, cb) {
                infoRequests.push(items);
                // Should request select from index 2 AND include the bind block
                assert.strictEqual(items[0], Const.isc_info_sql_sqlda_start);
                const startIdx = items[2] | (items[3] << 8);
                assert.strictEqual(startIdx, 2);
                assert.ok(items.includes(Const.isc_info_sql_select));
                assert.ok(items.includes(Const.isc_info_sql_relation_schema));
                assert.ok(items.includes(Const.isc_info_sql_bind));

                const reply = [
                    Const.isc_info_sql_select,
                    Const.isc_info_sql_describe_vars, ...intLE(1),
                    ...selectColBytes(2, 'COL_2', Const.SQL_INT64),
                    Const.isc_info_sql_bind,
                    Const.isc_info_sql_describe_vars, ...intLE(1),
                    ...bindVarBytes(1, Const.SQL_SHORT, 0, 0, 2),
                    Const.isc_info_end,
                ];
                process.nextTick(() => cb(null, { buffer: Buffer.from(reply) }));
            };

            const stmt = { connection: fakeCnx, handle: 9 };
            await new Promise((resolve, reject) => {
                fakeCnx._finishPrepare(stmt, Buffer.from(initialBytes), 'SELECT COL_1, COL_2 ...', (err, res) => {
                    if (err) reject(err);
                    else resolve(res);
                });
            });

            assert.strictEqual(infoRequests.length, 1);
            assert.strictEqual(stmt.output.length, 2);
            assert.strictEqual(stmt.output[0].field, 'COL_1');
            assert.strictEqual(stmt.output[1].field, 'COL_2');
            assert.strictEqual(stmt.input.length, 1);
            assert.strictEqual(stmt.input[0].type, Const.SQL_SHORT);
        });

        it('_finishPrepare delivers an error to the callback instead of throwing if describe fails', async function () {
            const badBytes = Buffer.from([
                Const.isc_info_sql_select,
                Const.isc_info_sql_describe_vars, ...intLE(1),
                Const.isc_info_sql_sqlda_seq, ...intLE(1),
                Const.isc_info_sql_type, ...intLE(99999), // unknown SQL type
            ]);

            let dropped = false;
            const fakeCnx = Object.create(Connection.prototype);
            fakeCnx.accept = { protocolVersion: Const.PROTOCOL_VERSION18 };
            fakeCnx.options = {};
            fakeCnx.dropStatement = function () { dropped = true; };

            const stmt = { connection: fakeCnx, handle: 11 };
            const err = await new Promise((resolve) => {
                fakeCnx._finishPrepare(stmt, badBytes, 'SELECT 1', (err) => resolve(err));
            });

            assert.ok(err instanceof Error);
            assert.strictEqual(dropped, true);
        });
    });
});
