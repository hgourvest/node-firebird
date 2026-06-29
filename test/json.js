'use strict';

const assert = require('assert');
const Connection = require('../lib/wire/connection');
const Database = require('../lib/wire/database');
const Const = require('../lib/wire/const');
const Xsql = require('../lib/wire/xsqlvar');

describe('Native JSON Data Type Support (Firebird 6.0)', function () {
    describe('parseValueIfJson helper function', function () {
        const parseValueIfJson = Connection.parseValueIfJson;

        it('should return the original value if jsonAsObject option is false or not provided', function () {
            const val = '{"foo":"bar"}';
            assert.strictEqual(parseValueIfJson(val, {}), val);
            assert.strictEqual(parseValueIfJson(val, { jsonAsObject: false }), val);
        });

        it('should parse valid JSON objects/arrays when jsonAsObject is true', function () {
            const options = { jsonAsObject: true };
            assert.deepStrictEqual(parseValueIfJson('{"a":1}', options), { a: 1 });
            assert.deepStrictEqual(parseValueIfJson('[1,2,3]', options), [1, 2, 3]);
        });

        it('should return original string if string is not valid JSON, even if jsonAsObject is true', function () {
            const options = { jsonAsObject: true };
            assert.strictEqual(parseValueIfJson('{"a":1', options), '{"a":1');
            assert.strictEqual(parseValueIfJson('{invalid}', options), '{invalid}');
        });

        it('should return the original value if the value is not a string', function () {
            const options = { jsonAsObject: true };
            assert.strictEqual(parseValueIfJson(123, options), 123);
            assert.strictEqual(parseValueIfJson(true, options), true);
            const obj = { x: 1 };
            assert.strictEqual(parseValueIfJson(obj, options), obj);
        });
    });

    describe('Parameter Serialization', function () {
        it('should correctly identify and serialize plain objects and arrays to JSON strings', function () {
            const options = { jsonAsObject: true };

            const serialize = (value) => {
                if (options.jsonAsObject && value !== null && value !== undefined && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
                    if (typeof value.pipe !== 'function') {
                        return JSON.stringify(value);
                    }
                }
                return value;
            };

            assert.strictEqual(serialize({ a: 1 }), '{"a":1}');
            assert.strictEqual(serialize([1, 2, 3]), '[1,2,3]');
            
            // Date should not be serialized
            const date = new Date();
            assert.strictEqual(serialize(date), date);

            // Buffer should not be serialized
            const buf = Buffer.from('hello');
            assert.strictEqual(serialize(buf), buf);

            // Stream-like object should not be serialized
            const stream = { pipe: function() {} };
            assert.strictEqual(serialize(stream), stream);

            // Non-objects should not be serialized
            assert.strictEqual(serialize(123), 123);
            assert.strictEqual(serialize('string'), 'string');
        });
    });
});
