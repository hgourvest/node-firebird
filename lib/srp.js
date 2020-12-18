var BigInt = require('big-integer'),
    crypto = require('crypto');

const SRP_KEY_SIZE = 128,
  SRP_KEY_MAX = BigInt('340282366920938463463374607431768211456'), // 1 << SRP_KEY_SIZE
  SRP_SALT_SIZE = 32;

const DEBUG = false;
const DEBUG_PRIVATE_KEY = BigInt('84316857F47914F838918D5C12CE3A3E7A9B2D7C9486346809E9EEFCE8DE7CD4259D8BE4FD0BCC2D259553769E078FA61EE2977025E4DA42F7FD97914D8A33723DFAFBC00770B7DA0C2E3778A05790F0C0F33C32A19ED88A12928567749021B3FD45DCD1CE259C45325067E3DDC972F87867349BA82C303CCCAA9B207218007B', 16);

/**
 * Prime values.
 *
 * @type {{g: (bigInt.BigInteger), k: (bigInt.BigInteger), N: (bigInt.BigInteger)}}
 */
const PRIME = {
    N: BigInt('E67D2E994B2F900C3F41F08F5BB2627ED0D49EE1FE767A52EFCD565CD6E768812C3E1E9CE8F0A8BEA6CB13CD29DDEBF7A96D4A93B55D488DF099A15C89DCB0640738EB2CBDD9A8F7BAB561AB1B0DC1C6CDABF303264A08D1BCA932D1F1EE428B619D970F342ABA9A65793B8B2F041AE5364350C16F735F56ECBCA87BD57B29E7', 16),
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
    var A = PRIME.g.modPow(a, PRIME.N);

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
    var gb = PRIME.g.modPow(b, PRIME.N);
    var kv = PRIME.k.multiply(v).mod(PRIME.N);
    var B = kv.add(gb).mod(PRIME.N);

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
 * @returns {bigInt.BigInteger}
 */
exports.serverSession = function(user, password, salt, A, B, b) {
    var u = getScramble(A, B);
    var v = getVerifier(user, password, salt);
    var vu = v.modPow(u, PRIME.N);
    var Avu = A.multiply(vu).mod(PRIME.N);
    var sessionSecret = Avu.modPow(b, PRIME.N);
    var K = getHash('sha1', toBuffer(sessionSecret));

    dump('server sessionSecret', sessionSecret);
    dump('server K', K);

    return BigInt(K, 16);
};

/**
 * M = H(H(N) xor H(g), H(I), s, A, B, K)
 */
exports.clientProof = function(user, password, salt, A, B, a, hashAlgo) {
    var K = clientSession(user, password, salt, A, B, a);
    var n1, n2;

    n1 = toBigInt(getHash('sha1', toBuffer(PRIME.N)));
    n2 = toBigInt(getHash('sha1', toBuffer(PRIME.g)));

    dump('n1', n1);
    dump('n2', n2);

    n1 = n1.modPow(n2, PRIME.N);
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
    return BigInt(getHash('sha1', pad(A), pad(B)), 16);
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
    var gx = PRIME.g.modPow(x, PRIME.N);
    var kgx = PRIME.k.multiply(gx).mod(PRIME.N);
    var diff = B.subtract(kgx).mod(PRIME.N);

    if (diff.lesser(0)) {
        diff = diff.add(PRIME.N);
    }

    var ux = u.multiply(x).mod(PRIME.N);
    var aux = a.add(ux).mod(PRIME.N);
    var sessionSecret = diff.modPow(aux, PRIME.N);
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
    return PRIME.g.modPow(getUserHash(user, salt, password), PRIME.N);
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
    return Buffer.from(BigInt.isInstance(bigInt) ? hexPad(bigInt.toString(16)) : bigInt, 'hex');
}

/**
 * Convert hex buffer or string to BigInt.
 *
 * @param hex
 * @returns {bigInt.BigInteger}
 */
function toBigInt(hex) {
    return BigInt(Buffer.isBuffer(hex) ? hex.toString('hex') : hex, 16);
}

/**
 * Dump value in debug mode.
 *
 * @param key
 * @param value
 */
function dump(key, value) {
    if (DEBUG) {
        if (BigInt.isInstance(value)) {
            value = value.toString(16);
        }

        console.log(key + '=' + value);
    }
}