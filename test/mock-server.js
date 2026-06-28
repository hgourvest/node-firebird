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
 * SRP auth protocol sequence (FB3/FB4/FB5, wireCrypt disabled):
 *
 *  Client                              Mock Server (SRP)
 *  ------                              -----------------
 *  op_connect (plugin=Srp, A=clientPublicKey)
 *             ──────────────────────▶
 *             ◀────────────────────── op_cond_accept (salt, B=serverPublicKey)
 *  srp.clientProof → M1
 *  op_cont_auth (M1)
 *             ──────────────────────▶
 *             ◀────────────────────── op_cont_auth (M2, server proof) ──┐
 *             ◀────────────────────── op_accept (protocolVersion)       │
 *  [wireCrypt=DISABLE → no op_crypt]                                     │
 *  op_attach  ──────────────────────▶                                   │
 *             ◀────────────────────── op_response  (handle=42)          │
 *  op_detach  ──────────────────────▶                                   │
 *             ◀────────────────────── op_response  (success)            │
 *             ◀────────────────────── socket.end()                      │
 *                                                                        │
 * NOTE: client does not validate M2 content; any bytes are accepted ◀───┘
 *
 * Protocol version support (Firebird compatibility):
 *  FB3 → PROTOCOL_VERSION14  (0x800E = 32782)
 *  FB4 → PROTOCOL_VERSION16  (0x8010 = 32784)
 *  FB5 → PROTOCOL_VERSION17  (0x8011 = 32785) / PROTOCOL_VERSION18 (0x8012 = 32786)
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
const {XdrWriter, XdrReader, BlrWriter} = require('../lib/wire/serialize');
const srp      = require('../lib/srp');
const Firebird = require('../lib');
const Socket   = require('../lib/wire/socket');

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
// SRP wire-protocol frame builders
// ---------------------------------------------------------------------------

/**
 * Build an op_cond_accept frame with SRP challenge data (opcode 98).
 *
 * Wire format:
 *   int opcode(98)
 *   int protocolVersion
 *   int architecture
 *   int minType
 *   XDR array: BLR auth-data = [uint16LE saltLen][salt hex bytes]
 *                               [uint16LE keyLen][serverB hex bytes]
 *   XDR string: "Srp"
 *   int: is_authenticated = 0
 *   XDR string: "" (keys)
 *
 * @param {number} protocolVersion  e.g. Const.PROTOCOL_VERSION14/16/17
 * @param {string} salt             Hex-encoded salt string (e.g. 64 hex chars)
 * @param {object} serverB          BigInt server public key B
 */
function buildOpCondAcceptSRP(protocolVersion, salt, serverB) {
    const bHex    = srp.hexPad(serverB.toString(16));
    const saltHex = salt;

    // Build the BLR auth-data buffer: [u16LE saltLen][salt][u16LE keyLen][B]
    const authBlr = new BlrWriter(4 + saltHex.length + 4 + bHex.length);
    authBlr.addWord(saltHex.length);
    authBlr.ensure(saltHex.length);
    authBlr.buffer.write(saltHex, authBlr.pos, 'utf8');
    authBlr.pos += saltHex.length;
    authBlr.addWord(bHex.length);
    authBlr.ensure(bHex.length);
    authBlr.buffer.write(bHex, authBlr.pos, 'utf8');
    authBlr.pos += bHex.length;

    const w = new XdrWriter(256 + authBlr.pos);
    w.addInt(Const.op_cond_accept);
    w.addInt(protocolVersion);
    w.addInt(Const.ARCHITECTURE_GENERIC);
    w.addInt(Const.ptype_lazy_send);
    w.addBlr(authBlr);              // XDR array: BLR auth data
    w.addString('Srp', 'utf8');     // plugin name
    w.addInt(0);                    // is_authenticated = 0
    w.addString('', 'utf8');        // keys = ""
    return w.getData();
}

/**
 * Build the server-side op_cont_auth frame (opcode 92) carrying server proof M2.
 *
 * Wire format:
 *   int opcode(92)
 *   XDR array: M2 auth data bytes (may be empty for mock purposes)
 *   XDR string: plugin name "Srp"
 *   XDR string: plist ""
 *   XDR string: pkey  ""
 *
 * NOTE: The node-firebird client does NOT validate M2 content; it just waits
 * for the subsequent op_accept.  An empty array is therefore sufficient for
 * offline testing.
 *
 * @param {string} [m2Data]  Optional UTF-8 string payload for the M2 field.
 *                           Omit (or pass undefined) for an empty array.
 */
function buildOpContAuthServer(m2Data, pluginName) {
    const w = new XdrWriter(128);
    w.addInt(Const.op_cont_auth);
    if (m2Data) {
        // Write M2 as a length-prefixed XDR array (UTF-8 encoded)
        const m2Buf = Buffer.from(m2Data, 'utf8');
        const authBlr = new BlrWriter(m2Buf.length + 4);
        authBlr.ensure(m2Buf.length);
        m2Buf.copy(authBlr.buffer, authBlr.pos);
        authBlr.pos += m2Buf.length;
        w.addBlr(authBlr);
    } else {
        w.addInt(0);                // empty M2 array (length = 0)
    }
    w.addString(pluginName || 'Srp', 'utf8'); // plugin name
    w.addString('', 'utf8');        // plist
    w.addString('', 'utf8');        // pkey
    return w.getData();
}

/**
 * Build an op_accept frame (opcode 3) – sent after SRP mutual auth completes.
 *
 * Wire format:
 *   int opcode(3)
 *   int protocolVersion
 *   int architecture
 *   int minType
 */
function buildOpAccept(protocolVersion) {
    const w = new XdrWriter(16);
    w.addInt(Const.op_accept);
    w.addInt(protocolVersion || Const.PROTOCOL_VERSION14);
    w.addInt(Const.ARCHITECTURE_GENERIC);
    w.addInt(Const.ptype_lazy_send);
    return w.getData();
}

// ---------------------------------------------------------------------------
// Wire-protocol parsers (used by mock server to inspect client messages)
// ---------------------------------------------------------------------------

/**
 * Parse an op_connect message to extract the auth plugin name and the client's
 * SRP public key A (CNCT_specific_data BLR tag).
 *
 * op_connect XDR layout:
 *   int op_connect (1)
 *   int op_attach  (19)
 *   int CONNECT_VERSION3
 *   int ARCHITECTURE_GENERIC
 *   XDR string: database path
 *   int: protocol count
 *   XDR array: BLR data  ← parsed here
 *   [protocol entries: 5 ints each]
 *
 * BLR tag format:
 *   CNCT_login(9), CNCT_plugin_name(8), CNCT_plugin_list(10):
 *     byte tag, byte len, <len bytes>
 *   CNCT_specific_data(7)  – may be multi-chunk:
 *     byte tag, byte totalLen, byte step, <totalLen-1 bytes of chunk data>
 *   CNCT_client_crypt(11), CNCT_user(1), CNCT_host(4), CNCT_user_verification(6):
 *     byte tag, byte len, <len bytes>
 *
 * @param {Buffer} buf  Raw TCP bytes starting at the op_connect opcode.
 * @returns {{ pluginName, specificData, login }} or null on parse error.
 */
function parseOpConnect(buf) {
    try {
        const r = new XdrReader(buf);
        r.readInt();            // op_connect
        r.readInt();            // op_attach
        r.readInt();            // CONNECT_VERSION3
        r.readInt();            // ARCHITECTURE_GENERIC
        r.readString('utf8');   // database path
        r.readInt();            // protocol count
        const blrData = r.readArray();
        if (!blrData) return { pluginName: '', specificData: '', login: '' };

        const result = { pluginName: '', specificData: '', login: '' };
        const specificParts = {};
        let pos = 0;

        while (pos < blrData.length) {
            const tag = blrData[pos++];
            if (pos >= blrData.length) break;

            switch (tag) {
                case Const.CNCT_plugin_name: {          // 8
                    if (pos >= blrData.length) break;
                    const len = blrData[pos++];
                    if (pos + len > blrData.length) break;
                    result.pluginName = blrData.slice(pos, pos + len).toString('utf8');
                    pos += len;
                    break;
                }
                case Const.CNCT_login: {                // 9
                    if (pos >= blrData.length) break;
                    const len = blrData[pos++];
                    if (pos + len > blrData.length) break;
                    result.login = blrData.slice(pos, pos + len).toString('utf8');
                    pos += len;
                    break;
                }
                case Const.CNCT_plugin_list: {          // 10
                    if (pos >= blrData.length) break;
                    const len = blrData[pos++];
                    if (pos + len > blrData.length) break;
                    pos += len;
                    break;
                }
                case Const.CNCT_specific_data: {        // 7 – multiblock
                    if (pos >= blrData.length) break;
                    const totalLen = blrData[pos++];    // includes step byte
                    if (totalLen < 1) break;            // must include at least the step byte
                    const chunkLen = totalLen - 1;
                    if (pos >= blrData.length) break;   // need at least the step byte
                    const step     = blrData[pos++];
                    if (pos + chunkLen > blrData.length) break; // bounds check
                    specificParts[step] = blrData.slice(pos, pos + chunkLen).toString('utf8');
                    pos += chunkLen;
                    break;
                }
                case Const.CNCT_client_crypt:           // 11
                case Const.CNCT_user:                   // 1
                case Const.CNCT_host:                   // 4
                case Const.CNCT_user_verification: {    // 6
                    if (pos >= blrData.length) break;
                    const len = blrData[pos++];
                    if (pos + len > blrData.length) break; // bounds check
                    pos += len;
                    break;
                }
                default:
                    // Unknown tag – stop scanning BLR
                    pos = blrData.length;
                    break;
            }
        }

        // Reassemble CNCT_specific_data chunks in order
        const steps = Object.keys(specificParts).sort((a, b) => Number(a) - Number(b));
        result.specificData = steps.map(s => specificParts[s]).join('');
        return result;
    } catch (e) {
        return null;
    }
}

/**
 * Parse an op_cont_auth message to extract the client's M1 proof and plugin name.
 *
 * op_cont_auth XDR layout:
 *   int op_cont_auth (92)
 *   XDR array: M1 proof bytes (UTF-8 encoded hex string, e.g. "3f9a...")
 *   XDR string: plugin name
 *   XDR string: plugin list
 *   int: keys (0)
 *
 * The M1 proof is sent by the client as a hex-character string encoded as
 * UTF-8 bytes (so each byte is an ASCII hex character 0-9/a-f).  Reading it
 * with `toString('utf8')` therefore produces the hex string directly.
 *
 * @param {Buffer} buf  Raw TCP bytes starting at the op_cont_auth opcode.
 * @returns {{ m1Hex, pluginName }} or null on parse error.
 */
function parseOpContAuth(buf) {
    try {
        const r = new XdrReader(buf);
        r.readInt();                                    // op_cont_auth
        const authDataBuf = r.readArray();              // M1 proof as UTF-8 hex characters
        const pluginName  = r.readString('utf8');
        // The authDataBuf contains UTF-8 bytes of the hex string (e.g. "3f9a...")
        const m1Hex = authDataBuf ? authDataBuf.toString('utf8') : '';
        return { m1Hex, pluginName };
    } catch (e) {
        return null;
    }
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

/**
 * Full-buffer dispatcher: passes the entire accumulated buffer to the handler
 * so the handler can parse variable-length message fields (e.g. SRP auth data).
 *
 * handler(socket, opcode, fullBuf) must return the number of bytes consumed,
 * or 0 to wait for more data.  On loopback each client write is one logical
 * message, so handlers may safely return buf.length to consume everything.
 */
function makeFullDispatcher(socket, handler) {
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
            const opcode   = buf.readInt32BE(0);
            const consumed = handler(socket, opcode, buf);
            if (consumed <= 0) break;   // need more data
            buf = buf.slice(consumed);
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

/**
 * Attach via mock server using SRP plugin with wire-crypt disabled.
 * Wire-crypt must be disabled because the mock server does not implement
 * the Arc4 stream cipher – it responds in plaintext throughout.
 */
async function withMockSrpAttach(port) {
    return new Promise((resolve, reject) => {
        Firebird.attach({
            host:      '127.0.0.1',
            port,
            database:  '/mock/test.fdb',
            user:      'SYSDBA',
            password:  'masterkey',
            pluginName: Const.AUTH_PLUGIN_SRP,
            wireCrypt:  Const.WIRE_CRYPT_DISABLE,
        }, (err, d) => (err ? reject(err) : resolve(d)));
    });
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
// SRP Authentication – full offline protocol tests (FB3 / FB4 / FB5)
// ---------------------------------------------------------------------------

/**
 * Fixed test credentials and salt for deterministic SRP mock tests.
 * Using a fixed private key b on the server side ensures reproducible B values.
 */
const SRP_TEST_USER     = 'SYSDBA';
const SRP_TEST_PASSWORD = 'masterkey';
// 64-hex-char salt (32 bytes), same as test/srp.js TEST_SALT_1
const SRP_TEST_SALT     = 'a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e';

describe('Firebird SRP Authentication – offline protocol tests', function () {

    /**
     * Run a complete SRP auth cycle against a mock server using the given
     * Firebird protocol version.
     *
     * Protocol versions:
     *   PROTOCOL_VERSION14 (0x800E) → Firebird 3 baseline
     *   PROTOCOL_VERSION16 (0x8010) → Firebird 4
     *   PROTOCOL_VERSION17 (0x8011) → Firebird 5
     *   PROTOCOL_VERSION18 (0x8012) → Firebird 5.0
     */
    async function runSrpAuthCycle(protocolVersion) {
        // Pre-generate server keys once (deterministic: salt is fixed)
        const serverKeys = srp.serverSeed(SRP_TEST_USER, SRP_TEST_PASSWORD, SRP_TEST_SALT);

        // Build the op_cond_accept SRP challenge frame
        const challengeFrame = buildOpCondAcceptSRP(protocolVersion, SRP_TEST_SALT, serverKeys.public);

        let opConnectInfo   = null;  // parsed op_connect data
        let opContAuthInfo  = null;  // parsed op_cont_auth data
        const timings       = {};    // phase → ms timestamps (for FIREBIRD_DEBUG)

        const { server, port } = await startMockServer(socket => {
            let state = 'init';

            makeFullDispatcher(socket, (s, opcode, buf) => {
                const now = Date.now();

                if (opcode === Const.op_connect) {
                    // Parse client public key A from op_connect BLR
                    opConnectInfo = parseOpConnect(buf);
                    state = 'challenge_sent';
                    timings.opConnectRecv = now;

                    if (process.env.FIREBIRD_DEBUG) {
                        const aSnip = opConnectInfo && opConnectInfo.specificData.slice(0, 16);
                        console.log('[mock-debug] op_connect: plugin=%s A[0:16]=%s',
                            opConnectInfo && opConnectInfo.pluginName, aSnip);
                    }

                    s.write(challengeFrame);
                    timings.challengeSent = Date.now();
                    return buf.length;

                } else if (opcode === Const.op_cont_auth && state === 'challenge_sent') {
                    // Parse M1 proof from op_cont_auth
                    opContAuthInfo = parseOpContAuth(buf);
                    state = 'auth_complete';
                    timings.m1Recv = now;

                    if (process.env.FIREBIRD_DEBUG) {
                        const m1Snip = opContAuthInfo && opContAuthInfo.m1Hex.slice(0, 16);
                        console.log('[mock-debug] op_cont_auth: plugin=%s M1[0:16]=%s',
                            opContAuthInfo && opContAuthInfo.pluginName, m1Snip);
                    }

                    // Send server proof M2 (empty) + op_accept in a single write
                    const reply = Buffer.concat([
                        buildOpContAuthServer(),
                        buildOpAccept(protocolVersion),
                    ]);
                    s.write(reply);
                    timings.acceptSent = Date.now();
                    return buf.length;

                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    timings.opAttachRecv = now;
                    s.write(buildOpResponse(42));
                    return buf.length;

                } else if (opcode === Const.op_detach) {
                    timings.opDetachRecv = now;
                    s.write(buildOpResponse(0));
                    s.end();
                    return buf.length;

                } else {
                    // Unknown opcode – consume whole buffer
                    return buf.length;
                }
            });
        });

        try {
            const t0 = Date.now();
            const db = await withMockSrpAttach(port);

            if (process.env.FIREBIRD_DEBUG) {
                console.log('[mock-debug] SRP proto=0x%x attach in %dms timings=%j',
                    protocolVersion, Date.now() - t0, timings);
            }

            assert.ok(db, 'db should be returned after SRP auth');
            assert.ok(opConnectInfo, 'op_connect should have been parsed');
            assert.strictEqual(opConnectInfo.pluginName, 'Srp', 'plugin name should be Srp');
            assert.ok(opConnectInfo.specificData.length > 0, 'client public key A should be non-empty');
            assert.ok(opContAuthInfo, 'op_cont_auth should have been parsed');
            assert.strictEqual(opContAuthInfo.pluginName, 'Srp', 'M1 plugin name should be Srp');
            assert.ok(opContAuthInfo.m1Hex.length > 0, 'client M1 proof should be non-empty');

            await new Promise((resolve, reject) =>
                db.detach(e => (e ? reject(e) : resolve())));
        } finally {
            await stopMockServer(server);
        }
    }

    it('should complete full SRP auth exchange – protocol 14 (FB3 baseline)', async function () {
        await runSrpAuthCycle(Const.PROTOCOL_VERSION14);
    });

    it('should complete full SRP auth exchange – protocol 16 (FB4)', async function () {
        await runSrpAuthCycle(Const.PROTOCOL_VERSION16);
    });

    it('should complete full SRP auth exchange – protocol 17 (FB5)', async function () {
        await runSrpAuthCycle(Const.PROTOCOL_VERSION17);
    });

    it('should complete full SRP auth exchange – protocol 18 (FB5)', async function () {
        await runSrpAuthCycle(Const.PROTOCOL_VERSION18);
    });

    /**
     * Firebird 4/5 chained-auth: after the client sends SRP M1, the server
     * sends op_cont_auth with Legacy_Auth (not Srp), then the client responds
     * with Legacy_Auth credentials, then the server sends op_accept.
     */
    it('should handle SRP + Legacy_Auth chained-auth (Firebird 4/5 behaviour) – protocol 16', async function () {
        const protocolVersion = Const.PROTOCOL_VERSION16;
        const serverKeys = srp.serverSeed(SRP_TEST_USER, SRP_TEST_PASSWORD, SRP_TEST_SALT);
        const challengeFrame = buildOpCondAcceptSRP(protocolVersion, SRP_TEST_SALT, serverKeys.public);

        let legacyAuthReceived = false;

        const { server, port } = await startMockServer(socket => {
            let state = 'init';
            makeFullDispatcher(socket, (s, opcode, buf) => {
                if (opcode === Const.op_connect) {
                    state = 'challenge_sent';
                    s.write(challengeFrame);
                    return buf.length;

                } else if (opcode === Const.op_cont_auth && state === 'challenge_sent') {
                    // Client sends SRP M1 – server responds with Legacy_Auth continuation
                    state = 'legacy_auth_sent';
                    s.write(buildOpContAuthServer(null, 'Legacy_Auth'));
                    return buf.length;

                } else if (opcode === Const.op_cont_auth && state === 'legacy_auth_sent') {
                    // Client sends Legacy_Auth credentials – server responds with op_accept
                    legacyAuthReceived = true;
                    state = 'auth_complete';
                    s.write(buildOpAccept(protocolVersion));
                    return buf.length;

                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    s.write(buildOpResponse(42));
                    return buf.length;

                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                    return buf.length;
                }
                return buf.length;
            });
        });

        try {
            const db = await withMockSrpAttach(port);
            assert.ok(db, 'db should be returned after chained SRP+Legacy_Auth auth');
            assert.ok(legacyAuthReceived, 'client should have sent Legacy_Auth credentials after SRP M1');
            await new Promise((resolve, reject) =>
                db.detach(e => (e ? reject(e) : resolve())));
        } finally {
            await stopMockServer(server);
        }
    });

    it('should parse op_connect BLR and extract Srp plugin name and client key A', async function () {
        // Use a loopback server solely to capture the raw op_connect bytes
        let capturedBuf = null;

        const { server, port } = await startMockServer(socket => {
            let sawConnect = false;
            makeFullDispatcher(socket, (s, opcode, buf) => {
                if (opcode === Const.op_connect && !sawConnect) {
                    sawConnect = true;
                    capturedBuf = Buffer.from(buf); // snapshot before clearing
                    // Respond with Legacy_Auth accept_data so attach() can complete
                    s.write(buildOpAcceptData('Legacy_Auth'));
                    return buf.length;
                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    s.write(buildOpResponse(42));
                    return buf.length;
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                    return buf.length;
                }
                return buf.length;
            });
        });

        try {
            const db = await new Promise((resolve, reject) => {
                Firebird.attach({
                    host: '127.0.0.1', port,
                    database: '/mock/test.fdb',
                    user: 'SYSDBA', password: 'masterkey',
                    pluginName: Const.AUTH_PLUGIN_SRP,
                    wireCrypt: Const.WIRE_CRYPT_DISABLE,
                }, (err, d) => (err ? reject(err) : resolve(d)));
            });

            assert.ok(capturedBuf, 'op_connect should have been captured');

            const parsed = parseOpConnect(capturedBuf);
            assert.ok(parsed, 'BLR parser should succeed');
            assert.strictEqual(parsed.pluginName, 'Srp', 'plugin name extracted from BLR');
            assert.strictEqual(parsed.login, 'SYSDBA', 'login extracted from BLR');
            assert.ok(parsed.specificData.length > 0, 'client public key A should be present in BLR');
            // A is a 1024-bit hex number → 1–256 hex chars
            assert.ok(parsed.specificData.length <= 256, 'client public key A is at most 256 hex chars');
            assert.ok(/^[0-9a-f]+$/i.test(parsed.specificData), 'client public key A is valid hex');

            await new Promise((resolve, reject) => db.detach(e => (e ? reject(e) : resolve())));
        } finally {
            await stopMockServer(server);
        }
    });

    it('should extract M1 proof from op_cont_auth via parseOpContAuth', async function () {
        let capturedM1  = null;
        let capturedPlugin = null;

        const serverKeys      = srp.serverSeed(SRP_TEST_USER, SRP_TEST_PASSWORD, SRP_TEST_SALT);
        const challengeFrame  = buildOpCondAcceptSRP(Const.PROTOCOL_VERSION14, SRP_TEST_SALT, serverKeys.public);

        const { server, port } = await startMockServer(socket => {
            let state = 'init';
            makeFullDispatcher(socket, (s, opcode, buf) => {
                if (opcode === Const.op_connect) {
                    state = 'challenge_sent';
                    s.write(challengeFrame);
                    return buf.length;
                } else if (opcode === Const.op_cont_auth && state === 'challenge_sent') {
                    const parsed = parseOpContAuth(buf);
                    capturedM1     = parsed && parsed.m1Hex;
                    capturedPlugin = parsed && parsed.pluginName;
                    // Send M2 + op_accept so the client can proceed
                    s.write(Buffer.concat([
                        buildOpContAuthServer(),
                        buildOpAccept(Const.PROTOCOL_VERSION14),
                    ]));
                    state = 'auth_done';
                    return buf.length;
                } else if (opcode === Const.op_attach || opcode === Const.op_create) {
                    s.write(buildOpResponse(42));
                    return buf.length;
                } else if (opcode === Const.op_detach) {
                    s.write(buildOpResponse(0));
                    s.end();
                    return buf.length;
                }
                return buf.length;
            });
        });

        try {
            const db = await withMockSrpAttach(port);
            await new Promise((resolve, reject) => db.detach(e => (e ? reject(e) : resolve())));

            assert.ok(capturedM1, 'M1 proof should have been captured');
            assert.ok(capturedM1.length > 0, 'M1 proof should be non-empty hex string');
            assert.ok(/^[0-9a-f]+$/i.test(capturedM1), 'M1 should be valid hex');
            assert.strictEqual(capturedPlugin, 'Srp', 'plugin should be Srp');
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

    // -----------------------------------------------------------------------
    // New round-trip tests for SRP wire frames
    // -----------------------------------------------------------------------

    it('should encode op_cond_accept (SRP) with correct opcode and is_authenticated=0', function () {
        const serverKeys = srp.serverSeed(SRP_TEST_USER, SRP_TEST_PASSWORD, SRP_TEST_SALT);
        const frame = buildOpCondAcceptSRP(Const.PROTOCOL_VERSION14, SRP_TEST_SALT, serverKeys.public);
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_cond_accept);   // opcode = 98
        assert.strictEqual(r.readInt(), Const.PROTOCOL_VERSION14); // protocol
        assert.strictEqual(r.readInt(), Const.ARCHITECTURE_GENERIC);
        assert.strictEqual(r.readInt(), Const.ptype_lazy_send);
        const authData = r.readArray();                           // BLR auth data
        assert.ok(authData && authData.length > 0, 'auth data should be non-empty');
        // Verify BLR format: [uint16LE saltLen][salt][uint16LE keyLen][B]
        const saltLen = authData.readUInt16LE(0);
        assert.strictEqual(saltLen, SRP_TEST_SALT.length, 'salt length in BLR');
        const saltExtracted = authData.slice(2, 2 + saltLen).toString('utf8');
        assert.strictEqual(saltExtracted, SRP_TEST_SALT, 'salt value in BLR');
        const keyOffset = 2 + saltLen;
        const keyLen = authData.readUInt16LE(keyOffset);
        assert.ok(keyLen > 0, 'server B key length should be positive');
        assert.strictEqual(r.readString('utf8'), 'Srp', 'plugin name');
        assert.strictEqual(r.readInt(), 0, 'is_authenticated = 0');
        assert.strictEqual(r.readString('utf8'), '', 'keys = empty');
    });

    it('should encode op_cont_auth (server) with correct opcode and empty M2', function () {
        const frame = buildOpContAuthServer();
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_cont_auth);     // opcode = 92
        const m2 = r.readArray();                                 // M2 array (empty)
        assert.ok(!m2, 'empty M2 array should be falsy');
        assert.strictEqual(r.readString('utf8'), 'Srp');          // plugin name
    });

    it('should encode op_accept (post-SRP) with correct opcode and protocol version', function () {
        const frame = buildOpAccept(Const.PROTOCOL_VERSION16);
        const r = new XdrReader(frame);
        assert.strictEqual(r.readInt(), Const.op_accept);          // opcode = 3
        assert.strictEqual(r.readInt(), Const.PROTOCOL_VERSION16); // protocol
        assert.strictEqual(r.readInt(), Const.ARCHITECTURE_GENERIC);
        assert.strictEqual(r.readInt(), Const.ptype_lazy_send);
    });

    it('should define SRP protocol version constants', function () {
        assert.strictEqual(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_MASK, 14);
        assert.strictEqual(Const.PROTOCOL_VERSION16 & Const.FB_PROTOCOL_MASK, 16);
        assert.strictEqual(Const.PROTOCOL_VERSION17 & Const.FB_PROTOCOL_MASK, 17);
        assert.strictEqual(Const.PROTOCOL_VERSION18 & Const.FB_PROTOCOL_MASK, 18);
    });
});

// ---------------------------------------------------------------------------
// Regression test: Socket deferred-write accumulation (Issue #411 / PR #412)
// ---------------------------------------------------------------------------
//
// Bug: Socket.write(data, defer=true) overwrote this.buffer instead of
// appending to it.  When two deferred packets were written back-to-back
// (op_close_blob then op_free_statement) the first was silently discarded,
// leaving the request/response queue one entry short.  Every subsequent
// operation was then matched to the wrong callback, causing the connection to
// hang forever after any SELECT that returned a non-null BLOB column.
//
// Fix: accumulate deferred packets with Buffer.concat so that a non-deferred
// flush sends ALL of them together.
//
// These tests call Socket.write() directly on a bare prototype instance
// (bypassing the constructor's net.createConnection) so that they run fully
// offline and deterministically.

describe('Socket – deferred write accumulation (regression #411)', function () {

    /**
     * Build a minimal Socket instance without opening a real TCP connection.
     * Writes to the underlying socket are captured in `written[]`.
     */
    function makeBareSocket() {
        const written = [];
        const fakeUnderlying = {
            setNoDelay: () => {},
            on: () => {},
            write: (data) => written.push(Buffer.from(data)),
        };

        const instance = Object.create(Socket.prototype);
        instance._socket        = fakeUnderlying;
        instance.buffer         = null;
        instance.compress       = false;
        instance.encrypt        = false;
        instance.compressor     = null;
        instance.decompressor   = null;
        instance.compressorBuffer   = [];
        instance.decompressorBuffer = [];
        instance.encryptCipher  = null;
        instance.decryptCipher  = null;

        return { instance, written };
    }

    it('should accumulate multiple consecutive deferred writes and flush all at once', function () {
        const { instance, written } = makeBareSocket();

        // Simulate op_close_blob (deferred) followed by op_free_statement
        // (deferred) – exactly the sequence that triggered the bug.
        const pkt1 = Buffer.from('OP_CLOSE_BLOB');
        const pkt2 = Buffer.from('OP_FREE_STMT');
        const pkt3 = Buffer.from('OP_ALLOC_STMT');

        instance.write(pkt1, true);   // defer – stored in socket.buffer
        instance.write(pkt2, true);   // defer – must ACCUMULATE, not overwrite
        instance.write(pkt3, false);  // flush – send accumulated buffer + pkt3

        assert.strictEqual(written.length, 1,
            'all accumulated packets should be sent in a single write on flush');

        const expected = Buffer.concat([pkt1, pkt2, pkt3]);
        assert.ok(
            written[0].equals(expected),
            'Expected ' + expected.toString() + ' but got ' + written[0].toString() +
            ' — pkt1 was dropped (deferred writes overwriting instead of accumulating)'
        );
    });

    it('should clear the deferred buffer after a flush (no double-send)', function () {
        const { instance, written } = makeBareSocket();

        const pkt1 = Buffer.from('DEFERRED_A');
        const pkt2 = Buffer.from('FLUSH_B');
        const pkt3 = Buffer.from('DIRECT_C');

        // First flush: accumulated pkt1 + pkt2
        instance.write(pkt1, true);
        instance.write(pkt2, false);

        // Second standalone write: only pkt3 — pkt1 must NOT be re-sent.
        instance.write(pkt3, false);

        assert.strictEqual(written.length, 2,
            'should produce exactly two socket writes: one flush and one direct');

        const expected1 = Buffer.concat([pkt1, pkt2]);
        const expected2 = pkt3;

        assert.ok(written[0].equals(expected1),
            'first write should be ' + expected1.toString());
        assert.ok(written[1].equals(expected2),
            'second write should be ' + expected2.toString() +
            ' (pkt1 must not be re-sent after flush)');
    });

    it('should handle a single deferred write followed by a flush', function () {
        const { instance, written } = makeBareSocket();

        const pkt1 = Buffer.from('ONLY_DEFERRED');
        const pkt2 = Buffer.from('FLUSH_DATA');

        instance.write(pkt1, true);
        instance.write(pkt2, false);

        assert.strictEqual(written.length, 1);
        const expected = Buffer.concat([pkt1, pkt2]);
        assert.ok(written[0].equals(expected));
    });

    it('should send a non-deferred write immediately when no buffer is pending', function () {
        const { instance, written } = makeBareSocket();

        const pkt = Buffer.from('IMMEDIATE');
        instance.write(pkt, false);

        assert.strictEqual(written.length, 1);
        assert.ok(written[0].equals(pkt));
    });

});
