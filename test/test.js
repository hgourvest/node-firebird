fb = require("../lib");
repl = require("repl");

macdb = '/fbdata/test.fdb';
windb = 'c:\\dev\\test.fdb';
db = macdb;

quit = function() {
    database.detach(function(ret){
        console.log('database detached');
    });
};

function logerror(err) {
    console.log(err.status);
}

function CheckResult(obj) {
    if (obj.status) {
        throw new Error('oups')
    }
}

// simple usage, transaction automatically started and commited/rollbacked
// - query is a non optional string
// - params is optional, can be a single value or an array
// - callback is optional

test1 = function(){
    var n = Date.now();
    database.execute("select cast(? as integer) from rdb$database", 123,
        // success
        function (result) {
            console.log(result.data);
            console.log(Date.now() - n + 'ms');
        },
        // error
        logerror);
};

// simple usage of a transaction  without providing error event
test2 = function() {
    database.startTransaction(function(transaction) {
        transaction.execute("select cast(? as integer) from rdb$database", 123, function(result) {
            transaction.commit(function(ret) { // commit in all situations for a single query
                CheckResult(result);           // error executing query ?
                CheckResult(ret);              // error commiting ?
                console.log(result.data);
            })
        });
    })
};

// multiple queries in a transaction
test3 = function() {
    var tr;

    function fail(err) {
        tr.rollback(function() {
            console.log(err.status);
        })
    }

    database.startTransaction(function(transaction) {
        tr = transaction;
        tr.execute("select cast(? as integer) from rdb$database", 123, function(result1) {
            tr.execute("select cast(? as integer) from rdb$database", 456, function(result2) {
                tr.commit(function(ret) {
                    console.log(result1.data[0]);
                    console.log(result2.data[0]);
                }, fail)
            }, fail);
        }, fail);
    })
};

connect = function(callback){
    database = new fb.Database('127.0.0.1', 3050, db, 'SYSDBA', 'masterkey', callback)
};

repl.start();
connect(function() {
    console.log('connected');
    test1();
});
