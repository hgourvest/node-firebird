'use strict';

/**
 * Offline wire-protocol tests using an in-process mock Firebird server.
 *
 * These tests do NOT require a real Firebird server.  A minimal TCP server is
 * started on a random loopback port; it speaks enough of the Firebird wire
 * protocol to exercise the Connection class end-to-end:
 *
 *  Client                              Mock Server
 *  ------                              -----------
 *  op_connect ──────────────────────▶
 *             ◀────────────────────── op_accept_data (is_authenticated=1)
 *  op_attach  ──────────────────────▶
 *             ◀────────────────────── op_response  (handle=42)
 *  op_detach  ──────────────────────▶
 *             ◀────────────────────── op_response  (success)
 *             ◀────────────────────── socket.end()
 *
 * Additional tests inject op_event and op_response_piggyback frames between
 * real responses to verify that these unsolicited frames are consumed without
 * corrupting the response queue.
 *
 * XDR round-trip tests exercise XdrWriter / XdrReader encode/decode cycles
 * without any network involvement.
 */

const net    = require('net');
const assert = require('assert');

const Const    = require('../lib/wire/const');
const {XdrWriter, XdrReader} = require('../lib/wire/serialize');
const Firebird = require('../lib');

// ---------------------------------------------------------------------------
// Wire-protocol response builders
// ---------------------------------------------------------------------------

/**
 * Build an op_accept_data frame (opcode 94).
 * is_authenticated=1 means no SRP exchange is needed – the connection
 * proceeds directly to op_attach.
 */
function buildOpAcceptData(pluginName) {
    const w = new XdrWriter(128);
    w.addInt(Const.op_accept_data);
    w.addInt(Const.PROTOCOL_VERSION14);
    w.addInt(Const.ARCHITECTURE_GENERIC);
    w.addInt(Const.ptype_lazy_send);
    w.addInt(0);                                        // auth data array len=0
    w.addString(pluginName || 'Legacy_Auth', 'utf8');   // plugin name
    w.addInt(1);                                        // is_authenticated=1
    w.addString('', 'utf8');                            // keys=""
    return w.getData();
}

/**
 * Build a minimal op_response frame (opcode 9).
 * handle : database / statement handle returned to the client
 */
function buildOpResponse(handle) {
    const w = new XdrWriter(32);
    w.addInt(Const.op_response);
    w.addInt(handle);
    w.addInt(0); w.addInt(0);       // oid (quad: high + low)
    w.addInt(0);                    // data array length = 0
    w.addInt(Const.isc_arg_end);    // status vector terminator
    return w.getData();
}

/**
 * Build a stray op_event frame (opcode 52).
 * When this arrives on the main connection the driver must consume it
 * without touching the response queue.
 */
function buildOpEvent(dbHandle, eventRid) {
    const w = new XdrWriter(64);
    w.addInt(Const.op_event);
    w.addInt(dbHandle);
    w.addInt(0);                    // EPB array length = 0
    w.addInt64(0);                  // AST pointer = 0
    w.addInt(eventRid || 1);
    return w.getData();
}

/**
 * Build an op_response_piggyback frame (opcode 72).
 * Firebird 5 sends this as an unsolicited cleanup notification.
 */
function buildOpResponsePiggyback() {
    const w = new XdrWriter(32);
    w.addInt(Const.op_response_piggyback);
    w.addInt(0);                    // handle
    w.addInt(0); w.addInt(0);       // oid
    w.addInt(0);                    // data array length = 0
    w.addInt(Const.isc_arg_end);    // status vector terminator
    return w.getData();
}

// ---------------------------------------------------------------------------
// Mock server helpers
// ---------------------------------------------------------------------------

/**
 * Start a TCP server on a random loopback port.
 * onClient(socket) is called for each accepted connection.
 * Returns { server, port }.
 */
function startMockServer(onClient) {
    return new Promise((resolve, reject) => {
        const server = net.createServer(onClient);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function stopMockServer(server) {
    return new Promise(resolve => server.close(resolve));
}

/**
 * Simple request dispatcher for the mock server.
 * Buffers incoming bytes and dispatches on the first 4-byte opcode.
 * handler(socket, opcode) is called whenever a new opcode is detected.
 */
function makeDispatcher(socket, handler) {
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
            const opcode = buf.readInt32BE(0);
            // We don't parse the full message length; assume each TCP write
            // from the client corresponds to exactly one logical message
            // (true on loopback for all frames we care about).
            buf = Buffer.alloc(0);
            handler(socket, opcode);
        }
    });
}

// ---------------------------------------------------------------------------
// Helper: attach via mock server, run test fn, then detach
// ---------------------------------------------------------------------------

async function withMockAttach(port, fn) {
    const db = await new Promise((resolve, reject) => {
        Firebird.attach({
            host:     '127.0.0.1',
            port,
            database: '/mock/test.fdb',
            user:     'SYSDBA',
            password: 'masterkey',
        }, (err, d) => (err ? reject(err) : resolve(d)));
    });

    try {
        await fn(db);
    } finally {
        await new Promise((resolve, reject) => db.detach(e => (e ? reject(e) : resolve())));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Firebird Wire Protocol – offline mock-server tests', function () {

    // -----------------------------------------------------------------------
    // 1. Full attach / detach cycle (happy path)
    // -----------------------------------------------------------------------

    it('should complete a full attach/detach cycle via mock server', async function () {
        const { server, port } = await startMockServer(socket => {
            makeDispatcher(socket, (s, opcode) => {
                if (opcode === Const.op_connect) {
                    s.write(buildOpAcceptData('Legacy_Auth'));
                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    s.write(buildOpResponse(42));
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                }
            });
        });

        try {
            await withMockAttach(port, async db => {
                assert.ok(db, 'db object should be returned');
            });
        } finally {
            await stopMockServer(server);
        }
    });

    // -----------------------------------------------------------------------
    // 2. op_event on main connection must not corrupt the response queue
    // -----------------------------------------------------------------------

    it('should ignore a stray op_event on the main connection without blocking', async function () {
        const { server, port } = await startMockServer(socket => {
            let attached = false;
            makeDispatcher(socket, (s, opcode) => {
                if (opcode === Const.op_connect) {
                    s.write(buildOpAcceptData('Legacy_Auth'));
                } else if ((opcode === Const.op_attach || opcode === Const.op_create) && !attached) {
                    attached = true;
                    // Inject a stray op_event BEFORE the real op_response.
                    // The driver must consume it and still deliver the op_response.
                    const combined = Buffer.concat([
                        buildOpEvent(42, 7),
                        buildOpResponse(42),
                    ]);
                    s.write(combined);
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                }
            });
        });

        try {
            await withMockAttach(port, async db => {
                assert.ok(db, 'db should attach successfully after stray op_event');
            });
        } finally {
            await stopMockServer(server);
        }
    });

    // -----------------------------------------------------------------------
    // 3. op_response_piggyback on main connection must not corrupt the queue
    // -----------------------------------------------------------------------

    it('should ignore op_response_piggyback on the main connection without blocking', async function () {
        const { server, port } = await startMockServer(socket => {
            let attached = false;
            makeDispatcher(socket, (s, opcode) => {
                if (opcode === Const.op_connect) {
                    s.write(buildOpAcceptData('Legacy_Auth'));
                } else if ((opcode === Const.op_attach || opcode === Const.op_create) && !attached) {
                    attached = true;
                    // Inject op_response_piggyback BEFORE the real op_response.
                    const combined = Buffer.concat([
                        buildOpResponsePiggyback(),
                        buildOpResponse(42),
                    ]);
                    s.write(combined);
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                }
            });
        });

        try {
            await withMockAttach(port, async db => {
                assert.ok(db, 'db should attach successfully after op_response_piggyback');
            });
        } finally {
            await stopMockServer(server);
        }
    });

    // -----------------------------------------------------------------------
    // 4. Multiple sequential attach/detach cycles (queue alignment)
    // -----------------------------------------------------------------------

    it('should handle multiple sequential attach/detach cycles with correct queue alignment', async function () {
        let connectionCount = 0;

        const { server, port } = await startMockServer(socket => {
            connectionCount++;
            makeDispatcher(socket, (s, opcode) => {
                if (opcode === Const.op_connect) {
                    s.write(buildOpAcceptData('Legacy_Auth'));
                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    s.write(buildOpResponse(connectionCount * 10));
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                }
            });
        });

        try {
            for (let i = 0; i < 3; i++) {
                await withMockAttach(port, async db => {
                    assert.ok(db, `cycle ${i}: db should be valid`);
                });
            }
        } finally {
            await stopMockServer(server);
        }
    });

});

// ---------------------------------------------------------------------------
// XDR encode/decode round-trip tests (fully offline, no network)
// ---------------------------------------------------------------------------

describe('XDR encode/decode round trips', function () {

    it('should round-trip a 32-bit integer', function () {
        const w = new XdrWriter(8);
        w.addInt(0xDEADBEEF | 0); // signed 32-bit
        const r = new XdrReader(w.getData());
        assert.strictEqual(r.readInt(), 0xDEADBEEF | 0);
    });

    it('should round-trip zero (0)', function () {
        const w = new XdrWriter(8);
        w.addInt(0);
        const r = new XdrReader(w.getData());
        assert.strictEqual(r.readInt(), 0);
    });

    it('should round-trip a UTF-8 string', function () {
        const w = new XdrWriter(64);
        w.addString('Hello Firebird!', 'utf8');
        const r = new XdrReader(w.getData());
        assert.strictEqual(r.readString('utf8'), 'Hello Firebird!');
    });

    it('should round-trip an empty string', function () {
        const w = new XdrWriter(16);
        w.addString('', 'utf8');
        const r = new XdrReader(w.getData());
        assert.strictEqual(r.readString('utf8'), '');
    });

    it('should round-trip a byte array (addInt + readArray)', function () {
        const payload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
        const w = new XdrWriter(32);
        w.addInt(payload.length);
        w.addBuffer(payload);
        // XDR arrays are 4-byte aligned
        const padLen = (4 - (payload.length % 4)) % 4;
        if (padLen > 0) w.addBuffer(Buffer.alloc(padLen)); // XDR alignment padding (0-3 bytes)

        const r = new XdrReader(w.getData());
        const len = r.readInt();
        assert.strictEqual(len, payload.length);
        const read = r.buffer.slice(r.pos, r.pos + len);
        assert.ok(read.equals(payload));
    });

    it('should round-trip a 64-bit integer via addInt64 / readInt64', function () {
        const w = new XdrWriter(16);
        w.addInt64(0x1234567890); // 78187493520
        const r = new XdrReader(w.getData());
        const v = r.readInt64();
        // Long value – compare via toString
        assert.strictEqual(v.toString(), '78187493520');
    });

    it('should encode op_response and decode protocolVersion / handle', function () {
        // Build a mock op_response and verify we can read the handle
        const frame = buildOpResponse(99);
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_response); // opcode
        assert.strictEqual(r.readInt(), 99);                // handle
    });

    it('should encode op_event and read all 4 fields', function () {
        const frame = buildOpEvent(7, 13);
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_event);    // opcode
        assert.strictEqual(r.readInt(), 7);                 // db handle
        r.readArray();                                      // EPB (empty)
        r.readInt64();                                      // AST pointer
        assert.strictEqual(r.readInt(), 13);                // event RID
    });

    it('should encode op_response_piggyback and read handle', function () {
        const frame = buildOpResponsePiggyback();
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_response_piggyback); // opcode
        assert.strictEqual(r.readInt(), 0);                           // handle
    });

    it('should encode op_accept_data and read protocolVersion + pluginName + is_authenticated', function () {
        const frame = buildOpAcceptData('Legacy_Auth');
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_accept_data);
        assert.strictEqual(r.readInt(), Const.PROTOCOL_VERSION14);
        assert.strictEqual(r.readInt(), Const.ARCHITECTURE_GENERIC);
        assert.strictEqual(r.readInt(), Const.ptype_lazy_send);
        r.readArray();                                      // auth data (empty)
        assert.strictEqual(r.readString('utf8'), 'Legacy_Auth');
        assert.strictEqual(r.readInt(), 1);                 // is_authenticated
        assert.strictEqual(r.readString('utf8'), '');       // keys
    });

    it('should align strings to 4-byte boundaries', function () {
        // 'ABC' is 3 bytes → padded to 4
        const w = new XdrWriter(32);
        w.addString('ABC', 'utf8');
        // Expected: [0,0,0,3, 65,66,67,0]  (4-byte aligned)
        const buf = w.getData();
        assert.strictEqual(buf.readInt32BE(0), 3);  // length prefix
        assert.strictEqual(buf[4], 0x41);            // 'A'
        assert.strictEqual(buf[5], 0x42);            // 'B'
        assert.strictEqual(buf[6], 0x43);            // 'C'
        assert.strictEqual(buf[7], 0x00);            // padding
        assert.strictEqual(buf.length, 8);
    });

    it('should correctly represent PROTOCOL_VERSION14 constant', function () {
        assert.strictEqual(Const.PROTOCOL_VERSION14, (0x8000 | 14));
        assert.strictEqual(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_MASK, 14);
        assert.ok(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_FLAG);
    });

    it('should define op_event, op_response_piggyback opcodes', function () {
        assert.strictEqual(Const.op_event,             52);
        assert.strictEqual(Const.op_response_piggyback, 72);
        assert.strictEqual(Const.op_accept_data,        94);
        assert.strictEqual(Const.op_cond_accept,        98);
    });
});
