const Firebird = require('../lib');
const Config = require('./config');
const assert = require('assert');

function fromCallback(executor) {
    return new Promise((resolve, reject) => {
        executor((err, result) => err ? reject(err) : resolve(result));
    });
}

describe('Blob Chunk Options', function () {
    const config = Config.default;
    let db;

    beforeAll(async function () {
        db = await fromCallback(cb => Firebird.attachOrCreate(config, cb));
        // Create table
        try {
            await fromCallback(cb => db.query('DROP TABLE test_blob_chunks', cb));
        } catch (e) {
            // Ignore if table does not exist
        }
        await fromCallback(cb => db.query('CREATE TABLE test_blob_chunks (id INTEGER, val BLOB SUB_TYPE 0)', cb));
    });

    afterAll(async function () {
        if (db) {
            try {
                await fromCallback(cb => db.query('DROP TABLE test_blob_chunks', cb));
            } catch (e) {}
            await fromCallback(cb => db.detach(cb));
        }
    });

    it('should write and read blob using default/custom chunks', async function () {
        // Create a large buffer (80 KB) with sequential pattern
        const size = 80 * 1024;
        const testBuffer = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
            testBuffer[i] = i % 256;
        }

        // Insert using initial connection
        await fromCallback(cb => db.query(
            'INSERT INTO test_blob_chunks (id, val) VALUES (?, ?)',
            [1, testBuffer],
            cb
        ));

        // Read using custom small chunk size (blobReadChunkSize = 100)
        const configSmall = Object.assign({}, config, { blobReadChunkSize: 100 });
        const dbSmall = await fromCallback(cb => Firebird.attach(configSmall, cb));
        try {
            const rows = await fromCallback(cb => dbSmall.query('SELECT val FROM test_blob_chunks WHERE id = 1', cb));
            assert.equal(rows.length, 1);
            const blobReader = rows[0].val;
            assert.equal(typeof blobReader, 'function');

            const readBuf = await new Promise((resolve, reject) => {
                blobReader(function (err, name, emitter) {
                    if (err) return reject(err);
                    const chunks = [];
                    emitter.on('data', chunk => chunks.push(chunk));
                    emitter.on('end', () => resolve(Buffer.concat(chunks)));
                });
            });

            assert.equal(readBuf.length, size);
            assert.deepEqual(readBuf, testBuffer);
        } finally {
            await fromCallback(cb => dbSmall.detach(cb));
        }

        // Read using custom large chunk size (blobReadChunkSize = 65535)
        const configLarge = Object.assign({}, config, { blobReadChunkSize: 65535 });
        const dbLarge = await fromCallback(cb => Firebird.attach(configLarge, cb));
        try {
            const rows = await fromCallback(cb => dbLarge.query('SELECT val FROM test_blob_chunks WHERE id = 1', cb));
            assert.equal(rows.length, 1);
            const blobReader = rows[0].val;

            const readBuf = await new Promise((resolve, reject) => {
                blobReader(function (err, name, emitter) {
                    if (err) return reject(err);
                    const chunks = [];
                    emitter.on('data', chunk => chunks.push(chunk));
                    emitter.on('end', () => resolve(Buffer.concat(chunks)));
                });
            });

            assert.equal(readBuf.length, size);
            assert.deepEqual(readBuf, testBuffer);
            
            // Check that the connection options actually stored the option
            assert.equal(dbLarge.connection.options.blobReadChunkSize, 65535);
        } finally {
            await fromCallback(cb => dbLarge.detach(cb));
        }

        // Read using capped chunk size (blobReadChunkSize = 999999)
        const configCapped = Object.assign({}, config, { blobReadChunkSize: 999999 });
        const dbCapped = await fromCallback(cb => Firebird.attach(configCapped, cb));
        try {
            const rows = await fromCallback(cb => dbCapped.query('SELECT val FROM test_blob_chunks WHERE id = 1', cb));
            assert.equal(rows.length, 1);
            const blobReader = rows[0].val;

            const readBuf = await new Promise((resolve, reject) => {
                blobReader(function (err, name, emitter) {
                    if (err) return reject(err);
                    const chunks = [];
                    emitter.on('data', chunk => chunks.push(chunk));
                    emitter.on('end', () => resolve(Buffer.concat(chunks)));
                });
            });

            assert.equal(readBuf.length, size);
            assert.deepEqual(readBuf, testBuffer);
            
            // Verify it was capped to 65535
            assert.equal(dbCapped.connection.options.blobReadChunkSize, 65535);
        } finally {
            await fromCallback(cb => dbCapped.detach(cb));
        }
    });
});
