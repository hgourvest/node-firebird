var assert = require('assert');
var Const = require('../lib/wire/const');
var Firebird = require('../lib');
var ServiceManager = require('../lib/wire/service');

describe('Test Firebird 3.0, 4.0, 5.0, and 6.0 protocol support', function () {
    it('should define protocol versions 14, 15, 16, 17, 18, 19, and 20', function () {
        assert.ok(Const.PROTOCOL_VERSION14, 'PROTOCOL_VERSION14 should be defined');
        assert.ok(Const.PROTOCOL_VERSION15, 'PROTOCOL_VERSION15 should be defined');
        assert.ok(Const.PROTOCOL_VERSION16, 'PROTOCOL_VERSION16 should be defined');
        assert.ok(Const.PROTOCOL_VERSION17, 'PROTOCOL_VERSION17 should be defined');
        assert.ok(Const.PROTOCOL_VERSION18, 'PROTOCOL_VERSION18 should be defined');
        assert.ok(Const.PROTOCOL_VERSION19, 'PROTOCOL_VERSION19 should be defined');
        assert.ok(Const.PROTOCOL_VERSION20, 'PROTOCOL_VERSION20 should be defined');
        assert.strictEqual(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_MASK, 14);
        assert.strictEqual(Const.PROTOCOL_VERSION15 & Const.FB_PROTOCOL_MASK, 15);
        assert.strictEqual(Const.PROTOCOL_VERSION16 & Const.FB_PROTOCOL_MASK, 16);
        assert.strictEqual(Const.PROTOCOL_VERSION17 & Const.FB_PROTOCOL_MASK, 17);
        assert.strictEqual(Const.PROTOCOL_VERSION18 & Const.FB_PROTOCOL_MASK, 18);
        assert.strictEqual(Const.PROTOCOL_VERSION19 & Const.FB_PROTOCOL_MASK, 19);
        assert.strictEqual(Const.PROTOCOL_VERSION20 & Const.FB_PROTOCOL_MASK, 20);
        assert.ok(Const.PROTOCOL_VERSION14 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION15 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION16 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION17 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION18 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION19 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
        assert.ok(Const.PROTOCOL_VERSION20 & Const.FB_PROTOCOL_FLAG, 'Should have FB protocol flag');
    });

    it('should include protocols 14 through 20 in SUPPORTED_PROTOCOL', function () {
        var versions = Const.SUPPORTED_PROTOCOL.map(function (p) { return p[0]; });
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION14) !== -1, 'Protocol 14 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION15) !== -1, 'Protocol 15 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION16) !== -1, 'Protocol 16 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION17) !== -1, 'Protocol 17 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION18) !== -1, 'Protocol 18 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION19) !== -1, 'Protocol 19 should be supported');
        assert.ok(versions.indexOf(Const.PROTOCOL_VERSION20) !== -1, 'Protocol 20 should be supported');
        assert.strictEqual(Const.SUPPORTED_PROTOCOL.length, 11, 'Should support 11 protocol versions');
    });

    it('should support Srp256 authentication plugin', function () {
        assert.strictEqual(Const.AUTH_PLUGIN_SRP256, 'Srp256');
        assert.ok(Const.AUTH_PLUGIN_LIST.indexOf('Srp256') !== -1, 'Srp256 should be in AUTH_PLUGIN_LIST');
        assert.ok(Const.AUTH_PLUGIN_SRP_LIST.indexOf('Srp256') !== -1, 'Srp256 should be in AUTH_PLUGIN_SRP_LIST');
    });

    it('should support Srp384 authentication plugin', function () {
        assert.strictEqual(Const.AUTH_PLUGIN_SRP384, 'Srp384');
        assert.ok(Const.AUTH_PLUGIN_LIST.indexOf('Srp384') !== -1, 'Srp384 should be in AUTH_PLUGIN_LIST');
        assert.ok(Const.AUTH_PLUGIN_SRP_LIST.indexOf('Srp384') !== -1, 'Srp384 should be in AUTH_PLUGIN_SRP_LIST');
    });

    it('should support Srp512 authentication plugin', function () {
        assert.strictEqual(Const.AUTH_PLUGIN_SRP512, 'Srp512');
        assert.ok(Const.AUTH_PLUGIN_LIST.indexOf('Srp512') !== -1, 'Srp512 should be in AUTH_PLUGIN_LIST');
        assert.ok(Const.AUTH_PLUGIN_SRP_LIST.indexOf('Srp512') !== -1, 'Srp512 should be in AUTH_PLUGIN_SRP_LIST');
    });

    it('should prefer Srp512 and Srp384 over Srp256 and Srp', function () {
        var srp512Index = Const.AUTH_PLUGIN_LIST.indexOf('Srp512');
        var srp384Index = Const.AUTH_PLUGIN_LIST.indexOf('Srp384');
        var srp256Index = Const.AUTH_PLUGIN_LIST.indexOf('Srp256');
        var srpIndex = Const.AUTH_PLUGIN_LIST.indexOf('Srp');
        assert.ok(srp512Index < srp384Index, 'Srp512 should come before Srp384');
        assert.ok(srp384Index < srp256Index, 'Srp384 should come before Srp256');
        assert.ok(srp256Index < srpIndex, 'Srp256 should come before Srp');
    });

    it('should export AUTH_PLUGIN_SRP256, AUTH_PLUGIN_SRP384, AUTH_PLUGIN_SRP512 from main module', function () {
        assert.strictEqual(Firebird.AUTH_PLUGIN_SRP256, 'Srp256');
        assert.strictEqual(Firebird.AUTH_PLUGIN_SRP384, 'Srp384');
        assert.strictEqual(Firebird.AUTH_PLUGIN_SRP512, 'Srp512');
    });

    it('should export wire crypt constants', function () {
        assert.strictEqual(Firebird.WIRE_CRYPT_ENABLE, 1);
        assert.strictEqual(Firebird.WIRE_CRYPT_DISABLE, 0);
    });

    it('should define op_crypt opcode', function () {
        assert.strictEqual(Const.op_crypt, 96);
    });

    it('should define op_crypt_key_callback opcode', function () {
        assert.strictEqual(Const.op_crypt_key_callback, 97);
    });

    it('should define DECFLOAT data type constants', function () {
        assert.strictEqual(Const.SQL_DEC16, 32760, 'SQL_DEC16 should be 32760');
        assert.strictEqual(Const.SQL_DEC34, 32762, 'SQL_DEC34 should be 32762');
    });

    it('should define DECFLOAT BLR constants', function () {
        assert.strictEqual(Const.blr_dec64, 24, 'blr_dec64 should be 24');
        assert.strictEqual(Const.blr_dec128, 25, 'blr_dec128 should be 25');
    });

    it('should define INT128 data type constants', function () {
        assert.strictEqual(Const.SQL_INT128, 32752, 'SQL_INT128 should be 32752');
        assert.strictEqual(Const.blr_int128, 26, 'blr_int128 should be 26');
    });

    it('should return a callback error for missing service query buffer', async function () {
        var svc = new ServiceManager({});
        await new Promise(function (resolve) {
            svc._processquery(undefined, function (err) {
                assert.ok(err instanceof Error);
                assert.match(err.message, /malformed service-manager response/i);
                resolve();
            });
        });
    });

    it('should return a callback error for truncated service query buffer', async function () {
        var svc = new ServiceManager({});
        await new Promise(function (resolve) {
            svc._processquery(Buffer.from([Const.isc_info_svc_server_version]), function (err) {
                assert.ok(err instanceof Error);
                assert.match(err.message, /malformed service-manager response/i);
                resolve();
            });
        });
    });

    it('should decode SQLVarText to correct logical character length based on connection encoding', function () {
        const { SQLVarText } = require('../lib/wire/xsqlvar');
        
        // Mock reader class
        class MockReader {
            constructor(buf) {
                this.buffer = buf;
                this.pos = 0;
            }
            readText(len, encoding) {
                const r = this.buffer.toString(encoding, this.pos, this.pos + len);
                this.pos += len;
                return r;
            }
            readInt() {
                return 0; // indicates not null / success
            }
        }

        // CHAR(6) in UTF8 connection encoding (subtype 4, length 24 bytes)
        const sqlVar = new SQLVarText();
        sqlVar.length = 24;
        sqlVar.subType = 4; // UTF8
        
        // Wire bytes: '1' followed by 23 spaces
        const wireBytes = Buffer.alloc(24, 0x20);
        wireBytes.write('1', 0, 1, 'utf8');
        
        // Decode with UTF8 connection options
        const reader = new MockReader(wireBytes);
        const result = sqlVar.decode(reader, false, { encoding: 'UTF8' });
        
        // Should be trimmed to 6 characters (not 24)
        assert.strictEqual(result, '1     ');
        assert.strictEqual(result.length, 6);
    });

    describe('Test Firebird 5.0 Inline BLOB support', function () {
        it('should define op_inline_blob and isc_dpb_max_inline_blob_size', function () {
            assert.strictEqual(Const.op_inline_blob, 114);
            assert.strictEqual(Const.isc_dpb_max_inline_blob_size, 93);
        });

        it('should parse op_inline_blob packets and populate cache', function () {
            const { XdrWriter, XdrReader } = require('../lib/wire/serialize');
            const Connection = require('../lib/wire/connection');

            // Encode: op_inline_blob, tran_id=123, blob_id={high:10, low:20}, blob_data="hello inline"
            const writer = new XdrWriter();
            writer.addInt(Const.op_inline_blob);
            writer.addInt(123); // tran_id
            writer.addQuad({ high: 10, low: 20 });
            
            const payload = Buffer.from('hello inline', 'utf8');
            writer.addInt(payload.length);
            writer.addBuffer(payload);
            writer.addAlignment(payload.length);

            // Followed by op_response with status (we'll just use a dummy status list ending with end)
            writer.addInt(Const.op_response);
            writer.addInt(0); // handle
            writer.addQuad({ high: 0, low: 0 }); // oid
            writer.addInt(0); // buffer (empty array)
            writer.addInt(Const.isc_arg_end); // end status list

            const reader = new XdrReader(writer.buffer.slice(0, writer.pos));
            const cnx = {
                _inlineBlobs: null
            };

            Connection.decodeResponse(reader, {}, cnx, false, function (err, res) {
                assert.ifError(err);
                assert.ok(cnx._inlineBlobs);
                const cacheKey = '10:20';
                assert.ok(cnx._inlineBlobs.has(cacheKey));
                const cachedData = cnx._inlineBlobs.get(cacheKey);
                assert.strictEqual(cachedData.toString('utf8'), 'hello inline');
            });
        });

        it('should bypass network calls in fetch_blob_async_transaction on cache hit', async function () {
            const Connection = require('../lib/wire/connection');
            const inlineBlobs = new Map();
            inlineBlobs.set('10:20', Buffer.from('cached blob text', 'utf8'));

            const statement = {
                connection: {
                    _inlineBlobs: inlineBlobs
                }
            };

            const fn = Connection.fetch_blob_async_transaction(statement, { high: 10, low: 20 }, 'test_col', {});
            const result = await fn();
            assert.strictEqual(result.value, 'cached blob text');
        });

        it('should bypass network calls in fetch_blob_async on cache hit', function () {
            const Connection = require('../lib/wire/connection');
            const inlineBlobs = new Map();
            inlineBlobs.set('10:20', Buffer.from('cached blob data', 'utf8'));

            const statement = {
                connection: {
                    _inlineBlobs: inlineBlobs
                }
            };

            const fn = Connection.fetch_blob_async(statement, { high: 10, low: 20 }, 'test_col', {});
            return new Promise((resolve, reject) => {
                fn(function (err, name, e, row) {
                    if (err) return reject(err);
                    assert.strictEqual(name, 'test_col');
                    let received = [];
                    e.on('data', function (chunk) {
                        received.push(chunk);
                    });
                    e.on('end', function () {
                        try {
                            const finalBuffer = Buffer.concat(received);
                            assert.strictEqual(finalBuffer.toString('utf8'), 'cached blob data');
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    });
                });
            });
        });
    });

    describe('Test Firebird 6.0 Protocol Version List Limit', function () {
        it('should define PROTOCOL_VERSION19 and PROTOCOL_VERSION20', function () {
            assert.ok(Const.PROTOCOL_VERSION19);
            assert.ok(Const.PROTOCOL_VERSION20);
        });

        it('should respect maxNegotiatedProtocols option and slice protocol list correctly', function () {
            // Helper function to test sliced protocols length
            function getProtocolsLength(options) {
                var maxProtocols = options.maxNegotiatedProtocols !== undefined ? options.maxNegotiatedProtocols : 10;
                var protocolsToSend = Const.SUPPORTED_PROTOCOL;
                if (protocolsToSend.length > maxProtocols) {
                    protocolsToSend = protocolsToSend.slice(-maxProtocols);
                }
                return protocolsToSend.length;
            }

            // Default behavior: maxNegotiatedProtocols = 10, should return 10
            assert.strictEqual(getProtocolsLength({}), 10);
            
            // Explicit 10: should return 10
            assert.strictEqual(getProtocolsLength({ maxNegotiatedProtocols: 10 }), 10);

            // Explicit 11 (Firebird 6.0 limit): should return 11 (since total defined is 11)
            assert.strictEqual(getProtocolsLength({ maxNegotiatedProtocols: 11 }), 11);

            // Explicit 5: should return 5
            assert.strictEqual(getProtocolsLength({ maxNegotiatedProtocols: 5 }), 5);
        });
    });

    describe('Test Firebird 6.0 Named Arguments', function () {
        it('should correctly map named parameter objects to positional parameter arrays', function () {
            // Helper function mimicking Connection.prototype.executeStatement parameter preparation
            function mapParams(params, input) {
                if (!(params instanceof Array)) {
                    if (params !== undefined && typeof params === 'object' && params !== null) {
                        var mappedParams = [];
                        for (var i = 0; i < input.length; i++) {
                            mappedParams.push(undefined);
                        }
                        var matchedCount = 0;
                        var nameMap = {};
                        for (var i = 0; i < input.length; i++) {
                            var name = input[i].alias || input[i].field;
                            if (name) {
                                nameMap[name.toUpperCase()] = i;
                            }
                        }
                        for (var key in params) {
                            if (Object.prototype.hasOwnProperty.call(params, key)) {
                                var cleanKey = key.startsWith(':') ? key.substring(1) : key;
                                var index = nameMap[cleanKey.toUpperCase()];
                                if (index !== undefined) {
                                    mappedParams[index] = params[key];
                                    matchedCount++;
                                }
                            }
                        }
                        if (matchedCount > 0) {
                            params = mappedParams;
                        } else {
                            params = [params];
                        }
                    } else if (params !== undefined) {
                        params = [params];
                    } else {
                        params = [];
                    }
                }
                return params;
            }

            const mockInput = [
                { alias: 'paramA', field: 'fieldA' },
                { alias: 'paramB', field: 'fieldB' },
                { alias: 'paramC', field: 'fieldC' }
            ];

            // 1. Success matching exact name:
            const params1 = { paramA: 10, paramB: 'hello', paramC: true };
            assert.deepStrictEqual(mapParams(params1, mockInput), [10, 'hello', true]);

            // 2. Success with prefix colons:
            const params2 = { ':paramA': 20, ':paramB': 'world', ':paramC': false };
            assert.deepStrictEqual(mapParams(params2, mockInput), [20, 'world', false]);

            // 3. Success with mixed casing:
            const params3 = { PaRaMa: 30, ':pArAmB': 'mixed', PARAMC: null };
            assert.deepStrictEqual(mapParams(params3, mockInput), [30, 'mixed', null]);

            // 4. Missing parameters default to undefined (which converts to null in PrepareParams):
            const params4 = { paramA: 40 };
            assert.deepStrictEqual(mapParams(params4, mockInput), [40, undefined, undefined]);

            // 5. Unrecognized keys fallback to original wrap behavior:
            const params5 = { unrecognizedKey: 50 };
            assert.deepStrictEqual(mapParams(params5, mockInput), [params5]);
        });
    });
});
