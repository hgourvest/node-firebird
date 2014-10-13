var fb = require('../lib');
var fs = require('fs');

macdb = '/Volumes/Development/github/node-firebird/test/fbdata/test.fdb';
windb = 'C:\\dev\\bases\\test.fdb';
lindb = '/tmp/test.fdb';

db = macdb;

config = {
    database: db,
    host: '127.0.0.1',     // default
    port: 3050,            // default
    user: 'SYSDBA',        // default
    password: 'masterkey', // default
    role: null,            // default
    pageSize: 4096,        // default when creating database
    timeout: 3000          // default query timeout
}

Array.prototype.async = function() {

    var self = this;
    var item = self.shift();

    if (item === undefined)
        return;

    item(function() {
        setImmediate(function() {
            self.async();
        });
    });

};
/*
if (fs.existsSync(config.database))
    fs.unlinkSync(config.database);
*/
fb.attachOrCreate(config, function (err, db) {

    if (err)
        throw err;

    database = db;

    var task = [];

//    task.push(test_events);
    task.push(test_create);
    task.push(test_insert);
    task.push(test_select);
    task.push(test_transaction);
/*
    task.push(function(next) {
        db.detach();
        next();
    });
*/
    task.async();
    //db.detach();
});

function test_create(next) {
    console.log('TEST: create');
    database.query('CREATE TABLE test (ID INT, NAME VARCHAR(50), FILE BLOB)', next);
    database.detach();
}

function test_insert(next) {
    console.log('TEST: insert');
//    database.query('INSERT INTO test (ID, NAME, FILE) VALUES(?, ?, ?) RETURNING ID', [1, 'Peter', fs.readFileSync('/users/petersirka/desktop/image.jpg')], function(err, result) {
        //database.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [2, 'Lucia'], next);
            next();
//    });
    next();
}

function test_select(next) {
    console.log('TEST: select');

    database.query('SELECT * FROM test', function(err, result) {
        console.log(fs.writeFileSync('/users/petersirka/desktop/aaa.jpg', result[0].file));
        next();
    });
}

function test_events(next) {
    database.on('row', function(row, index) {
        console.log('row: --->', index, row);
    });

    database.on('query', function(q) {
        console.log('query: --->', q);
    });

    database.on('result', function(rows) {
        console.log('result --->', rows);
    });

    next();
}

function test_transaction(next) {
    console.log('TEST: transaction');
    next();
}