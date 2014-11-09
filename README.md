![Firebird Logo](https://www.totaljs.com/exports/firebird-logo.png)

[![NPM version][npm-version-image]][npm-url] [![NPM downloads][npm-downloads-image]][npm-url] [![Mozilla License][license-image]][license-url]
# Pure JavaScript Firebird client for Node.js.

Pure JavaScript and Asynchronous Firebird client for Node.js. [Firebird forum](https://groups.google.com/forum/#!forum/node-firebird) on Google Groups. Please share and follow Firebird database, it's a very good open-source product.

__Firebird database on social networks__

- [Firebird on Google+](https://plus.google.com/111558763769231855886/posts)
- [Firebird on Twitter](https://twitter.com/firebirdsql/)
- [Firebird on Facebook](https://www.facebook.com/FirebirdSQL)

__New version v0.2.0 supports__

- added auto-reconnect
- added [sequentially selects](https://github.com/hgourvest/node-firebird/wiki/What-is-sequentially-selects)
- events for connection (attach, detach, row, result, transaction, commit, rollback, error, etc.)
- performance improvements
- supports inserting/updating buffers and streams
- reading blobs (sequentially)
- pooling
- `database.detach()` waits for last command
- better unit-test
- best of use with [total.js - web application framework for node.js](http://www.totaljs.com)

---

- [Firebird documentation](http://www.firebirdsql.org/en/documentation/)
- [Firebird limits and data types](http://www.firebirdsql.org/en/firebird-technical-specifications/)

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
- `Firebird.pool(maxSockets, options, function(err, db)) -> return {Object}` create a connection pooling

## Connection types

### Connection options

```js
var options = {};

options.host = '127.0.0.1';
// options.port = 3050;
options.database = 'database.fdb';
options.user = 'SYSDBA';
options.password = 'masterkey';
```

### Classic

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.query('SELECT * FROM TABLE', function(err, result) {
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
pool.get(function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.query('SELECT * FROM TABLE', function(err, result) {
        // IMPORTANT: release the pool connection
        db.detach();
    });
});

// close all opened connections
pool.detach();

// Destroy pool
pool.destroy();
```

## Database object (db)

### Methods

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

### PARAMETRIZED QUERIES

### Parameters

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.query('INSERT INTO USERS (ID, ALIAS, CREATED) VALUES(?, ?, ?) RETURNING ID', [1, 'Pe\'ter', new Date()] function(err, result) {
        console.log(result[0].id);
        db.query('SELECT * FROM USERS WHERE Alias=?', ['Peter'], function(err, result) {
            console.log(result);
            db.detach();
        });
    });
});
```

### BLOB (stream)

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    // INSERT STREAM as BLOB
    db.query('INSERT INTO USERS (ID, ALIAS, FILE) VALUES(?, ?, ?)', [1, 'Peter', fs.createReadStream('/users/image.jpg')] function(err, result) {
        // IMPORTANT: close the connection
        db.detach();
    });
});
```

### BLOB (buffer)

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    // INSERT BUFFER as BLOB
    db.query('INSERT INTO USERS (ID, ALIAS, FILE) VALUES(?, ?, ?)', [1, 'Peter', fs.readFileSync('/users/image.jpg')] function(err, result) {
        // IMPORTANT: close the connection
        db.detach();
    });
});
```

### READING BLOBS (ASYNCHRONOUS)

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.query('SELECT ID, ALIAS, USERPICTURE FROM USER', function(err, rows) {

        if (err)
            throw err;

        // first row
        rows[0].userpicture(function(err, name, e) {

            if (err)
                throw err;

            // +v0.2.4
            // e.pipe(writeStream/Response);

            // e === EventEmitter
            e.on('data', function(chunk) {
                // reading data
            });

            e.on('end', function() {
                // end reading
                // IMPORTANT: close the connection
                db.detach();
            });
        });

    });
});
```

### STREAMING A BIG DATA

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.sequentially('SELECT * FROM BIGTABLE', function(row, index) {

        // EXAMPLE
        stream.write(JSON.stringify(row));

    }, function(err) {
        // END
        // IMPORTANT: close the connection
        db.detach();
    });
});
```

### TRANSACTIONS

__Transaction types:__

- `Firebird.ISOLATION_READ_UNCOMMITTED`
- `Firebird.ISOLATION_READ_COMMITED`
- `Firebird.ISOLATION_REPEATABLE_READ`
- `Firebird.ISOLATION_SERIALIZABLE`
- `Firebird.ISOLATION_READ_COMMITED_READ_ONLY`

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    // db = DATABASE
    db.transaction(Firebird.ISOLATION_READ_COMMITED, function(err, transaction) {
        transaction.query('INSERT INTO users VALUE(?,?)', [1, 'Janko'], function(err, result) {

            if (err) {
                transaction.rollback();
                return;
            }

            transaction.commit(function(err) {
                if (err)
                    transaction.rollback();
                else
                    db.detach();
            });
        });
    });
});
```

### EVENTS

```js
Firebird.attach(options, function(err, db) {

    if (err)
        throw err;

    db.on('row', function(row, index, isObject) {
        // index === Number
        // isObject === is row object or array?
    });

    db.on('result', function(result) {
        // result === Array
    });

    db.on('attach', function() {

    });

    db.on('detach', function(isPoolConnection) {
        // isPoolConnection == Boolean
    });

    db.on('reconnect', function() {

    });

    db.on('error', function(err) {

    });

    db.on('transaction', function(isolation) {
        // isolation === Number
    });

    db.on('commit', function() {

    });

    db.on('rollback', function() {

    });

    db.detach();
});
```

### Escaping query values

```js
var sql1 = 'SELECT * FROM TBL_USER WHERE ID>' + Firebird.escape(1);
var sql2 = 'SELECT * FROM TBL_USER WHERE NAME=' + Firebird.escape('Pe\'er');
var sql3 = 'SELECT * FROM TBL_USER WHERE CREATED<=' + Firebird.escape(new Date());
var sql4 = 'SELECT * FROM TBL_USER WHERE NEWSLETTER=' + Firebird.escape(true);

// or db.escape()

console.log(sql1);
console.log(sql2);
console.log(sql3);
console.log(sql4);
```

### Charset for database connection is always UTF-8

node-firebird doesn't let you chose the charset connection, it will always use UTF8.
Node is unicode, no matter if your database is using another charset to store string or blob, Firebird will transliterate automatically.

This is why you should use **Firebird 2.5** server at least.

### Firebird 3.0 Support 

Firebird new wire protocol is not supported yet so 
For Firebird 3.0 you need the following in firebird.conf
```
AuthServer = Legacy_Auth
WireCrypt= Disabled
```
## Contributors

- Henri Gourvest, <https://github.com/hgourvest>
- Popa Marius Adrian, <https://github.com/mariuz>
- Peter Širka, <https://github.com/petersirka>

[license-image]: http://img.shields.io/badge/license-MOZILLA-blue.svg?style=flat
[license-url]: LICENSE

[npm-url]: https://npmjs.org/package/node-firebird
[npm-version-image]: http://img.shields.io/npm/v/node-firebird.svg?style=flat
[npm-downloads-image]: http://img.shields.io/npm/dm/node-firebird.svg?style=flat
