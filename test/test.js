fb = require("../lib");
repl = require("repl");

macdb = '/fbdata/test.fdb';
windb = 'C:\\dev\\bases\\test.fdb';
db = windb;

host = '127.0.0.1';
port = 3050;
user = 'SYSDBA';
password = 'masterkey';
role = null;
pagesize = 4096;

quit = function() {
    database.detach(function(){
        console.log('database detached');
    });
};

function logerror(err) {
    console.log(err.message);
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
    database.execute("select cast(? as integer) from rdb$database", 123,
        // success
        function (result) {
            console.log(result.data[0][0]);
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
                tr.commit(function() {
                    console.log(result1.data[0]);
                    console.log(result2.data[0]);
                }, fail)
            }, fail);
        }, fail);
    })
};

// concurrency

function createPool(count, callback) {
    var pool = [];
    for(var i = 0; i < count; i++) {
         fb.attach(host, port, db, user, password, role, function(db) {
             pool[--count] = db;
             if (count == 0) {
                callback(pool);
             }
        }, function(err) {
            callback(err);
            callback = null;
        })
    }
}

test4 = function(count, poolsize) {

    createPool(poolsize, function(pool) {
        var n = Date.now();
        var max = count;
        for (var i = 0; i < max; i++) {
            pool[i % poolsize].execute("select * from rdb$relations", function(){
                if (--count == 0) {
                    console.log(max + " queries");
                    console.log((Date.now() - n)/max + 'ms / query');
                    for (var db in pool) {pool[db].detach()}
                }
            });
        }
    });
};

// more complex sample

test5 = function() {
    var tr, st;
    function error(err) {
        if (tr) tr.rollback();
        if (st) st.drop();
        console.log(err);
    }

    function fetch(callback) {
        st.fetch(tr, function(ret) {
            console.log(ret.data);
            callback(ret.fetched);
        }, error)
    }

    database.startTransaction(function(transaction) {
        tr = transaction;
        tr.newStatement("select * from rdb$relations", function(statement) {
            st = statement;
            st.execute(tr, function() {

                var cb = function(fetched) {
                    if (fetched) {
                        st.drop();
                        tr.commit();
                    } else {
                        fetch(cb);
                    }
                };
                fetch(cb);
            }, error)
        }, error);
    }, error)
};


repl.start("");

fb.attachOrCreate(host, port, db, user, password, pagesize, role,
    function (db) {
        database = db;
        test1();
    }, logerror
);
