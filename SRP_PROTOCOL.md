# Firebird SRP Authentication Protocol

## Overview

Firebird uses **Secure Remote Password (SRP)** authentication for all connections that do not use the legacy wire-encryption scheme (`Legacy_Auth`). SRP provides password-authenticated key agreement: neither side ever sends the plaintext password over the wire, and both sides prove knowledge of the password without revealing it.

- **Firebird 3** introduced SRP (`Srp` plugin, SHA-1 HMAC, Protocol Version 14).
- **Firebird 4** added `Srp256` (SHA-256 HMAC, Protocol Version 16) and kept `Srp` as fallback.
- **Firebird 5** uses Protocol Version 17 with the same plugin set as FB4, plus optional wire compression.
- **Firebird 6** (in development) continues Protocol Version 17 and retains full backward compatibility.

---

## SRP Concepts

| Term | Meaning |
|---|---|
| `N` | A large 1024-bit prime (the SRP group parameter, same for all Firebird versions) |
| `g` | Generator `2` |
| `k` | Multiplier parameter derived from `N` and `g` |
| `s` | Random salt stored in the security database |
| `v` | Verifier: `g^x mod N`, where `x = H(s, H(U:p))` |
| `a`, `A` | Client private/public ephemeral keys: `A = g^a mod N` |
| `b`, `B` | Server private/public ephemeral keys: `B = kv + g^b mod N` |
| `u` | Scrambler: `H(A, B)` |
| `K` | Session key derived by both sides |
| `M1` | Client proof: `H(H(N)⊕H(g), H(I), s, A, B, K)` |
| `M2` | Server proof: `H(A, M1, K)` (client may or may not verify this) |

The SRP group parameters are shared constants defined in `lib/srp.js`:

```
N = E67D2E994B2F900C3F41F08F5BB2627ED0D49EE1FE767A52EFCD565CD6E768812C3E1E9CE8F0A8BEA6CB13CD29DDEBF7A96D4A93B55D488DF099A15C89DCB0640738EB2CBDD9A8F7BAB561AB1B0DC1C6CDABF303264A08D1BCA932D1F1EE428B619D970F342ABA9A65793B8B2F041AE5364350C16F735F56ECBCA87BD57B29E7
g = 2
k = 1277432915985975349439481660349303019122249719989
```

> **Important exponent reduction note**: The Firebird engine reduces intermediate SRP exponents modulo N, which deviates from the SRP specification. `node-firebird` mirrors this behaviour in `lib/srp.js` so that client and server agree on the session key `K`.

---

## Protocol Version Matrix

| Firebird Version | Wire Protocol | Auth Plugin | Hash | `op_accept_data` opcode | `op_cond_accept` opcode |
|---|---|---|---|---|---|
| 2.5 | 13 | `Legacy_Auth` | DES crypt | 94 | — |
| 3.x | 14 (`0x800E`) | `Srp` | SHA-1 | 94 | 98 |
| 4.x | 16 (`0x8010`) | `Srp`, `Srp256` | SHA-1 / SHA-256 | 94 | 98 |
| 5.x | 17 (`0x8011`) | `Srp`, `Srp256` | SHA-1 / SHA-256 | 94 | 98 |

The high bit of the protocol version number (`0x8000`) is the **Firebird private flag**: it prevents ambiguity with Borland InterBase protocol numbers (protocols 1–13).

---

## Wire-Protocol Sequence Diagrams

### Legacy Auth (no SRP, `is_authenticated = 1`)

```
Client                                         Server
──────                                         ──────
op_connect (plugin=Legacy_Auth, A=hash(pw))
  ─────────────────────────────────────────────▶
                          op_accept_data (is_authenticated=1)
  ◀─────────────────────────────────────────────
op_attach (database, DPB)
  ─────────────────────────────────────────────▶
                          op_response (dbHandle)
  ◀─────────────────────────────────────────────
```

### SRP Auth (FB3 Protocol 14 / FB4 Protocol 16 / FB5 Protocol 17)

```
Client                                         Server
──────                                         ──────
1. op_connect
     plugin  = "Srp" (or "Srp256")
     A       = clientPublicKey (hex)
  ─────────────────────────────────────────────▶

                          2. op_cond_accept (opcode 98)
                               BLR auth data:
                                 [uint16LE saltLen][salt hex]
                                 [uint16LE keyLen ][B hex   ]
                               plugin = "Srp"
                               is_authenticated = 0
  ◀─────────────────────────────────────────────

3. Client computes:
     u  = SHA1(pad(A), pad(B))
     x  = SHA1(salt, SHA1(U + ':' + password))
     S  = (B - k·g^x)^(a + u·x) mod N
     K  = SHA1(S)
     M1 = SHA1(SHA1(N)⊕SHA1(g), SHA1(user), salt, A, B, K)

4. op_cont_auth (opcode 92)
     auth_data = M1 (hex)
     plugin    = "Srp"
  ─────────────────────────────────────────────▶

                          5. Server verifies M1, computes M2
                          op_cont_auth (opcode 92)
                               auth_data = M2 (server proof, may be empty)
                               plugin = "Srp"
  ◀─────────────────────────────────────────────

                          6. op_accept (opcode 3)
                               protocolVersion = 0x800E / 0x8010 / 0x8011
  ◀─────────────────────────────────────────────

[If wireCrypt ≠ DISABLE]:
7. op_crypt (opcode 96) "Arc4"
  ─────────────────────────────────────────────▶
                          op_response
  ◀─────────────────────────────────────────────
     Both sides enable Arc4 stream cipher using
     session key K (padded to 20 bytes / SHA-1 length)

8. op_attach (database, DPB)
  ─────────────────────────────────────────────▶
                          op_response (dbHandle)
  ◀─────────────────────────────────────────────
```

### SRP256 (Srp256 plugin — FB4/FB5 only)

The wire sequence is identical to SRP (above). The only difference is:

- The hash algorithm for `M1` / `M2` computation switches from **SHA-1** to **SHA-256**.
- The plugin name in `op_cond_accept` is `"Srp256"` instead of `"Srp"`.

---

## Changes Per Firebird Version

### Firebird 3 (Protocol 14, plugin `Srp`)

- Introduced the SRP authentication framework.
- Hash algorithm for `M1` and `M2`: **SHA-1**.
- Arc4 stream cipher for wire encryption.
- Auth data encoding: BLR byte array inside `op_cond_accept`.
- No wire compression support.

### Firebird 4 (Protocol 16, plugins `Srp256` and `Srp`)

- Added `Srp256` plugin with **SHA-256** hashing (preferred).
- Falls back to `Srp` (SHA-1) if the server does not offer `Srp256`.
- Wire compression support added (`pflag_compress` in protocol negotiation).
- `op_response_piggyback` (opcode 72) introduced — server sends this as an unsolicited completion notification; clients must silently discard it.

### Firebird 5 (Protocol 17, plugins `Srp256` and `Srp`)

- Protocol version bumped to 17 (`0x8011`).
- Wire protocol is otherwise compatible with Protocol 16.
- `op_response_piggyback` usage more prevalent during `EventConnection` teardown.
- BigInt arithmetic in SRP key generation can be significantly **slower** on resource-constrained CI runners (see [Timing Issue](#timing-issue-and-fix) below).

### Firebird 6 (Protocol 17, in development)

- Retains Protocol Version 17.
- Continues to support `Srp256` and `Srp` plugins.
- No client-visible protocol changes from Firebird 5 at this time.

---

## Timing Issue and Fix

### Root Cause

SRP key generation involves **modular exponentiation** over 1024-bit integers. In Node.js, this is performed by the `big-integer` library using pure-JavaScript arithmetic. On a developer machine the `clientSeed()` call completes in < 1 ms and `clientProof()` in < 5 ms. On a loaded CI runner (especially with Firebird 3 which uses SHA-1 requiring more steps), both calls can take **500–3000 ms** combined.

The original per-test timeout was 10 s → raised to 30 s → **raised to 60 s** (current) to handle the worst-case loaded runner scenario.

### How to Diagnose

Set the environment variable `FIREBIRD_DEBUG=1` before running your tests. You will see:

```
[fb-debug] srp.clientSeed: 843ms
[fb-debug] srp.clientProof(sha1): 1247ms
```

- `srp.clientSeed` measures the time to generate the client ephemeral key pair `(a, A = g^a mod N)`.
- `srp.clientProof(sha1|sha256)` measures the time to derive `K` and compute `M1`.

If these values exceed 4000 ms combined, the 60-second timeout may still be too tight on extremely loaded runners. In that case, increase the `it(…, { timeout: … })` value in `test/index.js` for the SRP tests.

### The Fix

`test/index.js`:
```js
it('should attach with srp plugin', { timeout: 60000 }, async function () { … });
```

### SRP Timing Debug Logs (in `lib/wire/connection.js`)

```js
// clientSeed — key pair generation
const _t0 = Date.now();
this.clientKeys = srp.clientSeed();
if (process.env.FIREBIRD_DEBUG) {
    console.log('[fb-debug] srp.clientSeed: %dms', Date.now() - _t0);
}

// clientProof — session key + M1 computation
const _t1 = Date.now();
var proof = srp.clientProof(user, password, salt, A, B, a, hashAlgo);
if (process.env.FIREBIRD_DEBUG) {
    console.log('[fb-debug] srp.clientProof(%s): %dms', accept.srpAlgo, Date.now() - _t1);
}
```

---

## Session Key Arc4 Encryption

After the SRP handshake, both the client and server share the session key `K = SHA1(S)`. This key is a 160-bit (20-byte) SHA-1 hash returned as a BigInt from `srp.clientProof()`.

The key is used to initialise an **Arc4 (RC4)** stream cipher for all subsequent bytes on the socket. A critical padding rule applies:

```js
// K is a BigInt; BigInt.toString(16) may omit leading zeros
// Arc4 requires exactly 20 bytes (SHA-1 output length)
var keyBuf = Buffer.from(ret.sessionKey.toString(16).padStart(40, '0'), 'hex');
//                                                    ^^^^^^^^^^^^^^^^^^^
//                  without this, a K with a leading 0x00 byte will be only
//                  19 bytes, causing a key mismatch and a garbled connection
self._socket.enableEncryption(keyBuf);
```

> **Bug fixed (commit `fc0021d`)**: the `padStart(40, '0')` call was missing. A session key whose most-significant byte was `0x00` would produce a 19-byte (or shorter) key, while the Firebird server always uses the full 20 bytes. This caused connection corruption for ~1 in 256 SRP sessions.

---

## How to Run the Online SRP Test

Requires a real Firebird server with:
- `AuthServer = Srp` (or `Srp256`) configured in `firebird.conf`
- A user `SYSDBA` with password `masterkey` (or adjust `test/config.js`)

```bash
# Basic run
npm test

# With debug logging
FIREBIRD_DEBUG=1 npm test -- --grep "srp"
```

The test verifies:
1. `Firebird.attach()` succeeds using SRP.
2. The `'attach'` driver event fires exactly once.
3. `db.detach()` succeeds cleanly.

---

## How to Run the Offline SRP Mock-Server Tests

No Firebird installation required.

```bash
# Run only the offline tests
npx vitest run test/mock-server.js

# With debug timing output
FIREBIRD_DEBUG=1 npx vitest run test/mock-server.js
```

The offline tests use `test/mock-server.js`, which contains a minimal TCP server that speaks enough of the Firebird wire protocol to exercise the full SRP handshake.

### Covered Scenarios

| Test | Protocol | What is verified |
|---|---|---|
| Full SRP attach/detach (FB3) | 14 (`Srp`) | Complete op_connect → op_cond_accept → op_cont_auth → op_accept → op_attach cycle |
| Full SRP attach/detach (FB4) | 16 (`Srp`) | Same flow with Protocol 16 |
| Full SRP attach/detach (FB5) | 17 (`Srp`) | Same flow with Protocol 17 |
| `parseOpConnect` BLR | any | Extracts plugin name `"Srp"` and client key A from `CNCT_specific_data` multi-block |
| `parseOpContAuth` | any | Extracts M1 hex proof from client `op_cont_auth` message |
| `op_cond_accept` XDR round-trip | 14 | BLR format: `[u16LE saltLen][salt][u16LE keyLen][B]` |
| `op_cont_auth` XDR round-trip | any | Correct opcode, empty M2 array, plugin name |
| `op_accept` XDR round-trip | 16 | Correct opcode and protocol version field |
| Protocol version constants | 14/16/17 | `FB_PROTOCOL_FLAG`, `FB_PROTOCOL_MASK` |

### SRP Phase Timing (FIREBIRD_DEBUG)

When `FIREBIRD_DEBUG=1` is set, each SRP mock-server test emits a timing trace:

```
[srp-test fb3] opConnectRecv=2ms challengeSent=847ms m1Recv=2094ms acceptSent=2094ms opAttachRecv=2095ms
```

Fields:
- `opConnectRecv` — server received `op_connect` from client
- `challengeSent` — server sent `op_cond_accept` (salt + B)
- `m1Recv` — server received `op_cont_auth` (M1 proof)
- `acceptSent` — server sent `op_cont_auth` (M2) + `op_accept`
- `opAttachRecv` — server received `op_attach`

The gap between `opConnectRecv` and `challengeSent` is the server-side `srp.serverSeed()` time; the gap between `challengeSent` and `m1Recv` is the client-side `srp.clientSeed()` + `srp.clientProof()` time.

---

## BLR Auth Data Format in `op_cond_accept`

The `op_cond_accept` (opcode 98) frame carries the SRP challenge in a **BLR byte array** field. The format is:

```
Offset   Size  Field
──────   ────  ─────
0        2     saltLen  (uint16 little-endian) — length of the salt hex string
2        N     salt     (ASCII hex string, N = saltLen bytes)
2+N      2     keyLen   (uint16 little-endian) — length of the server B hex string
4+N      M     B        (ASCII hex string, M = keyLen bytes)
```

Example:
```
00 40    → saltLen = 64 (32 bytes of salt → 64 hex chars)
3031323334...  → 64 ASCII hex characters of salt
00 80    → keyLen = 128 (64 bytes of B → 128 hex chars)
61626364...  → 128 ASCII hex characters of B
```

`node-firebird` parses this in `lib/wire/connection.js`:
```js
var saltLen = d.buffer.readUInt16LE(0);
var keyLen  = d.buffer.readUInt16LE(saltLen + 2);
var keyStart = saltLen + 4;
cnx.serverKeys = {
    salt:   d.buffer.slice(2, saltLen + 2).toString('utf8'),
    public: BigInt(d.buffer.slice(keyStart).toString('utf8'), 16)
};
```

---

## `op_cont_auth` Client Message Format

The client sends `op_cont_auth` (opcode 92) with:

```
Field           XDR type   Content
──────────────  ────────   ───────────────────────────────
opcode          int32      92 (op_cont_auth)
auth_data       array      M1 proof as ASCII hex string
plugin_name     string     "Srp" or "Srp256"
plist           string     "" (empty)
pkey            string     "" (empty)
```

---

## `op_cont_auth` Server Response Format

The server replies with `op_cont_auth` (opcode 92) carrying M2:

```
Field           XDR type   Content
──────────────  ────────   ────────────────────────────────
opcode          int32      92 (op_cont_auth)
auth_data       array      M2 server proof (may be empty)
plugin_name     string     "Srp" or "Srp256"
plist           string     "" (empty)
pkey            string     "" (empty)
```

> **node-firebird does NOT validate M2**. After receiving the server `op_cont_auth`, it simply waits for the subsequent `op_accept`. This is safe for practical use but means a compromised server could send any M2 value.

---

## Offline Mock-Server Architecture

```
┌─────────────────────────────────────────────────────────┐
│ test/mock-server.js                                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Frame Builders (XdrWriter / BlrWriter)            │  │
│  │  buildOpAcceptData(plugin)                        │  │
│  │  buildOpResponse(handle)                          │  │
│  │  buildOpEvent(dbHandle, eventRid)                 │  │
│  │  buildOpResponsePiggyback()                       │  │
│  │  buildOpCondAcceptSRP(proto, salt, B)             │  │
│  │  buildOpContAuthServer(m2Data)                    │  │
│  │  buildOpAccept(proto)                             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Frame Parsers                                     │  │
│  │  parseOpConnect(buf)  — BLR parser                │  │
│  │  parseOpContAuth(buf) — M1 extractor              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Server Helpers                                    │  │
│  │  startMockServer() / stopMockServer()             │  │
│  │  makeDispatcher(port, handler)                    │  │
│  │  makeFullDispatcher(port, handler)                │  │
│  │  withMockAttach(port) / withMockDetach(db)        │  │
│  │  withMockSrpAttach(port, proto?)                  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
           │ TCP loopback
           ▼
┌─────────────────────────────────────────────────────────┐
│ lib/wire/connection.js  (Connection class)              │
│  connect() → decodeResponse() → attach() → detach()    │
└─────────────────────────────────────────────────────────┘
```

---

## Related Files

| File | Description |
|---|---|
| `lib/srp.js` | Pure-JS SRP implementation (BigInt arithmetic, SHA-1/SHA-256 hashing) |
| `lib/wire/connection.js` | Wire protocol encode/decode; SRP handshake; debug logging |
| `lib/wire/const.js` | Protocol version constants, opcode numbers, auth plugin names |
| `lib/wire/serialize.js` | `XdrWriter`, `XdrReader`, `BlrWriter`, `BlrReader` |
| `test/srp.js` | Unit tests for SRP arithmetic helpers and end-to-end handshake |
| `test/mock-server.js` | Offline wire-protocol tests (SRP auth + queue integrity) |
| `test/index.js` | Online integration tests (real Firebird server required) |
| `BIGINT_MIGRATION.md` | Migration guide: `big-integer` → native `BigInt` (root-cause analysis, modPow docs, performance) |

---

## Troubleshooting

### `should attach with srp plugin` times out in CI

1. Set `FIREBIRD_DEBUG=1` and check the timing logs:
   ```
   [fb-debug] srp.clientSeed: Xms
   [fb-debug] srp.clientProof(sha1): Yms
   ```
2. If `X + Y > 5000`, the runner is overloaded. Increase the timeout in `test/index.js`:
   ```js
   it('should attach with srp plugin', { timeout: 120000 }, async function () { … });
   ```
3. Alternatively, run the tests at off-peak times or use a dedicated runner.

### Connection succeeds but data is garbled (after SRP)

Most likely cause: session key padding bug. Verify `lib/wire/connection.js` has:
```js
var keyBuf = Buffer.from(ret.sessionKey.toString(16).padStart(40, '0'), 'hex');
```
If the `padStart(40, '0')` is absent, keys with a leading zero byte will be truncated.

### `op_response_piggyback` causes queue corruption (Firebird 5)

Fixed in `lib/wire/connection.js`. Verify the `decodeResponse` switch statement has:
```js
case Const.op_response_piggyback:
    parseOpResponse(data, {}, cb);
    return { _isOpEvent: true };  // skip queue shift
```

### `op_event` on main connection causes hang

Fixed in `lib/wire/connection.js`. Verify:
```js
case Const.op_event:
    data.readInt();     // db handle
    data.readArray();   // EPB
    data.readInt64();   // AST pointer
    data.readInt();     // event RID
    return { _isOpEvent: true };  // skip queue shift
```

---

## References

- [RFC 2945 — The SRP Authentication and Key Exchange System](https://www.ietf.org/rfc/rfc2945.txt)
- [Firebird source: `src/auth/SecureRemotePassword/`](https://github.com/FirebirdSQL/firebird/tree/master/src/auth/SecureRemotePassword)
- [Firebird Wire Protocol documentation](https://github.com/FirebirdSQL/firebird/blob/master/doc/WhatsNew)
- [node-firebird `lib/srp.js`](lib/srp.js)
- [node-firebird `lib/wire/connection.js`](lib/wire/connection.js)
- [node-firebird `test/mock-server.js`](test/mock-server.js)
