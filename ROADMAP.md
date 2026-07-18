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

- **[Issue #341](https://github.com/hgourvest/node-firebird/issues/341) — RETURNING failure leads to uncaught error** ✅ Resolved
  Goal: isolate statement failures and reset connection state correctly after errors.
  Deliverables:
  - Root cause fixed in `src/wire/connection.ts`: a failing `INSERT ... RETURNING` (`op_execute2`) left the trailing `op_response` of the empty `op_sql_response` unconsumed, shifting every later response to the wrong callback; the error is now consumed and delivered to the statement's callback (with `gdscode`/`gdsparams`), and the transaction/connection stay usable.
  - Also fixed: stale per-packet fetch decode state leaking between responses that share a TCP segment (could desync pipelined statements the same way).
  - Regression test added: `test/returning-failure.js` (failure + subsequent query on the same transaction, connection, pipelined mix, zero-row `UPDATE ... RETURNING`).

- **[Issue #312](https://github.com/hgourvest/node-firebird/issues/312) — Hang when preparing a statement with too many parameters on Firebird 2.5** ✅ Resolved
  Root cause (diagnosed by the reporter): Firebird 2.5 sign-extends XDR opaque lengths above 32767 (a 32768-byte describe response arrives with length `0xFFFF8000`), which corrupted the read position and left the prepare callback hanging. `XdrReader.readArray` now recovers the real length from the low 16 bits when the length is negative — valid positive lengths (including > 65535 on newer servers) are untouched, so the recovery only triggers on the 2.5 bug pattern. Unit test in `test/unit/serialize.test.ts`.

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
- **[Issue #322](https://github.com/hgourvest/node-firebird/issues/322)** — `sum()` on NUMERIC columns errored (workaround was CAST) ✅ Resolved — not reproducible on 2.x (fixed by the native-BigInt scaled INT64 decoding); regression test added (`test/index.js` — "should sum NUMERIC columns exactly")
- **[Issue #347](https://github.com/hgourvest/node-firebird/issues/347)** — Sporadic gdscode 335544472 (wrong user/password) on attach ✅ Resolved — matches the SRP proof serialization bug fixed in 2.8.1 (issue #421, ~1.2% of Srp attaches); the reporter's `Legacy_UserManager` workaround bypassed the SRP path. FAQ entry added in [README.md § FAQ](README.md#faq)

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

- **Optional helper utilities (non-breaking additions)** ✅ Implemented (shipped with the promise API):
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

### Phase A.1 — Strictness hardening ✅ Done

The sources now compile with full `"strict": true` (including `noImplicitAny`, `strictNullChecks`, `strictPropertyInitialization`, `useUnknownInCatchVariables`). The hardening was done without runtime changes: wire-populated fields use definite-assignment assertions, connection/service handles use non-null assertions at send sites, and the intentionally dynamic wire-core parameters carry explicit `: any` annotations — making the remaining looseness visible and greppable (`grep ': any' src/wire`) for the follow-up tightening below.

**Follow-up (Phase A.2, future):** replace the explicit `: any` annotations in `src/wire/connection.ts` with real types (Statement/Transaction/Callback shapes), which is a semantic typing effort rather than a compiler-flag one.

### Phase B — Dual API: callbacks + promises ✅ Done

Shipped: every callback API has a promise-returning `*Async` counterpart (`Firebird.attachAsync`, `pool.getAsync`, `db.queryAsync`, `db.executeAsync`, `transaction.commitAsync`, `transaction.rollbackAsync`, statement wrappers, …) plus the `pool.withConnection()` and `db.withTransaction()` helpers. The wrappers delegate to the callback implementations, so execution ordering and serialization semantics are unchanged, and rejections are always `Error` instances carrying `gdscode`/`gdsparams`. Documented in [README.md § Promises and async/await](README.md#promises-and-asyncawait).

**Remaining awareness points (documented, inherent to promises):**
- Promise wrappers can hide resource-leak bugs if callers forget `finally`; the `withConnection` / `withTransaction` helpers mitigate this.
- Mixing callbacks and promises in the same codebase increases the surface for subtle bugs; the docs recommend one style per project.
- Rejected promises that are not caught produce `UnhandledPromiseRejection` warnings — a difference from callback-style errors.

**Follow-up:** ✅ Done — the ServiceManager API (backup/restore/user management/trace/properties) now has `*Async` wrappers for every function, documented in [README.md § Service Manager functions](README.md#service-manager-functions).

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
| 6.0 | 20 | ✅ Implemented |

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

- **Protocol Version 20:** ✅ Implemented — the Protocol 20 "prepare hang" was root-caused (the server reads a trailing `p_sqlst_flags` field from `op_prepare_statement` since `PROTOCOL_PREPARE_FLAG`/protocol 20; the client did not send it, leaving the server blocked mid-packet) and fixed: the field is now sent, Protocol 20 is offered by default, and schema metadata (`relationSchema` via `isc_info_sql_relation_schema`) is returned on describe. `maxNegotiatedProtocols` remains as an escape hatch — the offered list is capped oldest-first, so `10` stops at Protocol 19 (the previous behavior). Integration tests in `test/protocol20.js`.
- **Srp384 and Srp512 Authentication Plugins:** ✅ Implemented — support for the SHA-384 and SHA-512 based Secure Remote Password (SRP) authentication plugins, dynamically upgraded during the connection handshake.
- **ChaCha and ChaCha64 Wire Encryption:** ✅ Implemented — support for the `ChaCha` and `ChaCha64` symmetric encryption algorithms in the wire protocol (incorporating SHA-256 session key stretching and IV mapping), providing a modern, secure alternative to the deprecated `Arc4` (RC4) cipher.
- **Creation with Different Owner (Issue #7718):** ✅ Implemented — `options.owner` sends `isc_dpb_owner` (102) on database creation, letting a superuser create a database owned by another user. Landed together with a DPB-tag correctness fix: `parallelWorkers`, `maxInlineBlobSize`, `searchPath` and `defaultSchema` were serialised with the WRONG tags (92–95 are the Firebird 4 replica/bind/decfloat tags — `parallelWorkers` silently switched the database into replica mode, `searchPath` failed the attach). The real values are 100/104/105; `defaultSchema` (which has no DPB tag of its own) is implemented by putting the schema first in the search path, since `CURRENT_SCHEMA` is the first existing schema of it. `isc_arg_warning` status-vector entries (e.g. "parallel workers value capped") are now parsed instead of hanging the connection. Live tests in `test/dpb-options.js`.

---

## 5. In-Flight PRs

These are open pull requests that are close to being merged and represent near-term deliverables.

- **[PR #385](https://github.com/hgourvest/node-firebird/pull/385)** — Use native `BigInt` instead of the `big-integer` library ✅ Merged
- **[PR #383](https://github.com/hgourvest/node-firebird/pull/383)** — `DECFLOAT` data type support ✅ Merged

---

## 6. Feature Parity with Other Node.js SQL Drivers (pg, mysql2)

A review of what [node-postgres (`pg`)](https://node-postgres.com/) and [`mysql2`](https://github.com/sidorares/node-mysql2) offer, compared against what this driver already ships. The goal is not to copy every feature, but to adopt the idioms Node.js developers now expect from a database driver.

### Already at parity (no work needed)

- **Row streaming with backpressure** — `sequentially()` with the `(row, index, next)` / Promise form covers what `pg-cursor` / `mysql2`'s `.stream()` provide (a `Readable` wrapper is still proposed below for ecosystem interop).
- **Server push notifications** — Firebird `POST_EVENT` support is the counterpart of PostgreSQL `LISTEN/NOTIFY`.
- **Object and array row formats** — `db.query` (objects) / `db.execute` (arrays) match `rowMode: 'array'` (pg) and `rowsAsArray` (mysql2).
- **Wire compression** — shipped (mysql2 has it; pg does not).
- **Authentication plugins** — Srp/Srp256/384/512 + Legacy, negotiated automatically (mysql2's auth-switch equivalent).
- **Statement timeouts** — shipped for FB 4.0+.
- **BigInt-safe numerics** — native `BigInt` for `INT128`, full IEEE 754 `DECFLOAT` (ahead of both drivers here).
- **Prepared statements** — available via `newStatement()` (manual reuse; transparent reuse via the `statementCacheSize` LRU cache).

### Not applicable to Firebird

- **SSL/TLS transport** — Firebird uses its own wire encryption (Arc4/ChaCha/ChaCha64 via SRP session keys), already shipped; TLS is not part of the Firebird remote protocol.
- **Multiple statements per query string** (mysql2 `multipleStatements`) — not supported by Firebird DSQL; `EXECUTE BLOCK` already covers the use case server-side.

### Gaps worth implementing

Ordered roughly by expected user impact:

1. **Promise/`async`–`await` API** ✅ Implemented — `*Async` wrappers on every API plus `pool.withConnection()` / `db.withTransaction()` helpers ([TypeScript Phase B](#phase-b--dual-api-callbacks--promises--done)), including ServiceManager `*Async` wrappers.
2. **Query cancellation + `AbortSignal`** ✅ Implemented — `{ signal }` in query options (callback and promise APIs, database- and transaction-level) plus manual `db.cancel()` / `db.cancelAsync()`, built on out-of-band `op_cancel` (protocol 12+). Cancelled statements fail with `err.gdscode === GDSCode.CANCELLED`; already-aborted signals reject with `AbortError` without contacting the server. Documented in [README.md § Query Cancellation with AbortSignal](README.md#query-cancellation-with-abortsignal-firebird-25).
3. **Batch/bulk execution (Firebird 4 batch API)** ✅ Implemented — `executeBatch` / `executeBatchAsync` on database (all-or-nothing), transaction (partial success with per-record errors) and statement objects, built on protocol 16 `op_batch_create` / `op_batch_msg` / `op_batch_exec`. Metadata-exact encoding (NUMERIC scale, BigInt, BOOLEAN, TIMESTAMP, DECFLOAT), NULL bitmaps, chunked messages, `multiError` completion state. Neither pg nor mysql2 has protocol-level batching. BLOB/ARRAY batch parameters remain a follow-up. Documented in [README.md § Batch Execution](README.md#batch-execution-firebird-40).
4. **Pool observability and tuning** ✅ Implemented — the pool is now an `EventEmitter` (`connect`, `acquire`, `release`, `remove`, plus an opt-in `error` channel) with live metrics (`totalCount`, `idleCount`, `activeCount`, `waitingCount`) and idle lifecycle tuning: `idleTimeoutMillis` shrinks the pool down to `min` when traffic drops and the same sweep evicts dead idle connections. Resolves [#329](https://github.com/hgourvest/node-firebird/issues/329) (idle connections held forever) and [#343](https://github.com/hgourvest/node-firebird/issues/343) (dead pooled connections handed to callers). Documented in [README.md § Pool events and metrics](README.md#pool-events-and-metrics).
5. **Connection URI strings** ✅ Implemented — `firebird://user:password@host:3050/path/to/db.fdb?encoding=UTF8` accepted everywhere an options object is (attach/create/attachOrCreate/drop/pool and the `*Async` wrappers), with alias vs absolute-path vs Windows-path handling, percent-decoding, typed query-parameter coercion and an exported `parseConnectionUri`. Documented in [README.md § Connection URI strings](README.md#connection-uri-strings).
6. **Named placeholders** ✅ Implemented (2.9.0) — mysql2's `namedPlaceholders: true` (`SELECT * FROM t WHERE id = :id` with `{id: 1}`), rewritten client-side to positional `?` params. Documented in [README.md § Named placeholders](README.md#named-placeholders).
7. **Custom type parsers (`typeCast`)** ✅ Implemented — mysql2-style `typeCast(column, next)` connection option, called for every result column value (including NULLs) with full column metadata (`type`/`typeName`/`subType`/`scale`/`field`/`relation`/`alias`) and `next()` returning the default-decoded value (after `blobAsText`/`jsonAsObject`). Covers the row decode path and `blobAsText`-resolved text; SQL type codes exported as `Firebird.SQL_TYPES`. Subsumes future per-type flag requests (dates as strings, BIGINT as string, etc.). Documented in [README.md § Custom type parsers](README.md#custom-type-parsers-typecast).
8. **Prepared-statement cache** ✅ Implemented — `statementCacheSize` option: a per-connection LRU cache of **idle** prepared statements, transparently reused by `db.query`/`tx.query`/`sequentially`/`executeBatch` with no API changes. Statements leave the cache while in use (concurrent runs of the same SQL never share a cursor), failed statements and DDL are never cached, and LRU entries are dropped over the limit. The legacy `cacheQuery`/`maxCachedQuery` options map onto the same cache (now bounded). Documented in [README.md § Prepared-statement cache](README.md#prepared-statement-cache).
9. **`Readable` stream adapter** ✅ Implemented — `db.queryStream(sql, params, options)` / `transaction.queryStream(...)` returning an object-mode `Readable` built on `sequentially`'s `next()`-based backpressure (fetching pauses while the buffer is full). Early destroy — including a `pipeline()` teardown — aborts the fetch and releases the statement. Composes with `typeCast`/`blobAsText`/`jsonAsObject`. Documented in [README.md § Streaming rows with queryStream](README.md#streaming-rows-with-querystream).
10. **Configurable socket keepalive** ✅ Implemented — `enableKeepAlive` (default true) and `keepAliveInitialDelay` (default 60000 ms) connection options, same names as mysql2, also accepted as URI query parameters. Documented in [README.md § Connection options](README.md#connection-options).
11. **`nestTables` / duplicate-column handling** ✅ Implemented — mysql2's `nestTables` as a connection and per-query option: `true` nests each object row by source table (`row[table][column]`, self-joins nest under their query aliases via `isc_info_sql_relation_alias`, expression columns under `''`), a string separator flattens to `'table<sep>column'` keys. Composes with `typeCast`/`blobAsText`/`queryStream`/`lowercase_keys`; array rows unaffected. The shared key computation also fixed a latent `sequentially` bug: blob materialization aligned `Object.keys(row)` with the column metadata by index, which desyncs on duplicate JOIN column names. Documented in [README.md § Nested result tables](README.md#nested-result-tables-nesttables); tests in `test/nest-tables.js`.
12. **Multi-host pooling (`PoolCluster`)** — mysql2 routes across primaries/replicas with failover strategies. With Firebird 4+ logical replication this becomes relevant, but it is niche today — evaluate after pool observability lands.

---

## Suggested Release Buckets

| Target | Items |
| :--- | :--- |
| Shipped in 2.4.0 | TypeScript 7 migration (ES classes, generated typings); Firebird database events (POST_EVENT); Srp256/384/512 auth; ChaCha/ChaCha64 wire encryption; Protocol 18/19 features (scrollable cursors, multi-row RETURNING, parallel workers, inline BLOBs); Firebird 6.0 features (schemas, tablespaces, JSON, ROW type); raw Buffer params; P0 fixes #387, #357 |
| Next minor | Promise/async-await API ✅ done (TS Phase B + `withConnection` / `withTransaction` helpers); pool observability ✅ done (events + metrics + idle reaping, resolves #329/#343); connection URI strings ✅ done; TS strictness hardening (Phase A.1) ✅ done (full `strict: true`); ServiceManager promise wrappers ✅ done; P1 issue #341 (failing RETURNING poisons connection) ✅ done |
| Next minor (cont.) | Query cancellation + `AbortSignal` ✅ done |
| Next minor (cont.) | Firebird 4 batch API (bulk inserts) ✅ done |
| Shipped in 2.9.0 | named placeholders; traditional `host[/port]:database` connection strings; deferred-op response queue fix |
| Shipped in 2.10.0 | `typeCast` hook; statement cache (`statementCacheSize` LRU); `queryStream` Readable adapter; configurable keepalive; ServiceManager promise wrappers; failing `RETURNING` fix (#341); Firebird 2.5 prepare-hang fix (#312); full TS strict mode + wire-core types (Phase A.1/A.2); Protocol 20 (prepare hang fixed — `p_sqlst_flags`; v19 cap lifted); database creation with different owner (#7718, `options.owner`); FB5/FB6 DPB-tag fixes (`parallelWorkers` no longer switches the database into replica mode) + `isc_arg_warning` parsing |
| Next minor | `nestTables` (mysql2-style nested / table-qualified object rows) |
| Future major | ESM/CJS dual exports; TS Phase C generics; multi-host pooling (if demand materializes) |

---

We believe these changes will make `node-firebird` a more robust, modern, and developer-friendly library for accessing Firebird databases. Contributions are welcome — please check the [open issues](https://github.com/hgourvest/node-firebird/issues) and the [contributing guide](README.md#contributing) for details.
