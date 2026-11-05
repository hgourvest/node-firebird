'use strict';

/**
 * Offline wire-protocol and CPU micro-benchmarks.
 *
 * Measures the hot paths inside `node-firebird` without requiring a running
 * Firebird server:
 *   1. XdrWriter / XdrReader primitive & row-level serialization
 *   2. BitSet null-bitmap construction & decoding
 *   3. BlrReader multi-segment BLOB assembly
 *   4. IEEE 754-2008 DECFLOAT(16/34) encode/decode
 *   5. Full `decodeResponse` (`op_fetch_response`) row-batch decoding
 *      (object rows, array rows, camelCase key transforms, nestTables)
 *   6. Large `describe()` parsing (including paginated > 1800 bind parameters)
 *   7. SRP-256 client seed & proof computation and Arc4 stream cipher
 */

const Const = require('../lib/wire/const');
const Connection = require('../lib/wire/connection');
const { XdrWriter, XdrReader, BlrReader, BitSet } = require('../lib/wire/serialize');
const Xsql = require('../lib/wire/xsqlvar');
const { encodeDecimal64, decodeDecimal64, encodeDecimal128, decodeDecimal128 } = require('../lib/ieee754-decimal');
const srp = require('../lib/srp');
const Socket = require('../lib/wire/socket');
const { benchSync, printTable } = require('./harness');

// ---------------------------------------------------------------------------
// Packet & fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a synthetic Protocol 13+ `op_fetch_response` packet containing `rowCount`
 * rows of 6 columns:
 *   0: ID          (SQL_LONG / INTEGER)
 *   1: CODE        (SQL_TEXT / CHAR(16) UTF8 = 64 bytes)
 *   2: NAME        (SQL_VARYING / VARCHAR(64) UTF8)
 *   3: AMOUNT      (SQL_INT64 / NUMERIC(18, 2), scale = -2)
 *   4: CREATED_AT  (SQL_TIMESTAMP)
 *   5: IS_ACTIVE   (SQL_BOOLEAN)
 */
function buildFetchResponseFixture(rowCount) {
    const colId = new Xsql.SQLVarInt();
    colId.type = Const.SQL_LONG;
    colId.scale = 0;
    colId.length = 4;
    colId.field = 'ID';
    colId.alias = 'ID';
    colId.relation = 'ORDERS';

    const colCode = new Xsql.SQLVarText();
    colCode.type = Const.SQL_TEXT;
    colCode.subType = 4; // UTF8
    colCode.charSetId = 4;
    colCode.scale = 0;
    colCode.length = 64; // CHAR(16) UTF8
    colCode.field = 'CODE';
    colCode.alias = 'CODE';
    colCode.relation = 'ORDERS';

    const colName = new Xsql.SQLVarString();
    colName.type = Const.SQL_VARYING;
    colName.subType = 4; // UTF8
    colName.charSetId = 4;
    colName.scale = 0;
    colName.length = 256;
    colName.field = 'CUSTOMER_NAME';
    colName.alias = 'CUSTOMER_NAME';
    colName.relation = 'ORDERS';

    const colAmount = new Xsql.SQLVarInt64();
    colAmount.type = Const.SQL_INT64;
    colAmount.scale = -2;
    colAmount.length = 8;
    colAmount.field = 'TOTAL_AMOUNT';
    colAmount.alias = 'TOTAL_AMOUNT';
    colAmount.relation = 'ORDERS';

    const colCreated = new Xsql.SQLVarTimeStamp();
    colCreated.type = Const.SQL_TIMESTAMP;
    colCreated.scale = 0;
    colCreated.length = 8;
    colCreated.field = 'CREATED_AT';
    colCreated.alias = 'CREATED_AT';
    colCreated.relation = 'ORDERS';

    const colActive = new Xsql.SQLVarBoolean();
    colActive.type = Const.SQL_BOOLEAN;
    colActive.scale = 0;
    colActive.length = 1;
    colActive.field = 'IS_ACTIVE';
    colActive.alias = 'IS_ACTIVE';
    colActive.relation = 'ORDERS';

    const output = [colId, colCode, colName, colAmount, colCreated, colActive];
    const dtParts = Xsql.encodeDateTimeParts(new Date('2026-05-15T12:34:56Z'));
    const codeFixed = Buffer.alloc(64, 0x20);
    codeFixed.write('ORD-000012345678', 0, 'utf8');

    const w = new XdrWriter(rowCount * 160 + 64);
    w.addInt(Const.op_fetch_response);
    w.addInt(0); // status = 0 (rows follow)
    w.addInt(1); // count = 1

    for (let i = 0; i < rowCount; i++) {
        // 6 columns -> 1 byte null bitmap + 3 padding bytes = 4 bytes
        // Every 8th row has a NULL CUSTOMER_NAME (bit 2)
        const nullMask = i % 8 === 7 ? 0x04 : 0x00;
        w.addBuffer(Buffer.from([nullMask, 0, 0, 0]));

        // col 0: ID
        w.addInt(i + 1);
        // col 1: CODE (fixed 64 bytes)
        w.addParamBuffer(codeFixed);
        // col 2: CUSTOMER_NAME (unless null)
        if ((nullMask & 0x04) === 0) {
            w.addString(`Customer #${i + 1} — Firebird Benchmark`, 'utf8');
        }
        // col 3: TOTAL_AMOUNT (scaled by 10^2)
        w.addInt64(BigInt((i + 1) * 12345));
        // col 4: CREATED_AT
        w.addInt(dtParts.date);
        w.addUInt(dtParts.time);
        // col 5: IS_ACTIVE (1 byte + 3 align bytes)
        w.addBuffer(Buffer.from([i & 1, 0, 0, 0]));

        if (i < rowCount - 1) {
            w.addInt(Const.op_fetch_response);
            w.addInt(0); // status = 0
            w.addInt(1); // count = 1
        } else {
            // End-of-batch marker (status = 100, count = 0)
            w.addInt(Const.op_fetch_response);
            w.addInt(100);
            w.addInt(0);
        }
    }

    return {
        buffer: w.getData(),
        output,
    };
}

/**
 * Build a multi-segment BLR buffer (as returned by `op_get_segment`)
 * containing `segmentCount` segments of `segmentSize` bytes each.
 */
function buildBlrSegmentsBuffer(segmentCount, segmentSize) {
    const buf = Buffer.alloc(segmentCount * (2 + segmentSize));
    let pos = 0;
    for (let i = 0; i < segmentCount; i++) {
        buf.writeUInt16LE(segmentSize, pos);
        pos += 2;
        buf.fill(0x61 + (i % 26), pos, pos + segmentSize);
        pos += segmentSize;
    }
    return buf;
}

/**
 * Build a `describe()` buffer with `paramCount` bind parameters.
 */
function buildDescribeBindBuffer(paramCount) {
    function wordLE(val) {
        return [val & 0xff, (val >> 8) & 0xff];
    }
    function intLE(val) {
        if (val >= -128 && val <= 127) return [...wordLE(1), val & 0xff];
        if (val >= -32768 && val <= 32767) return [...wordLE(2), val & 0xff, (val >> 8) & 0xff];
        return [
            ...wordLE(4),
            val & 0xff,
            (val >> 8) & 0xff,
            (val >> 16) & 0xff,
            (val >> 24) & 0xff,
        ];
    }
    const bytes = [
        Const.isc_info_sql_stmt_type,
        ...intLE(Const.isc_info_sql_stmt_select),
        Const.isc_info_sql_select,
        Const.isc_info_sql_describe_vars,
        ...intLE(0),
        Const.isc_info_sql_describe_end,
        Const.isc_info_sql_bind,
        Const.isc_info_sql_describe_vars,
        ...intLE(paramCount),
    ];
    for (let i = 1; i <= paramCount; i++) {
        bytes.push(
            Const.isc_info_sql_sqlda_seq,
            ...intLE(i),
            Const.isc_info_sql_type,
            ...intLE(Const.SQL_LONG),
            Const.isc_info_sql_sub_type,
            ...intLE(0),
            Const.isc_info_sql_scale,
            ...intLE(0),
            Const.isc_info_sql_length,
            ...intLE(4),
            Const.isc_info_sql_describe_end
        );
    }
    bytes.push(Const.isc_info_end);
    return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Suite runner
// ---------------------------------------------------------------------------

function runMicroBenchmarks(options = {}) {
    const allResults = [];

    // 1. Serialization & Low-Level Buffers
    const serialResults = [];

    serialResults.push(
        benchSync(
            'XdrWriter + XdrReader (200 mixed rows)',
            () => {
                const w = new XdrWriter(16384);
                for (let i = 0; i < 200; i++) {
                    w.addInt(i);
                    w.addInt64(BigInt(i * 100000));
                    w.addDouble(i * 1.25);
                    w.addString('Firebird wire benchmark payload', 'utf8');
                }
                const r = new XdrReader(w.getData());
                for (let i = 0; i < 200; i++) {
                    r.readInt();
                    r.readInt64BigInt();
                    r.readDouble();
                    r.readString('utf8');
                }
            },
            { itemsPerOp: 200, unit: 'rows/s' }
        )
    );

    const nullBitmapBuf32 = Buffer.alloc(4, 0b01010101);
    serialResults.push(
        benchSync(
            'BitSet decode + get (32 columns x 200 rows)',
            () => {
                let nulls = 0;
                for (let r = 0; r < 200; r++) {
                    const bs = new BitSet(nullBitmapBuf32);
                    for (let c = 0; c < 32; c++) {
                        if (bs.get(c)) nulls++;
                    }
                }
                return nulls;
            },
            { itemsPerOp: 200, unit: 'rows/s' }
        )
    );

    serialResults.push(
        benchSync(
            'BitSet encode (32 columns x 200 rows)',
            () => {
                for (let r = 0; r < 200; r++) {
                    const bs = new BitSet();
                    for (let c = 0; c < 32; c++) {
                        bs.set(c, (c & 3) === 0 ? 1 : 0);
                    }
                    bs.toBuffer();
                }
            },
            { itemsPerOp: 200, unit: 'rows/s' }
        )
    );

    const blrSegBuf = buildBlrSegmentsBuffer(32, 1024); // 32 x 1 KB = 32 KB
    serialResults.push(
        benchSync(
            'BlrReader.readSegment (32 x 1 KB segments)',
            () => {
                const br = new BlrReader(blrSegBuf);
                br.readSegment();
            },
            { itemsPerOp: 32 / 1024, unit: 'MB/s' }
        )
    );

    const dec64Buf = encodeDecimal64('1234567890.123456');
    const dec128Buf = encodeDecimal128('1234567890123456789012345678.901234');
    serialResults.push(
        benchSync(
            'DECFLOAT(16) encode + decode round-trip',
            () => {
                const b = encodeDecimal64('1234567890.123456');
                decodeDecimal64(b || dec64Buf);
            },
            { itemsPerOp: 1, unit: 'ops/s' }
        )
    );

    serialResults.push(
        benchSync(
            'DECFLOAT(34) encode + decode round-trip',
            () => {
                const b = encodeDecimal128('1234567890123456789012345678.901234');
                decodeDecimal128(b || dec128Buf);
            },
            { itemsPerOp: 1, unit: 'ops/s' }
        )
    );

    if (!options.json) {
        printTable('Wire Serialization & Primitives (Offline)', serialResults);
    }
    allResults.push(...serialResults);

    // 2. Row Batch Decoding (`decodeResponse` on `op_fetch_response`)
    const decodeResults = [];
    const fixture200 = buildFetchResponseFixture(200);
    const noopDb = { emit: function () {} };

    function runDecodeBench(label, customOptions, cnxOptions) {
        const statement = {
            output: fixture200.output,
            options: customOptions,
            nbrowsfetched: 0,
            connection: {
                accept: { protocolVersion: Const.PROTOCOL_VERSION18 },
                options: cnxOptions,
                db: noopDb,
            },
        };
        const cnx = { options: cnxOptions };
        const cbObj = { statement };

        return benchSync(
            label,
            () => {
                const reader = new XdrReader(fixture200.buffer);
                Connection.decodeResponse(reader, cbObj, cnx, Boolean(cnxOptions.lowercase_keys), () => {});
            },
            { itemsPerOp: 200, unit: 'rows/s' }
        );
    }

    decodeResults.push(
        runDecodeBench('decodeResponse 200 rows (asObject: true)', { asObject: true }, { encoding: 'UTF8' })
    );
    decodeResults.push(
        runDecodeBench('decodeResponse 200 rows (asObject: false / array)', { asObject: false }, { encoding: 'UTF8' })
    );
    decodeResults.push(
        runDecodeBench(
            'decodeResponse 200 rows (lowercase + camelCase)',
            { asObject: true, transformKeys: 'camel' },
            { encoding: 'UTF8', lowercase_keys: true }
        )
    );
    decodeResults.push(
        runDecodeBench(
            'decodeResponse 200 rows (nestTables: true)',
            { asObject: true, nestTables: true },
            { encoding: 'UTF8' }
        )
    );

    const describeBuf1500 = buildDescribeBindBuffer(1500);
    decodeResults.push(
        benchSync(
            'Connection.describe (1,500 bind parameters)',
            () => {
                const stmt = { input: null, output: null, connection: { options: { encoding: 'UTF8' } } };
                Connection.describe(describeBuf1500, stmt);
            },
            { itemsPerOp: 1500, unit: 'params/s' }
        )
    );

    if (!options.json) {
        printTable('Row Decoding & Metadata Parsing (Offline)', decodeResults);
    }
    allResults.push(...decodeResults);

    // 3. Crypto & Auth (SRP + Wire Encryption)
    const cryptoResults = [];
    const clientKeys = srp.clientSeed();
    const serverSalt = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const serverKeys = srp.serverSeed('SYSDBA', 'masterkey', serverSalt);

    cryptoResults.push(
        benchSync(
            'SRP clientSeed + clientProof (Srp256)',
            () => {
                srp.clientProof(
                    'SYSDBA',
                    'masterkey',
                    serverSalt,
                    clientKeys.public,
                    serverKeys.public,
                    clientKeys.private,
                    'sha256'
                );
            },
            { warmupMs: 50, minTimeMs: 250, minSamples: 10, itemsPerOp: 1, unit: 'handshakes/s' }
        )
    );

    const arc4Key = Buffer.alloc(20, 0x42);
    const arc4Payload = Buffer.alloc(65536, 0x5a); // 64 KB
    const arc4Cipher = new Socket.Arc4(arc4Key);
    cryptoResults.push(
        benchSync(
            'Arc4 wire cipher transform (64 KB packet)',
            () => {
                arc4Cipher.transform(arc4Payload);
            },
            { itemsPerOp: 65536 / (1024 * 1024), unit: 'MB/s' }
        )
    );

    if (!options.json) {
        printTable('Authentication & Wire Encryption (Offline)', cryptoResults);
    }
    allResults.push(...cryptoResults);

    return allResults;
}

if (require.main === module) {
    runMicroBenchmarks();
}

module.exports = { runMicroBenchmarks };
