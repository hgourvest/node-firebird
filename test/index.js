const Firebird = require('../lib');

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const currentTime = new Date().getTime();
const testDir = path.resolve(__dirname);

const config = {
    database: path.join(process.env.FIREBIRD_DATA || testDir, `test-${currentTime}.fdb`),
    host: '127.0.0.1',
    port: 3050,
    user: 'sysdba',
    password: 'masterkey',
    lowercase_keys: true
};

describe('Connection', () => {

    it('should attach or create database', done => {
        Firebird.attachOrCreate(config, (err, db) => {
            assert.ok(!err, err);
            db.detach();
            done();
        });
    });

    it('should reconnect when socket is closed', done => {
        Firebird.attach(config, (err, db) => {
            assert.ok(!err, err);
            db.on('reconnect', () => {
                db.detach();
                done();
            });
            db.connection._socket.end();
        });
    });
});

describe('Pooling', () => {
        
    const poolSize = 2;
    
    let pool;
    
    before(() => {
        pool = Firebird.pool(poolSize, config);
    });
    
    after(() => {
        pool.destroy();
    });
    
    it('should wait when all connections are in use', done => {
        for (let i = 0; i < poolSize; i++) {
            pool.get((err, db) => {
                assert.ok(!err, err);
                setImmediate(() => db.detach());
            });
        }
        
        pool.get((err, db) => {
            assert(!err, err);
            
            db.query('SELECT * FROM RDB$DATABASE', (err, rows) => {
                assert(!err, err);
                assert.equal(rows.length, 1);
                db.detach();
                done();
            });
        });
        
        assert.equal(pool.pending.length, 1);
    });
});


describe('Database', () => {
    
    const blobPath = path.join(testDir, 'image.png');
    
    let db;
    
    before(done => {
        Firebird.attach(config, (err, _db) => {
            if (err) throw err;
            db = _db;
            done();
        });
    });
    
    after(() => {
        if (db) db.detach();
    });
    
    it('should create table', done => {
        db.query(`
            CREATE TABLE test (
                ID INT, 
                PARENT BIGINT, 
                NAME VARCHAR(50), 
                FILE BLOB, 
                CREATED TIMESTAMP
            )
        `, err => {
            assert.ok(!err, err);
            
            db.query('SELECT COUNT(*) FROM test', (err, rows) => {
                assert.ok(!err, err);
                assert.equal(rows[0].count, 0);
                done();
            });
        });
    });
    
    describe('insert', () => {
        it('should insert without returning', done => {
            db.query('INSERT INTO test (ID, NAME, CREATED) VALUES(?, ?, ?)', [1, 'Firebird 1', '2014-12-12 13:59'], err => {
                assert.ok(!err, err);
                done();
            });
        });
        
        it('should insert with returning', done => {
            db.query('INSERT INTO test (ID, NAME, CREATED) VALUES(?, ?, ?) RETURNING ID', [2, 'Firebird 2', '2014-12-12 13:59'], (err, row) => {
                assert.ok(!err, err);
                assert.equal(row['id'], 2);
                done();
            });
        });
        
        it('should insert with blob from stream', done => {
            db.query('INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID', [3, 'Firebird 3', fs.createReadStream(blobPath), '14.12.2014 12:12:12'], (err, row) => {
                assert.ok(!err, err);
                assert.equal(row['id'], 3);
                done();
            });
        });
        
        it('should insert with blob from buffer', done => {
            db.query('INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID', [4, 'Firebird 4', fs.readFileSync(blobPath), '14.12.2014T12:12:12'], (err, row) => {
                assert.ok(!err, err);
                assert.equal(row['id'], 4);
                done();
            });
        });
    });
       
    describe('update', () => {
        it('should update with blob from stream', done => {
            db.query('UPDATE test SET NAME = ?, FILE = ? WHERE Id = 1', ['Firebird 1 (UPD)', fs.createReadStream(blobPath)], err => {
                assert.ok(!err, err);
                done();
            });
        });
        
        it('should update with blob from buffer', done => {
            db.query('UPDATE test SET NAME = ?, FILE = ? WHERE Id = 2', ['Firebird 2 (UPD)', fs.readFileSync(blobPath)], err => {
                assert.ok(!err, err);
                done();
            });
        });
        
        describe('verify', () => {
            it('should select data from update with blob from stream', done => {
                db.query('SELECT * FROM test WHERE ID = 1', (err, rows) => {
                    assert.ok(!err, err);
                    
                    const [row] = rows;
                    assert.notEqual(row, undefined);
                    assert.equal(row.id, 1);
                    assert.equal(row.name, 'Firebird 1 (UPD)');
                    assert.equal(typeof(row.file), 'function');
        
                    row.file((err, name, emitter) => {
                        assert.ok(!err, err);
        
                        let count = 0;
        
                        emitter.on('data', buffer => {
                            count += buffer.length;
                        });
        
                        emitter.on('end', () => {
                            assert.equal(count, 5472);
                            done();
                        });
                    });
                });    
            });
            
            it('should select data from update with blob from buffer', done => {
                db.query('SELECT * FROM test WHERE ID = 2', (err, rows) => {
                    assert.ok(!err, err);
                    
                    const [row] = rows;
                    assert.notEqual(row, undefined);
                    assert.equal(row.id, 2);
                    assert.equal(row.name, 'Firebird 2 (UPD)');
                    assert.equal(typeof(row.file), 'function');
        
                    row.file((err, name, emitter) => {
                        assert.ok(!err, err);
        
                        let count = 0;
        
                        emitter.on('data', buffer => {
                            count += buffer.length;
                        });
        
                        emitter.on('end', () => {
                            assert.equal(count, 5472);
                            done();
                        });
                    });
                });    
            });
        });
    });
    
    describe('select', () => {
        it('should select scalar values', done => {
            db.query(`
                SELECT 
                    CAST(123 AS NUMERIC(10,2)) As a, 
                    MAX(2) AS b, 
                    COUNT(*) AS c 
                FROM RDB$DATABASE
            `, (err, rows) => {
                assert.ok(!err, err);
                const [row] = rows;
                assert.equal(row.a, 123, 'CAST returned an unexpected value.');
                assert.equal(row.b, 2, 'MAX returned an unexpected value.');
                assert.notEqual(row.c, 0, 'COUNT returned an unexpected value.');
                done();
            });
        });
        
        it('should select rows as arrays', done => {
            db.execute('SELECT COUNT(*), SUM(ID) FROM test', (err, rows) => {
                assert.ok(!err, err);
                const [row] = rows;
                assert.equal(row[0], 4);
                assert.equal(row[1], 10);
                done();
            });    
        });
        
        it('should select rows as objects', done => {
            db.query('SELECT COUNT(*), SUM(ID) FROM test', (err, rows) => {
                assert.ok(!err, err);
                const [row] = rows;
                assert.equal(row.count, 4);
                assert.equal(row.sum, 10);
                done();
            });    
        });
        
        it('should select rows sequentially as arrays', done => {
            let sum = 0;
            db.sequentially('SELECT Id FROM test', row => {
                sum += row[0];
            }, () => {
                assert.equal(sum, 10);
                done();
            }, true);
        });
        
        it('should select rows sequentially as objects', done => {
            let sum = 0;
            db.sequentially('SELECT Id FROM test', row => {
                sum += row.id;
            }, () => {
                assert.equal(sum, 10);
                done();
            });
        });
    });
    
    describe('transaction', () => {
       
        it('should rollback', done => {
            db.transaction((err, transaction) => {
                assert(!err, err);
                transaction.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [5, 'Transaction 1'], err => {
                    assert.ok(!err, err);
                    transaction.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [6, 'Transaction 2'], err => {
                        assert.ok(!err, err);
                        transaction.query('INSERT INTO test_fail (ID, NAME) VALUES(?, ?)', [7, 'Transaction 3'], err => {
                            assert.ok(err);
                            transaction.rollback(err => {
                                assert.ok(!err, err);
                                verify(done, 4);
                            });
                        });
                    });
                });
            });
        });

        it('should commit', done => {
            db.transaction((err, transaction) => {
                assert(!err, err);
                transaction.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [5, 'Transaction 1'], err => {
                    assert.ok(!err, err);
                    transaction.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [6, 'Transaction 2'], err => {
                        assert.ok(!err, err);
                        transaction.query('INSERT INTO test (ID, NAME) VALUES(?, ?)', [7, 'Transaction 3'], err => {
                            assert.ok(!err, err);
                            transaction.commit(err => {
                                assert.ok(!err, err);
                                verify(done, 7);
                            });
                        });
                    });
                });
            });
        });
        
        function verify(callback, count) {
            db.query('SELECT COUNT(*) FROM test', (err, rows) => {
                assert.ok(!err, err);
                const [row] = rows;
                assert.equal(row.count, count);
                callback();
            });
        }
    });
});
