# Node-Firebird Roadmap

This document outlines the future development direction for the `node-firebird` library. Our primary goals are to modernize the codebase, implement support for the latest Firebird features, and improve the overall developer experience.

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

- **[Issue #387](https://github.com/hgourvest/node-firebird/issues/387) — BLOB callback never runs**
  Goal: ensure query callbacks always settle (success or error) and that BLOB streaming cannot stall silently.
  Deliverables:
  - Add internal watchdog/timeout for pending requests (opt-in first, then default).
  - Add debug logging hooks (connection + statement lifecycle) to diagnose stalls.
  - Add regression test: BLOB read path must either resolve or error deterministically.

- **[Issue #357](https://github.com/hgourvest/node-firebird/issues/357) — Pool connections hanging after idle time**
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
  - Validate that `sequentially` does not retain rows unintentionally.
  - Provide streaming patterns and "do/don't" guidance in docs.

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

### P2 — Questions / documentation gaps (triage)

These may be closed with a clear explanation or resolved with a small doc/code fix.

- **[Issue #353](https://github.com/hgourvest/node-firebird/issues/353)** — LIST() function support question
- **[Issue #348](https://github.com/hgourvest/node-firebird/issues/348)** — Protocol version hard-coded?
- **[Issue #335](https://github.com/hgourvest/node-firebird/issues/335)** — BLOB loading slowly
- **[Issue #336](https://github.com/hgourvest/node-firebird/issues/336)** — Default encoding option (UTF-8 vs latin1)
- **[Issue #332](https://github.com/hgourvest/node-firebird/issues/332)** — LIKE clause error in SELECT
- **[Issue #320](https://github.com/hgourvest/node-firebird/issues/320)** — Deno compatibility

---

## 2. Express.js Support (First-Class Integration)

The library already works with Express, but "support" should mean **documented, safe-by-default patterns** that prevent connection leaks and hangs in a request/response lifecycle.

### Deliverables

- **New docs section: "Using node-firebird with Express.js"**
  - Recommended architecture: create a single pool at app startup and reuse it.
  - Request lifecycle pattern: acquire connection → run queries → always release in `finally`.
  - Transaction middleware example (commit on success, rollback on error).
  - Error handling: map Firebird errors to HTTP status codes without exposing internals.
  - BLOB streaming example: stream BLOBs directly to `res` and ensure `db.detach()` on `finish`/`close`.

- **Optional helper utilities (non-breaking additions)**
  - `pool.withConnection(async (db) => { ... })` — guarantees release even on error.
  - `db.withTransaction(async (tx) => { ... })` — auto-commit or auto-rollback.

### Acceptance Criteria

Provide at least **two copy-paste ready examples**:

1. **Standard JSON API endpoint** — query rows and return JSON, with proper connection release.
2. **BLOB streaming download endpoint** — pipe a BLOB column to the HTTP response, with cleanup on client disconnect.

---

## 3. TypeScript Roadmap (Detailed)

Goal: improve TypeScript support without breaking existing JavaScript/callback users. Each phase is independently deliverable.

### Phase A — Accurate typings for the current API (no runtime changes)

Deliver or refresh `.d.ts` definitions covering:
- Connection options (`host`, `port`, `database`, `user`, `password`, `role`, `charset`, `pageSize`, `wireCrypt`, `wireCompression`, `dbCryptConfig`, `sessionTimeZone`, `retryConnectionInterval`, `blobAsText`, `lowercase_keys`, `encoding`, etc.)
- Pool object and its methods (`pool.get`, `pool.destroy`)
- Database / transaction / statement objects and all their callbacks
- Event emitter events (`row`, `result`, `attach`, `detach`, `reconnect`, `error`, `transaction`, `commit`, `rollback`)
- Result shapes: `db.query` → `Array<Record<string, unknown>>`, `db.execute` → `unknown[][]`
- Blob columns (appear as functions at runtime; typings must model that explicitly)

**Tradeoffs and constraints to be aware of:**
- Query result shapes are dynamic (depend on the SQL); TypeScript cannot infer column names automatically. Users must cast or supply their own row types.
- Blob columns being functions is a runtime quirk; the typings will be accurate but may surprise users new to the library.
- Some options and event payloads vary by server version or protocol; typings must be permissive in those areas to avoid false type errors.
- Maintaining `.d.ts` files separately from the JavaScript source creates a risk of drift; a linting step should be added to CI to catch obvious mismatches.

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
- A major TypeScript rewrite would be a large undertaking. Incremental phases (A → B → C) are preferred to reduce risk and keep the library usable throughout the transition.

### Modern JavaScript Classes (prerequisite / parallel track)

Before or alongside the TypeScript work, refactor the prototype-based codebase to use ES6 `class` syntax. This improves readability and makes a future TypeScript migration less disruptive.

**Benefits:** cleaner code structure, easier to understand inheritance.
**Risk:** a large mechanical refactor may introduce subtle behavioral regressions; must be accompanied by thorough test coverage.

---

## 4. Protocol Implementation Status

| Firebird Version | Protocol Versions | Status |
| :--- | :--- | :--- |
| 2.5 | 10, 11, 12, 13 | ✅ Implemented |
| 3.0 | 14, 15 | ✅ Implemented |
| 4.0 | 16, 17 | ✅ Implemented |
| 5.0 | 18 | ❌ Not Implemented |
| 6.0 | N/A | ❌ Not Implemented |

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

- **Protocol Version 18:** ❌ TODO.
- **Bidirectional Cursors:** ❌ TODO — scrollable cursors for remote database access.
- **`RETURNING` Multiple Rows:** ❌ TODO — DML returning multiple rows.
- **`SKIP LOCKED`:** ❌ TODO — `SELECT WITH LOCK`, `UPDATE`, and `DELETE`.
- **Parallel Workers Information:** ❌ TODO.

### Firebird 6 and Beyond

- **Native `JSON` Data Type:** ❌ TODO — native JSON storage support.
- **SQL-Standard `ROW` Type:** ❌ TODO — structured data types as columns or variables.
- **SQL-Compliant JSON Functions:** ❌ TODO — `JSON_VALUE`, `JSON_QUERY`, `JSON_EXISTS`, `JSON_OBJECT`.
- **Tablespaces:** ❌ TODO — physical storage location control.
- **SQL Schemas:** ❌ TODO — standard schema namespace support.
- **Enhanced Collation Support:** ❌ TODO — collations declared as part of the data type.

---

## 5. In-Flight PRs

These are open pull requests that are close to being merged and represent near-term deliverables.

- **[PR #385](https://github.com/hgourvest/node-firebird/pull/385)** — Use native `BigInt` instead of the `big-integer` library
- **[PR #383](https://github.com/hgourvest/node-firebird/pull/383)** — `DECFLOAT` data type support ✅ Merged

---

## Suggested Release Buckets

| Target | Items |
| :--- | :--- |
| Next patch | P0 bug fixes: #387, #357, #343, #341 |
| Next minor | Express.js docs + helpers; TS Phase A typings; in-flight PR #385; Protocol 17 + DECFLOAT shipped in #383 |
| Future minor | TS Phase B (promise wrappers); P1 + P2 issues; Protocol 18 / Firebird 5 |
| Future major | ESM/CJS rework; TS Phase C generics; full class-based refactor (only if breaking) |

---

We believe these changes will make `node-firebird` a more robust, modern, and developer-friendly library for accessing Firebird databases. Contributions are welcome — please check the [open issues](https://github.com/hgourvest/node-firebird/issues) and [contributing guide](README.md) for details.
