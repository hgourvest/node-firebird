const Firebird = require('../lib');
const Config = require('./config');
const assert = require('assert');
const Pool = require('../lib/pool');

const config = Config.default;

describe('Pool Fixes', function () {

    it('should timeout if attach hangs (Fix 1)', function () {
        return new Promise((resolve, reject) => {
            // Mock attach that never calls back
            const hangingAttach = (options, cb) => {
                // never calls cb
            };

            const pool = new Pool(hangingAttach, 1, { connectTimeout: 500 });
            
            pool.get((err, db) => {
                try {
                    assert.ok(err);
                    assert.equal(err.message, 'Connection timeout after 500ms');
                    assert.equal(pool._creating, 0);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    });

    it('should discard late connection after timeout (Fix 1)', function () {
        return new Promise((resolve, reject) => {
            let detachCalled = false;
            const hangingAttach = (options, cb) => {
                setTimeout(() => {
                    cb(null, {
                        detach: () => { detachCalled = true; },
                        on: (event, cb) => {},
                        connection: { _pooled: true }
                    });
                }, 200);
            };

            const pool = new Pool(hangingAttach, 1, { connectTimeout: 100 });
            
            pool.get((err, db) => {
                try {
                    assert.ok(err);
                    assert.equal(err.message, 'Connection timeout after 100ms');
                    
                    // Wait for late connection
                    setTimeout(() => {
                        try {
                            assert.ok(detachCalled);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    }, 150);
                } catch (e) {
                    reject(e);
                }
            });
        });
    });

    it('should reject get() if pool is destroyed (Fix 2)', function () {
        const pool = new Pool(null, 1, {});
        pool.destroy();
        
        return new Promise((resolve, reject) => {
            pool.get((err, db) => {
                if (err && err.message === 'Pool has been destroyed') {
                    resolve();
                } else {
                    reject(new Error('Should have rejected with "Pool has been destroyed"'));
                }
            });
        });
    });

    it('should drain pending queue on destroy (Fix 4)', function () {
        return new Promise((resolve, reject) => {
            const hangingAttach = (options, cb) => {};
            const pool = new Pool(hangingAttach, 1, {});

            // First request takes the only slot (max=1) and hangs in attach
            pool.get((err, db) => {});

            let callbackCalled = false;
            // Second request must stay in pending
            pool.get((err, db) => {
                try {
                    assert.ok(err);
                    assert.equal(err.message, 'Pool is being destroyed');
                    callbackCalled = true;
                } catch (e) {
                    // This will be caught by the promise
                }
            });

            try {
                assert.equal(pool.pending.length, 1);
                pool.destroy();
                assert.equal(pool.pending.length, 0);
                assert.ok(callbackCalled);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });

    it('should invoke destroy callback even if connections are in use (Fix 5)', function () {
        return new Promise((resolve, reject) => {
            const mockDb = {
                detach: (cb) => { if (cb) cb(); },
                on: (event, cb) => {},
                connection: { _pooled: true }
            };
            const instantAttach = (options, cb) => { cb(null, mockDb); };
            const pool = new Pool(instantAttach, 1, {});

            pool.get((err, db) => {
                try {
                    assert.ifError(err);
                    assert.equal(pool.dbinuse, 1);
                    
                    // pool.destroy should complete even if db is still in use
                    pool.destroy(() => {
                        resolve();
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
    });

    it('should discard connection and create a new one if connection is closed/destroyed while idle', function () {
        return new Promise((resolve, reject) => {
            let attachCount = 0;
            const mockDbs = [];

            const attach = (options, cb) => {
                attachCount++;
                const db = {
                    detach: (cb) => { if (cb) cb(); },
                    on: (event, cb) => {},
                    connection: {
                        _isClosed: false,
                        _isDetach: false,
                        _socket: { destroyed: false }
                    }
                };
                mockDbs.push(db);
                cb(null, db);
            };

            const pool = new Pool(attach, 1, {});

            // First get: creates first connection
            pool.get((err, db1) => {
                try {
                    assert.ifError(err);
                    assert.equal(attachCount, 1);

                    // Return to pool (triggers detach listener, which adds to pooldb)
                    db1.connection._pooled = true;
                    // Simulate detach/return to pool
                    pool.dbinuse--;
                    pool.pooldb.push(db1);

                    // Destroy/close the connection socket while idle
                    db1.connection._socket.destroyed = true;

                    // Second get: should notice socket is destroyed, discard db1, and attach a new connection
                    pool.get((err, db2) => {
                        try {
                            assert.ifError(err);
                            assert.equal(attachCount, 2); // verify new connection was created
                            assert.notStrictEqual(db1, db2);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });

                } catch (e) {
                    reject(e);
                }
            });
        });
    });
});
