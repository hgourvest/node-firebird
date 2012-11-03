fb = require("../lib");
repl = require("repl");

macdb = '/fbdata/test.fdb';
windb = 'C:\\dev\\bases\\test.fdb';
db = windb;

config = {
    database: db,
    host: '127.0.0.1',     // default
    port: 3050,            // default
    user: 'SYSDBA',        // default
    password: 'masterkey', // default
    role: null,            // default
    pageSize: 4096         // default when creating database
}

quit = function() {
    database.detach(
        function(){
            console.log('database detached');
        }
    );
};

function logError(err) {
    console.log(err.message);
}

function checkError(err) {
    if (err) {
        throw new Error(err.message)
    }
}

// simple usage, transaction automatically started and commited/rollbacked
// - query is a non optional string
// - params is optional, can be a single value or an array
// - callback is optional
test1 = function(){
    database.query("select cast(? as integer) from rdb$database", 123,
        function (err, result) {
            if (err) {logError(err); return}
            console.log(result[0].cast);
        }
    );
};

// simple usage of a transaction
test2 = function() {
    database.startTransaction(
        function(err0, transaction) {
            checkError(err0);
            transaction.query("select cast(? as integer) from rdb$database", 123,
                function(err1, result) {
                    transaction.commit(
                        function(err2) { // commit in all situations for a single query
                            checkError(err1);           // error executing query ?
                            checkError(err2);           // error commiting ?
                            console.log(result);
                        }
                    )
                }
            );
        }
    )
};

// multiple queries in a transaction
test3 = function() {

    function check(tr, callback){
        return function(err, param) {
            if (!err) {
                callback(err, param);
            } else {
                tr.rollback();
                console.log(err.message);
            }
        }
    }

    database.startTransaction(
        function(err, transaction) {
            checkError(err);
            transaction.query("select cast(? as integer) from rdb$database", 123,
                check(transaction, function(err, result1) {
                    transaction.query("select cast(? as integer) from rdb$database", 456,
                        check(transaction, function(err, result2) {
                            transaction.commit(
                                function(err) {
                                    checkError(err);
                                    console.log(result1[0]);
                                    console.log(result2[0]);
                                }
                            )
                        })
                    );
                })
            );
        }
    )
};

// concurrency

function createPool(count, callback) {
    var pool = [];
    for(var i = 0; i < count; i++) {
        fb.attach(config,
            function(err, db) {
                if (err) {
                    logError(err);
                    return;
                }
                pool[--count] = db;
                if (count == 0) {
                    callback(pool);
                }
            }
        )
    }
}

test4 = function(count, poolsize) {
    createPool(poolsize,
        function(pool) {
            var n = Date.now();
            var max = count;
            for (var i = 0; i < max; i++) {
                pool[i % poolsize].execute("select * from rdb$relations",
                    function(){
                        if (--count == 0) {
                            console.log(max + " queries");
                            console.log((Date.now() - n)/max + 'ms / query');
                            for (var db in pool) {pool[db].detach()}
                        }
                    }
                );
            }
        }
    );
};

// more complex sample

test5 = function() {
    var tr, st;
    function error(err) {
        if (tr) tr.rollback();
        if (st) st.drop();
        logError(err);
    }

    function fetch(callback) {
        st.fetch(tr,
            function(err, ret) {
                if (err) {
                    error(err);
                } else {
                    console.log(ret.data);
                    callback(ret.fetched);
                }
            }
        )
    }

    database.startTransaction(
        function(err, transaction) {
            if (err) {error(err); return};
            tr = transaction;
            tr.newStatement("select * from rdb$relations",
                function(err, statement) {
                    if (err) {error(err); return};
                    st = statement;
                    st.execute(tr,
                        function(err) {
                            if (err) {error(err); return};
                            var cb = function(fetched) {
                                if (fetched) {
                                    st.drop();
                                    tr.commit();
                                } else {
                                    fetch(cb);
                                }
                            };
                            fetch(cb);
                        }
                    )
                }
            );
        }
    )
};

repl.start("");

fb.attachOrCreate(config,
    function (err, db) {
        if (err) {
            console.log(err.message);
        } else {
            database = db;
            test1();
        }
    }
);