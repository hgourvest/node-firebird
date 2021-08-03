const path = require('path');

const currentDate = new Date();
const testDir = path.resolve(__dirname);
const dbName = 'test-' + currentDate.getTime() + '.fdb';

exports.default = {
    database: path.join(process.env.FIREBIRD_DATA || testDir, dbName),
    host: '127.0.0.1',
    port: 3050,
    user: 'sysdba',
    password: 'masterkey',
    role: null,
    pageSize: 4096,
    timeout: 3000,
    lowercase_keys: true,
    retryConnectionInterval: 100
};

exports.currentDate = currentDate;
exports.testDir = testDir;

exports.extends = function(base, args) {
    return Object.assign({}, base, args);
}

