fb = require("../lib");
repl = require("repl");

macdb = '/fbdata/test.fdb';
windb = 'D:\\test\\test.fdb';
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
    database.execute("select cast(? as integer) from rdb$database", 123,
        // success
        function (result) {
            console.log(result.data);
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

// concurrency

function createPool(count, callback) {
    var pool = [];
    var done = count;
    while (count > 0) {
        pool[--count] = new fb.Database('127.0.0.1', 3050, db, 'SYSDBA', 'masterkey', function() {
            done--;
            if (done == 0) {
                callback(pool);
            }
        }, function(err) {
            callback(err)
            callback = null;
        })
    }
}

test4 = function(count, poolsize) {

    createPool(poolsize, function(pool) {
        var n = Date.now();
        var max = count;
        for (var i = 0; i < max; i++) {
            pool[i % poolsize].execute("select * from rdb$database", function(){
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
    database.startTransaction(function(transaction) {
        tr = transaction;
        tr.newStatement("select cas t(? as integer) from rdb$database", function(statement) {
            st = statement;
            st.execute(tr, [123], function() {
                st.fetchAll(tr, function(data) {
                    console.log(data);
                    st.drop();
                    tr.commit()
                }, error)
            }, error)
        }, error);
    }, error)
}

connect = function(callback, error){
    database = new fb.Database('127.0.0.1', 3050, db, 'SYSDBA', 'masterkey', callback, error)
};

repl.start();
connect(
    function() {
        console.log('connected');

    },
    logerror
);
