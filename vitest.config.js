const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        globals: true,
        testTimeout: 10000,
        fileParallelism: false,
        include: ['test/arc4.js', 'test/index.js', 'test/protocol.js', 'test/service.js', 'test/srp.js'],
    },
});
