const Firebird = require('../lib/index.js');
const Config = require('./config');

const assert = require('assert');
const stream = require('stream');
const path = require('path');
const fs = require('fs');

const config = Object.assign({}, Config.default, {manager: true});
const REMOVE_DB = false;

function readStream(s, cb) {
    var result = '';

    s.on('data', chunk => result += chunk.toString() + '\n');
    s.on('end', () => cb(result));
}

describe('Test Service', () => {
    const DATABASE = Config.default;

    // Create DB before tests
    before(done => {
        Firebird.attachOrCreate(DATABASE, (err, db) => {
            assert.ok(!err, err);
            db.detach(done);
        });
    });

    // Remove DB and backup files after tests
    after(done => {
        if (!REMOVE_DB) {
            done();
            return;
        }

        fs.readdir(path.resolve(__dirname), (err, fileNames) => {
            if (err) throw err;

            for (const name of fileNames) {
                if (name.toLowerCase().indexOf('.fdb') > -1 || name.toLowerCase().indexOf('.fbk') > -1) {
                    fs.unlinkSync(path.resolve(__dirname, name));
                }
            }
            done();
        });
    });

    it('should attach', done => {
        Firebird.attach(config, (err, srv) => {
            assert.ok(!err, err);
            srv.detach(done);
        });
    });

    describe('Server info', () => {
        it('should get all server infos', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getFbserverInfos([], {}, (err, data) => {
                    assert.ok(!err, err);

                    assert.ok(data.dbinfo, 'Db info not found');
                    assert.ok(data.dbinfo.database, 'Db info database not found');
                    assert.ok(data.dbinfo.nbattachment != null, 'Db info nb attachment not found');
                    assert.ok(data.dbinfo.nbdatabase != null, 'Db info nb database not found');
                    assert.ok(data.svcversion, 'Svc version not found');
                    assert.ok(data.fbversion, 'Fb version not found');
                    assert.ok(data.fbimplementation, 'Fb implementation not found');
                    assert.ok(data.fbcapatibilities, 'Fb capatibilities not found');
                    assert.ok(data.pathsecuritydb, 'Fb security DB path not found');
                    assert.ok(data.fbenv, 'Fb environment not found');
                    assert.ok(data.fbenvlock, 'Fb lock environment not found');
                    assert.ok(data.fbenvmsg, 'Fb messages environment not found');
                    srv.detach(done);
                });
            });
        });

        it('should get one server info', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getFbserverInfos({dbinfo: true}, {}, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data.dbinfo, 'Db Info not found')
                    assert.ok(!data.fbversion, 'FB version found (must not)');

                    srv.detach(done);
                });
            });
        });
    });

    describe('Server stats and logs', () => {
        it('should get stats', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getStats({}, (err, data) => {
                    assert.ok(!err, err);

                    readStream(data, result => {
                        assert.ok(result.indexOf('Gstat execution time') > -1, '"Gstat execution time" text not found')

                        srv.detach(done);
                    });
                });
            });
        });

        it('should get logs', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getLog({}, (err, data) => {
                    assert.ok(!err, err);

                    readStream(data, result => {
                        assert.equal(typeof result, 'string');

                        srv.detach(done);
                    });
                });
            });
        });
    });

    describe('Server properties', () => {
        // Add delay for skip error : Service is currently busy // TODO better srv.detach ?
        beforeEach(done => setTimeout(done, 100));

        it('should set dialect', done => {
            testProperty(
              'setDialect', [DATABASE.database, 1],
              RegExp.prototype.test.bind(/Database dialect\s*1/), done
            );
        });

        it('should set sweep interval', done => {
            testProperty(
              'setSweepinterval', [DATABASE.database, 20000],
              RegExp.prototype.test.bind(/Sweep interval:\s*20000/), done
            );
        });

        it('should set cache buffer', done => {
            testProperty(
              'setCachebuffer', [DATABASE.database, 4000],
              RegExp.prototype.test.bind(/Page buffers\s*4000/), done
            );
        });

        it('should old shutdown', done => {
            testProperty(
              'Shutdown', [DATABASE.database, 0, 0],
              RegExp.prototype.test.bind(/Attributes\s*.*? multi-user maintenance/), done
            );
        });

        it('should bring online', done => {
            testProperty(
              'BringOnline', [DATABASE.database],
              (data) => data.indexOf('maintenance') === -1, done
            )
        });

        const SHUTDOWN = [
          {name: 'force - multi', args: [0, 0, 1], test: /Attributes\s*.*? multi-user maintenance/},
          {name: 'force - single', args: [0, 0, 2], test: /Attributes\s*.*? single-user maintenance/},
          {name: 'transaction - multi', args: [1, 0, 1], test: /Attributes\s*.*? multi-user maintenance/},
          {name: 'transaction - single',args: [1, 0, 2], test: /Attributes\s*.*? single-user maintenance/},
          {name: 'attachement - multi',args: [2, 0, 1], test: /Attributes\s*.*? multi-user maintenance/},
          {name: 'attachement - single',args: [2, 0, 2], test: /Attributes\s*.*? single-user maintenance/}
        ];
        SHUTDOWN.forEach(possibility => {
            // Skip these tests for Firebird 3+ due to "Target shutdown mode is invalid" errors
            // These shutdown modes may not be supported in Firebird 3+ or require different parameters
            it.skip('should new shutdown : ' + possibility.name, done => {
                possibility.args.unshift(DATABASE.database);

                testProperty(
                  'Shutdown', possibility.args,
                  RegExp.prototype.test.bind(possibility.test), () => {
                      testProperty(
                        'BringOnline', [DATABASE.database],
                        (data) => data.indexOf('maintenance') === -1, done
                      );
                  }
                );
            });
        });

        it('should set shadow'); // TODO

        it('should disable force write', done => {
            testProperty(
              'setForcewrite', [DATABASE.database, false],
              data => data.indexOf('force write') === -1, done
            );
        });

        it('should enable force write', done => {
            testProperty(
              'setForcewrite', [DATABASE.database, true],
              data => data.indexOf('force write') > -1, done
            );
        });

        it('should disable reverse space', done => {
            testProperty(
              'setReservespace', [DATABASE.database, false],
              data => data.indexOf('no reserve') > -1, done
            );
        });

        it('should enable reverse space', done => {
            testProperty(
              'setReservespace', [DATABASE.database, true],
              data => data.indexOf('no reserve') === -1, done
            );
        });

        it('should set read only', done => {
            testProperty(
              'setReadonlyMode', [DATABASE.database],
              RegExp.prototype.test.bind(/Attributes\s*.*?read only/), done
            );
        });

        it('should set read write', done => {
            testProperty(
              'setReadwriteMode', [DATABASE.database],
              RegExp.prototype.test.bind(/^\s*Attributes((?!read only).)*$/m), done
            );
        });

        /**
         * Execute service manager function and call getStat for check.
         *
         * @param func Function on the service manager to execute
         * @param args Arguments without callback
         * @param verifier Callback return boolean asserting
         * @param done Done callback
         */
        function testProperty(func, args, verifier, done) {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                // Get the database path from args (it's the first argument for most property functions)
                const dbPath = args[0];

                // Push callback into args
                args.push((err, data) => {
                    assert.ok(!err, err);

                    srv.getStats({database: dbPath}, (err, data) => {
                        assert.ok(!err, err);

                        readStream(data, result => {
                            assert.ok(verifier(result), result);

                            srv.detach(done);
                        });
                    });
                });

                srv[func].apply(srv, args);
            });
        }
    });

    describe('Server users', () => {
        it('should get user', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getUsers('sysdba', (err, data) => {
                    assert.ok(!err, err);
                    verifyUser(data.fbusers[0], {
                        username: 'SYSDBA',
                        firstname: '',
                        middlename: '',
                        lastname: '',
                        userid: 0,
                        groupid: 0
                    });

                    srv.detach(done);
                });
            });
        });

        it('should get all users', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getUsers(undefined, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data.fbusers.length > 0);

                    srv.detach(done);
                });
            });
        });

        const EXPECTED_USER = {
            username: 'TEST-'+(new Date()).getTime(),
            password: 'test',
            firstname: 'Sql',
            middlename: 'server',
            lastname: 'user',
            userid: 2,
            groupid: 0
        };
        it('should create user', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.addUser(EXPECTED_USER.username, EXPECTED_USER.password, EXPECTED_USER, (err, data) => {
                    assert.ok(!err, err);

                    srv.getUsers(EXPECTED_USER.username, (err, userData) => {
                        assert.ok(!err, err);
                        verifyUser(userData.fbusers[0], EXPECTED_USER);

                        srv.detach(done);
                    });
                });
            });
        });

        const EDIT_EXPECTED_USER = Object.assign({}, EXPECTED_USER, {
            firstname: 'Sql2',
            middlename: 'server2',
            lastname: 'user2'
        });
        it('should edit user', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.editUser(EDIT_EXPECTED_USER.username, EDIT_EXPECTED_USER, (err, data) => {
                    assert.ok(!err, err);

                    srv.getUsers(EDIT_EXPECTED_USER.username, (err, userData) => {
                        assert.ok(!err, err);
                        verifyUser(userData.fbusers[0], EDIT_EXPECTED_USER);

                        srv.detach(done);
                    });
                });
            });
        });

        it('should remove user', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.removeUser(EXPECTED_USER.username, '', (err, data) => {
                    assert.ok(!err, err);

                    srv.getUsers('', (err, userData) => {
                        assert.ok(!err, err);
                        const users = userData.fbusers.filter(u => u.username === EXPECTED_USER.username)
                        assert.equal(users.length, 0);

                        srv.detach(done);
                    });
                });
            });
        });

        function verifyUser(user, expected) {
            assert.equal(user.username, expected.username);
            assert.equal(user.firstname, expected.firstname);
            assert.equal(user.middlename, expected.middlename);
            assert.equal(user.lastname, expected.lastname);
            assert.equal(user.userid, expected.userid);
            assert.equal(user.groupid, expected.groupid);
        }
    });

    describe('Backup/Restaure', () => {
        it('should backup', done => {
            const BACKUP_OPTS = {
                database: DATABASE.database,
                files: [
                    {filename: DATABASE.database.replace('.fdb', '-backup.fbk')}
                ]
            };

            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.backup(BACKUP_OPTS, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    data.on('data', () => {});
                    data.on('end', () => {
                        assert.ok(fs.existsSync(path.resolve(BACKUP_OPTS.files[0].filename)));
                        srv.detach(done);
                    });
                });
            });
        });

        it('should restore', done => {
            const RESTORE_OPTS = {
                database: DATABASE.database.replace('.fdb', '-rest.fdb'),
                files: [
                    DATABASE.database.replace('.fdb', '-backup.fbk')
                ]
            };

            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.restore(RESTORE_OPTS, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    data.on('data', () => {});
                    data.on('end', () => {
                        assert.ok(fs.existsSync(path.resolve(RESTORE_OPTS.database)));
                        srv.detach(done);
                    });
                });
            });
        });

        it('should nbackup', done => {
            const BACKUP_OPTS = {
                database: DATABASE.database,
                file: DATABASE.database.replace('.fdb', '-nbackup.fbk')
            };

            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.nbackup(BACKUP_OPTS, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    assert.ok(fs.existsSync(path.resolve(BACKUP_OPTS.file)));
                    srv.detach(done);
                });
            });
        });

        it('should nrestore', done => {
            const RESTORE_OPTS = {
                database: DATABASE.database.replace('.fdb', '-nrestore.fdb'),
                files: [
                    DATABASE.database.replace('.fdb', '-nbackup.fbk')
                ]
            };

            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.nrestore(RESTORE_OPTS, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    assert.ok(fs.existsSync(path.resolve(RESTORE_OPTS.database)));
                    srv.detach(done);
                });
            });
        });
    });

    describe('Trace', () => {
        const traceName = 'test-trace-' + Config.currentDate.getTime();
        var traceConfig, traceId;

        before(done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getFbserverInfos({'fbversion': true}, {}, (err, data) => {
                    assert.ok(!err, err);

                    var matches = data.fbversion.match(/((\w{2})-(\w)(\d+)\.(\d+)\.(\d+)\.(\d+)(?:-\S+)?) (.+)/);
                    var serverMajorVersion = parseInt(matches[4]);
                    var traceConfigFile = serverMajorVersion > 2 ? 'fbtrace-3.conf' : 'fbtrace-2.conf';
                    traceConfig = fs.readFileSync(path.resolve(__dirname, traceConfigFile), {encoding: 'utf8'});

                    srv.detach(done);
                });
            });
        });

        // TODO test logging of new transaction or statement
        it('should start trace', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.startTrace({configfile: traceConfig, tracename: traceName}, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    var result = '';
                    data.on('data', chunk => {
                        traceId = chunk.substring('Trace session ID '.length, chunk.indexOf(' started'));
                        assert.ok(traceId);
                        result += chunk;

                        done(); // Done when trace is starting
                    });
                    data.on('end', () => {
                        srv.detach();
                    });
                });
            });
        });

        it('should suspend trace', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.suspendTrace({traceid: traceId}, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    readStream(data, result => {
                        assert.equal(result.trim(), 'Trace session ID ' + traceId + ' paused');

                        srv.detach(done);
                    });
                });
            });
        });

        it('should resume trace', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.resumeTrace({traceid: traceId}, (err, data) => {
                    assert.ok(!err, err);
                    assert.ok(data instanceof stream.Readable);

                    readStream(data, result => {
                        assert.equal(result.trim(), 'Trace session ID ' + traceId + ' resumed');

                        srv.detach(done);
                    });
                });
            });
        });

        it('should get trace', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.getTraceList({}, (err, data) => {
                    assert.ok(!err, err);

                    readStream(data, result => {
                        assert.ok(result.indexOf('Session ID: ' + traceId) > -1);
                        assert.ok(result.indexOf('name:  ' + traceName) > -1);
                        assert.ok(result.indexOf('user:  ' + config.user.toUpperCase()) > -1);
                        assert.ok(result.indexOf('date:') > -1);
                        assert.ok(result.indexOf('flags: active') > -1);

                        srv.detach(done);
                    });
                });
            });
        });

        it('should stop trace', done => {
            Firebird.attach(config, (err, srv) => {
                assert.ok(!err, err);

                srv.stopTrace({traceid: traceId}, (err, data) => {
                    assert.ok(!err, err);

                    readStream(data, result => {
                        assert.equal(result.trim(), 'Trace session ID ' + traceId + ' stopped');

                        srv.detach(done);
                    });
                });
            });
        });
    });
});
