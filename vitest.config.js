const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        globals: true,
        testTimeout: 10000,
        hookTimeout: 30000,
        fileParallelism: false,
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        include: ['test/arc4.js', 'test/srp.js', 'test/protocol.js'],
    },
});
