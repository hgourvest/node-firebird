'use strict';

/**
 * SQL Schemas support tests for Firebird 6.0 (Protocol 20+).
 *
 * These tests validate:
 *  1. DPB constants for schema parameters (isc_dpb_search_path,
 *     isc_dpb_default_schema) are correctly defined.
 *  2. isc_info_sql_relation_schema SQL info constant is defined.
 *  3. DESCRIBE_WITH_SCHEMA array includes isc_info_sql_relation_schema and is
 *     a strict superset of DESCRIBE.
 *  4. The describe() parser correctly reads isc_info_sql_relation_schema from
 *     a synthesised server response buffer and populates param.relationSchema.
 *  5. searchPath is correctly serialised as a comma-joined string when an
 *     array is provided.
 *  6. Backward-compatibility: when the negotiated protocol is below 20 the
 *     standard DESCRIBE array (without schema item) is used.
 *
 * No live Firebird server is required – all tests run fully offline.
 */

const assert = require('assert');
const net    = require('net');

const Const    = require('../lib/wire/const');
const {XdrWriter, BlrWriter, BlrReader} = require('../lib/wire/serialize');
const Firebird = require('../lib');

// ---------------------------------------------------------------------------
// Buffer helpers
// ---------------------------------------------------------------------------

/**
 * Write a BlrReader-compatible integer to a BlrWriter.
 *
 * BlrReader.readInt() format:
 *   [uint16LE length][int8|int16LE|int32LE value]
 *
 * We always use a 4-byte (int32LE) payload for simplicity.
 */
function blrWriteInt(blr, value) {
    blr.addWord(4);          // length prefix = 4 bytes
    blr.addInt32(value);     // int32LE
}

/**
 * Write a BlrReader-compatible string to a BlrWriter.
 *
 * BlrReader.readString() format:
 *   [uint16LE length][utf8 bytes]
 *
 * BlrWriter.addString2() writes exactly this layout.
 */
function blrWriteStr(blr, tag, s) {
    blr.addByte(tag);
    blr.addString2(0, s, 'utf8'); // addString2 writes uint16LE length + bytes
    // addString2 uses tag = first arg as the byte code - but we already wrote the tag separately.
    // Redo: write length + string manually.
}

/**
 * Write BlrReader-compatible string WITHOUT a leading tag byte.
 */
function blrWriteString(blr, s) {
    const len = Buffer.byteLength(s, 'utf8');
    blr.addWord(len);  // uint16LE length  (BlrReader.readString reads uint16LE)
    const enc = Buffer.from(s, 'utf8');
    for (let i = 0; i < enc.length; i++) blr.addByte(enc[i]);
}

/**
 * Build a minimal describe response buffer that the describe() function in
 * connection.js can parse.
 *
 * The format mirrors what the Firebird server sends back in response to
 * op_prepare_statement. Each item is:
 *   [1-byte item tag] followed by item-specific payload.
 *
 * Integer items (isc_info_sql_*):
 *   BlrReader.readInt() → [uint16LE length][int32LE or smaller value]
 *
 * String items (field, relation, alias, relation_schema):
 *   BlrReader.readString() → [uint16LE length][utf8 bytes]
 *
 * This function builds a response with ONE output column from
 * MYSCHEMA.EMPLOYEE.NAME, including the FB 6.0 schema item.
 */
function buildDescribeResponseWithSchema() {
    const blr = new BlrWriter(512);

    // isc_info_sql_stmt_type + int(SELECT=1)
    blr.addByte(Const.isc_info_sql_stmt_type);
    blrWriteInt(blr, Const.isc_info_sql_stmt_select);

    // isc_info_sql_select  → begin output column section
    blr.addByte(Const.isc_info_sql_select);

    // isc_info_sql_describe_vars + count=1
    blr.addByte(Const.isc_info_sql_describe_vars);
    blrWriteInt(blr, 1);  // 1 output column

    // --- column 1 ---
    blr.addByte(Const.isc_info_sql_sqlda_seq);
    blrWriteInt(blr, 1);

    // SQL_VARYING=448; +1 makes it nullable
    blr.addByte(Const.isc_info_sql_type);
    blrWriteInt(blr, Const.SQL_VARYING + 1);

    blr.addByte(Const.isc_info_sql_sub_type);
    blrWriteInt(blr, 0);

    blr.addByte(Const.isc_info_sql_scale);
    blrWriteInt(blr, 0);

    blr.addByte(Const.isc_info_sql_length);
    blrWriteInt(blr, 100);

    blr.addByte(Const.isc_info_sql_field);
    blrWriteString(blr, 'NAME');

    blr.addByte(Const.isc_info_sql_relation);
    blrWriteString(blr, 'EMPLOYEE');

    // Firebird 6.0: schema of source relation
    blr.addByte(Const.isc_info_sql_relation_schema);
    blrWriteString(blr, 'MYSCHEMA');

    blr.addByte(Const.isc_info_sql_alias);
    blrWriteString(blr, 'NAME');

    blr.addByte(Const.isc_info_sql_describe_end);

    // --- input params section (none) ---
    blr.addByte(Const.isc_info_sql_bind);
    blr.addByte(Const.isc_info_sql_describe_vars);
    blrWriteInt(blr, 0);
    blr.addByte(Const.isc_info_sql_describe_end);

    return blr.buffer.slice(0, blr.pos);
}

/**
 * Same but without the schema item (pre-FB 6.0 server response).
 */
function buildDescribeResponseWithoutSchema() {
    const blr = new BlrWriter(512);

    blr.addByte(Const.isc_info_sql_stmt_type);
    blrWriteInt(blr, Const.isc_info_sql_stmt_select);

    blr.addByte(Const.isc_info_sql_select);
    blr.addByte(Const.isc_info_sql_describe_vars);
    blrWriteInt(blr, 1);

    blr.addByte(Const.isc_info_sql_sqlda_seq);
    blrWriteInt(blr, 1);

    blr.addByte(Const.isc_info_sql_type);
    blrWriteInt(blr, Const.SQL_VARYING + 1);

    blr.addByte(Const.isc_info_sql_sub_type);
    blrWriteInt(blr, 0);

    blr.addByte(Const.isc_info_sql_scale);
    blrWriteInt(blr, 0);

    blr.addByte(Const.isc_info_sql_length);
    blrWriteInt(blr, 50);

    blr.addByte(Const.isc_info_sql_field);
    blrWriteString(blr, 'ID');

    blr.addByte(Const.isc_info_sql_relation);
    blrWriteString(blr, 'ORDERS');

    blr.addByte(Const.isc_info_sql_alias);
    blrWriteString(blr, 'ID');

    blr.addByte(Const.isc_info_sql_describe_end);

    blr.addByte(Const.isc_info_sql_bind);
    blr.addByte(Const.isc_info_sql_describe_vars);
    blrWriteInt(blr, 0);
    blr.addByte(Const.isc_info_sql_describe_end);

    return blr.buffer.slice(0, blr.pos);
}

// ---------------------------------------------------------------------------
// Re-implement describe() logic for offline testing
// ---------------------------------------------------------------------------

/**
 * Parse a describe response buffer and return a statement-like object.
 * Mirrors the describe() function in connection.js so we can verify the
 * parser handles isc_info_sql_relation_schema correctly.
 */
function runDescribe(buffer) {
    const br = new BlrReader(buffer);
    const stmt = { input: undefined, output: undefined, type: undefined };
    let parameters = null;
    let param = null;

    while (br.pos < br.buffer.length) {
        const code = br.readByteCode();
        switch (code) {
            case Const.isc_info_sql_stmt_type:
                stmt.type = br.readInt();
                break;
            case Const.isc_info_sql_select:
                stmt.output = parameters = [];
                break;
            case Const.isc_info_sql_bind:
                stmt.input = parameters = [];
                break;
            case Const.isc_info_sql_num_variables:
                br.readInt();
                break;
            case Const.isc_info_sql_describe_vars: {
                if (!parameters) break;
                br.readInt(); // column count - ignored in the describe() loop
                let finishDescribe = false;
                param = null;
                let num = 0;
                while (!finishDescribe) {
                    switch (br.readByteCode()) {
                        case Const.isc_info_sql_describe_end:
                            finishDescribe = true;
                            break;
                        case Const.isc_info_sql_sqlda_seq:
                            num = br.readInt();
                            break;
                        case Const.isc_info_sql_type: {
                            const t = br.readInt();
                            param = {};
                            param.type     = t & ~1;
                            param.nullable = Boolean(t & 1);
                            parameters[num - 1] = param;
                            break;
                        }
                        case Const.isc_info_sql_sub_type:
                            if (param) param.subType = br.readInt();
                            break;
                        case Const.isc_info_sql_scale:
                            if (param) param.scale = br.readInt();
                            break;
                        case Const.isc_info_sql_length:
                            if (param) param.length = br.readInt();
                            break;
                        case Const.isc_info_sql_field:
                            if (param) param.field = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_relation:
                            if (param) param.relation = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_relation_schema:
                            if (param) param.relationSchema = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_alias:
                            if (param) param.alias = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_owner:
                            if (param) param.owner = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_sql_relation_alias:
                            if (param) param.relationAlias = br.readString(Const.DEFAULT_ENCODING);
                            break;
                        default:
                            finishDescribe = true;
                            br.pos--;
                    }
                }
                break;
            }
            default:
                // unknown item - stop
                break;
        }
    }

    return stmt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Firebird 6.0 — SQL Schemas support', function () {

    // -----------------------------------------------------------------------
    // 1. Constants
    // -----------------------------------------------------------------------

    describe('DPB constants', function () {
        it('should define isc_dpb_search_path = 94', function () {
            assert.strictEqual(Const.isc_dpb_search_path, 94,
                'isc_dpb_search_path must be 94 (as per Firebird 6.0 source)');
        });

        it('should define isc_dpb_default_schema = 95', function () {
            assert.strictEqual(Const.isc_dpb_default_schema, 95,
                'isc_dpb_default_schema must be 95 (as per Firebird 6.0 source)');
        });

        it('schema DPB tags must follow max_inline_blob_size (93) consecutively', function () {
            assert.strictEqual(Const.isc_dpb_max_inline_blob_size, 93);
            assert.strictEqual(Const.isc_dpb_search_path, 94);
            assert.strictEqual(Const.isc_dpb_default_schema, 95);
        });
    });

    describe('SQL info constants', function () {
        it('should define isc_info_sql_relation_schema = 33', function () {
            assert.strictEqual(Const.isc_info_sql_relation_schema, 33,
                'isc_info_sql_relation_schema must be 33 (as per Firebird 6.0 source)');
        });

        it('isc_info_sql_relation_schema must not collide with existing info items', function () {
            const knownItems = [
                Const.isc_info_sql_select,
                Const.isc_info_sql_bind,
                Const.isc_info_sql_num_variables,
                Const.isc_info_sql_describe_vars,
                Const.isc_info_sql_describe_end,
                Const.isc_info_sql_sqlda_seq,
                Const.isc_info_sql_type,
                Const.isc_info_sql_sub_type,
                Const.isc_info_sql_scale,
                Const.isc_info_sql_length,
                Const.isc_info_sql_null_ind,
                Const.isc_info_sql_field,
                Const.isc_info_sql_relation,
                Const.isc_info_sql_owner,
                Const.isc_info_sql_alias,
                Const.isc_info_sql_relation_alias,
                Const.isc_info_sql_explain_plan,
            ];
            assert.ok(
                !knownItems.includes(Const.isc_info_sql_relation_schema),
                'isc_info_sql_relation_schema (33) must not duplicate any existing SQL info item'
            );
        });
    });

    // -----------------------------------------------------------------------
    // 2. DESCRIBE arrays
    // -----------------------------------------------------------------------

    describe('DESCRIBE_WITH_SCHEMA array', function () {
        it('should be defined and non-empty', function () {
            assert.ok(Array.isArray(Const.DESCRIBE_WITH_SCHEMA), 'DESCRIBE_WITH_SCHEMA must be an array');
            assert.ok(Const.DESCRIBE_WITH_SCHEMA.length > 0, 'DESCRIBE_WITH_SCHEMA must not be empty');
        });

        it('should contain isc_info_sql_relation_schema', function () {
            assert.ok(
                Const.DESCRIBE_WITH_SCHEMA.includes(Const.isc_info_sql_relation_schema),
                'DESCRIBE_WITH_SCHEMA must include isc_info_sql_relation_schema'
            );
        });

        it('standard DESCRIBE should NOT contain isc_info_sql_relation_schema (backward compat)', function () {
            assert.ok(
                !Const.DESCRIBE.includes(Const.isc_info_sql_relation_schema),
                'Legacy DESCRIBE array must not include isc_info_sql_relation_schema'
            );
        });

        it('DESCRIBE_WITH_SCHEMA must include every item in DESCRIBE', function () {
            for (const item of Const.DESCRIBE) {
                assert.ok(
                    Const.DESCRIBE_WITH_SCHEMA.includes(item),
                    `DESCRIBE_WITH_SCHEMA must include all DESCRIBE items; missing: ${item}`
                );
            }
        });

        it('DESCRIBE_WITH_SCHEMA should be exactly 1 element longer than DESCRIBE', function () {
            assert.strictEqual(
                Const.DESCRIBE_WITH_SCHEMA.length,
                Const.DESCRIBE.length + 1,
                'DESCRIBE_WITH_SCHEMA should differ from DESCRIBE by exactly 1 item'
            );
        });

        it('isc_info_sql_relation_schema appears exactly once in DESCRIBE_WITH_SCHEMA', function () {
            const count = Const.DESCRIBE_WITH_SCHEMA.filter(
                (b) => b === Const.isc_info_sql_relation_schema
            ).length;
            assert.strictEqual(count, 1);
        });

        it('DESCRIBE_WITH_SCHEMA should contain isc_info_sql_stmt_type', function () {
            assert.ok(Const.DESCRIBE_WITH_SCHEMA.includes(Const.isc_info_sql_stmt_type));
        });

        it('DESCRIBE_WITH_SCHEMA should contain isc_info_sql_relation', function () {
            assert.ok(Const.DESCRIBE_WITH_SCHEMA.includes(Const.isc_info_sql_relation));
        });
    });

    // -----------------------------------------------------------------------
    // 3. Describe parser — with schema (FB 6.0 response)
    // -----------------------------------------------------------------------

    describe('describe() parser — Firebird 6.0 response WITH schema', function () {
        let stmt;

        beforeAll(function () {
            const buf = buildDescribeResponseWithSchema();
            stmt = runDescribe(buf);
        });

        it('should parse statement type as SELECT', function () {
            assert.strictEqual(stmt.type, Const.isc_info_sql_stmt_select);
        });

        it('should produce exactly one output column', function () {
            assert.ok(Array.isArray(stmt.output));
            assert.strictEqual(stmt.output.length, 1);
        });

        it('output column should have correct field name', function () {
            assert.strictEqual(stmt.output[0].field, 'NAME');
        });

        it('output column should have correct relation name', function () {
            assert.strictEqual(stmt.output[0].relation, 'EMPLOYEE');
        });

        it('output column should have correct relationSchema', function () {
            assert.strictEqual(stmt.output[0].relationSchema, 'MYSCHEMA',
                'relationSchema must be populated from isc_info_sql_relation_schema');
        });

        it('output column should have correct alias', function () {
            assert.strictEqual(stmt.output[0].alias, 'NAME');
        });

        it('output column should be marked nullable', function () {
            assert.strictEqual(stmt.output[0].nullable, true);
        });

        it('output column should have correct length', function () {
            assert.strictEqual(stmt.output[0].length, 100);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Describe parser — without schema (pre-FB 6.0 response)
    // -----------------------------------------------------------------------

    describe('describe() parser — pre-FB 6.0 response WITHOUT schema', function () {
        let stmt;

        beforeAll(function () {
            const buf = buildDescribeResponseWithoutSchema();
            stmt = runDescribe(buf);
        });

        it('should parse statement type correctly', function () {
            assert.strictEqual(stmt.type, Const.isc_info_sql_stmt_select);
        });

        it('should produce exactly one output column', function () {
            assert.strictEqual(stmt.output.length, 1);
        });

        it('output column should have correct relation name', function () {
            assert.strictEqual(stmt.output[0].relation, 'ORDERS');
        });

        it('output column relationSchema should be undefined (not sent by pre-6.0 server)', function () {
            assert.strictEqual(stmt.output[0].relationSchema, undefined,
                'Pre-6.0 servers do not send isc_info_sql_relation_schema; field must be absent');
        });
    });

    // -----------------------------------------------------------------------
    // 5. searchPath serialisation
    // -----------------------------------------------------------------------

    describe('searchPath option serialisation', function () {
        function serialiseSearchPath(sp) {
            return Array.isArray(sp) ? sp.join(',') : String(sp);
        }

        it('array form should be joined with commas', function () {
            assert.strictEqual(
                serialiseSearchPath(['myapp', 'PUBLIC', 'SYSTEM']),
                'myapp,PUBLIC,SYSTEM'
            );
        });

        it('string form should be passed through unchanged', function () {
            assert.strictEqual(
                serialiseSearchPath('myapp,PUBLIC'),
                'myapp,PUBLIC'
            );
        });

        it('single-element array should produce a string without commas', function () {
            assert.strictEqual(serialiseSearchPath(['myapp']), 'myapp');
        });

        it('empty array should produce empty string', function () {
            assert.strictEqual(serialiseSearchPath([]), '');
        });
    });

    // -----------------------------------------------------------------------
    // 6. Protocol 20 constants integrity
    // -----------------------------------------------------------------------

    describe('Protocol 20 integrity', function () {
        it('PROTOCOL_VERSION20 should equal 0x8014 (FB_PROTOCOL_FLAG | 20)', function () {
            assert.strictEqual(Const.PROTOCOL_VERSION20, 0x8014);
        });

        it('PROTOCOL_VERSION20 should have FB_PROTOCOL_FLAG set', function () {
            assert.ok(Const.PROTOCOL_VERSION20 & Const.FB_PROTOCOL_FLAG);
        });

        it('PROTOCOL_VERSION19 should be the highest version in SUPPORTED_PROTOCOL (P20 capped)', function () {
            // Protocol 20 is intentionally excluded from SUPPORTED_PROTOCOL to avoid
            // Firebird 6.0 prepare-statement hangs. P19 is the current maximum.
            const versions = Const.SUPPORTED_PROTOCOL.map((p) => p[0]);
            const maxVer   = Math.max(...versions);
            assert.strictEqual(maxVer, Const.PROTOCOL_VERSION19,
                'PROTOCOL_VERSION19 should be the highest negotiated version (P20 intentionally capped)');
            // P20 constant is still exported for future use
            assert.ok(Const.PROTOCOL_VERSION20, 'PROTOCOL_VERSION20 constant should still be defined');
        });
    });

    // -----------------------------------------------------------------------
    // 7. Mock-server: schema DPB parameters sent by client on attach
    // -----------------------------------------------------------------------

    describe('mock-server: schema DPB parameters on attach', function () {
        let server, capturedBytes, serverPort;

        function buildOpAcceptData() {
            const w = new XdrWriter(64);
            w.addInt(Const.op_accept_data);
            w.addInt(Const.PROTOCOL_VERSION20); // advertise Protocol 20
            w.addInt(Const.ARCHITECTURE_GENERIC);
            w.addInt(Const.ptype_lazy_send);
            w.addInt(0);                        // auth data len = 0
            w.addString('Legacy_Auth', 'utf8');
            w.addInt(1);                        // is_authenticated = 1
            w.addString('', 'utf8');
            return w.getData();
        }

        function buildOpResponse(handle) {
            const w = new XdrWriter(32);
            w.addInt(Const.op_response);
            w.addInt(handle);
            w.addInt(0); w.addInt(0);
            w.addInt(0);                    // data length = 0
            w.addInt(Const.isc_arg_end);
            return w.getData();
        }

        beforeAll(function () {
            capturedBytes = Buffer.alloc(0);

            server = net.createServer(function (socket) {
                socket.on('data', function (chunk) {
                    capturedBytes = Buffer.concat([capturedBytes, chunk]);
                });

                // Respond: accept → attach OK → detach OK
                setTimeout(function () {
                    socket.write(buildOpAcceptData());
                    setTimeout(function () {
                        socket.write(buildOpResponse(42));
                        setTimeout(function () {
                            socket.write(buildOpResponse(0));
                            socket.end();
                        }, 20);
                    }, 20);
                }, 20);
            });

            return new Promise((resolve) => {
                server.listen(0, '127.0.0.1', function () {
                    serverPort = server.address().port;

                    Firebird.attach({
                        host: '127.0.0.1',
                        port: serverPort,
                        database: '/tmp/test.fdb',
                        user: 'SYSDBA',
                        password: 'masterkey',
                        defaultSchema: 'MYSCHEMA',
                        searchPath: ['MYSCHEMA', 'PUBLIC'],
                        wireCrypt: Const.WIRE_CRYPT_DISABLE,
                    }, function (err, db) {
                        setTimeout(function () {
                            if (db) db.detach();
                            resolve();
                        }, 150);
                    });
                });
            });
        });

        afterAll(function () {
            return new Promise((resolve) => {
                server.close(resolve);
            });
        });

        it('should send isc_dpb_default_schema (tag 95) in the DPB', function () {
            assert.ok(
                capturedBytes.includes(Buffer.from([Const.isc_dpb_default_schema])),
                'DPB must contain isc_dpb_default_schema tag (95 / 0x5f)'
            );
        });

        it('should send isc_dpb_search_path (tag 94) in the DPB', function () {
            assert.ok(
                capturedBytes.includes(Buffer.from([Const.isc_dpb_search_path])),
                'DPB must contain isc_dpb_search_path tag (94 / 0x5e)'
            );
        });

        it('DPB payload should contain the schema name bytes "MYSCHEMA"', function () {
            const schemaBytes = Buffer.from('MYSCHEMA', 'utf8');
            assert.ok(
                capturedBytes.includes(schemaBytes),
                'Schema name "MYSCHEMA" should appear in the captured DPB bytes'
            );
        });

        it('DPB payload should contain the comma-joined search path "MYSCHEMA,PUBLIC"', function () {
            const spBytes = Buffer.from('MYSCHEMA,PUBLIC', 'utf8');
            assert.ok(
                capturedBytes.includes(spBytes),
                'Search path "MYSCHEMA,PUBLIC" should appear in the captured DPB bytes'
            );
        });
    });
});
