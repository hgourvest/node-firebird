/**
 * IEEE 754-2008 Decimal Floating Point Support
 * 
 * This module implements encoding and decoding of IEEE 754 Decimal64 and Decimal128
 * formats using the BID (Binary Integer Decimal) encoding.
 * 
 * Based on the decimal-java library from FirebirdSQL:
 * https://github.com/FirebirdSQL/decimal-java
 * 
 * References:
 * - IEEE 754-2008 Standard
 * - https://en.wikipedia.org/wiki/Decimal64_floating-point_format
 * - https://en.wikipedia.org/wiki/Decimal128_floating-point_format
 */

// IEEE 754 Decimal64 constants (16 decimal digits of precision)
const DECIMAL64_BIAS = 398;
const DECIMAL64_MAX_EXPONENT = 369;
const DECIMAL64_MIN_EXPONENT = -398;
const DECIMAL64_MAX_COEFFICIENT = 9999999999999999n; // 16 digits

// IEEE 754 Decimal128 constants (34 decimal digits of precision)
const DECIMAL128_BIAS = 6176;
const DECIMAL128_MAX_EXPONENT = 6111;
const DECIMAL128_MIN_EXPONENT = -6176;
const DECIMAL128_MAX_COEFFICIENT = 9999999999999999999999999999999999n; // 34 digits

// Special value patterns
const DECIMAL64_INFINITY = 0x7800000000000000n;
const DECIMAL64_NEG_INFINITY = 0xF800000000000000n;
const DECIMAL64_NAN = 0x7C00000000000000n;
const DECIMAL64_SNAN = 0x7E00000000000000n;

const DECIMAL128_INFINITY_HIGH = 0x7800000000000000n;
const DECIMAL128_NEG_INFINITY_HIGH = 0xF800000000000000n;
const DECIMAL128_NAN_HIGH = 0x7C00000000000000n;
const DECIMAL128_SNAN_HIGH = 0x7E00000000000000n;

/**
 * Encode a number to IEEE 754 Decimal64 format (8 bytes)
 * @param {number|string|BigInt} value - The value to encode
 * @returns {Buffer} - 8-byte buffer containing the Decimal64 encoding
 */
function encodeDecimal64(value) {
    // Handle special cases
    if (value === null || value === undefined) {
        return Buffer.alloc(8);
    }
    
    if (typeof value === 'number') {
        if (isNaN(value)) {
            return bigIntToBuffer(DECIMAL64_NAN, 8);
        }
        if (!isFinite(value)) {
            return bigIntToBuffer(value > 0 ? DECIMAL64_INFINITY : DECIMAL64_NEG_INFINITY, 8);
        }
        value = value.toString();
    }
    
    if (Buffer.isBuffer(value)) {
        return value.slice(0, 8);
    }
    
    // Parse the decimal string
    const str = value.toString();
    const sign = str.startsWith('-') ? 1n : 0n;
    const absStr = str.replace(/^-/, '');
    
    // Handle zero
    if (parseFloat(absStr) === 0) {
        return bigIntToBuffer(sign << 63n, 8);
    }
    
    // Parse coefficient and exponent
    let coefficient, exponent;
    const eIndex = absStr.toLowerCase().indexOf('e');
    
    if (eIndex !== -1) {
        const mantissa = absStr.substring(0, eIndex).replace('.', '');
        coefficient = mantissa === '' || mantissa === '-' ? 0n : BigInt(mantissa);
        const expPart = absStr.substring(eIndex + 1);
        const dotIndex = absStr.indexOf('.');
        if (dotIndex !== -1 && dotIndex < eIndex) {
            exponent = parseInt(expPart) - (eIndex - dotIndex - 1);
        } else {
            exponent = parseInt(expPart);
        }
    } else {
        const dotIndex = absStr.indexOf('.');
        if (dotIndex !== -1) {
            const withoutDot = absStr.replace('.', '');
            coefficient = withoutDot === '' || withoutDot === '-' ? 0n : BigInt(withoutDot);
            exponent = -(absStr.length - dotIndex - 1);
        } else {
            coefficient = absStr === '' || absStr === '-' ? 0n : BigInt(absStr);
            exponent = 0;
        }
    }
    
    // Normalize: remove trailing zeros
    while (coefficient % 10n === 0n && coefficient !== 0n && exponent < DECIMAL64_MAX_EXPONENT) {
        coefficient /= 10n;
        exponent++;
    }
    
    // Check coefficient range
    if (coefficient > DECIMAL64_MAX_COEFFICIENT) {
        throw new Error(`Coefficient ${coefficient} exceeds Decimal64 maximum`);
    }
    
    // Adjust exponent with bias
    const biasedExponent = exponent + DECIMAL64_BIAS;
    if (biasedExponent < 0 || biasedExponent > 767) {
        throw new Error(`Exponent ${exponent} out of Decimal64 range`);
    }
    
    // Encode using BID (Binary Integer Decimal) format
    // Bit layout: S(1) | Combination(5) | Exponent continuation(8) | Coefficient continuation(50)
    
    let encoded = 0n;
    
    // Sign bit (bit 63)
    encoded |= sign << 63n;
    
    // Combination field encodes:
    // - Top 4 bits of coefficient (most significant digit)
    // - Top 2 bits of exponent
    const expBigInt = BigInt(biasedExponent);
    
    // Simple BID encoding (combination field based on leading digit)
    const msd = Number(coefficient / 1000000000000000n); // Most significant digit
    
    if (msd <= 7) {
        // Combination: 00abc (a,b,c = exp bits 8,9,10)
        const combo = (expBigInt >> 8n) & 0x3n;
        encoded |= combo << 61n;
        encoded |= (expBigInt & 0xFFn) << 53n;
        encoded |= coefficient & 0x1FFFFFFFFFFFFFn;
    } else {
        // Combination: 11abc (for leading digit 8 or 9)
        encoded |= 0x3n << 61n;
        encoded |= ((expBigInt >> 8n) & 0x3n) << 59n;
        encoded |= (expBigInt & 0xFFn) << 51n;
        encoded |= (coefficient - 8000000000000000n) & 0x7FFFFFFFFFFFFn;
    }
    
    return bigIntToBuffer(encoded, 8);
}

/**
 * Decode IEEE 754 Decimal64 format (8 bytes) to a string
 * @param {Buffer} buffer - 8-byte buffer containing the Decimal64 encoding
 * @returns {string|number} - Decoded value as string or special value
 */
function decodeDecimal64(buffer) {
    if (buffer.length !== 8) {
        throw new Error('Decimal64 buffer must be 8 bytes');
    }
    
    const encoded = bufferToBigInt(buffer);
    
    // Extract sign
    const sign = (encoded >> 63n) & 0x1n;
    
    // Extract combination field (bits 62-58, 5 bits)
    const combo = (encoded >> 58n) & 0x1Fn;
    
    if ((combo & 0x1En) === 0x1En) {
        // Special value (NaN or Infinity)
        if ((combo & 0x1n) === 0n) {
            return sign ? -Infinity : Infinity;
        } else {
            return NaN;
        }
    }
    
    // Decode exponent and coefficient
    let exponent, coefficient;
    
    if ((combo & 0x18n) !== 0x18n) {
        // Combination: 00abc or 01abc (MSD 0-7)
        // Top 2 bits of exponent from bits 2-3 of combo (bit 60-61)
        // Lower 8 bits of exponent from bits 57-50
        exponent = ((combo & 0x6n) << 8n) | ((encoded >> 50n) & 0xFFn);
        // Coefficient continuation is bits 49-0 (50 bits)
        coefficient = encoded & 0x3FFFFFFFFFFFFn;
    } else {
        // Combination: 11abc (MSD 8-9)
        // Top 2 bits of exponent from bits 0-1 of combo
        exponent = ((combo & 0x6n) << 8n) | ((encoded >> 50n) & 0xFFn);
        // Coefficient starts at 8 * 10^15, plus the 49-bit continuation
        coefficient = 8000000000000000n + (encoded & 0x1FFFFFFFFFFFFn);
    }
    
    // Remove bias from exponent
    const unbias = Number(exponent) - DECIMAL64_BIAS;
    
    // Build result string
    const coeffStr = coefficient.toString();
    const signStr = sign ? '-' : '';
    
    if (unbias === 0) {
        return signStr + coeffStr;
    } else if (unbias > 0) {
        return signStr + coeffStr + '0'.repeat(unbias);
    } else {
        const absExp = -unbias;
        if (absExp >= coeffStr.length) {
            return signStr + '0.' + '0'.repeat(absExp - coeffStr.length) + coeffStr;
        } else {
            const intPart = coeffStr.substring(0, coeffStr.length - absExp);
            const fracPart = coeffStr.substring(coeffStr.length - absExp);
            return signStr + intPart + '.' + fracPart;
        }
    }
}

/**
 * Encode a number to IEEE 754 Decimal128 format (16 bytes)
 * @param {number|string|BigInt} value - The value to encode
 * @returns {Buffer} - 16-byte buffer containing the Decimal128 encoding
 */
function encodeDecimal128(value) {
    // Handle special cases
    if (value === null || value === undefined) {
        return Buffer.alloc(16);
    }
    
    if (typeof value === 'number') {
        if (isNaN(value)) {
            const buf = Buffer.alloc(16);
            bufferWriteBigInt(buf, DECIMAL128_NAN_HIGH, 0, 8);
            return buf;
        }
        if (!isFinite(value)) {
            const buf = Buffer.alloc(16);
            bufferWriteBigInt(buf, value > 0 ? DECIMAL128_INFINITY_HIGH : DECIMAL128_NEG_INFINITY_HIGH, 0, 8);
            return buf;
        }
        value = value.toString();
    }
    
    if (Buffer.isBuffer(value)) {
        return value.slice(0, 16);
    }
    
    // Parse the decimal string
    const str = value.toString();
    const sign = str.startsWith('-') ? 1n : 0n;
    const absStr = str.replace(/^-/, '');
    
    // Handle zero
    if (parseFloat(absStr) === 0) {
        const buf = Buffer.alloc(16);
        bufferWriteBigInt(buf, sign << 63n, 0, 8);
        return buf;
    }
    
    // Parse coefficient and exponent
    let coefficient, exponent;
    const eIndex = absStr.toLowerCase().indexOf('e');
    
    if (eIndex !== -1) {
        const mantissa = absStr.substring(0, eIndex).replace('.', '');
        coefficient = mantissa === '' || mantissa === '-' ? 0n : BigInt(mantissa);
        const expPart = absStr.substring(eIndex + 1);
        const dotIndex = absStr.indexOf('.');
        if (dotIndex !== -1 && dotIndex < eIndex) {
            exponent = parseInt(expPart) - (eIndex - dotIndex - 1);
        } else {
            exponent = parseInt(expPart);
        }
    } else {
        const dotIndex = absStr.indexOf('.');
        if (dotIndex !== -1) {
            const withoutDot = absStr.replace('.', '');
            coefficient = withoutDot === '' || withoutDot === '-' ? 0n : BigInt(withoutDot);
            exponent = -(absStr.length - dotIndex - 1);
        } else {
            coefficient = absStr === '' || absStr === '-' ? 0n : BigInt(absStr);
            exponent = 0;
        }
    }
    
    // Normalize: remove trailing zeros
    while (coefficient % 10n === 0n && coefficient !== 0n && exponent < DECIMAL128_MAX_EXPONENT) {
        coefficient /= 10n;
        exponent++;
    }
    
    // Check coefficient range
    if (coefficient > DECIMAL128_MAX_COEFFICIENT) {
        throw new Error(`Coefficient ${coefficient} exceeds Decimal128 maximum`);
    }
    
    // Adjust exponent with bias
    const biasedExponent = exponent + DECIMAL128_BIAS;
    if (biasedExponent < 0 || biasedExponent > 12287) {
        throw new Error(`Exponent ${exponent} out of Decimal128 range`);
    }
    
    // Encode using BID format (simplified)
    // Bit layout: S(1) | Combination(5) | Exponent continuation(12) | Coefficient continuation(110)
    
    const expBigInt = BigInt(biasedExponent);
    
    let high = 0n;
    let low = coefficient & ((1n << 64n) - 1n);
    
    // Sign bit
    high |= sign << 63n;
    
    // Simplified encoding (combination field)
    const msd = Number(coefficient / 1000000000000000000000000000000000n);
    
    if (msd <= 7) {
        high |= (expBigInt >> 12n) & 0x3n << 61n;
        high |= (expBigInt & 0xFFFn) << 49n;
        high |= (coefficient >> 64n) & 0x1FFFFFFFFFFFFn;
    } else {
        high |= 0x3n << 61n;
        high |= ((expBigInt >> 12n) & 0x3n) << 59n;
        high |= (expBigInt & 0xFFFn) << 47n;
        high |= ((coefficient - 8000000000000000000000000000000000n) >> 64n) & 0x7FFFFFFFFFFFn;
    }
    
    const buf = Buffer.alloc(16);
    bufferWriteBigInt(buf, high, 0, 8);
    bufferWriteBigInt(buf, low, 8, 8);
    return buf;
}

/**
 * Decode IEEE 754 Decimal128 format (16 bytes) to a string
 * @param {Buffer} buffer - 16-byte buffer containing the Decimal128 encoding
 * @returns {string|number} - Decoded value as string or special value
 */
function decodeDecimal128(buffer) {
    if (buffer.length !== 16) {
        throw new Error('Decimal128 buffer must be 16 bytes');
    }
    
    const high = bufferToBigInt(buffer.slice(0, 8));
    const low = bufferToBigInt(buffer.slice(8, 16));
    
    // Extract sign
    const sign = (high >> 63n) & 0x1n;
    
    // Check for special values
    const combo = (high >> 58n) & 0x1Fn;
    
    if ((combo & 0x1En) === 0x1En) {
        // Special value (NaN or Infinity)
        if ((combo & 0x1n) === 0n) {
            return sign ? -Infinity : Infinity;
        } else {
            return NaN;
        }
    }
    
    // Decode exponent and coefficient
    let exponent, coeffHigh;
    
    if ((combo & 0x18n) !== 0x18n) {
        // Normal case
        exponent = ((combo & 0x6n) << 12n) | ((high >> 49n) & 0xFFFn);
        coeffHigh = high & 0x1FFFFFFFFFFFFn;
    } else {
        // MSD 8-9
        exponent = ((combo & 0x6n) << 12n) | ((high >> 47n) & 0xFFFn);
        coeffHigh = (high & 0x7FFFFFFFFFFFn) + (8n << 110n);
    }
    
    const coefficient = (coeffHigh << 64n) | low;
    
    // Remove bias
    const unbias = Number(exponent) - DECIMAL128_BIAS;
    
    // Build result string
    const coeffStr = coefficient.toString();
    const signStr = sign ? '-' : '';
    
    if (unbias === 0) {
        return signStr + coeffStr;
    } else if (unbias > 0) {
        return signStr + coeffStr + '0'.repeat(unbias);
    } else {
        const absExp = -unbias;
        if (absExp >= coeffStr.length) {
            return signStr + '0.' + '0'.repeat(absExp - coeffStr.length) + coeffStr;
        } else {
            const intPart = coeffStr.substring(0, coeffStr.length - absExp);
            const fracPart = coeffStr.substring(coeffStr.length - absExp);
            return signStr + intPart + '.' + fracPart;
        }
    }
}

/**
 * Convert a BigInt to a Buffer (big-endian)
 * @param {BigInt} value - The BigInt value
 * @param {number} size - Buffer size in bytes
 * @returns {Buffer}
 */
function bigIntToBuffer(value, size) {
    const buf = Buffer.alloc(size);
    let val = BigInt(value.toString());
    for (let i = size - 1; i >= 0; i--) {
        buf[i] = Number(val & 0xFFn);
        val >>= 8n;
    }
    return buf;
}

/**
 * Convert a Buffer to BigInt (big-endian)
 * @param {Buffer} buffer
 * @returns {BigInt}
 */
function bufferToBigInt(buffer) {
    let result = 0n;
    for (let i = 0; i < buffer.length; i++) {
        result = (result << 8n) | BigInt(buffer[i]);
    }
    return result;
}

/**
 * Write BigInt to buffer at offset (big-endian)
 * @param {Buffer} buffer
 * @param {BigInt} value
 * @param {number} offset
 * @param {number} size
 */
function bufferWriteBigInt(buffer, value, offset, size) {
    let val = BigInt(value.toString());
    for (let i = offset + size - 1; i >= offset; i--) {
        buffer[i] = Number(val & 0xFFn);
        val >>= 8n;
    }
}

module.exports = {
    encodeDecimal64,
    decodeDecimal64,
    encodeDecimal128,
    decodeDecimal128
};
