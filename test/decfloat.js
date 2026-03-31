/**
 * DECFLOAT (IEEE 754 Decimal64/Decimal128) Tests
 * 
 * Comprehensive tests for IEEE 754-2008 Decimal floating point support
 */

var assert = require('assert');
const { encodeDecimal64, decodeDecimal64, encodeDecimal128, decodeDecimal128 } = require('../lib/ieee754-decimal');

describe('IEEE 754 DECFLOAT Support', function () {
    describe('Decimal64 (DECFLOAT(16))', function () {
        describe('Basic encoding/decoding', function () {
            it('should encode and decode zero', function () {
                const encoded = encodeDecimal64('0');
                const decoded = decodeDecimal64(encoded);
                assert.strictEqual(decoded, '0');
            });

            it('should encode and decode positive integers', function () {
                const testCases = ['1', '12', '123', '1234', '12345', '999999999999999'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode negative integers', function () {
                const testCases = ['-1', '-12', '-123', '-1234', '-12345', '-999999999999999'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode decimal fractions', function () {
                const testCases = ['0.1', '0.01', '0.001', '1.5', '12.34', '123.456'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode negative decimals', function () {
                const testCases = ['-0.1', '-0.01', '-1.5', '-12.34', '-123.456'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode scientific notation', function () {
                const testCases = [
                    { input: '1.23e5', expected: '123000' },
                    { input: '1.23e-5', expected: '0.0000123' },
                    { input: '9.9e10', expected: '99000000000' }
                ];
                testCases.forEach(({ input, expected }) => {
                    const encoded = encodeDecimal64(input);
                    const decoded = decodeDecimal64(encoded);
                    assert.strictEqual(decoded, expected);
                });
            });
        });

        describe('Special values', function () {
            it('should handle positive infinity', function () {
                const encoded = encodeDecimal64(Infinity);
                const decoded = decodeDecimal64(encoded);
                assert.strictEqual(decoded, Infinity);
            });

            it('should handle negative infinity', function () {
                const encoded = encodeDecimal64(-Infinity);
                const decoded = decodeDecimal64(encoded);
                assert.strictEqual(decoded, -Infinity);
            });

            it('should handle NaN', function () {
                const encoded = encodeDecimal64(NaN);
                const decoded = decodeDecimal64(encoded);
                assert.ok(isNaN(decoded));
            });
        });

        describe('Precision edge cases', function () {
            it('should handle maximum 16-digit coefficient', function () {
                const value = '9999999999999999';
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                assert.strictEqual(decoded, value);
            });

            it('should handle very small numbers', function () {
                const testCases = ['0.0000000000000001', '0.00000000000001'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    // Should preserve the value or normalize it
                    assert.ok(Math.abs(parseFloat(decoded) - parseFloat(value)) < 1e-15);
                });
            });

            it('should normalize trailing zeros', function () {
                const encoded = encodeDecimal64('1.2300');
                const decoded = decodeDecimal64(encoded);
                // Trailing zeros may be removed during normalization
                assert.strictEqual(parseFloat(decoded), 1.23);
            });
        });

        describe('Round-trip consistency', function () {
            it('should maintain precision through encode/decode cycles', function () {
                const testCases = [
                    '123.456',
                    '0.00123',
                    '999999999999999',
                    '-123.456',
                    '1.23e5'
                ];
                
                testCases.forEach(value => {
                    const encoded1 = encodeDecimal64(value);
                    const decoded1 = decodeDecimal64(encoded1);
                    const encoded2 = encodeDecimal64(decoded1);
                    const decoded2 = decodeDecimal64(encoded2);
                    
                    assert.strictEqual(decoded1, decoded2);
                    assert.ok(encoded1.equals(encoded2));
                });
            });
        });

        describe('Buffer handling', function () {
            it('should return 8-byte buffer', function () {
                const encoded = encodeDecimal64('123.456');
                assert.ok(Buffer.isBuffer(encoded));
                assert.strictEqual(encoded.length, 8);
            });

            it('should handle pre-encoded buffer', function () {
                const original = '123.456';
                const encoded1 = encodeDecimal64(original);
                const encoded2 = encodeDecimal64(encoded1);
                
                assert.ok(encoded1.equals(encoded2));
            });
        });

        describe('Number input', function () {
            it('should handle numeric input', function () {
                const value = 123.456;
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                assert.ok(Math.abs(parseFloat(decoded) - value) < 1e-10);
            });

            it('should handle negative numeric input', function () {
                const value = -123.456;
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                assert.ok(Math.abs(parseFloat(decoded) - value) < 1e-10);
            });
        });
    });

    describe('Decimal128 (DECFLOAT(34))', function () {
        describe('Basic encoding/decoding', function () {
            it('should encode and decode zero', function () {
                const encoded = encodeDecimal128('0');
                const decoded = decodeDecimal128(encoded);
                assert.strictEqual(decoded, '0');
            });

            it('should encode and decode positive integers', function () {
                const testCases = ['1', '12', '123', '1234567890123456789012345678901234'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode negative integers', function () {
                const testCases = ['-1', '-12', '-123', '-1234567890123456789012345678901234'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode decimal fractions', function () {
                const testCases = ['0.1', '0.01', '0.001', '1.5', '12.34', '123.456789012345'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    assert.strictEqual(decoded, value);
                });
            });

            it('should encode and decode high-precision decimals', function () {
                const value = '123456789.0123456789012345678901234';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                // Allow for normalization
                assert.ok(Math.abs(parseFloat(decoded) - parseFloat(value)) < 1e-20);
            });
        });

        describe('Special values', function () {
            it('should handle positive infinity', function () {
                const encoded = encodeDecimal128(Infinity);
                const decoded = decodeDecimal128(encoded);
                assert.strictEqual(decoded, Infinity);
            });

            it('should handle negative infinity', function () {
                const encoded = encodeDecimal128(-Infinity);
                const decoded = decodeDecimal128(encoded);
                assert.strictEqual(decoded, -Infinity);
            });

            it('should handle NaN', function () {
                const encoded = encodeDecimal128(NaN);
                const decoded = decodeDecimal128(encoded);
                assert.ok(isNaN(decoded));
            });
        });

        describe('Precision edge cases', function () {
            it('should handle maximum 34-digit coefficient', function () {
                const value = '9999999999999999999999999999999999';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                assert.strictEqual(decoded, value);
            });

            it('should handle very large numbers', function () {
                const value = '123456789012345678901234567890';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                assert.strictEqual(decoded, value);
            });

            it('should handle very small numbers', function () {
                const value = '0.0000000000000000000000000000000001';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                assert.ok(Math.abs(parseFloat(decoded) - parseFloat(value)) < 1e-30);
            });
        });

        describe('Round-trip consistency', function () {
            it('should maintain precision through encode/decode cycles', function () {
                const testCases = [
                    '123.456',
                    '0.00123',
                    '999999999999999999999999999999',
                    '-123.456789012345',
                    '1.23e25'
                ];
                
                testCases.forEach(value => {
                    const encoded1 = encodeDecimal128(value);
                    const decoded1 = decodeDecimal128(encoded1);
                    const encoded2 = encodeDecimal128(decoded1);
                    const decoded2 = decodeDecimal128(encoded2);
                    
                    assert.strictEqual(decoded1, decoded2);
                    assert.ok(encoded1.equals(encoded2));
                });
            });
        });

        describe('Buffer handling', function () {
            it('should return 16-byte buffer', function () {
                const encoded = encodeDecimal128('123.456');
                assert.ok(Buffer.isBuffer(encoded));
                assert.strictEqual(encoded.length, 16);
            });

            it('should handle pre-encoded buffer', function () {
                const original = '123.456';
                const encoded1 = encodeDecimal128(original);
                const encoded2 = encodeDecimal128(encoded1);
                
                assert.ok(encoded1.equals(encoded2));
            });
        });

        describe('Number input', function () {
            it('should handle numeric input', function () {
                const value = 123.456;
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                assert.ok(Math.abs(parseFloat(decoded) - value) < 1e-10);
            });
        });
    });

    describe('Comparison between Decimal64 and Decimal128', function () {
        it('should handle same value in both formats', function () {
            const value = '123.456';
            const dec64 = decodeDecimal64(encodeDecimal64(value));
            const dec128 = decodeDecimal128(encodeDecimal128(value));
            assert.strictEqual(dec64, dec128);
        });

        it('should handle values beyond Decimal64 precision in Decimal128', function () {
            // This value has more than 16 significant digits
            const value = '12345678901234567890.123456789';
            const enc128 = encodeDecimal128(value);
            const dec128 = decodeDecimal128(enc128);
            // Should preserve more precision in Decimal128
            assert.ok(dec128.length > 16);
        });
    });

    describe('Integration with XdrWriter/XdrReader', function () {
        it('should work with serialize module', function () {
            const { XdrWriter, XdrReader } = require('../lib/wire/serialize');
            
            // Test Decimal64
            const writer64 = new XdrWriter(32);
            writer64.addDecFloat16('123.456');
            const buffer64 = writer64.getData();
            
            const reader64 = new XdrReader(buffer64);
            const value64 = reader64.readDecFloat16();
            assert.strictEqual(value64, '123.456');
            
            // Test Decimal128
            const writer128 = new XdrWriter(32);
            writer128.addDecFloat34('123.456789012345');
            const buffer128 = writer128.getData();
            
            const reader128 = new XdrReader(buffer128);
            const value128 = reader128.readDecFloat34();
            assert.strictEqual(value128, '123.456789012345');
        });
    });

    describe('Error handling', function () {
        it('should throw error for coefficient too large for Decimal64', function () {
            const tooLarge = '99999999999999999'; // 17 digits
            assert.throws(() => encodeDecimal64(tooLarge));
        });

        it('should throw error for coefficient too large for Decimal128', function () {
            const tooLarge = '99999999999999999999999999999999999'; // 35 digits
            assert.throws(() => encodeDecimal128(tooLarge));
        });

        it('should throw error for invalid buffer size in decode', function () {
            const invalidBuffer = Buffer.alloc(4);
            assert.throws(() => decodeDecimal64(invalidBuffer));
            assert.throws(() => decodeDecimal128(invalidBuffer));
        });
    });
});


describe('IEEE 754 DECFLOAT Support', () => {
    describe('Decimal64 (DECFLOAT(16))', () => {
        describe('Basic encoding/decoding', () => {
            it('should encode and decode zero', () => {
                const encoded = encodeDecimal64('0');
                const decoded = decodeDecimal64(encoded);
                expect(decoded).toBe('0');
            });

            it('should encode and decode positive integers', () => {
                const testCases = ['1', '12', '123', '1234', '12345', '999999999999999'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode negative integers', () => {
                const testCases = ['-1', '-12', '-123', '-1234', '-12345', '-999999999999999'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode decimal fractions', () => {
                const testCases = ['0.1', '0.01', '0.001', '1.5', '12.34', '123.456'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode negative decimals', () => {
                const testCases = ['-0.1', '-0.01', '-1.5', '-12.34', '-123.456'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode scientific notation', () => {
                const testCases = [
                    { input: '1.23e5', expected: '123000' },
                    { input: '1.23e-5', expected: '0.0000123' },
                    { input: '9.9e10', expected: '99000000000' }
                ];
                testCases.forEach(({ input, expected }) => {
                    const encoded = encodeDecimal64(input);
                    const decoded = decodeDecimal64(encoded);
                    expect(decoded).toBe(expected);
                });
            });
        });

        describe('Special values', () => {
            it('should handle positive infinity', () => {
                const encoded = encodeDecimal64(Infinity);
                const decoded = decodeDecimal64(encoded);
                expect(decoded).toBe(Infinity);
            });

            it('should handle negative infinity', () => {
                const encoded = encodeDecimal64(-Infinity);
                const decoded = decodeDecimal64(encoded);
                expect(decoded).toBe(-Infinity);
            });

            it('should handle NaN', () => {
                const encoded = encodeDecimal64(NaN);
                const decoded = decodeDecimal64(encoded);
                expect(isNaN(decoded)).toBe(true);
            });
        });

        describe('Precision edge cases', () => {
            it('should handle maximum 16-digit coefficient', () => {
                const value = '9999999999999999';
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                expect(decoded).toBe(value);
            });

            it('should handle very small numbers', () => {
                const testCases = ['0.0000000000000001', '0.00000000000001'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal64(value);
                    const decoded = decodeDecimal64(encoded);
                    // Should preserve the value or normalize it
                    expect(parseFloat(decoded)).toBeCloseTo(parseFloat(value), 15);
                });
            });

            it('should normalize trailing zeros', () => {
                const encoded = encodeDecimal64('1.2300');
                const decoded = decodeDecimal64(encoded);
                // Trailing zeros may be removed during normalization
                expect(parseFloat(decoded)).toBe(1.23);
            });
        });

        describe('Round-trip consistency', () => {
            it('should maintain precision through encode/decode cycles', () => {
                const testCases = [
                    '123.456',
                    '0.00123',
                    '999999999999999',
                    '-123.456',
                    '1.23e5'
                ];
                
                testCases.forEach(value => {
                    const encoded1 = encodeDecimal64(value);
                    const decoded1 = decodeDecimal64(encoded1);
                    const encoded2 = encodeDecimal64(decoded1);
                    const decoded2 = decodeDecimal64(encoded2);
                    
                    expect(decoded1).toBe(decoded2);
                    expect(encoded1.equals(encoded2)).toBe(true);
                });
            });
        });

        describe('Buffer handling', () => {
            it('should return 8-byte buffer', () => {
                const encoded = encodeDecimal64('123.456');
                expect(Buffer.isBuffer(encoded)).toBe(true);
                expect(encoded.length).toBe(8);
            });

            it('should handle pre-encoded buffer', () => {
                const original = '123.456';
                const encoded1 = encodeDecimal64(original);
                const encoded2 = encodeDecimal64(encoded1);
                
                expect(encoded1.equals(encoded2)).toBe(true);
            });
        });

        describe('Number input', () => {
            it('should handle numeric input', () => {
                const value = 123.456;
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                expect(parseFloat(decoded)).toBeCloseTo(value, 10);
            });

            it('should handle negative numeric input', () => {
                const value = -123.456;
                const encoded = encodeDecimal64(value);
                const decoded = decodeDecimal64(encoded);
                expect(parseFloat(decoded)).toBeCloseTo(value, 10);
            });
        });
    });

    describe('Decimal128 (DECFLOAT(34))', () => {
        describe('Basic encoding/decoding', () => {
            it('should encode and decode zero', () => {
                const encoded = encodeDecimal128('0');
                const decoded = decodeDecimal128(encoded);
                expect(decoded).toBe('0');
            });

            it('should encode and decode positive integers', () => {
                const testCases = ['1', '12', '123', '1234567890123456789012345678901234'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode negative integers', () => {
                const testCases = ['-1', '-12', '-123', '-1234567890123456789012345678901234'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode decimal fractions', () => {
                const testCases = ['0.1', '0.01', '0.001', '1.5', '12.34', '123.456789012345'];
                testCases.forEach(value => {
                    const encoded = encodeDecimal128(value);
                    const decoded = decodeDecimal128(encoded);
                    expect(decoded).toBe(value);
                });
            });

            it('should encode and decode high-precision decimals', () => {
                const value = '123456789.0123456789012345678901234';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                // Allow for normalization
                expect(parseFloat(decoded)).toBeCloseTo(parseFloat(value), 20);
            });
        });

        describe('Special values', () => {
            it('should handle positive infinity', () => {
                const encoded = encodeDecimal128(Infinity);
                const decoded = decodeDecimal128(encoded);
                expect(decoded).toBe(Infinity);
            });

            it('should handle negative infinity', () => {
                const encoded = encodeDecimal128(-Infinity);
                const decoded = decodeDecimal128(encoded);
                expect(decoded).toBe(-Infinity);
            });

            it('should handle NaN', () => {
                const encoded = encodeDecimal128(NaN);
                const decoded = decodeDecimal128(encoded);
                expect(isNaN(decoded)).toBe(true);
            });
        });

        describe('Precision edge cases', () => {
            it('should handle maximum 34-digit coefficient', () => {
                const value = '9999999999999999999999999999999999';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                expect(decoded).toBe(value);
            });

            it('should handle very large numbers', () => {
                const value = '123456789012345678901234567890';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                expect(decoded).toBe(value);
            });

            it('should handle very small numbers', () => {
                const value = '0.0000000000000000000000000000000001';
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                expect(parseFloat(decoded)).toBeCloseTo(parseFloat(value), 30);
            });
        });

        describe('Round-trip consistency', () => {
            it('should maintain precision through encode/decode cycles', () => {
                const testCases = [
                    '123.456',
                    '0.00123',
                    '999999999999999999999999999999',
                    '-123.456789012345',
                    '1.23e25'
                ];
                
                testCases.forEach(value => {
                    const encoded1 = encodeDecimal128(value);
                    const decoded1 = decodeDecimal128(encoded1);
                    const encoded2 = encodeDecimal128(decoded1);
                    const decoded2 = decodeDecimal128(encoded2);
                    
                    expect(decoded1).toBe(decoded2);
                    expect(encoded1.equals(encoded2)).toBe(true);
                });
            });
        });

        describe('Buffer handling', () => {
            it('should return 16-byte buffer', () => {
                const encoded = encodeDecimal128('123.456');
                expect(Buffer.isBuffer(encoded)).toBe(true);
                expect(encoded.length).toBe(16);
            });

            it('should handle pre-encoded buffer', () => {
                const original = '123.456';
                const encoded1 = encodeDecimal128(original);
                const encoded2 = encodeDecimal128(encoded1);
                
                expect(encoded1.equals(encoded2)).toBe(true);
            });
        });

        describe('Number input', () => {
            it('should handle numeric input', () => {
                const value = 123.456;
                const encoded = encodeDecimal128(value);
                const decoded = decodeDecimal128(encoded);
                expect(parseFloat(decoded)).toBeCloseTo(value, 10);
            });
        });
    });

    describe('Comparison between Decimal64 and Decimal128', () => {
        it('should handle same value in both formats', () => {
            const value = '123.456';
            const dec64 = decodeDecimal64(encodeDecimal64(value));
            const dec128 = decodeDecimal128(encodeDecimal128(value));
            expect(dec64).toBe(dec128);
        });

        it('should handle values beyond Decimal64 precision in Decimal128', () => {
            // This value has more than 16 significant digits
            const value = '12345678901234567890.123456789';
            const enc128 = encodeDecimal128(value);
            const dec128 = decodeDecimal128(enc128);
            // Should preserve more precision in Decimal128
            expect(dec128.length).toBeGreaterThan(16);
        });
    });

    describe('Integration with XdrWriter/XdrReader', () => {
        it('should work with serialize module', () => {
            const { XdrWriter, XdrReader } = require('../lib/wire/serialize');
            
            // Test Decimal64
            const writer64 = new XdrWriter(32);
            writer64.addDecFloat16('123.456');
            const buffer64 = writer64.getData();
            
            const reader64 = new XdrReader(buffer64);
            const value64 = reader64.readDecFloat16();
            expect(value64).toBe('123.456');
            
            // Test Decimal128
            const writer128 = new XdrWriter(32);
            writer128.addDecFloat34('123.456789012345');
            const buffer128 = writer128.getData();
            
            const reader128 = new XdrReader(buffer128);
            const value128 = reader128.readDecFloat34();
            expect(value128).toBe('123.456789012345');
        });
    });

    describe('Error handling', () => {
        it('should throw error for coefficient too large for Decimal64', () => {
            const tooLarge = '99999999999999999'; // 17 digits
            expect(() => encodeDecimal64(tooLarge)).toThrow();
        });

        it('should throw error for coefficient too large for Decimal128', () => {
            const tooLarge = '99999999999999999999999999999999999'; // 35 digits
            expect(() => encodeDecimal128(tooLarge)).toThrow();
        });

        it('should throw error for invalid buffer size in decode', () => {
            const invalidBuffer = Buffer.alloc(4);
            expect(() => decodeDecimal64(invalidBuffer)).toThrow();
            expect(() => decodeDecimal128(invalidBuffer)).toThrow();
        });
    });
});
