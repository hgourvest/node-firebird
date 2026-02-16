const net = require("net");
const zlib = require("zlib");
const crypto = require("crypto");

/**
 * Arc4 stream cipher for Firebird wire encryption.
 * Uses the SRP session key to create RC4 encryption/decryption streams.
 */
class Arc4 {
    constructor(key) {
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
    transform(data) {
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
 * Socket proxy.
 */
class Socket {
    constructor(port, host) {
        this._socket = net.createConnection(port, host);
        this._socket.setNoDelay(true);
        this.compressor = null;
        this.compressorBuffer = [];
        this.decompressor = null;
        this.decompressorBuffer = [];
        this.buffer = null;
        this.encrypt = false;
        this.encryptCipher = null;
        this.decryptCipher = null;

        return new Proxy(this._socket, this);
    }

    /**
     * Decompress and/or decrypt data when received.
     * Override on data event.
     */
    on(event, cb) {
        if (event === 'data') {
            const mainCb = cb;
            cb = (data) => {
                // Decrypt first if encryption is enabled
                if (this.encrypt) {
                    data = this.decryptCipher.transform(data);
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
    write(data, defer = false) {
        if (defer) {
            this.buffer = Buffer.from(data);
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
            this._socket.write(this.encryptCipher.transform(data));
        } else {
            this._socket.write(data);
        }
    }

    /**
     * Enable compression/decompression on the fly.
     */
    enableCompression() {
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
     * Enable encryption/decryption using Arc4 cipher.
     * @param {Buffer} sessionKey - The session key from SRP authentication.
     */
    enableEncryption(sessionKey) {
        this.encrypt = true;
        this.encryptCipher = new Arc4(sessionKey);
        this.decryptCipher = new Arc4(sessionKey);
    }

    /**
     * Proxy trap.
     */
    get(target, field) {
        if (field in this) {
            return this[field].bind(this);
        }

        return target[field];
    }
}

module.exports = Socket;
module.exports.Arc4 = Arc4;
