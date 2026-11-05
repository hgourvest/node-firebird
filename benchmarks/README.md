# `node-firebird` Benchmark Suite

Zero-dependency performance benchmark suite for `node-firebird`, built on `process.hrtime.bigint()`.

The suite is split into two parts:
1. **Offline CPU & Wire-Protocol Micro-Benchmarks (`benchmarks/micro.js`)** — runs anywhere with zero external services required. Exercises XDR/BLR serialization, `BitSet` null bitmaps, `DECFLOAT(16/34)` IEEE 754-2008 DPD math, `op_fetch_response` row-batch decoding across all output modes, large SQLDA `describe()` metadata parsing, `Srp256` handshake proofs, and `Arc4` wire encryption.
2. **Live Firebird Server Benchmarks (`benchmarks/live.js`)** — opt-in end-to-end benchmarks against a running Firebird instance. Measures prepared-statement cache speedup (`statementCacheSize`), 1,000-row `SELECT` throughput (`queryAsync` objects vs `executeAsync` arrays), bulk `INSERT` throughput via `executeBatchAsync` (`op_batch_create` / `op_batch_msg` / `op_batch_exec`), and 64 KB `BLOB` write bandwidth.

---

## Quick Start

```bash
# Build lib/ first if you have modified src/
npm run build

# Run offline CPU & wire-protocol micro-benchmarks (default, no Firebird server required)
npm run bench

# Run both offline micro-benchmarks and live Firebird server benchmarks
npm run bench:live

# Run only the live Firebird server benchmarks
node benchmarks/index.js --live

# Output machine-readable JSON (for CI / before-and-after comparisons)
node benchmarks/index.js --json
```

---

## CLI Options & Environment Variables

### Flags (`benchmarks/index.js`)

| Flag | Description |
| :--- | :--- |
| *(none)* / `--micro` | Run offline wire-protocol and CPU micro-benchmarks (default). |
| `--live` | Run only the live Firebird server benchmarks (gracefully skips if unreachable). |
| `--all` | Run both offline micro-benchmarks and live Firebird server benchmarks (`npm run bench:live`). |
| `--json` | Suppress ASCII tables and emit structured JSON with `opsPerSec`, `throughput`, `meanNs`, `p50Ns`, `p95Ns`, `minNs`, and `maxNs`. |

### Environment Variables (Live Server Benchmarks)

When `--live`, `--all`, or `FIREBIRD_BENCH_LIVE=1` is active, `benchmarks/live.js` creates a temporary database (`node-firebird-bench-<pid>.fdb`), runs the benchmark suite, and drops the database on exit:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ISC_HOST` | `127.0.0.1` | Firebird server hostname or IP address |
| `ISC_PORT` | `3050` | Firebird server TCP port |
| `ISC_USER` | `SYSDBA` | Firebird user |
| `ISC_PASSWORD` | `masterkey` | Firebird password |
| `FIREBIRD_DATA` | `/tmp` | Directory on the Firebird server host where the temporary `.fdb` database is created |
| `FIREBIRD_BENCH_LIVE` | `0` | Set to `1` to enable live benchmarks even without `--live` / `--all` |

---

## Directory Structure

- [`benchmarks/index.js`](./index.js) — CLI entry point and JSON reporter.
- [`benchmarks/harness.js`](./harness.js) — High-resolution timing harness (`benchSync`, `benchAsync`), automatic batch calibration, percentile computation (`mean`, `p50`, `p95`, `min`, `max`), and ASCII table formatter (`printTable`).
- [`benchmarks/micro.js`](./micro.js) — Synthetic wire packet generators and offline CPU micro-benchmarks.
- [`benchmarks/live.js`](./live.js) — Live Firebird server integration benchmarks.

---

## What Each Benchmark Measures

### 1. Wire Serialization & Primitives (`src/wire/serialize.ts`, `src/ieee754-decimal.ts`)
- **`XdrWriter + XdrReader (200 mixed rows)`** — Encodes and decodes 200 rows × 6 mixed columns (`Int32`, `Int64`, `Double`, `Quad`, `String`, `Buffer`) using the wire-protocol XDR encoder/decoder.
- **`BitSet decode + get (32 columns x 200 rows)`** — Unpacks 4-byte null indicator bitmaps and checks column nullability across 200 rows.
- **`BitSet encode (32 columns x 200 rows)`** — Populates and serializes 32-column null bitmaps for 200 outbound parameter rows.
- **`BlrReader.readSegment (32 x 1 KB segments)`** — Reassembles a 32 KB BLOB payload delivered across 32 consecutive 1 KB BLR segments.
- **`DECFLOAT(16)` & `DECFLOAT(34)` round-trips** — Full IEEE 754-2008 Densely Packed Decimal (DPD) string-to-wire and wire-to-string conversion for 64-bit and 128-bit decimal floats.

### 2. Row Decoding & Metadata Parsing (`src/wire/connection.ts`)
- **`decodeResponse 200 rows (asObject: true)`** — Decodes a synthetic Protocol 18 `op_fetch_response` packet containing 200 rows of 6 columns (`INTEGER`, `CHAR(16)`, `VARCHAR(64)`, `NUMERIC(18,2)`, `TIMESTAMP`, `BOOLEAN`) into standard JS objects.
- **`decodeResponse 200 rows (asObject: false / array)`** — Decodes the same 200-row packet into positional value arrays (`execute()` / `executeAsync()`).
- **`decodeResponse 200 rows (lowercase + camelCase)`** — Decodes 200 object rows with `lowercase_keys: true` and `transformKeys: 'camel'`.
- **`decodeResponse 200 rows (nestTables: true)`** — Decodes 200 object rows nested by relation name (`row.ORDERS.ID`, etc.).
- **`Connection.describe (1,500 bind parameters)`** — Parses a 1,500-parameter `isc_info_sql_bind` SQLDA response buffer into `SQLVarParam` descriptors.

### 3. Authentication & Wire Encryption (`src/srp.ts`, `src/wire/socket.ts`)
- **`SRP clientSeed + clientProof (Srp256)`** — Computes the client ephemeral keypair and SHA-256 SRP proof (`BigInt` modular exponentiation over the 2048-bit prime group).
- **`Arc4 wire cipher transform (64 KB packet)`** — Encrypts/decrypts a 64 KB wire buffer using the `Legacy_Auth` / `Arc4` stream cipher.

### 4. Live Firebird Server Benchmarks (`benchmarks/live.js`)
- **`Point SELECT by PK (cached prepared statement)`** — Executes `SELECT ... FROM BENCH_ITEMS WHERE ID = ?` inside a read-only transaction on a connection with `statementCacheSize: 100` (hits the LRU prepared-statement cache, skipping `op_allocate_statement` + `op_prepare_statement` + `op_free_statement(DSQL_drop)`).
- **`Point SELECT by PK (uncached prepare + execute + drop)`** — Executes the same point lookup with `statementCacheSize: 0`.
- **`SELECT 1,000 rows -> Objects (queryAsync)`** — Fetches 1,000 6-column rows from Firebird as JS objects.
- **`SELECT 1,000 rows -> Arrays (executeAsync)`** — Fetches 1,000 6-column rows from Firebird as positional arrays.
- **`INSERT 200 rows via executeBatchAsync`** — Inserts 200 rows per transaction using the Firebird 4.0+ wire batch protocol (`op_batch_create` / `op_batch_msg` / `op_batch_exec`).
- **`BLOB 64 KB write round-trip`** — Uploads a 64 KB binary `BLOB` parameter and commits.

---

## Reference Baseline

Recorded on Node.js `v26.0.0` (`linux/x64`, Intel Core i7-9700K @ 3.60GHz):

```text
=== Wire Serialization & Primitives (Offline) ===
────────────────────────────────────────────────────────────────────────────────────────────────────────────
Benchmark                                   │           Throughput │   Mean / op │         p50 │         p95
────────────────────────────────────────────────────────────────────────────────────────────────────────────
XdrWriter + XdrReader (200 mixed rows)      │     1,981,860 rows/s │   100.92 µs │    94.25 µs │   125.15 µs
BitSet decode + get (32 columns x 200 rows) │     8,901,585 rows/s │    22.47 µs │    21.57 µs │    25.33 µs
BitSet encode (32 columns x 200 rows)       │     5,320,872 rows/s │    37.59 µs │    34.73 µs │    49.95 µs
BlrReader.readSegment (32 x 1 KB segments)  │             305 MB/s │   102.35 µs │    63.18 µs │   220.75 µs
DECFLOAT(16) encode + decode round-trip     │        674,849 ops/s │     1.48 µs │     1.46 µs │     1.71 µs
DECFLOAT(34) encode + decode round-trip     │        321,602 ops/s │     3.11 µs │     2.96 µs │     3.77 µs
────────────────────────────────────────────────────────────────────────────────────────────────────────────

=== Row Decoding & Metadata Parsing (Offline) ===
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Benchmark                                         │           Throughput │   Mean / op │         p50 │         p95
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
decodeResponse 200 rows (asObject: true)          │       361,378 rows/s │   553.44 µs │   521.46 µs │   774.70 µs
decodeResponse 200 rows (asObject: false / array) │       373,689 rows/s │   535.20 µs │   512.95 µs │   692.30 µs
decodeResponse 200 rows (lowercase + camelCase)   │       322,987 rows/s │   619.22 µs │   569.01 µs │   867.25 µs
decodeResponse 200 rows (nestTables: true)        │       315,570 rows/s │   633.77 µs │   568.60 µs │   872.17 µs
Connection.describe (1,500 bind parameters)       │  11,143,226 params/s │   134.61 µs │   132.72 µs │   183.45 µs
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

=== Authentication & Wire Encryption (Offline) ===
──────────────────────────────────────────────────────────────────────────────────────────────────────────
Benchmark                                 │           Throughput │   Mean / op │         p50 │         p95
──────────────────────────────────────────────────────────────────────────────────────────────────────────
SRP clientSeed + clientProof (Srp256)     │     337 handshakes/s │     2.97 ms │     2.99 ms │     3.42 ms
Arc4 wire cipher transform (64 KB packet) │             278 MB/s │   224.47 µs │   221.94 µs │   240.28 µs
──────────────────────────────────────────────────────────────────────────────────────────────────────────
```
