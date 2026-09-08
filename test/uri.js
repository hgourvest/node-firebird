const Firebird = require('../lib');
const Config = require('./config');

const assert = require('assert');

const { parseConnectionUri } = Firebird;

describe('Connection URI strings (firebird://...)', function () {

    describe('parseConnectionUri', function () {

        it('should parse a full URI', function () {
            const o = parseConnectionUri('firebird://alice:secret@db.example.com:3051//var/fb/prod.fdb');
            assert.deepStrictEqual(o, {
                host: 'db.example.com',
                port: 3051,
                user: 'alice',
                password: 'secret',
                database: '/var/fb/prod.fdb',
            });
        });

        it('should treat a single-segment database as an alias', function () {
            const o = parseConnectionUri('firebird://localhost/employee');
            assert.strictEqual(o.database, 'employee');
        });

        it('should restore the leading slash for single-slash absolute paths', function () {
            const o = parseConnectionUri('firebird://localhost/var/fb/prod.fdb');
            assert.strictEqual(o.database, '/var/fb/prod.fdb');
        });

        it('should keep Windows drive paths as-is', function () {
            const o = parseConnectionUri('firebird://localhost/C:/fbdata/prod.fdb');
            assert.strictEqual(o.database, 'C:/fbdata/prod.fdb');
        });

        it('should decode percent-encoded credentials and paths', function () {
            const o = parseConnectionUri('firebird://user%40corp:p%40ss%3Aword@localhost/my%20db');
            assert.strictEqual(o.user, 'user@corp');
            assert.strictEqual(o.password, 'p@ss:word');
            assert.strictEqual(o.database, 'my db');
        });

        it('should unbracket IPv6 hosts', function () {
            const o = parseConnectionUri('firebird://[::1]:3050/employee');
            assert.strictEqual(o.host, '::1');
            assert.strictEqual(o.port, 3050);
        });

        it('should map query parameters onto options with type coercion', function () {
            const o = parseConnectionUri(
                'firebird://localhost/employee?encoding=UTF8&lowercase_keys=true' +
                '&pageSize=8192&wireCompression=1&role=READONLY&connectTimeout=5000');
            assert.strictEqual(o.encoding, 'UTF8');
            assert.strictEqual(o.lowercase_keys, true);
            assert.strictEqual(o.pageSize, 8192);
            assert.strictEqual(o.wireCompression, true);
            assert.strictEqual(o.role, 'READONLY');
            assert.strictEqual(o.connectTimeout, 5000);
        });

        it('should accept user/password as query parameters', function () {
            const o = parseConnectionUri('firebird://localhost/employee?user=bob&password=pw');
            assert.strictEqual(o.user, 'bob');
            assert.strictEqual(o.password, 'pw');
        });

        it('should omit unset parts instead of defaulting them', function () {
            const o = parseConnectionUri('firebird://localhost/employee');
            assert.strictEqual(o.port, undefined);
            assert.strictEqual(o.user, undefined);
            assert.strictEqual(o.password, undefined);
        });

        it('should accept Firebird-native inet:// URIs', function () {
            const o = parseConnectionUri('inet://db.example.com:3051//var/fb/prod.fdb');
            assert.deepStrictEqual(o, {
                host: 'db.example.com',
                port: 3051,
                database: '/var/fb/prod.fdb',
            });
            assert.strictEqual(parseConnectionUri('inet://localhost/employee').database, 'employee');
            assert.strictEqual(parseConnectionUri('inet://localhost/C:/fbdata/prod.fdb').database, 'C:/fbdata/prod.fdb');
        });

        it('should pin the IP family for inet4:// and inet6://', function () {
            const v4 = parseConnectionUri('inet4://localhost/employee');
            assert.strictEqual(v4.ipFamily, 4);
            assert.strictEqual(v4.host, 'localhost');
            const v6 = parseConnectionUri('inet6://[::1]:3050/employee');
            assert.strictEqual(v6.ipFamily, 6);
            assert.strictEqual(v6.host, '::1');
            assert.strictEqual(v6.port, 3050);
            assert.strictEqual(parseConnectionUri('inet://localhost/employee').ipFamily, undefined);
            assert.strictEqual(parseConnectionUri('firebird://localhost/employee').ipFamily, undefined);
        });

        it('should accept credentials and query options on inet:// URIs', function () {
            const o = parseConnectionUri('INET://alice:secret@h/employee?ipFamily=6&lowercase_keys=1');
            assert.strictEqual(o.user, 'alice');
            assert.strictEqual(o.password, 'secret');
            assert.strictEqual(o.ipFamily, 6);
            assert.strictEqual(o.lowercase_keys, true);
        });

        it('should reject non-firebird schemes', function () {
            assert.throws(() => parseConnectionUri('postgres://localhost/db'), /Unsupported connection URI scheme/);
        });

        it('should reject local-only Firebird transports (xnet, wnet)', function () {
            assert.throws(() => parseConnectionUri('xnet://employee'), /local IPC transports/);
            assert.throws(() => parseConnectionUri('wnet://server/employee'), /local IPC transports/);
        });

        it('should reject malformed URIs', function () {
            assert.throws(() => parseConnectionUri('firebird//nope'), /Invalid connection URI/);
        });

        it('should reject non-numeric values for numeric options', function () {
            assert.throws(() => parseConnectionUri('firebird://h/db?pageSize=big'), /Invalid numeric value/);
        });
    });

    describe('parseConnectionString (traditional host[/port]:database strings)', function () {
        const { parseConnectionString } = Firebird;

        it('should parse host:alias', function () {
            assert.deepStrictEqual(parseConnectionString('db.example.com:employee'),
                { host: 'db.example.com', database: 'employee' });
        });

        it('should parse host/port:path', function () {
            assert.deepStrictEqual(parseConnectionString('db.example.com/3051:/var/fb/prod.fdb'),
                { host: 'db.example.com', port: 3051, database: '/var/fb/prod.fdb' });
        });

        it('should treat a bare alias as the database', function () {
            assert.deepStrictEqual(parseConnectionString('employee'), { database: 'employee' });
        });

        it('should treat a bare absolute path as the database', function () {
            assert.deepStrictEqual(parseConnectionString('/var/fb/prod.fdb'),
                { database: '/var/fb/prod.fdb' });
        });

        it('should treat a single character before ":" as a drive letter, not a host', function () {
            assert.deepStrictEqual(parseConnectionString('C:\\fbdata\\prod.fdb'),
                { database: 'C:\\fbdata\\prod.fdb' });
            assert.deepStrictEqual(parseConnectionString('C:/fbdata/prod.fdb'),
                { database: 'C:/fbdata/prod.fdb' });
        });

        it('should parse a Windows path behind a host', function () {
            assert.deepStrictEqual(parseConnectionString('myserver:C:\\fbdata\\prod.fdb'),
                { host: 'myserver', database: 'C:\\fbdata\\prod.fdb' });
        });

        it('should parse bracketed IPv6 hosts', function () {
            assert.deepStrictEqual(parseConnectionString('[::1]/3050:employee'),
                { host: '::1', port: 3050, database: 'employee' });
            assert.deepStrictEqual(parseConnectionString('[::1]:employee'),
                { host: '::1', database: 'employee' });
        });

        it('should still route firebird:// strings to the URI parser', function () {
            const o = parseConnectionString('firebird://alice:secret@h:3051/employee');
            assert.strictEqual(o.user, 'alice');
            assert.strictEqual(o.port, 3051);
            assert.strictEqual(o.database, 'employee');
        });

        it('should route inet:// strings to the URI parser', function () {
            const o = parseConnectionString('inet6://[::1]:3051/employee');
            assert.strictEqual(o.host, '::1');
            assert.strictEqual(o.port, 3051);
            assert.strictEqual(o.ipFamily, 6);
            assert.strictEqual(o.database, 'employee');
        });

        it('should still reject other URI schemes', function () {
            assert.throws(() => parseConnectionString('postgres://localhost/db'),
                /Unsupported connection URI scheme/);
        });

        it('should reject service names as ports', function () {
            assert.throws(() => parseConnectionString('host/gds_db:employee'),
                /Invalid port in connection string/);
        });

        it('should reject an empty host or database part', function () {
            assert.throws(() => parseConnectionString(':employee'), /empty host/);
            assert.throws(() => parseConnectionString('myserver:'), /empty database/);
        });
    });

    describe('live connection with a URI', function () {
        const cfg = Config.default;
        const dbPath = cfg.database.replace(/\.fdb$/, '-uri.fdb');
        const uri = 'firebird://' +
            encodeURIComponent(cfg.user) + ':' + encodeURIComponent(cfg.password) +
            '@' + cfg.host + ':' + cfg.port + '/' + dbPath + '?lowercase_keys=true';

        it('should attachOrCreate, query and drop via URI', async function () {
            const db = await Firebird.attachOrCreateAsync(uri);
            try {
                const rows = await db.queryAsync('SELECT 1 AS answer FROM rdb$database');
                assert.strictEqual(rows[0].answer, 1); // lowercase_keys came from the URI
            } finally {
                await db.detachAsync();
            }
            await Firebird.dropAsync(uri);
        });

        it('should attachOrCreate, query and drop via a Firebird-native inet4:// URI', async function () {
            const inetPath = cfg.database.replace(/\.fdb$/, '-inet.fdb');
            // inet4:// pins the socket to IPv4 — the test config host is
            // an IPv4 literal or a name that resolves to one
            const inetUri = 'inet4://' +
                encodeURIComponent(cfg.user) + ':' + encodeURIComponent(cfg.password) +
                '@' + cfg.host + ':' + cfg.port + '/' + inetPath;
            const db = await Firebird.attachOrCreateAsync(inetUri);
            try {
                const rows = await db.queryAsync('SELECT 1 AS ANSWER FROM rdb$database');
                assert.strictEqual(rows[0].ANSWER, 1);
            } finally {
                await db.detachAsync();
            }
            await Firebird.dropAsync(inetUri);
        });

        it('should attach with a traditional host/port:database string', async function () {
            // No credentials in the old-style form — the SYSDBA/masterkey
            // defaults apply, which is what the test server uses.
            const oldStyle = cfg.host + '/' + cfg.port + ':' + dbPath;

            const seed = await Firebird.attachOrCreateAsync(uri);
            await seed.detachAsync();

            const db = await Firebird.attachAsync(oldStyle);
            try {
                const rows = await db.queryAsync('SELECT 1 AS ANSWER FROM rdb$database');
                assert.strictEqual(Number(rows[0].ANSWER), 1);
            } finally {
                await db.detachAsync();
                await Firebird.dropAsync(uri).catch(() => {});
            }
        });

        it('should work with the pool factory', async function () {
            // the pool attaches (never creates) — make sure the db exists
            const seed = await Firebird.attachOrCreateAsync(uri);
            await seed.detachAsync();

            const pool = Firebird.pool(2, uri);
            try {
                const rows = await pool.withConnection((db) =>
                    db.queryAsync('SELECT 1 AS one FROM rdb$database'));
                assert.strictEqual(rows[0].one, 1);
            } finally {
                await pool.destroyAsync();
                await Firebird.dropAsync(uri).catch(() => {});
            }
        });
    });
});
