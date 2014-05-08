# node-firebird

Pure JavaScript and Asynchronous Firebird client for Node.js.

To get help, join [this] [2] google group.

If you are new to Firebird you will find useful documentation [here] [1].

## Install

	npm install node-firebird

## Examples

### Connecting

	fb = require("node-firebird");
	fb.attach(
	    {
	        host: '127.0.0.1',
	        database: 'database.fdb',
	        user: 'SYSDBA',
	        password: 'masterkey'
	    },
		function(err, db){
            if (err) {
                console.log(err.message);
            } else {
                database = db;
            	console.log("connected");
            }
		}
	);

### Querying

#### Simple query

	database.query("select cast(? as integer) from rdb$database", 123,
		function (err, result) {
			console.log(result)
		}
	);

The transaction automatically started, commited or rollbacked.

- query is a non optional string.
- params is optional, can be a single value or an array.
- callback is optional.
- 


### Detaching

#### Simple query

	database.detach();



### Using transaction

    function checkError(err) {
        if (err) {
            throw new Error(err.message)
        }
    }
    function check(tr, callback){
        return function(err, param) {
            if (!err) {
                callback(err, param);
            } else {
                tr.rollback();
                throw new Error(err.message)
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

### Arrays or Objects ?

The common usage is to fetch records as objects

    database.query(...)

You can also fetch records as arrays

    database.execute(...)

In this case you can retrieve fields name in the callback

    function(err, rows, fields){...}

You can do the same on transactions.

### Errors handling

This is a typical error object:

    {
    	status: [
    		{gdscode: 335544569},                   // Dynamic SQL Error
    		{gdscode: 335544436, params: [-104]},   // SQL error code = -104
    		{gdscode: 335544634, params: [1,31]},   // Token unknown - line 1, column 31
    		{gdscode: 335544382, params: ["m"]}     // m
    	],
    	sqlcode: -104,
    	message: "Dynamic SQL Error, SQL error code = -104, Token unknown - line 1, column 31, m"
    }

- The first gdscode value is the most significant error.
- The sqlcode value is extracted from status vector.
- The message string is built using firebird.msg file.

  [1]: http://www.firebirdsql.org/en/documentation/
  [2]: https://groups.google.com/forum/#!forum/node-firebird
  
### Charset for database connection is always UTF-8 

node-firebird doesn't let you chose the charset connection, it will always use UTF8.
Node is unicode, no matter if your database is using another charset to store string or blob, Firebird will transliterate automatically.

This is why you should use Firebird 2.5 server at least.
