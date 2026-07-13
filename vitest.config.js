const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        globals: true,
        testTimeout: 10000,
        hookTimeout: 30000,
        fileParallelism: false,
        maxWorkers: 1,
        isolate: false,
        include: [
            'test/unit/*.test.ts',
            'test/arc4.js',
            'test/protocol.js',
            'test/srp.js',
            'test/service.js',
            'test/utf8-user-identification.js',
            'test/index.js',
            'test/promises.js',
            'test/cancel.js',
            'test/db-crypt-config.js',
            'test/encoding.js',
            'test/timezone.js',
            'test/decfloat.js',
            'test/mock-server.js',
            'test/pool-fixes.js',
            'test/blob-chunks.js',
            'test/sql-schemas.js',
            'test/tablespaces.js',
            'test/json.js',
            'test/row-type.js',
            'test/collations.js'
        ],
    },
});
