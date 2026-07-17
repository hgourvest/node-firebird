import crypto from 'crypto';

export interface KeyPair {
    public: bigint;
    private: bigint;
}

export interface ClientProof {
    clientSessionKey: bigint;
    authData: bigint;
}

const SRP_KEY_SIZE = 128,
  SRP_KEY_MAX = BigInt('340282366920938463463374607431768211456'), // 1 << SRP_KEY_SIZE
  SRP_SALT_SIZE = 32;

const DEBUG = false;
const DEBUG_PRIVATE_KEY = BigInt('0x84316857F47914F838918D5C12CE3A3E7A9B2D7C9486346809E9EEFCE8DE7CD4259D8BE4FD0BCC2D259553769E078FA61EE2977025E4DA42F7FD97914D8A33723DFAFBC00770B7DA0C2E3778A05790F0C0F33C32A19ED88A12928567749021B3FD45DCD1CE259C45325067E3DDC972F87867349BA82C303CCCAA9B207218007B');

/**
 * Prime values.
 *
 * @type {{g: BigInt, k: BigInt, N: BigInt}}
 */
const PRIME = {
    N: BigInt('0xE67D2E994B2F900C3F41F08F5BB2627ED0D49EE1FE767A52EFCD565CD6E768812C3E1E9CE8F0A8BEA6CB13CD29DDEBF7A96D4A93B55D488DF099A15C89DCB0640738EB2CBDD9A8F7BAB561AB1B0DC1C6CDABF303264A08D1BCA932D1F1EE428B619D970F342ABA9A65793B8B2F041AE5364350C16F735F56ECBCA87BD57B29E7'),
    g: BigInt(2),
    k: BigInt('1277432915985975349439481660349303019122249719989')
};

const kCache: Record<string, bigint> = {};
function getK(hashAlgo: string): bigint {
    if (!kCache[hashAlgo]) {
        kCache[hashAlgo] = BigInt('0x' + getHash(hashAlgo, pad(PRIME.N), pad(PRIME.g)));
    }
    return kCache[hashAlgo];
}

/**
 * Generate a client key pair.
 *
 * @param a BigInt Client private key.
 * @returns {{private: BigInt, public: BigInt}}
 */
export function clientSeed(a: bigint = toBigInt(crypto.randomBytes(SRP_KEY_SIZE)) % PRIME.N): KeyPair {
    // a must be in [0, N): clientSession() reduces the exponent (a + ux) mod N
    // to match the Firebird engine, but A = g^a is computed from the raw a.
    // When random a >= N (~10% of 1024-bit values), the proof diverges from
    // the server's session key, causing sporadic auth failures.
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
 * @param salt BigInt Connection salt.
 * @param b BigInt Server private key.
 * @returns {{private: BigInt, public: BigInt}}
 */
export function serverSeed(user: string, password: string, salt: Buffer | string, b?: bigint | string, hashAlgo: string = 'sha1'): KeyPair {
    if (typeof b === 'string') {
        hashAlgo = b;
        b = undefined;
    }
    const bKey: bigint = (b === undefined || b === null)
        ? toBigInt(crypto.randomBytes(SRP_KEY_SIZE))
        : b as bigint;
    var v = getVerifier(user, password, salt, 'sha1');
    var gb = modPow(PRIME.g, bKey, PRIME.N);
    var k = getK('sha1');
    var kv = (k * v) % PRIME.N;
    var B = (kv + gb) % PRIME.N;

    dump('v', v);
    dump('b', bKey);
    dump('gb', bKey);
    dump('kv', v);
    dump('B', B);

    return {
        public: B,
        private: bKey
    };
}

/**
 * Server session secret.
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt BigInt Connection salt.
 * @param A BigInt Client public key.
 * @param B BigInt Server public key.
 * @param b BigInt Server private key.
 * @returns {BigInt}
 */
export function serverSession(user: string, password: string, salt: Buffer | string, A: bigint, B: bigint, b: bigint, hashAlgo: string = 'sha1'): bigint {
    var u = getScramble(A, B, 'sha1');
    var v = getVerifier(user, password, salt, 'sha1');
    var vu = modPow(v, u, PRIME.N);
    var Avu = (A * vu) % PRIME.N;
    var sessionSecret = modPow(Avu, b, PRIME.N);
    var K = getHash('sha1', toBuffer(sessionSecret));

    dump('server sessionSecret', sessionSecret);
    dump('server K', K);

    return BigInt('0x' + K);
};

/**
 * M = H(H(N) xor H(g), H(I), s, A, B, K)
 */
export function clientProof(user: string, password: string, salt: Buffer | string, A: bigint, B: bigint, a: bigint, hashAlgo: string = 'sha1'): ClientProof {
    var K = clientSession(user, password, salt, A, B, a, 'sha1');
    var n1, n2;

    n1 = toBigInt(getHash('sha1', toBuffer(PRIME.N)));
    n2 = toBigInt(getHash('sha1', toBuffer(PRIME.g)));

    dump('n1', n1);
    dump('n2', n2);

    n1 = modPow(n1, n2, PRIME.N);
    n2 = toBigInt(getHash('sha1', user));
    // K is hashed as the raw fixed-length digest, exactly like the server's
    // digest.process(sessionKey) over a 20-byte UCharBuffer. Converting it
    // through bigint dropped a leading zero byte (~0.4% of connections) and
    // broke the proof (issue #421).
    var M = toBigInt(getHash(hashAlgo, toBuffer(n1), toBuffer(n2), salt, toBuffer(A), toBuffer(B), K));

    dump('n1-2', n1);
    dump('n2-2', n2);
    dump('proof:M', M);

    return {
        clientSessionKey: toBigInt(K),
        authData: M,
    };
}

/**
 *  Pad hex string.
 */
export function hexPad(hex: string): string {
    if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }

    return hex;
}

/**
 * The SRP prime modulus N (1024-bit, same value used by Firebird).
 * Exported so tests and tooling can assert key-size invariants without
 * duplicating the constant.
 */
export const PRIME_N: bigint = PRIME.N;

/**
 * Pad key with SRP_KEY_SIZE.
 *
 * @param n BigInt Key to pad.
 * @returns Buffer
 */
function pad(n: bigint): Buffer {
    var buff = Buffer.from(hexPad(n.toString(16)), 'hex');

    if (buff.length > SRP_KEY_SIZE) {
        buff = buff.slice(buff.length - SRP_KEY_SIZE, buff.length);
    } else if (buff.length < SRP_KEY_SIZE) {
        var padded = Buffer.alloc(SRP_KEY_SIZE);
        buff.copy(padded, SRP_KEY_SIZE - buff.length);
        buff = padded;
    }

    return buff;
}

/**
 * Scramble keys.
 *
 * The server hashes the minimal (stripped) magnitude bytes of A and B
 * (RemotePassword::computeScramble → processStrippedInt in Firebird's
 * srp.cpp, identical in 3.0 through master) — NOT the 128-byte padded
 * form, which the engine only uses for k = H(N, pad(g)). Padding here
 * made u diverge whenever A or B had a leading zero byte (~0.8% of
 * connections), failing the proof (issue #421).
 *
 * @param A BigInt Client public key.
 * @param B BigInt Server public key.
 * @returns {BigInt}
 */
function getScramble(A: bigint, B: bigint, hashAlgo: string = 'sha1'): bigint {
    return BigInt('0x' + getHash(hashAlgo, toBuffer(A), toBuffer(B)));
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
 * @param salt BigInt Connection salt.
 * @param A BigInt Client public key.
 * @param B BigInt Server public key.
 * @param a BigInt Client private key.
 * @returns Buffer The raw session-key digest (fixed length, may start
 *                 with a zero byte — significant for the proof).
 */
function clientSession(user: string, password: string, salt: Buffer | string, A: bigint, B: bigint, a: bigint, hashAlgo: string = 'sha1'): Buffer {
    var u = getScramble(A, B, 'sha1');
    var x = getUserHash(user, salt, password, 'sha1');
    var gx = modPow(PRIME.g, x, PRIME.N);
    var k = getK('sha1');
    var kgx = (k * gx) % PRIME.N;
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
    var K = Buffer.from(getHash('sha1', toBuffer(sessionSecret)), 'hex');

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
 * @param salt BigInt Connection salt.
 * @param password string Connection password.
 * @returns {BigInt}
 */
function getUserHash(user: string, salt: Buffer | string, password: string, hashAlgo: string = 'sha1'): bigint {
    var hash1 = getHash(hashAlgo, user.toUpperCase(), ':', password);
    var hash2 = getHash(hashAlgo, salt, toBuffer(hash1));

    return toBigInt(hash2);
}

/**
 * Verifier of user hash.
 *
 * @param user string Connection username.
 * @param password string Connection password.
 * @param salt  BigInt Connection salt.
 * @returns {BigInt}
 */
function getVerifier(user: string, password: string, salt: Buffer | string, hashAlgo: string = 'sha1'): bigint {
    return modPow(PRIME.g, getUserHash(user, salt, password, hashAlgo), PRIME.N);
}

/**
 * Hash data and return hex string.
 *
 * @param algo string Algorithm to use.
 * @param data any[] Data to hash.
 * @returns {string}
 */
function getHash(algo: string, ...data: (string | Buffer)[]): string {
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
function toBuffer(bigInt: bigint | string): Buffer {
    return Buffer.from(typeof bigInt === 'bigint' ? hexPad(bigInt.toString(16)) : bigInt, 'hex');
}

/**
 * Convert hex buffer or string to BigInt.
 *
 * @param hex
 * @returns {BigInt}
 */
function toBigInt(hex: Buffer | string): bigint {
    return BigInt('0x' + (Buffer.isBuffer(hex) ? hex.toString('hex') : hex));
}

/**
 * Dump value in debug mode.
 *
 * @param key
 * @param value
 */
function dump(key: string, value: any): void {
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
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
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
