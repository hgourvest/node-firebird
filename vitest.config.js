const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        globals: true,
        testTimeout: 10000,
        hookTimeout: 30000,
        fileParallelism: false,
        maxWorkers: 1,
        isolate: false,
        include: ['test/arc4.js', 'test/protocol.js', 'test/srp.js', 'test/service.js', 'test/index.js'],
    },
});
