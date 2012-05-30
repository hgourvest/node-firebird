# node-firebird

Pure javascript and asynchronous Firebird client for Node.js

## Examples

### Connecting

	fb = require("node-firebird");
	var database = new fb.Database('127.0.0.1', 3050, db, 'SYSDBA', 'masterkey', 
		function(){
			console.log("connected");
		}, 
		function(error){
			console.log("can't connect");
		}
	);

### Querying

#### Simple query

	database.execute("select cast(? as integer) from rdb$database", [123],
		function (result) {
			console.log(result.data)
		}
	);

The transaction automatically started and commited/rollbacked.

- query is a non optional string.
- params is optional, can be a single value or an array.
- callback & error are optional.


### Using transaction

	var tr;

	function fail(err) {
		tr.rollback();
		console.log(err.status);
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

### Errors handling

Most async methods can trigger a callback and an error event, they are optionnals. If an error occur the error event will be called, if no error event is provided, the error will be sent to the callback event and you will have to check if the result is an error. An error object have a status property.

	function CheckResult(obj) {
		if (obj.status) {
			throw new Error('oups')
		}
	}

	database.startTransaction(function(transaction) {
		transaction.execute("select cast(? as integer) from rdb$database", 123, function(result) {
			transaction.commit(function(ret) { // commit in all situations for a single query
				CheckResult(result);           // error executing query ?
				CheckResult(ret);              // error commiting ?
				console.log(result.data);
			})
		});
	})
