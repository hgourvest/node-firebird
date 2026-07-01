# Copilot instructions for node-firebird

Pure JavaScript, dependency-free, asynchronous Firebird database client for Node.js. There is no
native binding — the entire wire protocol is reimplemented in JS under `lib/wire/`.

## Build, lint, and test

- No build step; plain CommonJS, `main` is `./lib` (see `lib/index.js` for the public API surface).
- Lint: `npm run lint` (runs `oxlint`, config implied by defaults — no custom oxlint config file).
- Test: `npm test` (runs `vitest run`). Tests **require a live Firebird server** reachable at
  `127.0.0.1:3050` with user `SYSDBA` / password `masterkey` (see `test/config.js`). Locally, start
  one with Docker:
  ```bash
  docker run -d --name firebird -e FIREBIRD_ROOT_PASSWORD="masterkey" -p 3050:3050 firebirdsql/firebird:5
  ```
- Run a single test file: `npx vitest run test/srp.js`.
- Run a single test by name: `npx vitest run test/index.js -t "should attach or create database"`.
- The set of test files that are part of the suite is explicitly listed in `vitest.config.js`
  (`test.include`) — a new `test/*.js` file will NOT be picked up automatically, it must be added
  to that array.
- `vitest.config.js` forces `fileParallelism: false`, `maxWorkers: 1`, `isolate: false`: tests share
  one Firebird connection/server and must not run concurrently across files.
- CI (`.github/workflows/node.js.yml`) runs the matrix across Node 20/22/24/26 and Firebird
  3/4/5/6-snapshot via Docker; see `CI_DEBUGGING_GUIDE.md` for how to inspect Firebird server logs
  on failed CI runs (`docker exec firebird tail -n 100 /firebird/log/firebird.log`).

## Architecture

- `lib/index.js` — public entry point: `attach`, `create`, `attachOrCreate`, `drop`, `pool`,
  `escape`, plus re-exported constants (isolation levels, auth plugins, wire-crypt modes). All of
  these open a raw `Connection` (`lib/wire/connection.js`) first, then negotiate the Firebird wire
  protocol on it.
- `lib/wire/connection.js` (~2900 lines) is the core of the driver: TCP socket handling, wire
  protocol op-code encoding/decoding (`op_attach`, `op_execute`, `op_fetch`, ...), authentication
  handshake (delegates SRP math to `lib/srp.js`, legacy hashing to `lib/unix-crypt.js`), blob
  read/write chunking, and response parsing (`decodeResponse`/`parseOpResponse`).
- `lib/wire/database.js`, `transaction.js`, `statement.js`, `xsqlvar.js` are thin wrappers around
  `Connection` that expose the object-oriented `db.query()` / `db.transaction()` / prepared
  statement API; `xsqlvar.js` also handles Firebird SQL type <-> JS type conversion (including
  DECFLOAT via `lib/ieee754-decimal.js`).
- `lib/wire/service.js` and `eventConnection.js`/`fbEventManager.js` implement the Services API
  (backup/restore, user management, etc.) and Firebird `POST_EVENT` notifications, respectively —
  both are separate wire sub-protocols layered on the same `Connection`/socket machinery.
- `lib/pool.js` implements connection pooling on top of `exports.attach`, with a documented
  lifecycle (idle → creating → in-use → idle) and safeguards for `connectTimeout` and slot leaks
  on `pool.destroy()` — see the state diagram in `README.md` under "Pool Lifecycle State Diagram".
- `lib/callback.js` (`doError`/`doCallback`) is the shared helper that normalizes Firebird wire
  error responses into `Error` objects with `.gdscode`/`.gdsparams` attached; used throughout
  `connection.js` instead of ad hoc error handling.
- `lib/gdscodes.js` is a large generated-style lookup table (GDS error code -> symbolic name), not
  meant to be hand-edited piecemeal.
- Authentication supports multiple plugins negotiated at connect time (Legacy, Srp, Srp256/384/512)
  — see `SRP_PROTOCOL.md` for the handshake details and `BIGINT_MIGRATION.md` for why SRP math uses
  native `BigInt` (do not reintroduce a `BigInt` shadowing import/library — it silently breaks hex
  parsing of the server's public key).

## Conventions

- Public/internal APIs are Node-style error-first callbacks (`function(err, result)`), not
  Promises — this is true throughout `lib/`. Tests wrap callbacks in a local `fromCallback()`
  helper (see `test/index.js`) to use `async/await`, but production code should stay
  callback-based for consistency with the rest of the driver.
- Errors from the wire protocol carry `gdscode` and `gdsparams` (see `lib/callback.js`); prefer
  reading/propagating these fields rather than parsing `error.message`.
- `options.lowercase_keys` controls whether result row keys are lowercased; this is threaded through
  many layers (`connection.js`, `xsqlvar.js`) — keep it in mind when touching row-decoding code.
- Test database files (`test/*.fdb`, `*.fbk`) are created per-run with a timestamp+random suffix
  (see `test/config.js`) and are gitignored; don't hardcode a single shared `.fdb` path in new tests.
