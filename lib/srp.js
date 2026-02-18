var crypto = require('crypto');

const SRP_KEY_SIZE = 128,
  SRP_KEY_MAX = BigInt('340282366920938463463374607431768211456'), // 1 << SRP_KEY_SIZE
  SRP_SALT_SIZE = 32;

const DEBUG = false;
const DEBUG_PRIVATE_KEY = BigInt('0x84316857F47914F838918D5C12CE3A3E7A9B2D7C9486346809E9EEFCE8DE7CD4259D8BE4FD0BCC2D259553769E078FA61EE2977025E4DA42F7FD97914D8A33723DFAFBC00770B7DA0C2E3778A05790F0C0F33C32A19ED88A12928567749021B3FD45DCD1CE259C45325067E3DDC972F87867349BA82C303CCCAA9B207218007B');

/**
 * Prime values.
 *
 * @type {{g: (bigInt.BigInteger), k: (bigInt.BigInteger), N: (bigInt.BigInteger)}}
 */
const PRIME = {
    N: BigInt('0xE67D2E994B2F900C3F41F08F5BB2627ED0D49EE1FE767A52EFCD565CD6E768812C3E1E9CE8F0A8BEA6CB13CD29DDEBF7A96D4A93B55D488DF099A15C89DCB0640738EB2CBDD9A8F7BAB561AB1B0DC1C6CDABF303264A08D1BCA932D1F1EE428B619D970F342ABA9A65793B8B2F041AE5364350C16F735F56ECBCA87BD57B29E7'),
    g: BigInt(2),
    k: BigInt('1277432915985975349439481660349303019122249719989')
};

/**
 * Generate a client key pair.
 *
 * @param a bigInt.BigInteger Client private key.
 * @returns {{private: bigInt.BigInteger, public: bigInt.BigInteger}}
 */
exports.clientSeed = function(a = toBigInt(crypto.randomBytes(SRP_KEY_SIZE))) {
    var A = modPow(PRIME.g, a, PRIME.N);

    dump('a', a);
    dump('A', A);

    return {
        public: A,
        private: a
    };
}

/**
 * Generate a server key pair.
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt bigInt.BigInteger Connection salt.
 * @param b bigInt.BigInteger Server private key.
 * @returns {{private: bigInt.BigInteger, public: bigInt.BigInteger}}
 */
exports.serverSeed = function(user, password, salt, b = toBigInt(crypto.randomBytes(SRP_KEY_SIZE))) {
    var v = getVerifier(user, password, salt);
    var gb = modPow(PRIME.g, b, PRIME.N);
    var kv = (PRIME.k * v) % PRIME.N;
    var B = (kv + gb) % PRIME.N;

    dump('v', v);
    dump('b', b);
    dump('gb', b);
    dump('kv', v);
    dump('B', B);

    return {
        public: B,
        private: b
    };
}

/**
 * Server session secret.
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt bigInt.BigInteger Connection salt.
 * @param A bigInt.BigInteger Client public key.
 * @param B bigInt.BigInteger Server public key.
 * @param b bigInt.BigInteger Server private key.
 * @param a bigInt.BigInteger Client private key (optional, for testing quirk).
 * @returns {bigInt.BigInteger}
 */
exports.serverSession = function(user, password, salt, A, B, b, a) {
    A = toBigInt(A);
    B = toBigInt(B);
    b = toBigInt(b);
    if (a) a = toBigInt(a);

    var u = getScramble(A, B);
    var x = getUserHash(user, salt, password);
    var ux = (u * x) % PRIME.N;

    var sessionSecret;
    if (a) {
        var aux = (a + ux) % PRIME.N;
        var gb = modPow(PRIME.g, b, PRIME.N);
        sessionSecret = modPow(gb, aux, PRIME.N);
    } else {
        var vu = modPow(PRIME.g, ux, PRIME.N);
        var Avu = (A * vu) % PRIME.N;
        sessionSecret = modPow(Avu, b, PRIME.N);
    }

    var K = getHash('sha1', toBuffer(sessionSecret));

    dump('server sessionSecret', sessionSecret);
    dump('server K', K);

    return BigInt('0x' + K);
};

/**
 * M = H(H(N) xor H(g), H(I), s, A, B, K)
 */
exports.clientProof = function(user, password, salt, A, B, a, hashAlgo) {
    A = toBigInt(A);
    B = toBigInt(B);
    a = toBigInt(a);

    var K = clientSession(user, password, salt, A, B, a);
    var n1, n2;

    n1 = toBigInt(getHash('sha1', toBuffer(PRIME.N)));
    n2 = toBigInt(getHash('sha1', toBuffer(PRIME.g)));

    dump('n1', n1);
    dump('n2', n2);

    n1 = modPow(n1, n2, PRIME.N);
    n2 = toBigInt(getHash('sha1', user));
    var M = toBigInt(getHash(hashAlgo, toBuffer(n1), toBuffer(n2), salt, toBuffer(A), toBuffer(B), toBuffer(K)));

    dump('n1-2', n1);
    dump('n2-2', n2);
    dump('proof:M', M);

    return {
        clientSessionKey: K,
        authData: M,
    };
}

/**
 *  Pad hex string.
 */
function hexPad(hex) {
    if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }

    return hex;
}
exports.hexPad = hexPad;

/**
 * Pad key with SRP_KEY_SIZE.
 *
 * @param n BigInt Key to pad.
 * @returns Buffer
 */
function pad(n) {
    var buff = Buffer.from(hexPad(n.toString(16)), 'hex');

    if (buff.length > SRP_KEY_SIZE) {
        buff = buff.slice(buff.length - SRP_KEY_SIZE, buff.length);
    }

    return buff;
}

/**
 * Scramble keys.
 *
 * @param A bigInt.BigInteger Client public key.
 * @param B bigInt.BigInteger Server public key.
 * @returns {bigInt.BigInteger}
 */
function getScramble(A, B) {
    return BigInt('0x' + getHash('sha1', pad(A), pad(B)));
}

/**
 * Client session secret.
 *
 * Both: u = H(A, B)
 * User: x = H(s, p)                 (user enters password)
 * User: S = (B - kg^x) ^ (a + ux)   (computes session key)
 * User: K = H(S)
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt bigInt.BigInteger Connection salt.
 * @param A bigInt.BigInteger Client public key.
 * @param B bigInt.BigInteger Server public key.
 * @param a bigInt.BigInteger Client private key.
 */
function clientSession(user, password, salt, A, B, a) {
    var u = getScramble(A, B);
    var x = getUserHash(user, salt, password);
    var gx = modPow(PRIME.g, x, PRIME.N);
    var kgx = (PRIME.k * gx) % PRIME.N;
    var diff = (B - kgx) % PRIME.N;

    if (diff < 0n) {
        diff = diff + PRIME.N;
    }

    // Note: While the SRP specification says exponents should not be reduced mod N,
    // the Firebird engine implementation does reduce these exponents mod N.
    // We must match the server's behavior for authentication to succeed.
    var ux = (u * x) % PRIME.N;
    var aux = (a + ux) % PRIME.N;
    var sessionSecret = modPow(diff, aux, PRIME.N);
    var K = toBigInt(getHash('sha1', toBuffer(sessionSecret)));

    dump('B', B);
    dump('u', u);
    dump('x', x);
    dump('gx', gx);
    dump('kgx', kgx);
    dump('diff', diff);
    dump('ux', ux);
    dump('aux', aux);
    dump('sessionSecret', sessionSecret);
    dump('sessionKey(K)', K);

    return K;
}

/**
 * Compute user hash.
 *
 * @param user string Connection username.
 * @param salt bigInt.BigInteger Connection salt.
 * @param password string Connection password.
 * @returns {bigInt.BigInteger}
 */
function getUserHash(user, salt, password) {
    var hash1 = getHash('sha1', user.toUpperCase(), ':', password);
    var hash2 = getHash('sha1', salt, toBuffer(hash1));

    return toBigInt(hash2);
}

/**
 * Verifier of user hash.
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt  bigInt.BigInteger Connection salt.
 * @returns {bigInt.BigInteger}
 */
function getVerifier(user, password, salt) {
    return modPow(PRIME.g, getUserHash(user, salt, password), PRIME.N);
}

/**
 * Hash data and return hex string.
 *
 * @param algo string Algorithm to use.
 * @param data any[] Data to hash.
 * @returns {string}
 */
function getHash(algo, ...data) {
    var hash = crypto.createHash(algo);

    for (var d of data) {
        hash.update(d);
    }

    return hash.digest('hex');
}

/**
 * Convert BigInt to buffer.
 *
 * @param bigInt
 * @returns {*}
 */
function toBuffer(bigInt) {
    return Buffer.from(typeof bigInt === 'bigint' ? hexPad(bigInt.toString(16)) : bigInt, 'hex');
}

/**
 * Convert hex buffer or string to BigInt.
 *
 * @param hex
 * @returns {bigInt.BigInteger}
 */
function toBigInt(hex) {
    if (hex == null) {
        return 0n;
    }
    if (typeof hex === 'bigint') {
        return hex;
    }
    if (typeof hex === 'number') {
        try {
            return BigInt(Math.trunc(hex));
        } catch (e) {
            return 0n;
        }
    }

    if (Buffer.isBuffer(hex)) {
        return BigInt('0x' + hex.toString('hex'));
    }

    const str = String(hex);
    if (str.includes('.') || str.toLowerCase().includes('e')) {
        try {
            return BigInt(Math.trunc(Number(str)));
        } catch (e) {
            return 0n;
        }
    }

    return BigInt('0x' + str);
}

/**
 * Dump value in debug mode.
 *
 * @param key
 * @param value
 */
function dump(key, value) {
    if (DEBUG) {
        if (typeof value === 'bigint') {
            value = value.toString(16);
        }

        console.log(key + '=' + value);
    }
}

/**
 * Calculates (base ^ exp) % mod using native BigInt.
 */
function modPow(base, exp, mod) {
    let result = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp & 1n) {
            result = (result * base) % mod;
        }
        base = (base * base) % mod;
        exp >>= 1n;
    }
    return result;
}