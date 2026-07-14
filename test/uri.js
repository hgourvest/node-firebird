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

        it('should reject non-firebird schemes', function () {
            assert.throws(() => parseConnectionUri('postgres://localhost/db'), /Unsupported connection URI scheme/);
        });

        it('should reject malformed URIs', function () {
            assert.throws(() => parseConnectionUri('firebird//nope'), /Invalid connection URI/);
        });

        it('should reject non-numeric values for numeric options', function () {
            assert.throws(() => parseConnectionUri('firebird://h/db?pageSize=big'), /Invalid numeric value/);
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
