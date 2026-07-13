# Node-Firebird Roadmap

This document outlines the future development direction for the `node-firebird` library. Our primary goals are to modernize the codebase, implement support for the latest Firebird features, and improve the overall developer experience. A major milestone landed in v2.4.0: the codebase was migrated to TypeScript 7 (see section 3), and Firebird 6.0-era protocol features (SRP-256/384/512, ChaCha wire encryption, database events) shipped alongside it.

> **Note:** The issue and PR lists below may be incomplete. Please check the [GitHub issues page](https://github.com/hgourvest/node-firebird/issues) for the most up-to-date list of open items, and feel free to open new issues or add a 👍 to existing ones to help prioritize.

---

## Guiding Principles

- **Stability first:** fix hangs, leaks, and "callback never called" scenarios before adding new API surface.
- **Compatibility:** keep the current callback API stable while adding promise/TypeScript improvements.
- **Framework-friendly:** make it straightforward to use in web frameworks (Express, Fastify, etc.) without connection leaks.
- **Incremental delivery:** ship small, reviewable changes rather than large rewrites.

---

## 1. User-Reported Issues (Prioritized)

These items come directly from current open issues and should be tracked as roadmap deliverables. Priority is based on user impact and frequency of reports.

### P0 — Correctness / hang / callback never called

- **[Issue #387](https://github.com/hgourvest/node-firebird/issues/387) — BLOB callback never runs** ✅ Resolved
  Goal: ensure query callbacks always settle (success or error) and that BLOB streaming cannot stall silently.
  Deliverables:
  - Add internal watchdog/timeout for pending requests (opt-in first, then default).
  - Add debug logging hooks (connection + statement lifecycle) to diagnose stalls.
  - Add regression test: BLOB read path must either resolve or error deterministically.

- **[Issue #357](https://github.com/hgourvest/node-firebird/issues/357) — Pool connections hanging after idle time** ✅ Resolved
  Goal: pool should detect dead sockets and recover cleanly.
  Deliverables:
  - Health-check on checkout (lightweight ping or keepalive).
  - Better handling of server disconnects + reconnect backoff.
  - Ensure `db.detach()` always returns connection to pool in all code paths.

- **[Issue #343](https://github.com/hgourvest/node-firebird/issues/343) — Pool connection errors**
  Goal: pool should provide reliable acquisition and clear error messages.
  Deliverables:
  - Clarify pool error semantics and add a retry strategy option.
  - Add tests for pool exhaustion and stale idle connections.

- **[Issue #313](https://github.com/hgourvest/node-firebird/issues/313) — Sequential heap limit / allocation failed**
  Goal: reduce memory pressure and document safe usage patterns.
  Deliverables:
  - Validate that `sequentially` does not retain rows unintentionally. ✅ Covered by existing regression test (`test/index.js` — "should not buffer all streamed rows in sequentially callback result").
  - Provide streaming patterns and "do/don't" guidance in docs. ✅ Added — see [README.md § Streaming a big data](README.md#streaming-a-big-data), including a backpressure example using the `on(row, index, next)` / Promise form.

### P1 — Behavior fixes / sharp edges

- **[Issue #341](https://github.com/hgourvest/node-firebird/issues/341) — RETURNING failure leads to uncaught error**
  Goal: isolate statement failures and reset connection state correctly after errors.
  Deliverables:
  - Harden error handling: ensure connection state machine resets on statement failure.
  - Add regression test for failure + subsequent query on the same connection.

- **[Issue #329](https://github.com/hgourvest/node-firebird/issues/329) — Pool idle connection deletion**
  Goal: make pool idle cleanup safe and observable.
  Deliverables:
  - Document and/or fix idle cleanup behavior.
  - Add observable events/metrics: "connection closed due to idle timeout", etc.

- **[Issue #164](https://github.com/hgourvest/node-firebird/issues/164) — Insert data with charset `NONE` (or `ISO8859_1`)** ✅ Resolved
  Goal: allow binary-safe writes to non-UTF8 text columns without corrupting bytes on the way through Node's string layer.
  Deliverables:
  - Added `SQLParamBuffer` (`src/wire/xsqlvar.ts`) + `XdrWriter.addParamBuffer` (`src/wire/serialize.ts`): when a `Buffer` is passed as a parameter for a non-BLOB column, its raw bytes are written directly instead of being coerced through `Buffer#toString()` (which previously forced a UTF-8 decode and could corrupt data on `NONE`/`WIN1252`/`ISO8859_1` connections).
  - Regression test added: `test/index.js` — "should insert with string from buffer".
  - This is the direct fix for the workaround requested in [#336](https://github.com/hgourvest/node-firebird/issues/336) ("write the buffer directly to the database without any other transliteration") — combine with `encoding: 'NONE'` to pass already-encoded bytes straight through.

### P2 — Questions / documentation gaps (triage)

These may be closed with a clear explanation or resolved with a small doc/code fix.

- **[Issue #353](https://github.com/hgourvest/node-firebird/issues/353)** — LIST() function support question ✅ Resolved (closed upstream via `blobAsText`); now documented in [README.md § FAQ](README.md#faq)
- **[Issue #348](https://github.com/hgourvest/node-firebird/issues/348)** — Protocol version hard-coded? ✅ Resolved (protocol negotiation shipped since the issue was filed); now documented in [README.md § FAQ](README.md#faq)
- **[Issue #335](https://github.com/hgourvest/node-firebird/issues/335)** — BLOB loading slowly ⚠️ Open upstream, but the fix (`blobChunkSize`/`blobReadChunkSize`) already ships — documented in [README.md § FAQ](README.md#faq)
- **[Issue #336](https://github.com/hgourvest/node-firebird/issues/336)** — Default encoding option (UTF-8 vs latin1) ✅ Resolved (`options.encoding` ships); now documented in [README.md § FAQ](README.md#faq), including the transliteration-mismatch caveat raised in the issue thread
- **[Issue #332](https://github.com/hgourvest/node-firebird/issues/332)** — LIKE clause error in SELECT ⚠️ Open upstream (server-side DSQL behavior, not reproducible on Firebird 6.0); workaround documented in [README.md § FAQ](README.md#faq)
- **[Issue #320](https://github.com/hgourvest/node-firebird/issues/320)** — Deno compatibility ✅ Resolved

---

## 2. Express.js Support (First-Class Integration)

The library already works with Express, but "support" should mean **documented, safe-by-default patterns** that prevent connection leaks and hangs in a request/response lifecycle.

### Deliverables

- **New docs section: "Using node-firebird with Express.js"** ✅ Added — see [README.md](README.md#using-node-firebird-with-expressjs)
  - Recommended architecture: create a single pool at app startup and reuse it. ✅
  - Request lifecycle pattern: acquire connection → run queries → always release in `finally`. ✅ (via an idempotent `withConnection` helper, since callback code has no native `finally`)
  - Transaction middleware example (commit on success, rollback on error). ✅
  - Error handling: map Firebird errors to HTTP status codes without exposing internals. ✅ (using the existing `GDSCode` constants from `src/gdscodes.ts`, published as `node-firebird/lib/gdscodes`)
  - BLOB streaming example: stream BLOBs directly to `res` and ensure `db.detach()` on `finish`/`close`. ✅

- **Optional helper utilities (non-breaking additions)** — not yet implemented; the docs currently show equivalent hand-rolled helpers (`withConnection`, `transactional`) instead.
  - `pool.withConnection(async (db) => { ... })` — guarantees release even on error.
  - `db.withTransaction(async (tx) => { ... })` — auto-commit or auto-rollback.

### Acceptance Criteria

Provide at least **two copy-paste ready examples**:

1. **Standard JSON API endpoint** — query rows and return JSON, with proper connection release. ✅
2. **BLOB streaming download endpoint** — pipe a BLOB column to the HTTP response, with cleanup on client disconnect. ✅

---

## 3. TypeScript Status & Roadmap

**The migration itself is done.** As of v2.4.0 ([PR #420](https://github.com/hgourvest/node-firebird/pull/420)) the driver is written in TypeScript: `src/` is compiled to `lib/` (CommonJS + generated `.d.ts`) by the native TypeScript 7 compiler, and the prototype-based code was rewritten as ES classes along the way. The runtime API is unchanged — existing JavaScript/callback users are unaffected. Build and development requirements are documented in [README.md § Developing the driver](README.md#developing-the-driver).

### Phase A — Accurate typings for the current API ✅ Done

Superseded by the migration: the hand-maintained `.d.ts` files are gone. Declarations are now generated from the sources at build time (`src/types.ts` and friends), so they cover connection options, the pool, database/transaction/statement objects, driver events and result shapes — and they cannot drift from the implementation.

**Remaining caveats (inherent, not migration debt):**
- Query result shapes are dynamic (depend on the SQL); TypeScript cannot infer column names automatically. Users must cast or supply their own row types.
- Blob columns being functions is a runtime quirk; the typings are accurate but may surprise users new to the library.
- Some options and event payloads vary by server version or protocol; typings stay permissive in those areas to avoid false type errors.

### Phase A.1 — Strictness hardening (next)

The sources currently compile with `strict: false` (`noImplicitAny` and `noImplicitThis` are also off) to keep the migration diff reviewable. Follow-up: enable strict flags incrementally, file by file, without runtime changes.

### Phase B — Dual API: callbacks + promises

Provide promise-returning wrappers alongside the existing callbacks:
- `Firebird.attachAsync`, `pool.getAsync`, `db.queryAsync`, `db.executeAsync`, `transaction.commitAsync`, `transaction.rollbackAsync`, etc.

**Tradeoffs and risks:**
- Promise wrappers can hide resource-leak bugs if callers forget `finally`; `withConnection` / `withTransaction` helpers (see Express section) mitigate this.
- Promise wrappers must not change execution ordering or serialization semantics, especially around `sequentially`.
- Mixing callbacks and promises in the same codebase increases the surface for subtle bugs; docs should recommend one style per project.
- Rejected promises that are not caught will produce `UnhandledPromiseRejection` warnings; users need to be aware of this difference from callback-style errors.

### Phase C — Modern TypeScript ergonomics (optional / future)

- Consider publishing dual CJS + ESM package exports, or documenting CJS-only stance clearly.
- Add opt-in generic helpers:
  - `db.query<T = Record<string, unknown>>(sql, params)` for user-supplied row shapes.
  - `db.queryAsync<T>(...): Promise<T[]>`

**Constraints:**
- Full ESM migration can be a **breaking change** depending on consumer build tooling; it may require a major version bump and a migration guide.
- Generic row typing is only as good as the types the user supplies; it does not validate SQL at compile time.

### Modern JavaScript Classes ✅ Done

Shipped as part of the TypeScript migration (v2.4.0): the prototype-based codebase now uses ES `class` syntax throughout `src/`.

---

## 4. Protocol Implementation Status

| Firebird Version | Protocol Versions | Status |
| :--- | :--- | :--- |
| 2.5 | 10, 11, 12, 13 | ✅ Implemented |
| 3.0 | 14, 15 | ✅ Implemented |
| 4.0 | 16, 17 | ✅ Implemented |
| 5.0 | 18, 19 | ✅ Implemented |
| 6.0 | 20 | ⚠️ Capped to v19 (Avoids Prepare Hangs) |

### Firebird 3 Support

- **Protocol Versions 14 and 15:** ✅ Implemented.
- **Enhanced Authentication:** ✅ Implemented — Srp256 (SHA-256) alongside Srp (SHA-1) and Legacy_Auth.
- **Wire Protocol Encryption:** ✅ Implemented — Arc4 (RC4) stream cipher using SRP session keys.
- **Wire Protocol Compression:** ✅ Implemented — zlib compression for protocol 13+.
- **Packed (NULL-aware) Row Data:** ✅ Implemented — null bitmap for protocol 13+.
- **op_cond_accept Handling:** ✅ Implemented.
- **UTF-8 User Identification:** ✅ Implemented.
- **Database Encryption Callback:** ✅ Implemented — `op_crypt_key_callback` support; `dbCryptConfig` accepts plain text or base64-encoded keys.

### Firebird 4 Support

- **Protocol Versions 16 and 17:** ✅ Implemented.
- **Statement Timeout:** ✅ Implemented (Protocol 16+).
- **`INT128` Data Type:** ✅ Implemented.
- **Time Zone Support:** ✅ Implemented — `TIME WITH TIME ZONE`, `TIMESTAMP WITH TIME ZONE`, `sessionTimeZone` option (Protocol 16+).
- **`DECFLOAT` Data Type:** ✅ Implemented — `DECFLOAT(16)` and `DECFLOAT(34)` with full IEEE 754-2008 BID (Binary Integer Decimal) encoding/decoding.

### Firebird 5 Support

- **Protocol Version 18:** ✅ Implemented.
- **Bidirectional Cursors:** ✅ Implemented — scrollable cursors for remote database access.
- **`RETURNING` Multiple Rows:** ✅ Implemented — DML returning multiple rows.
- **`SKIP LOCKED`:** ✅ Implemented — `SELECT WITH LOCK`, `UPDATE`, and `DELETE` (pure SQL syntax compatibility).
- **Parallel Workers:** ✅ Implemented — client connection configuration via `parallelWorkers` (`isc_dpb_parallel_workers` DPB tag).
- **Protocol Version 19 (Inline BLOBs):** ✅ Implemented — support for `op_inline_blob` (114) packet decoding/caching, and `maxInlineBlobSize` (`isc_dpb_max_inline_blob_size` DPB tag `93`) connection parameter.

### Firebird 6 and Beyond

- **Protocol Version List Limit:** ✅ Implemented — capping at Protocol 19 (defaults to 10 for backward compatibility) successfully avoids the query preparation hang experienced on Protocol 20 while maintaining full encryption and feature compatibility up to Firebird 5.x.
- **Srp384 and Srp512 Authentication Plugins:** ✅ Implemented — support for the SHA-384 and SHA-512 based Secure Remote Password (SRP) authentication plugins, dynamically upgraded during the connection handshake.
- **ChaCha and ChaCha64 Wire Encryption:** ✅ Implemented — support for the `ChaCha` and `ChaCha64` symmetric encryption algorithms in the wire protocol (incorporating SHA-256 session key stretching and IV mapping), providing a modern, secure alternative to the deprecated `Arc4` (RC4) cipher.
- **Creation with Different Owner (Issue #7718):** ❌ Planned — support for specifying a custom database owner during database creation.

---

## 5. In-Flight PRs

These are open pull requests that are close to being merged and represent near-term deliverables.

- **[PR #385](https://github.com/hgourvest/node-firebird/pull/385)** — Use native `BigInt` instead of the `big-integer` library ✅ Merged
- **[PR #383](https://github.com/hgourvest/node-firebird/pull/383)** — `DECFLOAT` data type support ✅ Merged

---

## Suggested Release Buckets

| Target | Items |
| :--- | :--- |
| Shipped in 2.4.0 | TypeScript 7 migration (ES classes, generated typings); Firebird database events (POST_EVENT); Srp256/384/512 auth; ChaCha/ChaCha64 wire encryption; Protocol 18/19 features (scrollable cursors, multi-row RETURNING, parallel workers, inline BLOBs); Firebird 6.0 features (schemas, tablespaces, JSON, ROW type); raw Buffer params; P0 fixes #387, #357 |
| Next minor | TS strictness hardening (Phase A.1); TS Phase B (promise wrappers); pool helpers (`withConnection` / `withTransaction`); remaining P1 issues (#343, #341, #329) |
| Future minor | Protocol 20 (lift the v19 cap once the prepare hang is resolved); database creation with different owner (#7718) |
| Future major | ESM/CJS dual exports; TS Phase C generics |

---

We believe these changes will make `node-firebird` a more robust, modern, and developer-friendly library for accessing Firebird databases. Contributions are welcome — please check the [open issues](https://github.com/hgourvest/node-firebird/issues) and the [contributing guide](README.md#contributing) for details.
