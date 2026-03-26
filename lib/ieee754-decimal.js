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
    
    // Split coefficient into MSD and continuation
    const msd = Number(coefficient / 1000000000000000n); // Most significant digit  
    const coeffCont = coefficient % 1000000000000000n; // Lower 15 digits (50 bits max)
    
    const expBigInt = BigInt(biasedExponent);
    const expTop = (expBigInt >> 8n) & 0x3n; // Top 2 bits of exponent (bits 9-8)
    const expLow = expBigInt & 0xFFn; // Lower 8 bits of exponent (bits 7-0)
    
    if (msd <= 7) {
        // Combination: G0 G1 G2 G3 G4 where G0 G1 = expTop, G2 G3 G4 = MSD
        const combo = (expTop << 3n) | BigInt(msd);
        encoded |= combo << 58n;
        // Exponent continuation (8 bits at position 57-50)
        encoded |= expLow << 50n;
        // Coefficient continuation (50 bits at position 49-0)
        encoded |= coeffCont & 0x3FFFFFFFFFFFFn;
    } else {
        // Combination: 11 G2 G3 G4 where G2 = (MSD-8), G3 G4 = expTop
        const combo = 0x18n | ((BigInt(msd - 8) & 0x1n) << 2n) | expTop;
        encoded |= combo << 58n;
        // Exponent continuation (8 bits at position 57-50)
        encoded |= expLow << 50n;
        // Coefficient continuation (50 bits at position 49-0)
        encoded |= coeffCont & 0x3FFFFFFFFFFFFn;
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
    let exponent, coefficient, msd;
    
    if ((combo & 0x18n) !== 0x18n) {
        // Combination: G0 G1 G2 G3 G4 where G0 G1 != 11
        // MSD is G2 G3 G4 (bits 2-0 of combo)
        msd = Number(combo & 0x7n);
        // Exponent top 2 bits are G0 G1 (bits 4-3 of combo)
        const expTop = (combo >> 3n) & 0x3n;
        // Exponent continuation is bits 57-50 (8 bits)
        const expLow = (encoded >> 50n) & 0xFFn;
        exponent = (expTop << 8n) | expLow;
        // Coefficient continuation is bits 49-0 (50 bits)
        const coeffCont = encoded & 0x3FFFFFFFFFFFFn;
        coefficient = BigInt(msd) * 1000000000000000n + coeffCont;
    } else {
        // Combination: 11 G2 G3 G4 (MSD 8-9)
        // MSD is 8 + G2 (bit 2 of combo)
        msd = 8 + Number((combo >> 2n) & 0x1n);
        // Exponent top 2 bits are G3 G4 (bits 1-0 of combo)
        const expTop = combo & 0x3n;
        // Exponent continuation is bits 57-50 (8 bits)
        const expLow = (encoded >> 50n) & 0xFFn;
        exponent = (expTop << 8n) | expLow;
        // Coefficient continuation is bits 49-0 (50 bits)  
        const coeffCont = encoded & 0x3FFFFFFFFFFFFn;
        coefficient = BigInt(msd) * 1000000000000000n + coeffCont;
    }
    
    // Remove bias from exponent
    const unbias = Number(exponent) - DECIMAL64_BIAS;
    
    // Build result string
    const coeffStr = coefficient.toString();
    const signStr = sign ? '-' : '';
    
    // Special case: if coefficient is 0, just return "0" regardless of exponent
    if (coefficient === 0n) {
        return signStr + '0';
    }
    
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
    
    // Encode using BID format
    // Bit layout: S(1) | Combination(5) | Exponent continuation(12) | Coefficient continuation(110)
    
    const expBigInt = BigInt(biasedExponent);
    
    // Split coefficient into MSD and continuation
    const msd = Number(coefficient / 1000000000000000000000000000000000n); // Most significant digit (10^33)
    const coeffCont = coefficient % 1000000000000000000000000000000000n; // Lower 33 digits (110 bits max)
    
    let high = 0n;
    let low = coeffCont & ((1n << 64n) - 1n); // Lower 64 bits of coefficient
    
    // Sign bit (bit 127)
    high |= sign << 63n;
    
    const expTop = (expBigInt >> 12n) & 0x3n; // Top 2 bits of exponent (bits 13-12)
    const expLow = expBigInt & 0xFFFn; // Lower 12 bits of exponent (bits 11-0)
    
    if (msd <= 7) {
        // Combination: G0 G1 G2 G3 G4 where G0 G1 = expTop, G2 G3 G4 = MSD
        const combo = (expTop << 3n) | BigInt(msd);
        high |= combo << 58n;
        // Exponent continuation (12 bits at position 121-110, which is bits 57-46 in high)
        high |= expLow << 46n;
        // Coefficient continuation high 46 bits (bits 109-64, which is bits 45-0 in high)
        high |= (coeffCont >> 64n) & 0x3FFFFFFFFFFFn;
    } else {
        // Combination: 11 G2 G3 G4 where G2 = (MSD-8), G3 G4 = expTop
        const combo = 0x18n | ((BigInt(msd - 8) & 0x1n) << 2n) | expTop;
        high |= combo << 58n;
        // Exponent continuation (12 bits at position 121-110)
        high |= expLow << 46n;
        // Coefficient continuation high 46 bits
        high |= (coeffCont >> 64n) & 0x3FFFFFFFFFFFn;
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
    let exponent, coefficient, msd;
    
    if ((combo & 0x18n) !== 0x18n) {
        // Combination: G0 G1 G2 G3 G4 where G0 G1 != 11
        // MSD is G2 G3 G4 (bits 2-0 of combo)
        msd = Number(combo & 0x7n);
        // Exponent top 2 bits are G0 G1 (bits 4-3 of combo)
        const expTop = (combo >> 3n) & 0x3n;
        // Exponent continuation is bits 121-110 (bits 57-46 in high, 12 bits)
        const expLow = (high >> 46n) & 0xFFFn;
        exponent = (expTop << 12n) | expLow;
        // Coefficient continuation is bits 109-0 (bits 45-0 in high + all 64 bits in low = 110 bits)
        const coeffHigh = high & 0x3FFFFFFFFFFFn; // 46 bits
        coefficient = (coeffHigh << 64n) | low; // Combine with low 64 bits
        coefficient = BigInt(msd) * 1000000000000000000000000000000000n + coefficient;
    } else {
        // Combination: 11 G2 G3 G4 (MSD 8-9)
        // MSD is 8 + G2 (bit 2 of combo)
        msd = 8 + Number((combo >> 2n) & 0x1n);
        // Exponent top 2 bits are G3 G4 (bits 1-0 of combo)
        const expTop = combo & 0x3n;
        // Exponent continuation is bits 121-110 (12 bits)
        const expLow = (high >> 46n) & 0xFFFn;
        exponent = (expTop << 12n) | expLow;
        // Coefficient continuation is bits 109-0 (110 bits)
        const coeffHigh = high & 0x3FFFFFFFFFFFn; // 46 bits
        coefficient = (coeffHigh << 64n) | low;
        coefficient = BigInt(msd) * 1000000000000000000000000000000000n + coefficient;
    }
    
    // Remove bias
    const unbias = Number(exponent) - DECIMAL128_BIAS;
    
    // Build result string
    const coeffStr = coefficient.toString();
    const signStr = sign ? '-' : '';
    
    // Special case: if coefficient is 0, just return "0"
    if (coefficient === 0n) {
        return signStr + '0';
    }
    
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
