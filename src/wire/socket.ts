import net from "net";
import zlib from "zlib";
import crypto from "crypto";

/**
 * Arc4 stream cipher for Firebird wire encryption.
 * Uses the SRP session key to create RC4 encryption/decryption streams.
 */
class Arc4 {
    _s: Uint8Array;
    _i: number;
    _j: number;

    constructor(key: Buffer | Uint8Array) {
        this._s = new Uint8Array(256);
        this._i = 0;
        this._j = 0;

        // KSA (Key-Scheduling Algorithm)
        for (var i = 0; i < 256; i++) {
            this._s[i] = i;
        }

        var j = 0;
        for (var i = 0; i < 256; i++) {
            j = (j + this._s[i] + key[i % key.length]) & 0xFF;
            // Swap
            var tmp = this._s[i];
            this._s[i] = this._s[j];
            this._s[j] = tmp;
        }
    }

    /**
     * Transform (encrypt/decrypt) data in place.
     * RC4 is symmetric - encrypt and decrypt are the same operation.
     */
    transform(data: Buffer | Uint8Array): Buffer {
        var out = Buffer.alloc(data.length);
        for (var n = 0; n < data.length; n++) {
            this._i = (this._i + 1) & 0xFF;
            this._j = (this._j + this._s[this._i]) & 0xFF;

            // Swap
            var tmp = this._s[this._i];
            this._s[this._i] = this._s[this._j];
            this._s[this._j] = tmp;

            var k = this._s[(this._s[this._i] + this._s[this._j]) & 0xFF];
            out[n] = data[n] ^ k;
        }
        return out;
    }
}

/**
 * ChaChaCipher wrapper around Node.js crypto.createCipheriv / createDecipheriv.
 */
class ChaChaCipher {
    _cipher: crypto.Cipheriv | crypto.Decipheriv;

    constructor(key: Buffer, iv: Buffer, ivlen: number, isEncrypt: boolean) {
        const opensslIv = Buffer.alloc(16);
        if (ivlen === 8) {
            iv.copy(opensslIv, 8, 0, 8);
        } else if (ivlen === 16) {
            const ctr = (iv[12] << 24) + (iv[13] << 16) + (iv[14] << 8) + iv[15];
            opensslIv.writeUInt32LE(ctr, 0);
            iv.copy(opensslIv, 4, 0, 12);
        } else if (ivlen === 12) {
            iv.copy(opensslIv, 4, 0, 12);
        } else {
            throw new Error('Wrong IV length: ' + ivlen);
        }

        if (isEncrypt) {
            this._cipher = crypto.createCipheriv('chacha20', key, opensslIv);
        } else {
            this._cipher = crypto.createDecipheriv('chacha20', key, opensslIv);
        }
    }

    transform(data: Buffer): Buffer {
        return this._cipher.update(data);
    }
}

/**
 * Socket proxy.
 */
class Socket {
    static Arc4 = Arc4;

    _socket: net.Socket;
    compress: boolean;
    compressor: zlib.Deflate | null;
    compressorBuffer: Buffer[];
    decompressor: zlib.Inflate | null;
    decompressorBuffer: Buffer[];
    buffer: Buffer | null;
    encrypt: boolean;
    encryptCipher: any;
    decryptCipher: any;

    constructor(port: number, host: string) {
        this._socket = net.createConnection(port, host);
        this._socket.setNoDelay(true);
        this._socket.setKeepAlive(true, 60000); // 1 minute delay to detect dead/stale connections
        this.compressor = null;
        this.compressorBuffer = [];
        this.decompressor = null;
        this.decompressorBuffer = [];
        this.buffer = null;
        this.encrypt = false;
        this.encryptCipher = null;
        this.decryptCipher = null;

        return new Proxy(this._socket, this as any) as any;
    }

    /**
     * Decompress and/or decrypt data when received.
     * Override on data event.
     */
    on(event: string, cb: (...args: any[]) => void): void {
        if (event === 'data') {
            const mainCb = cb;
            cb = (data: Buffer) => {
                // Decrypt first if encryption is enabled
                 if (this.encrypt) {
                    data = this.decryptCipher.transform(data);
                    if (process.env.FIREBIRD_DEBUG) {
                        console.log('[fb-debug] socket.read decrypted: length=%d RX-cipher-offset=%d',
                            data.length, this.decryptCipher._i);
                        console.log('[fb-debug] socket.read decrypted hex: %s', data.toString('hex'));
                    }
                }

                if (this.compress) {
                    this.decompressor.write(data, () => {
                        mainCb(Buffer.concat(this.decompressorBuffer));
                        this.decompressorBuffer = []; // Reset buffer
                    });
                } else {
                    mainCb(data);
                }
            };
        }

        this._socket.on(event, cb);
    }

    /**
     * Compress and/or encrypt data before sending to socket.
     */
    write(data: Buffer | Uint8Array, defer = false): void {
        if (process.env.FIREBIRD_DEBUG) {
            console.log('[fb-debug] socket.write: length=%d bytes=%s encrypt=%s defer=%s',
                data.length, Buffer.from(data).toString('hex'), this.encrypt, defer);
        }
        if (defer) {
            // Accumulate deferred packets instead of overwriting.  Multiple
            // deferred ops (e.g. op_close_blob followed immediately by
            // op_free_statement) must all be kept until the next flush;
            // overwriting the buffer silently drops packets and desynchronises
            // the request/response queue, causing the connection to hang.
            this.buffer = this.buffer
                ? Buffer.concat([this.buffer, Buffer.from(data)])
                : Buffer.from(data);
            return;
        }

        if (!defer && this.buffer) {
            data = Buffer.concat([this.buffer, data]);
            this.buffer = null;
        }

        if (this.compress) {
            this.compressor.write(data, () => {
                var compressedData = Buffer.concat(this.compressorBuffer);
                this.compressorBuffer = []; // Reset buffer

                // Encrypt after compression if encryption is enabled
                if (this.encrypt) {
                    compressedData = this.encryptCipher.transform(compressedData);
                }

                this._socket.write(compressedData);
            });
        } else if (this.encrypt) {
            const out = this.encryptCipher.transform(data);
            if (process.env.FIREBIRD_DEBUG) {
                console.log('[fb-debug] socket.write encrypted: length=%d TX-cipher-offset=%d',
                    out.length, this.encryptCipher._i);
            }
            this._socket.write(out);
        } else {
            this._socket.write(data);
        }
    }

    /**
     * Enable compression/decompression on the fly.
     */
    enableCompression(): void {
        this.compress = true;

        // Create decompressor instance
        this.decompressor = zlib.createInflate();
        this.decompressor.on('data', (inflate) => {
            this.decompressorBuffer.push(inflate);
        });

        // Create compressor instance
        this.compressor = zlib.createDeflate({
            flush: zlib.constants.Z_FULL_FLUSH,
            finishFlush: zlib.constants.Z_SYNC_FLUSH
        });
        this.compressor.on('data', (deflate) => {
            this.compressorBuffer.push(deflate);
        });
    }

    /**
     * Enable encryption/decryption.
     * @param {Buffer} sessionKey - The session key from SRP authentication.
     * @param {string} [pluginName='Arc4'] - The selected encryption plugin.
     * @param {Buffer} [iv] - The initialization vector (needed for ChaCha/ChaCha64).
     */
    enableEncryption(sessionKey: Buffer, pluginName: string = 'Arc4', iv?: Buffer): void {
        this.encrypt = true;
        if (pluginName === 'Arc4') {
            this.encryptCipher = new Arc4(sessionKey);
            this.decryptCipher = new Arc4(sessionKey);
        } else if (pluginName === 'ChaCha' || pluginName === 'ChaCha64') {
            const stretchedKey = crypto.createHash('sha256').update(sessionKey).digest();
            const ivlen = pluginName === 'ChaCha64' ? 8 : (iv ? iv.length : 16);

            this.encryptCipher = new ChaChaCipher(stretchedKey, iv, ivlen, true);
            this.decryptCipher = new ChaChaCipher(stretchedKey, iv, ivlen, false);
        } else {
            throw new Error('Unsupported encryption plugin: ' + pluginName);
        }
    }

    /**
     * Proxy trap.
     */
    get(target: any, field: string | symbol): any {
        if (field in this) {
            return this[field].bind(this);
        }

        if (typeof target[field] === 'function') {
            return target[field].bind(target);
        }

        return target[field];
    }
}

export = Socket;
