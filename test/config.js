const path = require('path');

const crypto = require('crypto');
const currentDate = new Date();
const testDir = path.resolve(__dirname);
const uniqueId = crypto.randomBytes(4).toString('hex');
const dbName = 'test-' + currentDate.getTime() + '-' + uniqueId + '.fdb';

exports.default = {
    database: path.join(process.env.FIREBIRD_DATA || testDir, dbName),
    host: '127.0.0.1',
    // FIREBIRD_PORT lets the suite target a non-default server, e.g. a
    // dockerized Firebird 4/5 running next to a local installation
    port: Number(process.env.FIREBIRD_PORT) || 3050,
    user: 'SYSDBA',
    password: 'masterkey',
    role: null,
    pageSize: 4096,
    timeout: 3000,
    lowercase_keys: true,
    retryConnectionInterval: 100,
    wireCompression: false,
};

exports.currentDate = currentDate;
exports.testDir = testDir;

exports.extends = function(base, args) {
    return Object.assign({}, base, args);
}

