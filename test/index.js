var Firebird = require('../lib');

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var currentDate = new Date();
var testDir = path.resolve(__dirname);

var config = {
    database: path.join(process.env.FIREBIRD_DATA || testDir, 'test-' + currentDate.getTime() + '.fdb'),
    host: '127.0.0.1',
    port: 3050,
    user: 'sysdba',
    password: 'masterkey',
    role: null,
    pageSize: 4096,
    timeout: 3000,
    lowercase_keys: true
};

describe('Connection', function () {

    it('should attach or create database', function (done) {
        Firebird.attachOrCreate(config, function (err, db) {
            assert.ok(!err, err);
            
            db.detach();
            done();
        });
    });

    it('should reconnect when socket is closed', function (done) {
        Firebird.attach(config, function (err, db) {
            assert.ok(!err, err);
            
            db.connection._socket.end();
            db.on('reconnect', function () {
                db.detach();
                done();
            });
        });
    });

    var testCreateConfig = Object.assign({}, config, {database: config.database.replace(/\.fdb/, '2.fdb')});
    it('should create', function(done) {
        Firebird.create(testCreateConfig, function(err, db) {
            assert.ok(!err, err);

            db.detach();
            done();
        });
    });

    it('should drop', function(done) {
        Firebird.drop(testCreateConfig, function(err) {
            assert.ok(!err, err);

            done();
        });
    });
});

describe('Pooling', function () {

    var poolSize = 2;
    var pool;

    before(function () {
        pool = Firebird.pool(poolSize, config);
    });

    after(function () {
        pool.destroy();
    });

    it('should wait when all connections are in use', function (done) {
        for (var i = 0; i < poolSize; i++) {
            pool.get(function (err, db) {
                assert.ok(!err, err);

                setImmediate(function () {
                    db.detach();
                });
            });
        }

        pool.get(function(err, db) {
            assert(!err, err);

            db.query('SELECT * FROM RDB$DATABASE', function(err, rows) {
                assert(!err, err);
                assert.equal(rows.length, 1);
                db.detach(function () {
                    assert.equal(pool.dbinuse, 0);
                    done();
                });
            });
        });

        assert.equal(pool.pending.length, 1);
    });
});

describe('Database', function() {
    const TEST_TABLE = 'CREATE TABLE test (ID INT, PARENT BIGINT, NAME VARCHAR(50), FILE BLOB, CREATED TIMESTAMP)';

    var blobPath = path.join(testDir, 'image.png');
    var blobSize = fs.readFileSync(blobPath).length;
    var db;

    before(function(done) {
        Firebird.attachOrCreate(config, function(err, _db) {
            if (err) throw err;
            db = _db;

            db.query(TEST_TABLE, function(err) {
                assert.ok(!err, err);
                done();
            });
        });
    });

    after(function() {
        if (db) db.detach();
    });

    describe('Select', function() {
        it('should simple select', function (done) {
            db.query('SELECT * FROM RDB$DATABASE', function (err, row) {
                assert.ok(!err, err);
                assert.ok(row);
                assert.equal(row.length, 1);
                assert.equal(row[0]['rdb$description'], null); // Check null value for FB3 BitSet

                done();
            });
        });

        it('should select with param', function (done) {
            db.query('SELECT * FROM RDB$ROLES WHERE RDB$OWNER_NAME = ?', [config.user], function (err, d) {
                assert.ok(!err, err);
                assert.ok(d);

                done();
            });
        });

        it('should select multiple rows', function (done) {
            db.query('SELECT FIRST 100 RDB$FIELD_NAME FROM RDB$FIELDS', function (err, d) {
                assert.ok(!err, err);

                done();
            });
        });

        it('should create table', function (done) {
            db.query('CREATE TABLE T (ID INT)', function (err, d) {
                assert.ok(!err, err);

                done();
            });
        });
    });

    describe('Insert', function() {
        it('should insert', function(done) {
            db.query(
              'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?)',
              [1, 'Firebird 1', '2014-12-12 13:59', 862304020112911],
              function(err) {
                  assert.ok(!err, err);
                  done();
              });
        });

        it('should insert with returning', function(done) {
            db.query(
              'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?) RETURNING ID',
              [2, 'Firebird 2', currentDate, 862304020112911],
              function(err, row) {
                  assert.ok(!err, err);
                  assert.equal(row['id'], 2);
                  done();
              });
        });

        it('should insert with blob from stream', function (done) {
            db.query(
              'INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID',
              [3, 'Firebird 3', fs.createReadStream(blobPath), '14.12.2014 12:12:12'],
              function (err, row) {
                assert.ok(!err, err);
                assert.equal(row['id'], 3);
                done();
              });
        });

        it('should insert with blob from buffer', function (done) {
            db.query(
              'INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID',
              [4, 'Firebird 4', fs.readFileSync(blobPath), '14.12.2014T12:12:12'],
              function (err, row) {
                assert.ok(!err, err);
                assert.equal(row['id'], 4);
                done();
              });
        });

        it('should insert with null', function(done) {
            db.query(
              'INSERT INTO test (ID, NAME, CREATED, PARENT) VALUES(?, ?, ?, ?)',
              [5, null, '2014-12-12 13:59', null],
              function(err) {
                  assert.ok(!err, err);
                  done();
              });
        });

        describe('verify', function () {
            it('should select data from inserts', function (done) {
                db.query('SELECT * FROM test', function (err, rows) {
                    assert.ok(!err, err);

                    var first = rows[0];
                    var second = rows[1];
                    var third = rows[2];
                    var five = rows[4];

                    assert.equal(first.created.getMonth(), 11);
                    assert.equal(first.created.getDate(), 12);
                    assert.equal(first.created.getFullYear(), 2014);
                    assert.equal(first.created.getHours(), 13);
                    assert.equal(first.created.getMinutes(), 59);

                    assert.equal(second.created.getTime(), currentDate.getTime());

                    assert.notEqual(third, undefined);
                    assert.equal(third.id, 3)
                    assert.equal(third.name, 'Firebird 3');
                    assert.equal(typeof(third.file), 'function');
                    assert.equal(third.created.getMonth(), 11);
                    assert.equal(third.created.getDate(), 14);
                    assert.equal(third.created.getFullYear(), 2014);
                    assert.equal(third.created.getHours(), 12);
                    assert.equal(third.created.getMinutes(), 12);

                    assert.equal(five.name, null);
                    assert.equal(five.parent, null);

                    third.file(function(err, name, emitter) {
                        assert.ok(!err, err);

                        var count = 0;

                        emitter.on('data', function(buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function() {
                            assert.equal(count, blobSize);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe('update', function () {
        it('should update with blob from stream', function(done) {
            db.query(
              'UPDATE test SET NAME = ?, FILE = ? WHERE Id = 1',
              ['Firebird 1 (UPD)', fs.createReadStream(blobPath)],
              function (err) {
                assert.ok(!err, err);
                done();
              });
        });

        it('should update with blob from buffer', function(done) {
            db.query('UPDATE test SET NAME = ?, FILE = ? WHERE Id = 2', ['Firebird 2 (UPD)', fs.readFileSync(blobPath)], function (err) {
                assert.ok(!err, err);
                done();
            });
        });

        describe('verify', function () {
            it('should select data from update with blob from stream', function(done) {
                db.query('SELECT * FROM test WHERE ID = 1', function (err, rows) {
                    assert.ok(!err, err);

                    var row = rows[0];
                    assert.notEqual(row, undefined);
                    assert.equal(row.id, 1);
                    assert.equal(row.name, 'Firebird 1 (UPD)');
                    assert.equal(typeof(row.file), 'function');

                    row.file(function (err, name, emitter) {
                        assert.ok(!err, err);

                        var count = 0;

                        emitter.on('data', function (buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function () {
                            assert.equal(count, 5472);
                            done();
                        });
                    });
                });
            });

            it('should select data from update with blob from buffer', function (done) {
                db.query('SELECT * FROM test WHERE ID = 2', function (err, rows) {
                    assert.ok(!err, err);

                    var row = rows[0];
                    assert.notEqual(row, undefined);
                    assert.equal(row.id, 2);
                    assert.equal(row.name, 'Firebird 2 (UPD)');
                    assert.equal(typeof(row.file), 'function');

                    row.file(function (err, name, emitter) {
                        assert.ok(!err, err);

                        var count = 0;

                        emitter.on('data', function (buffer) {
                            count += buffer.length;
                        });

                        emitter.on('end', function () {
                            assert.equal(count, 5472);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe('Select - complex', function () {
        it('should select scalar values', function(done) {
            db.query(
              'SELECT CAST(123 AS NUMERIC(10,2)) As a, MAX(2) AS b, COUNT(*) AS c FROM RDB$DATABASE',
              function(err, rows) {
                  assert.ok(!err, err);
                  var row = rows[0];
                  assert.equal(row.a, 123,
                    'CAST returned an unexpected value.');
                  assert.equal(row.b, 2,
                    'MAX returned an unexpected value.');
                  assert.notEqual(row.c, 0,
                    'COUNT returned an unexpected value.');
                  done();
              });
        });

        it('should select rows as arrays', function(done) {
            db.execute('SELECT COUNT(*), SUM(ID) FROM test',
              function(err, rows) {
                  assert.ok(!err, err);
                  var row = rows[0];
                  assert.equal(row[0], 5);
                  assert.equal(row[1], 15);
                  done();
              });
        });

        it('should select rows as objects', function(done) {
            db.query('SELECT COUNT(*), SUM(ID) FROM test',
              function(err, rows) {
                  assert.ok(!err, err);
                  var row = rows[0];
                  assert.equal(row.count, 5);
                  assert.equal(row.sum, 15);
                  done();
              });
        });

        it('should select rows sequentially as arrays', function(done) {
            var sum = 0;
            db.sequentially('SELECT Id FROM test', function(row) {
                sum += row[0];
            }, function() {
                assert.equal(sum, 15);
                done();
            }, true);
        });

        it('should select rows sequentially as objects', function(done) {
            var sum = 0;
            db.sequentially('SELECT Id FROM test', function(row) {
                sum += row.id;
            }, function() {
                assert.equal(sum, 15);
                done();
            });
        });
    });

    describe('Transaction', function() {
        var db;

        before(function(done) {
            Firebird.attachOrCreate(config, function(err, _db) {
                if (err) throw err;
                db = _db;
                done();
            });
        });

        after(function() {
            if (db) db.detach();
        });

        it('should create table2', function(done) {
            db.query('EXECUTE BLOCK AS BEGIN ' +
              'if (not exists(select 1 from rdb$relations where rdb$relation_name = \'TEST2\')) then ' +
              'execute statement \'CREATE TABLE test2 (ID INT, NAME VARCHAR(50))\'; ' +
              'END',
              function(err) {
                  assert.ok(!err, err);
                  done();
              });
        });

        it('should rollback', function(done) {
            db.transaction(function(err, transaction) {
                assert(!err, err);
                transaction.query(
                  'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                  [1, 'Transaction 1'], function(err) {
                      assert.ok(!err, err);
                      transaction.query(
                        'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                        [2, 'Transaction 2'], function(err) {
                            assert.ok(!err, err);
                            transaction.query(
                              'INSERT INTO test_fail (ID, NAME) VALUES(?, ?)',
                              [3, 'Transaction 3'],
                              function(err) {
                                  assert.ok(err);
                                  transaction.rollback(
                                    function(err) {
                                        assert.ok(!err, err);
                                        verify(done, 0);
                                    });
                              });
                        });
                  });
            });
        });

        it('should commit', function(done) {
            db.transaction(function(err, transaction) {
                assert(!err, err);
                transaction.query(
                  'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                  [4, 'Transaction 1'], function(err) {
                      assert.ok(!err, err);
                      transaction.query(
                        'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                        [5, 'Transaction 2'], function(err) {
                            assert.ok(!err, err);
                            transaction.query(
                              'INSERT INTO test2 (ID, NAME) VALUES(?, ?)',
                              [6, 'Transaction 3'],
                              function(err) {
                                  assert.ok(!err, err);
                                  transaction.commit(
                                    function(err) {
                                        assert.ok(!err, err);
                                        verify(done, 3);
                                    });
                              });
                        });
                  });
            });
        });

        function verify(callback, count) {
            db.query('SELECT COUNT(*) FROM test2', function(err, rows) {
                assert.ok(!err, err);
                var row = rows[0];
                assert.equal(row.count, count);
                callback();
            });
        }
    });
});
