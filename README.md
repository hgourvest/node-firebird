# Pure JavaScript and Asynchronous Firebird client for Node.js

![Firebird Logo](https://firebirdsql.org/file/about/firebird-logo-90.png)

[![NPM version][npm-version-image]][npm-url] [![NPM downloads][npm-downloads-image]][npm-url] [![Mozilla License][license-image]][license-url]

[![NPM](https://nodei.co/npm/node-firebird.png?downloads=true&downloadRank=true)](https://nodei.co/npm/node-firebird/)

## Table of contents

- [Installation](#installation)
- [Usage](#usage) — including [developing the driver](#developing-the-driver)
- [Promises and async/await](#promises-and-asyncawait) — the `*Async` API plus `withConnection` / `withTransaction` helpers
- [Connection types](#connection-types) — connection options, `firebird://` URIs and traditional connection strings, classic connections, pooling
- [Database object (db)](#database-object-db) — database, transaction and statement methods/options
- [Examples](#examples) — parametrized queries, named placeholders, custom type parsers (typeCast), BLOBs, streaming big data, transactions, driver events, database events (POST_EVENT), service manager, charsets/encoding, Firebird 3.0–6.0 features
- [Extensive Examples](#extensive-examples) — DECFLOAT/INT128, query cancellation (AbortSignal), batch execution (bulk inserts), statement timeouts, scrollable cursors, RETURNING multiple rows, SKIP LOCKED, advanced pooling
- [Using node-firebird with Express.js](#using-node-firebird-with-expressjs)
- [FAQ](#faq)
- [Contributing](#contributing) · [Contributors](#contributors)

## Community & resources

- [Firebird forum](https://groups.google.com/forum/#!forum/node-firebird) on Google Groups — questions and discussion
- [GitHub issues](https://github.com/hgourvest/node-firebird/issues) — bug reports and feature requests
- [ROADMAP](ROADMAP.md) — planned work and protocol implementation status
- Driver internals: [SRP authentication protocol](docs/SRP_PROTOCOL.md) · [database encryption key callback](docs/ENCRYPTION_CALLBACK.md)
- Firebird itself: [documentation](https://firebirdsql.org/en/documentation/) · [limits and data types](https://firebirdsql.org/en/firebird-technical-specifications/) · [Twitter/X](https://twitter.com/firebirdsql/) · [Facebook](https://www.facebook.com/FirebirdSQL)

## Installation

```bash
npm install node-firebird
```

The driver is pure JavaScript at runtime — no native addons and no runtime
dependencies. Node.js 20 or newer is supported (CI runs on Node 20, 22, 24
and 26 against Firebird 3, 4, 5 and 6).

## Usage

```js
var Firebird = require('node-firebird');
```

TypeScript is fully supported — the driver itself is written in TypeScript and
ships its own type declarations:

```ts
import * as Firebird from 'node-firebird';
import type { Options, Database } from 'node-firebird';
```

### Developing the driver

Since v2.4.0 the driver is written in TypeScript and compiled with the native
TypeScript 7 compiler (`tsc`). The published package ships both the compiled
output and the sources.

**Requirements**

- Node.js >= 20 (CI matrix: 20, 22, 24, 26)
- npm (TypeScript 7 and all tooling are installed as devDependencies — no
  global installs needed)
- a Firebird server on `127.0.0.1:3050` with `SYSDBA`/`masterkey` for the
  integration tests (CI tests against Firebird 3, 4, 5 and 6-snapshot); the
  unit tests under `test/unit/` run without a server

The quickest way to get a test server is Docker:

```bash
docker run -d --name firebird -p 3050:3050 \
  -e FIREBIRD_ROOT_PASSWORD=masterkey \
  firebirdsql/firebird:5
```

**Layout**

- `src/` — the TypeScript sources; this is what you edit
- `lib/` — compiled CommonJS + generated `.d.ts` declarations; build output,
  gitignored — never edit it by hand
- `test/` — vitest suite (integration tests at the top level, server-free
  tests in `test/unit/`)

**Workflow**

```bash
npm install        # installs deps and builds lib/ via the prepare script
npm run build      # compile src/ -> lib/
npm run typecheck  # type-check sources and tests without emitting
npm run lint       # oxlint
npm test           # build + run the vitest suite (unit + integration)
```

### Methods

- `Firebird.escape(value) -> return {String}` - prevent for SQL Injections
- `Firebird.attach(options, function(err, db))` attach a database
- `Firebird.create(options, function(err, db))` create a database
- `Firebird.attachOrCreate(options, function(err, db))` attach or create database
- `Firebird.pool(max, options) -> return {Object}` create a connection pooling
- `Firebird.attachAsync(options) -> Promise<Database>`, `createAsync`, `attachOrCreateAsync`, `dropAsync` — promise counterparts, see [Promises and async/await](#promises-and-asyncawait)

## Promises and async/await

Every callback API has a promise-returning counterpart with an `Async`
suffix, plus two higher-level helpers: `pool.withConnection()` and
`db.withTransaction()`. The callback API is unchanged and the two styles can
be mixed freely, though sticking to one per project keeps code readable.

```js
const Firebird = require('node-firebird');

const pool = Firebird.pool(5, options);

// acquire → work → always release, even when `work` throws
const users = await pool.withConnection((db) =>
    db.queryAsync('SELECT id, name FROM users WHERE plan = ?', ['pro'])
);

// commit on success, rollback on error
await pool.withConnection((db) =>
    db.withTransaction(async (transaction) => {
        await transaction.executeAsync('INSERT INTO audit (msg) VALUES (?)', ['signup']);
        await transaction.executeAsync('UPDATE stats SET signups = signups + 1');
    })
);

await pool.destroyAsync();
```

Available wrappers:

- **module** — `Firebird.attachAsync(options)`, `createAsync`, `attachOrCreateAsync`, `dropAsync`; resolve with a `Database` (or a `ServiceManager` when `options.manager` is `true`)
- **pool** — `pool.getAsync()`, `pool.destroyAsync()`, `pool.withConnection(work)`
- **database** — `db.queryAsync(sql, params?, options?)`, `executeAsync`, `executeBatchAsync(sql, rows, options?)`, `sequentiallyAsync(sql, params?, onRow, options?)`, `transactionAsync(options?)`, `newStatementAsync(sql)`, `attachEventAsync()`, `detachAsync()`, `dropAsync()`, `db.withTransaction(work, options?)`
- **transaction** — `queryAsync`, `executeAsync`, `executeBatchAsync`, `sequentiallyAsync`, `newStatementAsync`, `commitAsync`, `rollbackAsync`, `commitRetainingAsync`, `rollbackRetainingAsync`
- **statement** — `executeAsync(transaction, params?, options?)`, `executeBatchAsync(transaction, rows, options?)`, `fetchAsync`, `fetchScrollAsync`, `fetchAllAsync`, `closeAsync`, `dropAsync`, `releaseAsync`
- **service manager** — every [Service Manager function](#service-manager-functions) has an `*Async` counterpart (`backupAsync`, `restoreAsync`, `getUsersAsync`, `addUserAsync`, `getFbserverInfosAsync`, `startTraceAsync`, …); stream-producing functions resolve with the `Readable`, info functions with the info object

Notes:

- Rejections are always `Error` instances carrying the usual Firebird
  properties (`err.gdscode`, `err.gdsparams`) — see [Using GDS codes](#using-gds-codes).
- `queryAsync` / `executeAsync` resolve with the rows only; column metadata
  is currently available through the callback API only.
- An un-`await`ed rejected promise becomes an unhandled rejection instead of
  a callback error — prefer the `withConnection` / `withTransaction` helpers,
  which guarantee cleanup on every path.
- TypeScript: the async methods accept a row-shape generic, e.g.
  `db.queryAsync<User>(sql, params)` returns `Promise<User[]>`.

## Connection types

### Connection options

```js
var options = {};

options.host = '127.0.0.1';
options.port = 3050;
options.database = 'database.fdb';
options.user = 'SYSDBA';
options.password = 'masterkey';
options.lowercase_keys = false; // set to true to lowercase keys
options.role = null; // default
options.pageSize = 4096; // default when creating database
options.retryConnectionInterval = 1000; // reconnect interval in case of connection drop
options.blobAsText = false; // set to true to get blob as text, only affects blob subtype 1
options.blobChunkSize = 1024; // segment size in bytes used when WRITING blobs (default 1024, max 65535)
options.blobReadChunkSize = 1024; // buffer size in bytes requested per op_get_segment when READING blobs (default 1024, max 65535)
options.encoding = 'UTF8'; // default encoding for connection is UTF-8
options.wireCompression = false; // set to true to enable firebird compression on the wire (works only on FB >= 3 and compression is enabled on server (WireCompression = true in firebird.conf))
options.wireCrypt = Firebird.WIRE_CRYPT_ENABLE; // default; set to Firebird.WIRE_CRYPT_DISABLE to disable wire encryption (FB >= 3)
options.pluginName = undefined; // optional, auto-negotiated; can be set to Firebird.AUTH_PLUGIN_SRP256, Firebird.AUTH_PLUGIN_SRP, or Firebird.AUTH_PLUGIN_LEGACY
options.dbCryptConfig = undefined; // optional; database encryption key for encrypted databases. Use 'base64:<value>' for base64-encoded keys or plain text
options.connectTimeout = 10000; // optional; timeout in ms for a single pool.get() attach operation (default: no timeout)
options.enableKeepAlive = true; // TCP keepalive probing to detect dead/stale connections (same option names as mysql2); set to false to disable
options.keepAliveInitialDelay = 60000; // ms a socket must be idle before the first keepalive probe (ignored when enableKeepAlive is false)
options.parallelWorkers = undefined; // optional; request multiple thread workers for maintenance/index tasks (FB >= 5)
options.maxInlineBlobSize = undefined; // optional; threshold size in bytes for inline blob transmission (default 65535, FB >= 5.0.3)
options.maxNegotiatedProtocols = 10; // optional; limit maximum protocol versions negotiated (default 10 for compatibility, set to 11 for FB >= 6.0)
options.defaultSchema = undefined; // optional; sets session CURRENT_SCHEMA at connect time (FB >= 6.0)
options.searchPath = undefined; // optional; ordered list/array of schemas to resolve unqualified object references (FB >= 6.0)
options.jsonAsObject = false; // optional; automatically stringify parameters and parse query results that contain JSON (FB >= 6.0)
options.namedPlaceholders = false; // set to true to allow :name placeholders in SQL with a { name: value } params object (see Named placeholders)
options.typeCast = undefined; // optional; custom type parser called for every result column value (see Custom type parsers)
options.statementCacheSize = 0; // optional; per-connection LRU cache of prepared statements, 0 = disabled (see Prepared-statement cache)
```

### Connection URI strings

Everywhere an options object is accepted — `attach`, `create`,
`attachOrCreate`, `drop`, `Firebird.pool()` and their `*Async`
counterparts — a `firebird://` URI string works too, which is handy for
12-factor apps and containers that configure the database via a single
environment variable:

```js
const db = await Firebird.attachAsync(process.env.DATABASE_URL);
// e.g. DATABASE_URL=firebird://SYSDBA:masterkey@db.example.com:3050//var/fb/prod.fdb?encoding=UTF8

const pool = Firebird.pool(10,
    'firebird://app:secret@localhost/appdb?lowercase_keys=true&idleTimeoutMillis=30000');
```

The database part after `host[:port]/` can be:

| URI | database |
| :--- | :--- |
| `firebird://host/employee` | the alias `employee` |
| `firebird://host//var/fb/prod.fdb` | `/var/fb/prod.fdb` (explicit absolute path) |
| `firebird://host/var/fb/prod.fdb` | `/var/fb/prod.fdb` (a database part with `/` is a path — aliases cannot contain slashes) |
| `firebird://host/C:/fbdata/prod.fdb` | the Windows path `C:/fbdata/prod.fdb` |

Query parameters map 1:1 onto the connection options above and are coerced
to the right type (`?pageSize=8192&lowercase_keys=true&wireCompression=1`).
Credentials and paths are URL-decoded, so reserved characters can be
percent-encoded (`p%40ss` for `p@ss`); `user`/`password` may alternatively
be passed as query parameters. IPv6 hosts use brackets:
`firebird://[::1]:3050/employee`. The parser is exported as
`Firebird.parseConnectionUri(uri)` if you need the resulting options object.

### Traditional connection strings (old style)

The classic Firebird connection string format — the same
`[host[/port]:]{path | alias}` strings isql and the other Firebird tools
use — is accepted everywhere too:

```js
const db = await Firebird.attachAsync('db.example.com/3051:/var/fb/prod.fdb');
```

| Connection string | meaning |
| :--- | :--- |
| `employee` | the alias `employee` on `127.0.0.1:3050` |
| `/var/fb/prod.fdb` | a path on `127.0.0.1:3050` |
| `db.example.com:employee` | the alias `employee` on `db.example.com:3050` |
| `db.example.com/3051:/var/fb/prod.fdb` | host and explicit port |
| `myserver:C:\fbdata\prod.fdb` | a Windows path behind a host |
| `C:\fbdata\prod.fdb` | a single character before `:` is a drive letter, not a host (same rule as Firebird) |
| `[::1]/3050:employee` | IPv6 hosts use brackets |

Unlike `firebird://` URIs, traditional strings carry no credentials or
options — the driver defaults apply (`SYSDBA`/`masterkey`, port 3050), and
the port must be numeric (`/etc/services` names are not resolved). Use the
URI form or an options object when you need to set anything else.
`Firebird.parseConnectionString(str)` parses both forms and is what
`attach`/`create`/`pool` use internally for string arguments.

### Classic

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.query('SELECT * FROM TABLE', function (err, result) {
    // IMPORTANT: close the connection
    db.detach();
  });
});
```

### Pooling

```js
// 5 = the number is count of opened sockets
var pool = Firebird.pool(5, options);

// Get a free pool
pool.get(function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.query('SELECT * FROM TABLE', function (err, result) {
    // IMPORTANT: release the pool connection
    db.detach();
  });
});

// Destroy pool
pool.destroy();
```

#### Pool events and metrics

The pool is an `EventEmitter` and exposes live counters, following the
`pg.Pool` conventions:

```js
const pool = Firebird.pool(10, {
    ...options,
    idleTimeoutMillis: 30000, // close connections idle for 30s…
    min: 2,                   // …but always keep 2 alive
    connectTimeout: 5000,
});

pool.on('connect', (db) => console.log('new server connection'));
pool.on('acquire', (db) => console.log('connection handed to a caller'));
pool.on('release', (db) => console.log('connection returned to the pool'));
pool.on('remove',  (db) => console.log('connection closed & removed'));
pool.on('error',   (err, db) => console.error('background pool error', err));

// live metrics — e.g. for a /health endpoint or periodic monitoring
console.log({
    total:   pool.totalCount,   // physical connections (idle + in use)
    idle:    pool.idleCount,    // available in the pool
    active:  pool.activeCount,  // handed out to callers
    waiting: pool.waitingCount, // get() calls queued for a free slot
});
```

- `idleTimeoutMillis` closes connections that sat idle in the pool for that
  long, never shrinking below `min` — long-lived pools no longer hold every
  connection they ever created (issue [#329](https://github.com/hgourvest/node-firebird/issues/329)).
  The sweep also evicts idle connections whose socket has died, so callers
  don't receive them after a server restart (issue [#343](https://github.com/hgourvest/node-firebird/issues/343)).
- `error` is a background-error channel (idle eviction failures and the
  like); unlike a plain `EventEmitter`, it is only emitted when a listener
  is attached, so existing applications keep working unchanged.
- Metrics are plain getters — reading them has no side effects.

#### Advanced Pooling Features

The pool implementation includes several safeguards for reliability:

1.  **Connection Timeout**: Use `options.connectTimeout` to prevent the pool from hanging if a server accepts the TCP connection but fails to respond to the Firebird wire protocol (e.g., during high load or authentication stalls).
2.  **Pool Destruction**: Calling `pool.destroy()` now immediately drains the `pending` queue, notifying all waiting callers with an error. It also prevents any further `pool.get()` calls.
3.  **Slot Recovery**: If a connection attempt times out, the pool slot is correctly freed so subsequent requests can be served. Late-arriving connections are automatically discarded to prevent resource leaks.
4.  **Idle Reaping & Health**: `idleTimeoutMillis`/`min` shrink the pool when traffic drops and evict dead idle connections (see [Pool events and metrics](#pool-events-and-metrics)).

#### Pool Lifecycle State Diagram

```mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Destroying: pool.destroy()
    Destroying --> Destroyed: all connections detached
    Destroyed --> [*]

    state Active {
        [*] --> Idle
        Idle --> Creating: pool.get() [no idle db]
        Creating --> InUse: attach() success
        Creating --> Idle: attach() failure/timeout
        Idle --> InUse: pool.get() [idle db exists]
        InUse --> Idle: db.detach()
    }

    state Destroying {
        [*] --> DrainingPending
        DrainingPending --> DetachingIdle
        DetachingIdle --> WaitingForInUse
        WaitingForInUse --> [*]
    }
```

#### Connect Timeout Sequence

```mermaid
sequenceDiagram
    participant User
    participant Pool
    participant Firebird
    User->>Pool: pool.get()
    Pool->>Pool: increment _creating
    Pool->>Pool: start timer (connectTimeout)
    Pool->>Firebird: attach(options)
    Note over Firebird: Server accepts TCP but hangs
    Pool-->>Pool: timer expires
    Pool->>Pool: decrement _creating
    Pool-->>User: callback(Error: Connection timeout)
    Note over Firebird: Server eventually responds
    Firebird-->>Pool: attach callback(db)
    Pool->>Firebird: db.detach() (discard late connection)
```

## Database object (db)

### Database Methods

- `db.query(query, [params], function(err, result), options)` - classic query, returns Array of Object
- `db.execute(query, [params], function(err, result), options)` - classic query, returns Array of Array
- `db.executeBatch(query, rows, function(err, result), options)` - bulk execution in one round-trip, all-or-nothing (FB >= 4.0, see [Batch Execution](#batch-execution-firebird-40))
- `db.sequentially(query, [params], function(row, index), function(err), options)` - sequentially query
- `db.detach(function(err))` detach a database
- `db.transaction(options, function(err, transaction))` create transaction
- `db.createTablespace(name, filePath, function(err, result))` - Create a physical tablespace (FB >= 6.0)
- `db.alterTablespace(name, filePath, function(err, result))` - Alter an existing tablespace physical location (FB >= 6.0)
- `db.dropTablespace(name, function(err, result))` - Drop a tablespace (FB >= 6.0)
- `db.createSchema(schemaName, [tablespaceName], function(err, result))` - Create a schema/namespace, optionally binding it to a tablespace (FB >= 6.0)

### Transaction options

```js
const options = {
    autoCommit: false,
    autoUndo: true,
    isolation: Firebird.ISOLATION_READ_COMMITTED,
    ignoreLimbo: false,
    readOnly: false,
    wait: true,
    waitTimeout: 0,
};
```

### Transaction methods

- `transaction.query(query, [params], function(err, result), options)` - classic query, returns Array of Object
- `transaction.execute(query, [params], function(err, result), options)` - classic query, returns Array of Array
- `transaction.executeBatch(query, rows, function(err, result), options)` - bulk execution with per-record errors (FB >= 4.0, see [Batch Execution](#batch-execution-firebird-40))
- `transaction.sequentially(query, [params], function(row, index), function(err), options)` - sequentially query
- `transaction.commit(function(err))` commit current transaction
- `transaction.rollback(function(err))` rollback current transaction

### Statement options 

```js
const options = {
  timeout: 1000, // Statement timeout in ms, default is 0 (no timeout)
}
```

## Examples

### Parametrized Queries

### Parameters

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.query(
    'INSERT INTO USERS (ID, ALIAS, CREATED) VALUES(?, ?, ?) RETURNING ID',
    [1, "Pe'ter", new Date()],
    function (err, result) {
      console.log(result[0].id);
      db.query(
        'SELECT * FROM USERS WHERE Alias=?',
        ['Peter'],
        function (err, result) {
          console.log(result);
          db.detach();
        }
      );
    }
  );
});
```

### Named placeholders

With the `namedPlaceholders: true` connection option, SQL may use `:name`
markers and parameters may be passed as a values-by-name object instead of
a positional array. The rewrite happens client-side before the statement is
prepared, so it works on every Firebird version; positional `?` arrays keep
working unchanged on the same connection.

```js
const db = await Firebird.attachAsync({ ...options, namedPlaceholders: true });
// or: firebird://user:pass@host/db?namedPlaceholders=true

const rows = await db.queryAsync(
  'SELECT * FROM USERS WHERE ALIAS = :alias AND CREATED > :since',
  { alias: 'Peter', since: new Date(2026, 0, 1) });

// A name may repeat — it binds once per occurrence:
await db.queryAsync(
  'SELECT * FROM T WHERE A = :v OR B = :v', { v: 42 });

// Batch rows can be objects too (Firebird 4.0+):
await db.executeBatchAsync(
  'INSERT INTO USERS (ID, ALIAS) VALUES (:id, :alias)',
  [{ id: 1, alias: 'a' }, { id: 2, alias: 'b' }]);
```

Placeholders inside string literals (`'...'`), quoted identifiers (`"..."`),
comments and `q'{...}'` alternative literals are left untouched. A key
present with value `null` binds SQL `NULL`; a *missing* key raises
`Missing value for named placeholder(s): ...`.

The scanner has no SQL grammar, so inside an `EXECUTE BLOCK` body every
PSQL `:variable` reference looks like a placeholder too. The option is
therefore off by default — and can be disabled for a single statement with
the per-query option:

```js
await db.queryAsync(execBlockSql, [], { namedPlaceholders: false });
```

### Custom type parsers (typeCast)

The `typeCast` connection option lets you override how column values are
decoded, per SQL type or per column — the same idea as mysql2's `typeCast`
and pg's `setTypeParser`. The hook is called for **every column value of
every result row** (including `NULL`s); whatever it returns becomes the
value in the row. Call `next()` to get the value the driver would produce
by default (after `blobAsText` / `jsonAsObject` are applied).

```js
const Firebird = require('node-firebird');

Firebird.attach({
    ...options,
    typeCast: (column, next) => {
        // dates as ISO strings instead of Date objects
        if (column.typeName === 'DATE') {
            const v = next();
            return v === null ? null : v.toISOString().slice(0, 10);
        }
        // BIGINT columns as strings
        if (column.type === Firebird.SQL_TYPES.SQL_INT64 && !column.scale) {
            return String(next());
        }
        return next(); // everything else: default decoding
    },
}, (err, db) => { /* ... */ });
```

`column` describes the result column:

| Property   | Meaning                                                             |
| :--------- | :------------------------------------------------------------------ |
| `type`     | Firebird SQL type code — compare against `Firebird.SQL_TYPES.*`      |
| `typeName` | Friendly name: `'VARYING'`, `'INT64'`, `'DATE'`, `'BLOB'`, ...       |
| `subType`  | Column subtype (`1` = text for BLOBs)                                |
| `scale`    | Negative decimal scale for `NUMERIC`/`DECIMAL` (e.g. `-2`)           |
| `length`   | Declared length in bytes                                             |
| `field`    | Column name in the table                                             |
| `relation` | Table name                                                           |
| `alias`    | SELECT-list alias (the row key for object rows)                      |

Notes:

- Non-text BLOB columns reach the hook as the usual asynchronous fetch
  function; text BLOBs with `blobAsText: true` reach it as the resolved
  string.
- The hook must be a **pure function** of its inputs: when a response
  spans multiple TCP packets the affected rows can be decoded more than
  once, calling the hook again for the same value.
- The hook runs for every value on the hot row-decoding path — keep it
  cheap, and prefer dispatching on `column.type`/`column.typeName` early.
- Exceptions thrown by the hook are caught: the default value is used and
  a warning is printed. A throw cannot be allowed to escape into the wire
  decoder, so validate inside the hook and encode failures in the value.

### Prepared-statement cache

Setting `statementCacheSize` keeps a per-connection LRU cache of prepared
statements (like mysql2's statement cache): running the same SQL string
again transparently reuses the already-prepared server-side statement,
skipping the prepare round-trip. No API changes are needed — `db.query`,
`tx.query`, `sequentially`, `executeBatch` and the `*Async` wrappers all
benefit automatically.

```js
Firebird.attach({ ...options, statementCacheSize: 100 }, (err, db) => {
    // the second identical query reuses the prepared statement
    db.query('SELECT * FROM t WHERE id = ?', [1], () => {
        db.query('SELECT * FROM t WHERE id = ?', [2], () => { /* ... */ });
    });
});
```

How it works:

- The number is the maximum of **idle** statements kept per connection;
  the least-recently-used statement is dropped when the limit is exceeded.
- A cached statement leaves the cache while in use, so concurrent runs of
  the same SQL never share a server-side cursor — extra preparations run
  in parallel and only one goes back into the cache.
- Statements that failed and DDL statements are never cached.
- Cache keys are exact SQL strings (after the `namedPlaceholders`
  rewrite), so use parametrized queries to get hits.
- The legacy `cacheQuery: true` / `maxCachedQuery` options remain
  supported and now map onto the same LRU cache (with a default limit of
  100 instead of the old unbounded map).

> **Note (DDL):** a statement prepared before a metadata change (e.g.
> `ALTER TABLE`) may fail when reused. If you mix DDL with hot queries on
> the same connection, keep the cache small or disabled.

### Streaming rows with queryStream

`db.queryStream(sql, params, options)` returns an **object-mode
`Readable`** emitting one row per chunk — the counterpart of
`pg-query-stream` and mysql2's `.stream()`. It is built on
`sequentially()`'s backpressure: fetching from the server pauses while
the stream's buffer is full and resumes as the consumer drains it, so
constant memory is used regardless of the result size.

```js
const { pipeline } = require('stream/promises');

// async iteration
for await (const row of db.queryStream('SELECT * FROM big_table')) {
    console.log(row.ID);
}

// or piping into any Writable/Transform (HTTP response, CSV encoder, ...)
await pipeline(
    db.queryStream('SELECT * FROM big_table WHERE grp = ?', [42]),
    myCsvTransform,
    res);
```

- `db.queryStream` runs in its own transaction (like `db.query`);
  `transaction.queryStream` runs inside your transaction, which is *not*
  committed when the stream ends.
- Destroying the stream early — including an error mid-`pipeline()` —
  aborts the fetch and releases the statement; the connection stays
  usable.
- Options: everything `query` accepts (e.g. `signal`), plus
  `highWaterMark` (rows buffered before fetching pauses, default 16) and
  `asObject: false` for array rows.
- Rows go through the regular decode path, so `typeCast`, `blobAsText`
  and `jsonAsObject` all apply.

### Tablespaces and Schema Partitioning (Firebird 6.0+)

For Firebird 6.0+ (Protocol 20+), you can create and manage physical tablespace locations and logical schema namespaces, optionally partitioning schemas into specific physical tablespaces.

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // 1. Create a physical tablespace mapping to a physical storage location
  db.createTablespace('FAST_TS', '/ssd/fast_data.ts', function (err, result) {
    if (err) throw err;
    console.log('Tablespace FAST_TS created successfully');

    // 2. Create a schema namespace and partition it into the FAST_TS tablespace
    db.createSchema('MYSCHEMA', 'FAST_TS', function (err, result) {
      if (err) throw err;
      console.log('Schema MYSCHEMA partitioned to FAST_TS');

      // 3. Drop tablespace when no longer needed
      // db.dropTablespace('FAST_TS', function (err, result) { ... });

      db.detach();
    });
  });
});
```

### Native JSON Data Type Support (Firebird 6.0+)

By enabling the `jsonAsObject` connection parameter, the driver will automatically serialize JavaScript objects/arrays passed as query parameters to JSON strings, and automatically parse returned JSON text/BLOB columns back into JavaScript objects/arrays.

```js
const options = {
    // ...other connection options
    jsonAsObject: true,
    blobAsText: true  // recommended to read text BLOBs as strings
};

Firebird.attach(options, function (err, db) {
  if (err) throw err;

  const data = { name: 'Alice', age: 30, roles: ['admin', 'user'] };

  db.query(
    'INSERT INTO USERS (ID, PROFILE_JSON) VALUES (?, ?)',
    [1, data],
    function (err, result) {
      if (err) throw err;

      db.query(
        'SELECT PROFILE_JSON FROM USERS WHERE ID = ?',
        [1],
        function (err, result) {
          if (err) throw err;
          // PROFILE_JSON is automatically parsed back to a JavaScript object
          console.log(result[0].profile_json); // { name: 'Alice', age: 30, roles: ['admin', 'user'] }
          db.detach();
        }
      );
    }
  );
});
```

### SQL-Standard ROW Type (Firebird 6.0+)

Firebird 6.0+ supports the SQL-standard `ROW` type representing composite records / tuples (e.g. `ROW(id INT, name VARCHAR(20))`). Since the database server compiles row value expressions into individual scalar columns/parameters at the wire interface, you can pass individual parameters or tuple arrays natively:

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // Use a row value expression / tuple comparison
  db.query(
    'SELECT * FROM USERS WHERE (ID, NAME) = (ROW(?, ?))',
    [1, 'Alice'],
    function (err, rows) {
      if (err) throw err;
      console.log(rows);
      db.detach();
    }
  );
});
```

For PSQL block declarations (triggers, procedures), you can declare and use `ROW`/`RECORD` variables (such as `DECLARE VARIABLE myrow ROW(id INT, name VARCHAR(20))`) directly within the compiled SQL strings executed via `db.query` or `db.execute`.

### BLOB (stream)

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  // INSERT STREAM as BLOB
  db.query(
    'INSERT INTO USERS (ID, ALIAS, FILE) VALUES(?, ?, ?)',
    [1, 'Peter', fs.createReadStream('/users/image.jpg')],
    function (err, result) {
      // IMPORTANT: close the connection
      db.detach();
    }
  );
});
```

### BLOB (buffer)

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  // INSERT BUFFER as BLOB
  db.query(
    'INSERT INTO USERS (ID, ALIAS, FILE) VALUES(?, ?, ?)',
    [1, 'Peter', fs.readFileSync('/users/image.jpg')],
    function (err, result) {
      // IMPORTANT: close the connection
      db.detach();
    }
  );
});
```

### Reading Blobs (Asynchronous)

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.query('SELECT ID, ALIAS, USERPICTURE FROM USER', function (err, rows) {
    if (err) throw err;

    // first row
    rows[0].userpicture(function (err, name, e) {
      if (err) throw err;

      // +v0.2.4
      // e.pipe(writeStream/Response);

      // e === EventEmitter
      e.on('data', function (chunk) {
        // reading data
      });

      e.on('end', function () {
        // end reading
        // IMPORTANT: close the connection
        db.detach();
      });
    });
  });
});
```

### Reading Multiples Blobs (Asynchronous)

```js
Firebird.attach(options, (err, db) => {
  if (err) throw err;

  db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, transaction) => {
    if (err) {
      throw err;
    }

    transaction.query('SELECT FIRST 10 * FROM JOB', (err, result) => {
      if (err) {
        transaction.rollback();
        return;
      }

      const arrBlob = [];
      for (const item of result) {
        const fields = Object.keys(item);
        for (const key of fields) {
          if (typeof item[key] === 'function') {
            item[key] = new Promise((resolve, reject) => {
              // the same transaction is used (better performance)
              // this is optional
              item[key](transaction, (error, name, event, row) => {
                if (error) {
                  return reject(error);
                }

                // reading data
                let value = '';
                event.on('data', (chunk) => {
                  value += chunk.toString('binary');
                });
                event.on('end', () => {
                  resolve({ value, column: name, row });
                });
              });
            });
            arrBlob.push(item[key]);
          }
        }
      }

      Promise.all(arrBlob)
        .then((blobs) => {
          for (const blob of blobs) {
            result[blob.row][blob.column] = blob.value;
          }

          transaction.commit((err) => {
            if (err) {
              transaction.rollback();
              return;
            }

            db.detach();
            console.log(result);
          });
        })
        .catch((err) => {
          transaction.rollback();
        });
    });
  });
});
```

### Optimizing BLOB Read/Write Chunk Sizes

When working with large blobs (especially over remote or high-latency connections), you can configure the chunk/segment sizes to minimize the number of network round-trips:

*   **blobChunkSize**: The segment size in bytes used when writing blobs (default: `1024`, maximum: `65535`).
*   **blobReadChunkSize**: The buffer size in bytes requested per segment read operation when reading blobs (default: `1024`, maximum: `65535`).

For example, setting `blobReadChunkSize: 65535` requests 64KB segments at a time, resulting in up to 64x fewer network packets/round-trips when reading large blobs.

```js
var options = {
    host: '127.0.0.1',
    port: 3050,
    database: 'database.fdb',
    user: 'SYSDBA',
    password: 'masterkey',
    blobChunkSize: 65535,      // Minimize write round-trips
    blobReadChunkSize: 65535   // Minimize read round-trips
};

Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // Insert/Read operations will use the configured 64KB chunk sizes
  db.detach();
});
```

### Streaming a big data

`db.query` / `db.execute` buffer the **entire** result set into memory as an array before your callback runs — fine for small/medium results, but a poor fit for big tables or unbounded exports (this is what causes "Sequential heap limit / allocation failed"-style errors on very large result sets). `db.sequentially` / `transaction.sequentially` stream rows one at a time to an `on(row, index)` callback instead: node-firebird never accumulates the rows itself, so memory use stays flat regardless of table size (the `rows` argument passed to the completion callback is always `[]`).

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.sequentially(
    'SELECT * FROM BIGTABLE',
    function (row, index) {
      // EXAMPLE
      stream.write(JSON.stringify(row));
    },
    function (err) {
      // END
      // IMPORTANT: close the connection
      db.detach();
    }
  );
});
```

#### Backpressure

Rows are still fetched from the server in batches (200 rows per round-trip) as fast as your `on` callback returns. If you're forwarding each row to something that can fall behind (an HTTP response, a file write stream, a rate-limited API), declare `on` with a third `next` parameter — or return a `Promise` — and node-firebird will wait for you to call it (or for the promise to resolve) before fetching or processing the next row:

```js
db.sequentially(
  'SELECT * FROM BIGTABLE',
  function (row, index, next) {
    // Only ask for the next row once the downstream write has drained.
    if (outputStream.write(JSON.stringify(row) + '\n')) {
      next();
    } else {
      outputStream.once('drain', next);
    }
  },
  function (err) {
    db.detach();
  }
);
```

#### Do / Don't

- **Do** use `sequentially` for large tables, full-table exports, or any query whose row count you can't bound in advance.
- **Do** use the 3-arg `on(row, index, next)` form (or return a `Promise` from `on`) when writing rows to something that applies its own backpressure, so unprocessed rows can't pile up faster than they're consumed.
- **Don't** use `db.query` / `db.execute` for big or unbounded result sets — both build the full array in memory before your callback ever runs.
- **Don't** assume the 2-arg `on(row, index)` form throttles you — it only guarantees node-firebird itself won't buffer rows; if your handler does async work without waiting on it (e.g. fire-and-forget writes), buffering can still build up on the *consumer* side.

### Transactions

**Transaction types:**

- `Firebird.ISOLATION_READ_UNCOMMITTED`
- `Firebird.ISOLATION_READ_COMMITTED`
- `Firebird.ISOLATION_REPEATABLE_READ`
- `Firebird.ISOLATION_SERIALIZABLE`
- `Firebird.ISOLATION_READ_COMMITTED_READ_ONLY`

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // db = DATABASE
  db.transaction(
    Firebird.ISOLATION_READ_COMMITTED,
    function (err, transaction) {
      transaction.query(
        'INSERT INTO users VALUE(?,?)',
        [1, 'Janko'],
        function (err, result) {
          if (err) {
            transaction.rollback();
            return;
          }

          transaction.commit(function (err) {
            if (err) transaction.rollback();
            else db.detach();
          });
        }
      );
    }
  );
});
```

### Driver Events

Driver events are synchronous notifications emitted on the `Database` object for connection-level operations. Subscribe with `db.on(eventName, handler)`.

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  db.on('attach', function () {
    // fired once the database is attached
  });

  db.on('detach', function (isPoolConnection) {
    // isPoolConnection === Boolean
  });

  db.on('reconnect', function () {
    // fired after the driver reconnects a dropped socket
  });

  db.on('error', function (err) {
    // connection-level errors (socket errors, closed connection, etc.)
  });

  db.on('transaction', function (options) {
    // fired when a transaction is started (before server response)
    // options === resolved transaction options object
  });

  db.on('commit', function () {
    // fired when a transaction commit is sent
  });

  db.on('rollback', function () {
    // fired when a transaction rollback is sent
  });

  db.on('query', function (sql) {
    // fired with the SQL string when a statement is prepared
  });

  db.on('row', function (row, index, isObject) {
    // fired for each row decoded during a fetch
    // index === Number, isObject === Boolean
  });

  db.on('result', function (rows) {
    // fired with the full rows array once all rows are fetched
    // rows === Array
  });

  db.detach();
});
```

### Firebird Database Events (POST_EVENT)

Firebird database events are **asynchronous** notifications triggered by `POST_EVENT` inside PSQL
triggers or stored procedures. They travel over a separate "aux" connection (opened via
`db.attachEvent()`) and are managed through a `FbEventManager` instance.

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  // 1. Open the aux event connection and get a FbEventManager
  db.attachEvent(function (err, evtmgr) {
    if (err) throw err;

    // 2. Subscribe to one or more named events (names must match POST_EVENT('name') in your
    //    PSQL triggers/procedures). Resolves once op_que_events is acknowledged by the server.
    evtmgr.registerEvent(['MY_EVENT'], function (err) {
      if (err) throw err;

      // 3. Listen for POST_EVENT notifications
      evtmgr.on('post_event', function (name, count) {
        // name  === event name string (e.g. 'MY_EVENT')
        // count === cumulative trigger count since last notification
      });
    });

    // 4. Unsubscribe from one or more events. Passing all currently registered names cancels
    //    the subscription (sends op_cancel_events); the manager re-subscribes automatically if
    //    other event names remain registered.
    // evtmgr.unregisterEvent(['MY_EVENT'], function (err) { ... });

    // 5. Inspect the current subscription state for debugging: returns
    //    { state, hasActiveSubscription, registeredEvents, eventId,
    //      isEventConnectionOpen, isDatabaseConnectionClosed }.
    //    state is one of 'IDLE' (aux connection open, no active subscription),
    //    'SUBSCRIBED' (op_que_events acknowledged) or 'CLOSED'.
    // const state = evtmgr.getState();

    // 6. Release the aux connection when done. Cancels any active subscription first, then
    //    gracefully closes the aux socket.
    // evtmgr.close(function (err) { ... });
  });
});
```

### Escaping Query values

```js
var sql1 = 'SELECT * FROM TBL_USER WHERE ID>' + Firebird.escape(1);
var sql2 = 'SELECT * FROM TBL_USER WHERE NAME=' + Firebird.escape("Pe'er");
var sql3 =
  'SELECT * FROM TBL_USER WHERE CREATED<=' + Firebird.escape(new Date());
var sql4 = 'SELECT * FROM TBL_USER WHERE NEWSLETTER=' + Firebird.escape(true);

// or db.escape()

console.log(sql1);
console.log(sql2);
console.log(sql3);
console.log(sql4);
```

### Using GDS codes

```js
var { GDSCode } = require('node-firebird/lib/gdscodes');
/*...*/
db.query(
  'insert into my_table(id, name) values (?, ?)',
  [1, 'John Doe'],
  function (err) {
    if (err.gdscode == GDSCode.UNIQUE_KEY_VIOLATION) {
      console.log('constraint name:' + err.gdsparams[0]);
      console.log('table name:' + err.gdsparams[0]);
      /*...*/
    }
    /*...*/
  }
);
```

### Service Manager functions

- backup
- restore
- fixproperties
- serverinfo
- database validation
- commit transaction
- rollback transaction
- recover transaction
- database stats
- users infos
- user actions (add modify remove)
- get firebird file log
- tracing

```js
// each row : fctname : [params], typeofreturn
var fbsvc = {
    "backup" : { [ "options"], "stream" },
    "nbackup" : { [ "options"], "stream" },
    "restore" : { [ "options"], "stream" },
    "nrestore" : { [ "options"], "stream" },
    "setDialect": { [ "database","dialect"], "stream" },
    "setSweepinterval": { [ "database","sweepinterval"], "stream" },
    "setCachebuffer" : { [ "database","nbpagebuffers"], "stream" },
    "BringOnline" : { [ "database"], "stream" },
    "Shutdown" : { [ "database","shutdown","shutdowndelay","shutdownmode"], "stream" },
    "setShadow" : { [ "database","activateshadow"], "stream" },
    "setForcewrite" : { [ "database","forcewrite"], "stream" },
    "setReservespace" : { [ "database","reservespace"], "stream" },
    "setReadonlyMode" : { [ "database"], "stream" },
    "setReadwriteMode" : { [ "database"], "stream" },
    "validate" : { [ "options"], "stream" },
    "commit" : { [ "database", "transactid"], "stream" },
    "rollback" : { [ "database", "transactid"], "stream" },
    "recover" : { [ "database", "transactid"], "stream" },
    "getStats" : { [ "options"], "stream" },
    "getLog" : { [ "options"], "stream" },
    "getUsers" : { [ "username"], "object" },
    "addUser" : { [ "username", "password", "options"], "stream" },
    "editUser" : { [ "username", "options"], "stream" },
    "removeUser" : { [ "username","rolename"], "stream" },
    "getFbserverInfos" : { [ "options", "options"], "object" },
    "startTrace" : { [ "options"], "stream" },
    "suspendTrace" : { [ "options"], "stream" },
    "resumeTrace" : { [ "options"], "stream" },
    "stopTrace" : { [ "options"], "stream" },
    "getTraceList" : { [ "options"], "stream" },
    "hasActionRunning" : { [ "options"], "object"}
}

```

Every function also has a promise-returning `*Async` counterpart (no
callback argument): stream-producing functions resolve with the
`Readable`, info functions with the info object.

```js
const svc = await Firebird.attachAsync({ ...options, manager: true });
try {
    const info = await svc.getFbserverInfosAsync();
    console.log(info.fbversion);

    const backup = await svc.backupAsync({
        database: '/DB/MYDB.FDB',
        files: [{ filename: '/DB/MYDB.FBK' }]
    });
    for await (const line of backup) console.log(line);
} finally {
    await svc.detachAsync();
}
```

### Backup Service example

```js
const options = {...}; // Classic configuration with manager = true
Firebird.attach(options, function(err, svc) {
    if (err)
        return;
    svc.backup(
        {
            database:'/DB/MYDB.FDB',
            files: [
                    {
                     filename:'/DB/MYDB.FBK',
                     sizefile:'0'
                    }
                   ]
        },
        function(err, data) {
            data.on('data', line => console.log(line));
            data.on('end', () => svc.detach());
        }
    );
});
```

### Restore Service example

```js
const config = {...}; // Classic configuration with manager = true
const RESTORE_OPTS = {
    database: 'database.fdb',
    files: ['backup.fbk']
};

Firebird.attach(config, (err, srv) => {
    srv.restore(RESTORE_OPTS, (err, data) => {
        data.on('data', () => {});
        data.on('end', () =>{
            srv.detach();})
        });
    });
```

### getLog and getFbserverInfos Service examples with use of stream and object return

```js
fb.attach(_connection, function (err, svc) {
  if (err) return;
  // all function that return a stream take two optional parameter
  // optread => byline or buffer  byline use isc_info_svc_line and buffer use isc_info_svc_to_eof
  // buffersize => is the buffer for service manager it can't exceed 8ko (i'm not sure)

  svc.getLog({ optread: 'buffer', buffersize: 2048 }, function (err, data) {
    // data is a readablestream that contain the firebird.log file
    console.log(err);
    data.on('data', function (data) {
      console.log(data.toString());
    });
    data.on('end', function () {
      console.log('finish');
    });
  });

  // an other exemple to use function that return object
  svc.getFbserverInfos(
    {
      dbinfo: true,
      fbconfig: true,
      svcversion: true,
      fbversion: true,
      fbimplementation: true,
      fbcapatibilities: true,
      pathsecuritydb: true,
      fbenv: true,
      fbenvlock: true,
      fbenvmsg: true,
    },
    {},
    function (err, data) {
      console.log(err);
      console.log(data);
    }
  );
});
```

### Character Set & Encoding Support

Node-Firebird defaults to `UTF-8` for database connections, but fully supports custom client character sets. You can set the connection encoding by specifying `options.encoding` (e.g. `'UTF8'`, `'WIN1252'`, `'ISO8859_1'`, `'LATIN1'`, `'ASCII'`, or `'NONE'`).

Commonly used Firebird character sets are automatically mapped to their corresponding Node.js Buffer encodings:

| Firebird Character Set | Node.js Buffer Encoding | Description / Notes |
| ---------------------- | ----------------------- | ------------------- |
| `UTF8`, `UNICODE_FSS`  | `utf8`                  | Unicode. Handles character-level truncation automatically based on charset width. |
| `WIN1252`, `ISO8859_1`, `LATIN1` | `latin1`      | 8-bit European encodings. Safely decodes special accented characters. |
| `ASCII`                | `ascii`                 | 7-bit ASCII. |
| `NONE`                 | `latin1`                | Raw/unspecified character set. Treated as binary-safe 8-bit characters. |

Accented characters and fixed-length `CHAR(N)` column whitespace/truncation are handled automatically matching the connection character set width definitions.

#### Custom Charset Connection Example
```js
var options = {
    host: '127.0.0.1',
    port: 3050,
    database: 'win1252_db.fdb',
    user: 'SYSDBA',
    password: 'masterkey',
    encoding: 'WIN1252' // Automatically maps to 'latin1' under the hood
};

Firebird.attach(options, function (err, db) {
    if (err) throw err;

    // Writes 'Ç Ã É Ú Ñ' correctly using Windows-1252 encoding
    db.query('INSERT INTO ACCENTED_TEST (ID, NAME) VALUES (?, ?)', [1, 'Ç Ã É Ú Ñ'], function (err) {
        if (err) throw err;

        db.query('SELECT NAME FROM ACCENTED_TEST WHERE ID = 1', function (err, rows) {
            if (err) throw err;
            console.log(rows[0].name); // 'Ç Ã É Ú Ñ' (perfectly decoded)
            db.detach();
        });
    });
});
```

### Firebird 3.0+ Support

Firebird 3.0 wire protocol versions 14 and 15 are now supported, including:

- **Srp256 authentication** (SHA-256) — preferred by default, alongside Srp (SHA-1) and Legacy_Auth
- **Wire encryption** (Arc4/RC4) — enabled by default via `wireCrypt`
- **Wire compression** — supported for protocol version 13+ (set `wireCompression: true`)
- **Database encryption callback** — support for encrypted databases via `dbCryptConfig` option

No server-side configuration changes are required for Firebird 3.0 with default settings.

```js
Firebird.attach({
  host: '127.0.0.1',
  port: 3050,
  database: '/path/to/db.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
  wireCrypt: Firebird.WIRE_CRYPT_ENABLE,  // default, can set WIRE_CRYPT_DISABLE
  pluginName: Firebird.AUTH_PLUGIN_SRP256, // optional, auto-negotiated
}, function(err, db) {
  if (err) throw err;
  // ...
  db.detach();
});
```

#### Database Encryption Support

For encrypted databases, provide the encryption key via the `dbCryptConfig` option:

```js
Firebird.attach({
  host: '127.0.0.1',
  database: '/path/to/encrypted.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
  dbCryptConfig: 'base64:bXlTZWNyZXRLZXkxMjM0NTY=',  // base64-encoded key
  // or dbCryptConfig: 'myPlainTextKey'  // plain text key (UTF-8 encoded)
}, function(err, db) {
  if (err) throw err;
  // ...
  db.detach();
});
```

**Notes:**
- The `dbCryptConfig` value can be prefixed with `base64:` for base64-encoded keys
- Plain text values are encoded as UTF-8
- Empty or undefined values send an empty response to the callback
- This feature requires Firebird 3.0.1+ (protocol 14/15) for encrypted databases

### Firebird 4.0 and 5.0 Support

Firebird 4.0+ wire protocol (versions 16 and 17) is fully supported, including:

- **Protocol versions 16 and 17** — Full support for Firebird 4.0+ and 5.0+ wire protocols (automatic fallback/negotiation).
- **DECFLOAT data types** — Production-ready support for `DECFLOAT(16)` (Decimal64, 8 bytes) and `DECFLOAT(34)` (Decimal128, 16 bytes) complying with the full IEEE 754-2008 standard using BID (Binary Integer Decimal) encoding. Supports special values such as `NaN`, `+Infinity`, `-Infinity`, `+0`, and `-0`.
- **INT128 data type** — Native support for 128-bit integers using Node.js `BigInt`.
- **Statement Timeout** — Support for query and statement-level execution timeouts (Protocol 16+).
- **Time Zone Support** — Native support for `TIME WITH TIME ZONE` and `TIMESTAMP WITH TIME ZONE` (represented as JavaScript `Date` objects).
- **Extended metadata identifiers** — Support for identifiers up to 63 characters.

No configuration changes are required for Firebird 4.0 or 5.0 servers. The driver will automatically negotiate the best protocol version supported by both the client and server.

```js
Firebird.attach({
  host: '127.0.0.1',
  port: 3050,
  database: '/path/to/fb4.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
}, function(err, db) {
  if (err) throw err;
  
  // DECFLOAT and INT128 types are automatically supported
  db.query('SELECT CAST(123.456 AS DECFLOAT(16)) AS df16, CAST(9876543210 AS INT128) AS i128 FROM RDB$DATABASE', function(err, result) {
    console.log(result); // { df16: 123.456, i128: 9876543210n }
    db.detach();
  });
});
```

#### Using Timezones (FB 4.0+)

Columns of type `TIMESTAMP WITH TIME ZONE` and `TIME WITH TIME ZONE` are automatically mapped to JavaScript `Date` objects. Values are read as UTC and represented in the local timezone of the Node.js process.

```js
// Select timezone columns
db.query('SELECT TS_TZ_COL, T_TZ_COL FROM FB4_TABLE', function(err, result) {
    console.log(result[0].ts_tz_col); // JavaScript Date object
});

// Insert using Date objects
db.query('INSERT INTO FB4_TABLE (TS_TZ_COL) VALUES (?)', [new Date()], function(err) {
    // ...
});
```

For legacy Firebird 4 servers with SRP authentication only, use the following configuration in `firebird.conf`:

```bash
AuthServer = Srp256, Srp
WireCrypt = Enabled
```

For more details see:
- [Firebird 3 release notes — new authentication](https://firebirdsql.org/file/documentation/release_notes/html/en/3_0/rnfb30-security-new-authentication.html)
- [Firebird 4 release notes — Srp256](https://firebirdsql.org/file/documentation/release_notes/html/en/4_0/rlsnotes40.html#rnfb40-config-srp256)
- [Firebird 4 release notes — DECFLOAT](https://firebirdsql.org/file/documentation/release_notes/html/en/4_0/rlsnotes40.html#rnfb40-datatype-decfloat)
- [Firebird 4 migration guide — authorization](https://ib-aid.com/download/docs/fb4migrationguide.html#_authorization_with_firebird_2_5_client_library_fbclient_dll)
- [Firebird 5 migration guide — authorization](https://ib-aid.com/download/docs/fb5migrationguide.html#_authorization_from_firebird_2_5_client_libraries)


## Extensive Examples

### Firebird 4.0+ DECFLOAT & INT128 Usage
```js
Firebird.attach({
  host: '127.0.0.1',
  database: '/path/to/fb4.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
}, function(err, db) {
  if (err) throw err;

  // Insert DECFLOAT and INT128 types
  db.query(
    'INSERT INTO INVENTORY (ID, PRICE, SERIAL_NUMBER) VALUES (?, ?, ?)',
    [1n, '12.34567890123456', 987654321098765432109876543210n],
    function(err) {
      if (err) throw err;

      // Select them back
      db.query('SELECT PRICE, SERIAL_NUMBER FROM INVENTORY WHERE ID = 1', function(err, result) {
        if (err) throw err;
        console.log(typeof result[0].price);          // 'string' (e.g. '12.34567890123456')
        console.log(typeof result[0].serial_number);   // 'bigint' (e.g. 987654321098765432109876543210n)
        db.detach();
      });
    }
  );
});
```

### Query Cancellation with AbortSignal (Firebird 2.5+)

Any query can be cancelled while it is executing on the server. Pass an
`AbortSignal` in the query options — when it fires, the driver sends an
out-of-band `op_cancel` packet and the running statement fails with
`err.gdscode === GDSCode.CANCELLED`. The connection itself stays healthy and
can run further queries immediately.

```js
const { GDSCode } = require('node-firebird/lib/gdscodes');

const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // or req.on('close', ...) in Express

try {
    const rows = await db.queryAsync('SELECT /* expensive */ ...', [], { signal: controller.signal });
} catch (err) {
    if (err.gdscode === GDSCode.CANCELLED) {
        // cancelled server-side; the connection remains usable
    } else if (err.name === 'AbortError') {
        // the signal was already aborted — the query was never sent
    } else {
        throw err;
    }
}
```

The option works with the callback API as well (`db.query(sql, params, cb,
{ signal })`) and on transaction-level queries. A running operation can also
be cancelled manually from anywhere with `db.cancel()` / `await
db.cancelAsync()`.

Notes:

- Cancellation is **per attachment** (that is how the Firebird protocol
  defines it): it cancels whatever is currently executing on that
  connection. With a pool this is naturally scoped to the request holding
  the connection.
- A signal that is already aborted rejects immediately with an `AbortError`
  without contacting the server; cancelling an idle connection is harmless.

### Batch Execution (Firebird 4.0+)

`executeBatch` sends many parameter rows for one statement in a single
round-trip using the Firebird 4 wire batch API (`op_batch_create` /
`op_batch_msg` / `op_batch_exec`) — typically 5–10× faster than executing
row by row. Available on the database, transaction and statement objects, in
callback and promise flavours.

```js
const rows = [
    [1, 'Alice', 10.50, new Date(), true,  100n],
    [2, 'Bob',   null,  new Date(), false, null],   // NULLs per column
    [3, 'Carol', 7.25,  new Date(), true,  300n],
];

// database level: own transaction, all-or-nothing (rollback if any record fails)
const res = await db.executeBatchAsync(
    'INSERT INTO t (id, name, amount, created, active, big) VALUES (?, ?, ?, ?, ?, ?)',
    rows);
console.log(res.recordCount, res.updateCounts, res.success);

// transaction level: partial success — failed records are reported,
// the rest can still be committed
const tr = await db.transactionAsync();
const r = await tr.executeBatchAsync('INSERT INTO t (...) VALUES (?, ?, ?, ?, ?, ?)', rows);
if (!r.success) {
    console.log('failed record indexes:', r.errorRecordNumbers);   // 0-based
    console.log('first error:', r.errors[0].error.message);
}
await tr.commitAsync();
```

The result object contains `recordCount`, `updateCounts` (one entry per
record), `errors` (`{ recordNumber, error }` with full gdscode details),
`errorRecordNumbers` and `success`. At the database level a failed batch
rejects with the first record error, carrying the full completion state as
`err.batchCompletion`.

Options (last argument): `chunkSize` (rows per `op_batch_msg` packet,
default 500), `multiError` (default `true` — collect all record errors
instead of stopping at the first), `bufferSize` (server-side batch buffer
in bytes).

Notes:

- Requires wire protocol 16+ (Firebird 4.0 or newer server).
- Values are encoded from the statement's own parameter metadata, so
  NUMERIC/DECIMAL scale, `BIGINT`/`INT128` (pass `BigInt`), `BOOLEAN`,
  `TIMESTAMP`/`DATE`/`TIME`, `FLOAT`/`DOUBLE` and `DECFLOAT` all round-trip
  exactly. BLOB and ARRAY parameters are not supported in batches yet.
- Oversized `CHAR`/`VARCHAR` values fail the batch client-side before
  anything is sent; server-side record errors (constraint violations,
  truncation…) are reported per record.

### Statement Timeouts (Firebird 4.0+)
Setting a statement timeout allows the client to automatically abort queries that take too long on the server.
```js
Firebird.attach(options, function(err, db) {
  if (err) throw err;

  // Specify a statement-level execution timeout of 1000ms
  db.query(
    'SELECT * FROM MY_LARGE_TABLE',
    [],
    function(err, result) {
      if (err) {
        if (err.message.includes('timeout')) {
          console.error('Query timed out!');
        } else {
          console.error('Error:', err);
        }
      }
      db.detach();
    },
    { timeout: 1000 } // timeout option passed to query/execute
  );
});
```

### Bidirectional Scrollable Cursors (Firebird 5.0+)
Firebird 5.0 introduced native support for scrollable cursors, enabling bi-directional result set traversal on the server side. You can execute a statement with `{ scrollable: true }` and navigate with `statement.fetchScroll()`.

```js
db.transaction(function(err, tx) {
  tx.newStatement('SELECT ID, VAL FROM MY_TABLE ORDER BY ID', function(err, statement) {
    if (err) throw err;

    // Execute the statement and request a scrollable cursor on the server
    statement.execute(tx, [], function(err) {
      if (err) throw err;

      // 1. Fetch the first row
      statement.fetchScroll(tx, 'FIRST', 0, 1, function(err, res) {
        console.log('First:', res.data); // Row 1

        // 2. Fetch the next row
        statement.fetchScroll(tx, 'NEXT', 0, 1, function(err, res) {
          console.log('Next:', res.data); // Row 2

          // 3. Fetch the prior row
          statement.fetchScroll(tx, 'PRIOR', 0, 1, function(err, res) {
            console.log('Prior:', res.data); // Row 1 again

            // 4. Fetch the absolute 3rd row
            statement.fetchScroll(tx, 'ABSOLUTE', 3, 1, function(err, res) {
              console.log('Absolute 3rd:', res.data); // Row 3

              statement.release();
              tx.commit();
              db.detach();
            });
          });
        });
      });
    }, { scrollable: true });
  });
});
```

Supported directions are: `'NEXT'` (0), `'PRIOR'` (1), `'FIRST'` (2), `'LAST'` (3), `'ABSOLUTE'` (4), and `'RELATIVE'` (5).

### DML RETURNING Multiple Rows (Firebird 5.0+)
In Firebird 5.0, DML statements like `UPDATE`, `DELETE`, and `INSERT ... SELECT` with a `RETURNING` clause can return multiple rows. When executing these statements, the driver receives an array of objects representing all the affected rows:

```js
db.query(
  'UPDATE MY_TABLE SET VAL = VAL || \'!\' WHERE ID > 1 RETURNING ID, VAL',
  [],
  function(err, rows) {
    if (err) throw err;
    console.log(rows); // Array of updated rows: [{ id: 2, val: 'two!' }, { id: 3, val: 'three!' }]
  }
);
```

### SKIP LOCKED (Firebird 5.0+)
Firebird 5.0 supports the `SKIP LOCKED` clause with `SELECT ... WITH LOCK`, `UPDATE`, and `DELETE` statements. This allows transactions to skip rows currently locked by other transactions instead of waiting or raising lock conflict errors, making it ideal for concurrency queues:

```js
// Selects unlocked rows, skipping any locked by concurrent processes
db.query(
  'SELECT * FROM QUEUE_TASK WHERE STATUS = \'PENDING\' WITH LOCK SKIP LOCKED',
  [],
  function(err, result) {
    if (err) throw err;
    console.log(result);
  }
);
```

### Advanced Connection Pooling & Life-cycle
```js
var pool = Firebird.pool(10, {
    host: '127.0.0.1',
    database: 'db.fdb',
    user: 'SYSDBA',
    password: 'masterkey',
    connectTimeout: 5000 // 5 seconds connect timeout for pool.get()
});

// Retrieve a connection
pool.get(function(err, db) {
    if (err) {
        console.error('Could not get connection from pool:', err);
        return;
    }

    db.query('SELECT * FROM TABLE', function(err, result) {
        // Return connection back to the pool
        db.detach();
    });
});

// Close all pool connections and reject pending requests
process.on('SIGTERM', function() {
    pool.destroy();
});
```

## Using node-firebird with Express.js

node-firebird works well with Express, but because the driver is connection/pool based rather than an ORM with automatic connection management, a few request-lifecycle patterns keep connections from leaking under load. This section documents the recommended architecture, referenced from the [roadmap](ROADMAP.md#2-expressjs-support-first-class-integration).

> The driver now ships native `pool.withConnection()` and `db.withTransaction()` helpers (see [Promises and async/await](#promises-and-asyncawait)) that supersede the hand-rolled `withConnection` / `transactional` helpers shown in the examples below. The examples remain valid and show what the helpers do under the hood.

### Recommended architecture: one pool per app, created at startup

Create a single `Firebird.pool(...)` when the app boots and reuse it for the lifetime of the process. Do **not** call `Firebird.pool()` or `Firebird.attach()` inside a request handler — that opens a new socket (or an entire new pool) on every request and will exhaust server and database resources under load.

```js
// db.js
const Firebird = require('node-firebird');

const options = {
  host: '127.0.0.1',
  database: '/var/lib/firebird/data/app.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
  connectTimeout: 5000,
};

// Size the pool to your expected concurrency, not to the number of requests.
const pool = Firebird.pool(10, options);

module.exports = pool;
```

```js
// app.js
const express = require('express');
const pool = require('./db');

const app = express();

// ...routes...

const server = app.listen(3000);

// Close the pool (and reject any in-flight pool.get() calls) on shutdown.
process.on('SIGTERM', function () {
  server.close(function () {
    pool.destroy();
  });
});
```

### Request lifecycle: acquire → query → always release

Every request that touches the database must release its connection back to the pool exactly once, on every code path: success, query error, or a synchronous throw. There is no native `finally` across async callbacks, so a small helper plays that role:

```js
// withConnection.js
function withConnection(pool, handler) {
  return function (req, res, next) {
    pool.get(function (err, db) {
      if (err) return next(err);

      var finished = false;

      // Safe to call more than once; only the first call has any effect.
      function done(err) {
        if (finished) return;
        finished = true;
        db.detach();
        if (err) next(err);
      }

      try {
        handler(db, req, res, done);
      } catch (err) {
        done(err);
      }
    });
  };
}

module.exports = withConnection;
```

```js
app.get('/users', withConnection(pool, function (db, req, res, done) {
  db.query('SELECT ID, ALIAS FROM USERS', function (err, rows) {
    if (err) return done(err);
    res.json(rows);
    done();
  });
}));
```

### Transaction middleware: commit on success, rollback on error

For write endpoints, acquire a connection and start a transaction in middleware, expose it as `req.tx`, and let the route handler decide whether to commit or roll back:

```js
function transactional(pool) {
  return function (req, res, next) {
    pool.get(function (err, db) {
      if (err) return next(err);

      db.transaction(function (err, tx) {
        if (err) {
          db.detach();
          return next(err);
        }

        req.tx = tx;

        // Call on success — commits, releases the connection, then responds.
        req.commit = function (payload) {
          tx.commit(function (err) {
            db.detach();
            if (err) return next(err);
            res.json(payload);
          });
        };

        // Call on failure — rolls back, releases the connection, then
        // forwards the error to Express's error-handling middleware.
        req.rollbackOnError = function (err) {
          tx.rollback(function () {
            db.detach();
            next(err);
          });
        };

        next();
      });
    });
  };
}

app.post('/orders', transactional(pool), function (req, res, next) {
  req.tx.query(
    'INSERT INTO ORDERS (CUSTOMER, TOTAL) VALUES (?, ?) RETURNING ID',
    [req.body.customer, req.body.total],
    function (err, result) {
      if (err) return req.rollbackOnError(err);
      req.commit(result);
    }
  );
});
```

### Error handling: map Firebird errors to HTTP status codes

Firebird errors surface as a plain `Error` with `.message`, `.gdscode`, and `.gdsparams` (see `lib/callback.js`). Map the codes you care about — exported as named constants from `node-firebird/lib/gdscodes` — to HTTP status codes in your error-handling middleware, and log the original error server-side only. Don't forward `err.message` as-is to clients: it can contain SQL text, table/column names, or file paths.

```js
const { GDSCode } = require('node-firebird/lib/gdscodes');

function mapFirebirdErrorToStatus(err) {
  switch (err.gdscode) {
    case GDSCode.UNIQUE_KEY_VIOLATION:
      return 409; // Conflict
    case GDSCode.LOCK_CONFLICT:
      return 423; // Locked
    default:
      return 500;
  }
}

// Express error-handling middleware (register last, with 4 arguments).
app.use(function (err, req, res, next) {
  console.error(err); // full detail goes to server logs only

  res.status(mapFirebirdErrorToStatus(err)).json({
    error: err.gdscode === GDSCode.UNIQUE_KEY_VIOLATION ? 'Duplicate record' : 'Request failed',
  });
});
```

### BLOB streaming: pipe a BLOB column straight to the response

Blob columns come back from `db.query`/`transaction.query` as functions (see [Reading Blobs](#reading-blobs-asynchronous)). Call the column function to get an `EventEmitter` you can `.pipe()` straight into `res`, and release the connection once streaming ends, errors, *or* the client disconnects early.

```js
app.get('/users/:id/picture', withConnection(pool, function (db, req, res, done) {
  db.query(
    'SELECT USERPICTURE FROM USERS WHERE ID = ?',
    [req.params.id],
    function (err, rows) {
      if (err) return done(err);
      if (!rows.length) {
        res.sendStatus(404);
        return done();
      }

      rows[0].userpicture(function (err, name, blobStream) {
        if (err) return done(err);

        res.type('application/octet-stream');

        // done() is idempotent — whichever of these fires first releases
        // the connection; the rest are no-ops.
        blobStream.once('end', function () { done(); });
        blobStream.once('error', done);
        res.once('close', function () { done(); });

        blobStream.pipe(res);
      });
    }
  );
}));
```

## FAQ

Answers to recurring questions from the [issue tracker](https://github.com/hgourvest/node-firebird/issues).

#### Can I use aggregate functions like `LIST()`? I get "no database to handle" when I call the result.

Yes — `LIST()` is plain SQL and needs no special driver support. The error happens because `LIST()` returns a text blob (subtype 1), and blob columns come back from `db.query`/`transaction.query` as **async reader functions** bound to the transaction the query ran in (see [Reading Blobs](#reading-blobs-asynchronous)). Calling that function without a transaction — or with a different one — is what throws "no database to handle".

The simplest fix is `blobAsText: true`, which returns subtype-1 blobs as plain strings automatically, no callback needed:

```js
const options = { /* ...other options... */ blobAsText: true };

Firebird.attach(options, function (err, db) {
  if (err) throw err;
  db.query('SELECT LIST(RDB$FIELD_NAME) AS COLUMNS FROM RDB$RELATION_FIELDS', function (err, rows) {
    if (err) throw err;
    console.log(rows[0].columns); // plain string, not a function
    db.detach();
  });
});
```

If you need to read it manually instead, pass the **same** transaction the query used:

```js
db.transaction(function (err, tx) {
  tx.query('SELECT LIST(RDB$FIELD_NAME) AS COLUMNS FROM RDB$RELATION_FIELDS', function (err, rows) {
    rows[0].columns(tx, function (err, name, e) {
      let collected = '';
      e.on('data', (chunk) => (collected += chunk));
      e.on('end', () => console.log(collected));
    });
  });
});
```

#### Is the wire protocol version hard-coded?

No. node-firebird negotiates the highest protocol version both the client and server support, up to `options.maxNegotiatedProtocols` (default `10`, i.e. Protocol 19 — see [Protocol Implementation Status](ROADMAP.md#4-protocol-implementation-status) in the roadmap for the full version table). Raise it if you're on Firebird 6.0 and want to attempt Protocol 20:

```js
options.maxNegotiatedProtocols = 11; // offers Protocol 20 as well as 19
```

The default is capped at 10 (Protocol 19) rather than the full list because Protocol 20 has a known query-preparation hang on some Firebird 6.0 builds — see the "Firebird 6 and Beyond" note in [ROADMAP.md](ROADMAP.md#4-protocol-implementation-status).

#### BLOB reads/writes are very slow, especially for large files over a remote connection

This is almost always network round-trips, not the database. By default, blobs are streamed in small (1024-byte) segments; for a multi-megabyte file over a non-local connection that's thousands of round-trips. Raise `blobChunkSize` / `blobReadChunkSize` (up to the protocol max of `65535`) to fetch/send far larger segments per round-trip — see [Optimizing BLOB Read/Write Chunk Sizes](#optimizing-blob-readwrite-chunk-sizes):

```js
options.blobChunkSize = 65535;
options.blobReadChunkSize = 65535;
```

If your server and client are on the same host, this won't matter much — the slowdown is latency-bound, not throughput-bound.

#### How do I use an encoding other than UTF-8 (e.g. WIN1252/Latin1)?

Set `options.encoding` — no source changes required (see [Character Set & Encoding Support](#character-set--encoding-support) for the full mapping table):

```js
options.encoding = 'WIN1252'; // or 'ISO8859_1', 'LATIN1', 'ASCII', 'NONE'
```

`options.encoding` must match the character set the *database itself* was created with. If you set an encoding that doesn't match the database's charset, Firebird will reject transliteration of characters that don't exist in both charsets with an error like `Cannot transliterate character between character sets` — that's the server protecting you from silent data corruption, not a driver bug. When in doubt, check the database's `RDB$CHARACTER_SETS` / connection charset rather than guessing.

If your database uses `charset NONE` (no transliteration at all — the server stores whatever bytes it's given) and you need full control over the byte encoding yourself, pass a `Buffer` instead of a string for text-column parameters. node-firebird writes `Buffer` values through unchanged, bypassing Node's UTF-8 string handling entirely — combine with a transliteration library like [`iconv-lite`](https://www.npmjs.com/package/iconv-lite) to produce the bytes:

```js
const iconv = require('iconv-lite');
options.encoding = 'NONE';

db.query(
  'INSERT INTO NOTES (ID, BODY) VALUES (?, ?)',
  [1, iconv.encode('Café', 'win1252')], // pre-encoded bytes, written as-is
  function (err) { /* ... */ }
);
```

#### I get "Dynamic SQL Error" (string truncation) using `LIKE` with a pattern longer than the column

```
SELECT * FROM ACTORS WHERE NAME LIKE 'James Wick%'  -- NAME is VARCHAR(10), literal is 11 chars
```

On some Firebird server versions, the optimizer infers a literal's type from the column it's compared against and can raise a truncation error at compile time if an inline string literal is longer than the column's declared length — even though the same query works fine as a parameterized query. This is server-side SQL compilation behavior, not something node-firebird controls; it did not reproduce against the Firebird 6.0 server used by this project's own test suite, so it appears to be limited to certain older engine versions/optimizer paths.

The reliable fix, which also happens to be the general best practice (see [Parametrized Queries](#parametrized-queries)), is to pass the pattern as a parameter instead of inlining it:

```js
// Instead of embedding the literal in the SQL text:
db.query("SELECT * FROM ACTORS WHERE NAME LIKE 'James Wick%'", ...);

// Bind it as a parameter:
db.query('SELECT * FROM ACTORS WHERE NAME LIKE ?', ['James Wick%'], function (err, rows) {
  if (err) throw err;
  console.log(rows);
});
```

#### attach() *sometimes* fails with gdscode 335544472 ("Your user name and password are not defined") even though the credentials are correct

If the failure is intermittent — the same code with the same credentials succeeds on most attempts and fails on others — update the driver: versions before 2.8.1 had two serialization mismatches in the SRP (Srp/Srp256/384/512) proof-of-password computation that made roughly 1 in 80 attaches fail with exactly this error (whenever the ephemeral SRP values happened to have a leading zero byte). Fixed in 2.8.1; see [issue #421](https://github.com/hgourvest/node-firebird/issues/421) and [issue #347](https://github.com/hgourvest/node-firebird/issues/347). Switching the user to `Legacy_UserManager`/`Legacy_Auth` "fixed" it on older versions only because that avoids the SRP code path entirely — with 2.8.1+ this workaround is no longer needed.

If the failure is consistent, the credentials really don't match an account for the authentication plugin in use: check `AuthServer`/`UserManager` in `firebird.conf` and remember that SRP and Legacy user managers keep separate password stores — a user created under one plugin does not automatically exist for the other.

## Contributing

Contributions are welcome — code, documentation, and bug reports alike.

- **Found a bug or have a question?** Open a [GitHub issue](https://github.com/hgourvest/node-firebird/issues). Please include your Node.js version, your Firebird server version, and a minimal reproduction (SQL plus code).
- **Want to write code?** See [Developing the driver](#developing-the-driver) for the build and test setup, and the [ROADMAP](ROADMAP.md) for ideas on what to pick up. Pull requests against `master` should come with tests and pass `npm test`, `npm run typecheck` and `npm run lint`.
- **Improving the documentation** is just as valuable — clearer examples and FAQ entries help everyone.

## Contributors

`node-firebird` was created by **Henri Gourvest** and is maintained by **Popa Marius Adrian**, with major early contributions from **Peter Širka** (pooling, sequential selects, driver events).

- Henri Gourvest — author, <https://github.com/hgourvest>
- Popa Marius Adrian — maintainer, <https://github.com/mariuz>
- Peter Širka — <https://github.com/petersirka>

…and many more — see the full [list of contributors](https://github.com/hgourvest/node-firebird/graphs/contributors).

<a href="https://github.com/hgourvest/node-firebird/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hgourvest/node-firebird" alt="Contributors" />
</a>

[license-image]: http://img.shields.io/badge/license-MOZILLA-blue.svg?style=flat
[license-url]: LICENSE
[npm-url]: https://npmjs.org/package/node-firebird
[npm-version-image]: http://img.shields.io/npm/v/node-firebird.svg?style=flat
[npm-downloads-image]: http://img.shields.io/npm/dm/node-firebird.svg?style=flat
