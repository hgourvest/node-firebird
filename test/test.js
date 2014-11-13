var fb = require('../lib');
var fs = require('fs');
var os = require('os');

var assert = require('assert');
var Path = require('path');
var now = new Date();

var config = {

    //  Problem with privileges in OSX
    //  database: Path.join(os.tmpdir(), 'test-' + new Date().getTime() + '.fdb'),

    database: Path.join(process.cwd(), 'test-' + new Date().getTime() + '.fdb'),
    host: '127.0.0.1',     // default
    port: 3050,            // default
    user: 'SYSDBA',        // default
    password: 'masterkey', // default
    role: null,            // default
    pageSize: 4096,        // default when creating database
    timeout: 3000          // default query timeout
}

Array.prototype.async = function(cb) {

    var self = this;
    var item = self.shift();

    if (item === undefined) {
        if (cb)
            cb();
        return;
    }

    item(function() {
        setImmediate(function() {
            self.async(cb);
        });
    });
};

fb.attachOrCreate(config, function (err, db) {

    if (err)
        throw err.message;

    database = db;

    var task = [];

    task.push(test_create);
    task.push(test_insert);

    task.push(function(next) {
        db.detach(next);
    });

    task.async();
});

function test_create(next) {

    var name = 'TEST ---> test_create';
    console.time(name);

    // Create table
    database.query('CREATE TABLE test (ID INT, PARENT BIGINT, NAME VARCHAR(50), FILE BLOB, CREATED TIMESTAMP)', function(err) {
        console.timeEnd(name);
        next();
    });
}

function test_insert(next) {

    var name = 'TEST ---> test_insert';
    var query = [];

    console.time(name);
    var lng = 862304020112911;
    database.query('INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?) RETURNING ID', [3, 'Firebird 3', now, 862304020112911], function(err, r) {

        database.query('SELECT PARENT, CAST(PARENT AS VARCHAR(20)) AS NEVIEM FROM test', function(e, r) {
            console.log(r);
            console.timeEnd(name);
            next();
        });

    });
}