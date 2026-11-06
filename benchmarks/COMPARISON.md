# Node.js Firebird Drivers — Head-to-Head Benchmark Comparison

This page compares the runtime performance of the three Node.js Firebird driver implementations against a live **Firebird 6.0** server:

1. **`node-firebird (wire)`** — This library's default pure JavaScript / TypeScript wire protocol driver (Protocol 10–20).
2. **`node-firebird ({ native: true })`** — This library's high-level API (`queryAsync`, `executeAsync`, `executeBatchAsync`, LRU statement cache, `db.sql`, `pool`) running over the optional `node-firebird-driver-native` backend.
3. **`node-firebird-driver-native`** — Raw C++ N-API binding over `libfbclient.so` (`createNativeClient`).
4. **`node-firebird-driver-wire`** — External pure TypeScript wire protocol driver (`createWireClient`).

---

## Test Environment

| Component | Details |
| :--- | :--- |
| **CPU** | Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz (8 cores) |
| **OS** | Linux x64 |
| **Runtime** | Node.js `v26.0.0` (V8) |
| **Database Server** | Firebird `6.0` (`127.0.0.1:3050`, `UTF8`, page size `8192`) |
| **Runner** | [`npm run bench:compare`](./compare.js) (`node benchmarks/index.js --compare`) |

---

## Summary Comparison Matrix

| Workload | `node-firebird` (wire) | `node-firebird` (`{ native: true }`) | `node-firebird-driver-native` (`libfbclient`) | `node-firebird-driver-wire` | Fastest Driver |
| :--- | ---: | ---: | ---: | ---: | :--- |
| **Point `SELECT` by PK (prepared / cached stmt)** | **1,983 queries/s**<br>*(504.21 µs)* | 1,265 queries/s<br>*(790.51 µs)* | 1,919 queries/s<br>*(521.06 µs)* | 1,156 queries/s<br>*(865.03 µs)* | **`node-firebird (wire)`**<br>*(1.72x faster than `driver-wire`)* |
| **Point `SELECT` by PK (prepare + exec + dispose)** | **960 queries/s**<br>*(1.04 ms)* | 884 queries/s<br>*(1.13 ms)* | 899 queries/s<br>*(1.11 ms)* | 636 queries/s<br>*(1.57 ms)* | **`node-firebird (wire)`**<br>*(1.51x faster than `driver-wire`)* |
| **`SELECT` 1,000 rows -> Objects** | **59,982 rows/s**<br>*(16.67 ms mean / 10.46 ms p50)* | 16,139 rows/s<br>*(61.96 ms)* | 17,439 rows/s<br>*(57.34 ms)* | 46,830 rows/s<br>*(21.35 ms)* | **`node-firebird (wire)`**<br>*(3.4x faster than `native`, 2.0x at p50 vs `driver-wire`)* |
| **`SELECT` 1,000 rows -> Arrays** | **99,447 rows/s**<br>*(10.06 ms)* | 15,649 rows/s<br>*(63.90 ms)* | 17,648 rows/s<br>*(56.66 ms)* | 49,983 rows/s<br>*(20.01 ms)* | **`node-firebird (wire)`**<br>*(5.6x faster than `native`, 2.0x faster than `driver-wire`)* |
| **Bulk `INSERT` 200 rows (single transaction)** | **8,754–13,922 rows/s**<br>*(14.37–22.85 ms)* | 3,147 rows/s<br>*(63.55 ms)* | 3,173 rows/s<br>*(63.03 ms)* | 4,142 rows/s<br>*(48.29 ms)* | **`node-firebird (wire)`**<br>*(2.8x–4.3x faster via Protocol 16+ wire batching)* |
| **`BLOB` 64 KB write round-trip** | 1.75–2.14 MB/s<br>*(29.20–35.81 ms)* | 1.72–2.46 MB/s<br>*(25.42–36.36 ms)* | **2.16–2.54 MB/s**<br>*(24.60–29.00 ms)* | 2.15–2.37 MB/s<br>*(26.41–29.10 ms)* | **`node-firebird-driver-native`** |

---

## Detailed Per-Driver Results

### 1. `node-firebird (wire)` — Pure JS Wire Driver (Default)

| Benchmark | Throughput | Mean / op | p50 | p95 |
| :--- | ---: | ---: | ---: | ---: |
| Point `SELECT` by PK (prepared / cached stmt) | **1,983 queries/s** | 504.21 µs | 495.91 µs | 696.00 µs |
| Point `SELECT` by PK (prepare + exec + dispose) | **960 queries/s** | 1.04 ms | 1.02 ms | 1.34 ms |
| `SELECT` 1,000 rows -> Objects | **59,982 rows/s** *(95,602 rows/s @ p50)* | 16.67 ms | 10.46 ms | 56.46 ms |
| `SELECT` 1,000 rows -> Arrays | **99,447 rows/s** | 10.06 ms | 10.02 ms | 11.15 ms |
| Bulk `INSERT` 200 rows (`executeBatchAsync`) | **8,754–13,922 rows/s** | 14.37–22.85 ms | 16.87–21.04 ms | 31.55–49.27 ms |
| `BLOB` 64 KB write round-trip | **1.75–2.14 MB/s** | 29.20–35.81 ms | 30.61–37.10 ms | 33.24–40.33 ms |

### 2. `node-firebird ({ native: true })` — Optional Native Adapter

| Benchmark | Throughput | Mean / op | p50 | p95 |
| :--- | ---: | ---: | ---: | ---: |
| Point `SELECT` by PK (prepared / cached stmt) | **1,265–1,515 queries/s** | 660.01–790.51 µs | 641.51–769.90 µs | 953.36 µs–1.09 ms |
| Point `SELECT` by PK (prepare + exec + dispose) | **830–884 queries/s** | 1.13–1.20 ms | 1.09–1.18 ms | 1.37–1.58 ms |
| `SELECT` 1,000 rows -> Objects | **15,208–16,139 rows/s** | 61.96–65.76 ms | 61.74–65.75 ms | 67.24–68.82 ms |
| `SELECT` 1,000 rows -> Arrays | **15,162–15,649 rows/s** | 63.90–65.95 ms | 62.01–66.16 ms | 70.97–78.94 ms |
| Bulk `INSERT` 200 rows (single transaction) | **3,147–3,350 rows/s** | 59.71–63.55 ms | 56.54–57.62 ms | 92.95–116.61 ms |
| `BLOB` 64 KB write round-trip | **1.72–2.46 MB/s** | 25.42–36.36 ms | 24.63–36.21 ms | 28.38–44.59 ms |

### 3. `node-firebird-driver-native` — Raw `libfbclient.so` N-API Driver

| Benchmark | Throughput | Mean / op | p50 | p95 |
| :--- | ---: | ---: | ---: | ---: |
| Point `SELECT` by PK (prepared / cached stmt) | **1,919–2,024 queries/s** | 493.98–521.06 µs | 530.98 µs | 643.63 µs |
| Point `SELECT` by PK (prepare + exec + dispose) | **899–940 queries/s** | 1.06–1.11 ms | 1.08 ms | 1.49 ms |
| `SELECT` 1,000 rows -> Objects | **17,439–17,627 rows/s** | 56.73–57.34 ms | 56.70 ms | 64.75 ms |
| `SELECT` 1,000 rows -> Arrays | **17,389–17,648 rows/s** | 56.66–57.51 ms | 56.62 ms | 59.66 ms |
| Bulk `INSERT` 200 rows (single transaction) | **3,173–3,517 rows/s** | 56.86–63.03 ms | 60.08 ms | 96.01 ms |
| `BLOB` 64 KB write round-trip | **2.16–2.54 MB/s** | 24.60–29.00 ms | 29.05 ms | 37.41 ms |

### 4. `node-firebird-driver-wire` — External Pure JS Wire Driver

| Benchmark | Throughput | Mean / op | p50 | p95 |
| :--- | ---: | ---: | ---: | ---: |
| Point `SELECT` by PK (prepared / cached stmt) | **1,156 queries/s** | 865.03 µs | 814.51 µs | 1.16 ms |
| Point `SELECT` by PK (prepare + exec + dispose) | **636 queries/s** | 1.57 ms | 1.58 ms | 2.03 ms |
| `SELECT` 1,000 rows -> Objects | **46,830 rows/s** | 21.35 ms | 20.64 ms | 32.99 ms |
| `SELECT` 1,000 rows -> Arrays | **49,983 rows/s** | 20.01 ms | 19.78 ms | 21.80 ms |
| Bulk `INSERT` 200 rows (single transaction) | **4,142 rows/s** | 48.29 ms | 47.76 ms | 58.81 ms |
| `BLOB` 64 KB write round-trip | **2.15 MB/s** | 29.10 ms | 26.77 ms | 37.76 ms |

---

## Architectural Analysis: Why `node-firebird (wire)` Wins

1. **Multi-Row `SELECT` Materialization (`5.6x` faster than `native`, `2.0x` faster than `driver-wire`):**
   - `node-firebird (wire)` decodes complete `op_fetch_response` packets synchronously inside V8 from a single contiguous buffer (`XdrReader`) and constructs row objects with a pre-computed column key table (`99,447 rows/s` for arrays, `95,600 rows/s` median for objects).
   - `node-firebird-driver-native` calls `IResultSet::fetchNext` across the Node N-API `AsyncWorker` threadpool boundary **once per row**, incurring libuv work-queue scheduling and Promise creation on every single row (`~17,500 rows/s`).
   - `node-firebird-driver-wire` allocates a separate `Buffer` per row via `readPackedMessageBuffer` and decodes each column asynchronously through `Promise.all(mappers.map(...))` on every row (`~47,000–50,000 rows/s`).

2. **Statement Preparation & Point Queries (`1.51x–1.72x` faster than `driver-wire`):**
   - On Protocol 11+, `node-firebird (wire)` pipelines `op_allocate_statement` + `op_prepare_statement` with inline `DESCRIBE` metadata items in a single lazy-send packet, avoiding extra metadata round-trips when the buffer fits.
   - `node-firebird-driver-wire` always sends two additional `op_info_sql` round-trips (`STATEMENT_SELECT_INFO_ITEMS` and `STATEMENT_BIND_INFO_ITEMS`) after every `op_prepare_statement`.

3. **Bulk `INSERT` / DML Batching (`2.8x–4.3x` faster than both other drivers):**
   - `node-firebird (wire)` implements Firebird 4.0+ Protocol 16+ wire batching (`op_batch_create`, `op_batch_msg`, `op_batch_exec`, `op_batch_rls`) via `executeBatchAsync()` and `createBatchStream()`, streaming all 200 parameter rows in a single network round-trip.
   - Neither `node-firebird-driver-native` nor `node-firebird-driver-wire` exposes Firebird's `IBatch` / wire batch protocol, requiring 200 sequential `stmt.execute()` round-trips.

4. **When to Use `{ native: true }` (`node-firebird-driver-native`):**
   - **Embedded / Serverless Connections (`embedded: true`):** `libfbclient.so` / `fbclient.dll` can open local `.fdb` files directly in-process via Firebird's Engine13 provider without a TCP server listening on port 3050.
   - **OS-Level / Custom Auth Plugins:** Environments that rely on custom client-side Firebird authentication plugins or local IPC transports bundled with `libfbclient`.

---

## Reproducing These Benchmarks

```bash
# Run the head-to-head comparison against a local Firebird server:
npm run bench:compare

# Or with custom connection settings:
ISC_HOST=127.0.0.1 ISC_PORT=3050 ISC_USER=SYSDBA ISC_PASSWORD=masterkey FIREBIRD_DATA=/tmp npm run bench:compare

# Emit machine-readable JSON:
node benchmarks/index.js --compare --json
```
