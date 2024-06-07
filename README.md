# Pure JavaScript and Asynchronous Firebird client for Node.js

![Firebird Logo](https://firebirdsql.org/file/about/firebird-logo-90.png)

[![NPM version][npm-version-image]][npm-url] [![NPM downloads][npm-downloads-image]][npm-url] [![Mozilla License][license-image]][license-url]

[![NPM](https://nodei.co/npm/node-firebird.png?downloads=true&downloadRank=true)](https://nodei.co/npm/node-firebird/)

[Firebird forum](https://groups.google.com/forum/#!forum/node-firebird) on Google Groups.

## Firebird database on social networks

- [Firebird on Twitter](https://twitter.com/firebirdsql/)
- [Firebird on Facebook](https://www.facebook.com/FirebirdSQL)

## Changelog for version v0.2.x

- added auto-reconnect
- added [sequentially selects](https://github.com/hgourvest/node-firebird/wiki/What-is-sequentially-selects)
- events for connection (attach, detach, row, result, transaction, commit, rollback, error, etc.)
- performance improvements
- supports inserting/updating buffers and streams
- reading blobs (sequentially)
- pooling
- `database.detach()` waits for last command
- better unit-test

---

- [Firebird documentation](https://firebirdsql.org/en/documentation/)
- [Firebird limits and data types](https://firebirdsql.org/en/firebird-technical-specifications/)

## Installation

```bash
npm install node-firebird
```

## Usage

```js
var Firebird = require('node-firebird');
```

### Methods

- `Firebird.escape(value) -> return {String}` - prevent for SQL Injections
- `Firebird.attach(options, function(err, db))` attach a database
- `Firebird.create(options, function(err, db))` create a database
- `Firebird.attachOrCreate(options, function(err, db))` attach or create database
- `Firebird.pool(max, options) -> return {Object}` create a connection pooling

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
options.encoding = 'UTF8'; // default encoding for connection is UTF-8
```

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

## Database object (db)

### Database Methods

- `db.query(query, [params], function(err, result))` - classic query, returns Array of Object
- `db.execute(query, [params], function(err, result))` - classic query, returns Array of Array
- `db.sequentially(query, [params], function(row, index), function(err))` - sequentially query
- `db.detach(function(err))` detach a database
- `db.transaction(isolation, function(err, transaction))` create transaction

### Transaction methods

- `transaction.query(query, [params], function(err, result))` - classic query, returns Array of Object
- `transaction.execute(query, [params], function(err, result))` - classic query, returns Array of Array
- `transaction.commit(function(err))` commit current transaction
- `transaction.rollback(function(err))` rollback current transaction

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

### Streaming a big data

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

### Events

```js
Firebird.attach(options, function (err, db) {
  if (err) throw err;

  db.on('row', function (row, index, isObject) {
    // index === Number
    // isObject === is row object or array?
  });

  db.on('result', function (result) {
    // result === Array
  });

  db.on('attach', function () {});

  db.on('detach', function (isPoolConnection) {
    // isPoolConnection == Boolean
  });

  db.on('reconnect', function () {});

  db.on('error', function (err) {});

  db.on('transaction', function (isolation) {
    // isolation === Number
  });

  db.on('commit', function () {});

  db.on('rollback', function () {});

  db.detach();
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

### Charset for database connection is always UTF-8

Node Firebird uses UTF-8 as the default charset. If you want a different one, such as Latin1, you will need to go into the library and modify the default_encoding in the index.js file

```js
const default_encoding = 'latin1';
```

This is why you should use **Firebird 2.5** server at least.

### Firebird 3.0 Support

Firebird new wire protocol is not supported yet so
for Firebird 3.0 you need to add the following in firebird.conf according to Firebird 3 release notes
<https://firebirdsql.org/file/documentation/release_notes/html/en/3_0/rnfb30-security-new-authentication.html>

```bash
AuthServer = Srp, Legacy_Auth
WireCrypt = Disabled
UserManager = Legacy_UserManager
```

Firebird 4 wire protocol is not supported yet so
for Firebird 4.0 you need to add the following in firebird.conf according to Firebird release notes
<https://firebirdsql.org/file/documentation/release_notes/html/en/4_0/rlsnotes40.html#rnfb40-config-srp256>

```bash
AuthServer = Srp256, Srp, Legacy_Auth
WireCrypt = Disabled
UserManager = Legacy_UserManager
```

Please read also Authorization with Firebird 2.5 client library from Firebird 4 migration guide
<https://ib-aid.com/download/docs/fb4migrationguide.html#_authorization_with_firebird_2_5_client_library_fbclient_dll>

## Contributors

- Henri Gourvest, <https://github.com/hgourvest>
- Popa Marius Adrian, <https://github.com/mariuz>
- Peter Širka, <https://github.com/petersirka>

[license-image]: http://img.shields.io/badge/license-MOZILLA-blue.svg?style=flat
[license-url]: LICENSE
[npm-url]: https://npmjs.org/package/node-firebird
[npm-version-image]: http://img.shields.io/npm/v/node-firebird.svg?style=flat
[npm-downloads-image]: http://img.shields.io/npm/dm/node-firebird.svg?style=flat
