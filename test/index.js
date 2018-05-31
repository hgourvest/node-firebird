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

    let db;

    afterEach(() => {
        if (db) db.detach();
    });

    it('should attach or create database', done => {
        Firebird.attachOrCreate(config, (err, _db) => {
            assert.ok(!err, err);
            db = _db;
            done();
        });
    });

    it('should reconnect when socket is closed', done => {
        Firebird.attach(config, (err, _db) => {
            assert.ok(!err, err);
            db = _db;
            db.on('reconnect', done);
            db.connection._socket.end();
        });
    });
});

describe('Database', () => {
    
    const blobPath = path.join(testDir, 'image.png');
    
    let db;
    
    before(done => {
        Firebird.attachOrCreate(config, (err, _db) => {
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
                assert.ok(rows[0].count === 0);
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
                assert.ok(row['id'] === 2);
                done();
            });
        });
        
        it('should insert with blob from stream', done => {
            db.query('INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID', [3, 'Firebird 3', fs.createReadStream(blobPath), '14.12.2014 12:12:12'], (err, row) => {
                assert.ok(!err, err);
                assert.ok(row['id'] === 3);
                done();
            });
        });
        
        it('should insert with blob from buffer', done => {
            db.query('INSERT INTO test (ID, NAME, FILE, CREATED) VALUES(?, ?, ?, ?) RETURNING ID', [4, 'Firebird 4', fs.readFileSync(blobPath), '14.12.2014T12:12:12'], (err, row) => {
                assert.ok(!err, err);
                assert.ok(row['id'] === 4);
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
    });
});