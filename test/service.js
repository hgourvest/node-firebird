const Firebird = require('../lib/index.js');
const Config = require('./config');

const assert = require('assert');
const stream = require('stream');
const path = require('path');
const fs = require('fs');

const config = Object.assign({}, Config.default, {manager: true});
const REMOVE_DB = false;

/**
 * Converts a callback-style function call into a Promise.
 * Usage: const result = await fromCallback(cb => someAsyncFn(arg1, arg2, cb));
 */
function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

function readStreamAsync(s) {
    return new Promise((resolve) => {
        var result = '';
        s.on('data', chunk => result += chunk.toString() + '\n');
        s.on('end', () => resolve(result));
    });
}

describe('Test Service', () => {
    const DATABASE = Config.default;

    // Create DB before tests
    beforeAll(async () => {
        const db = await fromCallback(cb => Firebird.attachOrCreate(DATABASE, cb));
        await fromCallback(cb => db.detach(cb));
    });

    // Remove DB and backup files after tests
    afterAll(async () => {
        if (!REMOVE_DB) {
            return;
        }

        const fileNames = await fromCallback(cb => fs.readdir(path.resolve(__dirname), cb));
        for (const name of fileNames) {
            if (name.toLowerCase().indexOf('.fdb') > -1 || name.toLowerCase().indexOf('.fbk') > -1) {
                fs.unlinkSync(path.resolve(__dirname, name));
            }
        }
    });

    it('should attach', async () => {
        const srv = await fromCallback(cb => Firebird.attach(config, cb));
        await fromCallback(cb => srv.detach(cb));
    });

    describe('Server info', () => {
        it('should get all server infos', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getFbserverInfos([], {}, cb));

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

            await fromCallback(cb => srv.detach(cb));
        });

        it('should get one server info', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getFbserverInfos({dbinfo: true}, {}, cb));

            assert.ok(data.dbinfo, 'Db Info not found')
            assert.ok(!data.fbversion, 'FB version found (must not)');

            await fromCallback(cb => srv.detach(cb));
        });
    });

    describe('Server stats and logs', () => {
        it('should get stats', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getStats({}, cb));
            const result = await readStreamAsync(data);

            assert.ok(result.indexOf('Gstat execution time') > -1, '"Gstat execution time" text not found')

            await fromCallback(cb => srv.detach(cb));
        });

        it('should get logs', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getLog({}, cb));
            const result = await readStreamAsync(data);

            assert.equal(typeof result, 'string');

            await fromCallback(cb => srv.detach(cb));
        });
    });

    describe('Server properties', { timeout: 15000 }, () => {
        // Add delay for skip error : Service is currently busy // TODO better srv.detach ?
        beforeEach(() => new Promise(resolve => setTimeout(resolve, 1000)));

        async function testProperty(func, args, verifier) {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const dbPath = args[0];
            await fromCallback(cb => { args.push(cb); srv[func].apply(srv, args); });
            const data = await fromCallback(cb => srv.getStats({database: dbPath}, cb));
            const result = await readStreamAsync(data);
            assert.ok(verifier(result), result);
            await fromCallback(cb => srv.detach(cb));
        }

        it('should set dialect', async () => {
            await testProperty(
              'setDialect', [DATABASE.database, 1],
              RegExp.prototype.test.bind(/Database dialect\s*1/)
            );
        });

        it('should set sweep interval', async () => {
            await testProperty(
              'setSweepinterval', [DATABASE.database, 20000],
              RegExp.prototype.test.bind(/Sweep interval:\s*20000/)
            );
        });

        it('should set cache buffer', async () => {
            await testProperty(
              'setCachebuffer', [DATABASE.database, 4000],
              RegExp.prototype.test.bind(/Page buffers\s*4000/)
            );
        });

        it('should old shutdown', async () => {
            await testProperty(
              'Shutdown', [DATABASE.database, 0, 0],
              RegExp.prototype.test.bind(/Attributes\s*.*? multi-user maintenance/)
            );
        });

        it('should bring online', async () => {
            await testProperty(
              'BringOnline', [DATABASE.database],
              (data) => data.indexOf('maintenance') === -1
            );
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
            it.skip('should new shutdown : ' + possibility.name, async () => {
                possibility.args.unshift(DATABASE.database);

                await testProperty(
                  'Shutdown', possibility.args,
                  RegExp.prototype.test.bind(possibility.test)
                );
                await testProperty(
                  'BringOnline', [DATABASE.database],
                  (data) => data.indexOf('maintenance') === -1
                );
            });
        });

        it.todo('should set shadow');

        it('should disable force write', async () => {
            await testProperty(
              'setForcewrite', [DATABASE.database, false],
              data => data.indexOf('force write') === -1
            );
        });

        it('should enable force write', async () => {
            await testProperty(
              'setForcewrite', [DATABASE.database, true],
              data => data.indexOf('force write') > -1
            );
        });

        it('should disable reverse space', async () => {
            await testProperty(
              'setReservespace', [DATABASE.database, false],
              data => data.indexOf('no reserve') > -1
            );
        });

        it('should enable reverse space', async () => {
            await testProperty(
              'setReservespace', [DATABASE.database, true],
              data => data.indexOf('no reserve') === -1
            );
        });

        it('should set read only', async () => {
            await testProperty(
              'setReadonlyMode', [DATABASE.database],
              RegExp.prototype.test.bind(/Attributes\s*.*?read only/)
            );
        });

        it('should set read write', async () => {
            await testProperty(
              'setReadwriteMode', [DATABASE.database],
              RegExp.prototype.test.bind(/^\s*Attributes((?!read only).)*$/m)
            );
        });
    });

    describe('Server users', () => {
        it('should get user', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getUsers('sysdba', cb));

            verifyUser(data.fbusers[0], {
                username: 'SYSDBA',
                firstname: '',
                middlename: '',
                lastname: '',
                userid: 0,
                groupid: 0
            });

            await fromCallback(cb => srv.detach(cb));
        });

        it('should get all users', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getUsers(undefined, cb));

            assert.ok(data.fbusers.length > 0);

            await fromCallback(cb => srv.detach(cb));
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
        it('should create user', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            await fromCallback(cb => srv.addUser(EXPECTED_USER.username, EXPECTED_USER.password, EXPECTED_USER, cb));
            const userData = await fromCallback(cb => srv.getUsers(EXPECTED_USER.username, cb));

            verifyUser(userData.fbusers[0], EXPECTED_USER);

            await fromCallback(cb => srv.detach(cb));
        });

        const EDIT_EXPECTED_USER = Object.assign({}, EXPECTED_USER, {
            firstname: 'Sql2',
            middlename: 'server2',
            lastname: 'user2'
        });
        it('should edit user', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            await fromCallback(cb => srv.editUser(EDIT_EXPECTED_USER.username, EDIT_EXPECTED_USER, cb));
            const userData = await fromCallback(cb => srv.getUsers(EDIT_EXPECTED_USER.username, cb));

            verifyUser(userData.fbusers[0], EDIT_EXPECTED_USER);

            await fromCallback(cb => srv.detach(cb));
        });

        it('should remove user', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            await fromCallback(cb => srv.removeUser(EXPECTED_USER.username, '', cb));
            const userData = await fromCallback(cb => srv.getUsers('', cb));

            const users = userData.fbusers.filter(u => u.username === EXPECTED_USER.username)
            assert.equal(users.length, 0);

            await fromCallback(cb => srv.detach(cb));
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
        it('should backup', async () => {
            const BACKUP_OPTS = {
                database: DATABASE.database,
                files: [
                    {filename: DATABASE.database.replace('.fdb', '-backup.fbk')}
                ]
            };

            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.backup(BACKUP_OPTS, cb));
            assert.ok(data instanceof stream.Readable);

            await new Promise((resolve) => {
                data.on('data', () => {});
                data.on('end', () => resolve());
            });

            assert.ok(fs.existsSync(path.resolve(BACKUP_OPTS.files[0].filename)));
            await fromCallback(cb => srv.detach(cb));
        });

        it('should restore', async () => {
            const RESTORE_OPTS = {
                database: DATABASE.database.replace('.fdb', '-rest.fdb'),
                files: [
                    DATABASE.database.replace('.fdb', '-backup.fbk')
                ]
            };

            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.restore(RESTORE_OPTS, cb));
            assert.ok(data instanceof stream.Readable);

            await new Promise((resolve) => {
                data.on('data', () => {});
                data.on('end', () => resolve());
            });

            assert.ok(fs.existsSync(path.resolve(RESTORE_OPTS.database)));
            await fromCallback(cb => srv.detach(cb));
        });

        it('should nbackup', async () => {
            const BACKUP_OPTS = {
                database: DATABASE.database,
                file: DATABASE.database.replace('.fdb', '-nbackup.fbk')
            };

            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.nbackup(BACKUP_OPTS, cb));
            assert.ok(data instanceof stream.Readable);

            assert.ok(fs.existsSync(path.resolve(BACKUP_OPTS.file)));
            await fromCallback(cb => srv.detach(cb));
        });

        it('should nrestore', async () => {
            const RESTORE_OPTS = {
                database: DATABASE.database.replace('.fdb', '-nrestore.fdb'),
                files: [
                    DATABASE.database.replace('.fdb', '-nbackup.fbk')
                ]
            };

            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.nrestore(RESTORE_OPTS, cb));
            assert.ok(data instanceof stream.Readable);

            assert.ok(fs.existsSync(path.resolve(RESTORE_OPTS.database)));
            await fromCallback(cb => srv.detach(cb));
        });
    });

    describe('Trace', () => {
        const traceName = 'test-trace-' + Config.currentDate.getTime();
        var traceConfig, traceId;

        beforeAll(async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getFbserverInfos({'fbversion': true}, {}, cb));

            var matches = data.fbversion.match(/((\w{2})-(\w)(\d+)\.(\d+)\.(\d+)\.(\d+)(?:-\S+)?) (.+)/);
            var serverMajorVersion = parseInt(matches[4]);
            var traceConfigFile = serverMajorVersion > 2 ? 'fbtrace-3.conf' : 'fbtrace-2.conf';
            traceConfig = fs.readFileSync(path.resolve(__dirname, traceConfigFile), {encoding: 'utf8'});

            await fromCallback(cb => srv.detach(cb));
        });

        // TODO test logging of new transaction or statement
        it('should start trace', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.startTrace({configfile: traceConfig, tracename: traceName}, cb));
            assert.ok(data instanceof stream.Readable);

            await new Promise((resolve) => {
                var result = '';
                data.on('data', chunk => {
                    traceId = chunk.substring('Trace session ID '.length, chunk.indexOf(' started'));
                    assert.ok(traceId);
                    result += chunk;
                    resolve(); // Done when trace is starting
                });
                data.on('end', () => {
                    srv.detach();
                });
            });
        });

        it('should suspend trace', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.suspendTrace({traceid: traceId}, cb));
            assert.ok(data instanceof stream.Readable);

            const result = await readStreamAsync(data);
            assert.equal(result.trim(), 'Trace session ID ' + traceId + ' paused');

            await fromCallback(cb => srv.detach(cb));
        });

        it('should resume trace', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.resumeTrace({traceid: traceId}, cb));
            assert.ok(data instanceof stream.Readable);

            const result = await readStreamAsync(data);
            assert.equal(result.trim(), 'Trace session ID ' + traceId + ' resumed');

            await fromCallback(cb => srv.detach(cb));
        });

        it('should get trace', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.getTraceList({}, cb));

            const result = await readStreamAsync(data);
            assert.ok(result.indexOf('Session ID: ' + traceId) > -1);
            assert.ok(result.indexOf('name:  ' + traceName) > -1);
            assert.ok(result.indexOf('user:  ' + config.user.toUpperCase()) > -1);
            assert.ok(result.indexOf('date:') > -1);
            assert.ok(result.indexOf('flags: active') > -1);

            await fromCallback(cb => srv.detach(cb));
        });

        it('should stop trace', async () => {
            const srv = await fromCallback(cb => Firebird.attach(config, cb));
            const data = await fromCallback(cb => srv.stopTrace({traceid: traceId}, cb));

            const result = await readStreamAsync(data);
            assert.equal(result.trim(), 'Trace session ID ' + traceId + ' stopped');

            await fromCallback(cb => srv.detach(cb));
        });
    });
});
