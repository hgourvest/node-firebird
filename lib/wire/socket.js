const net = require("net");
const zlib = require("zlib");

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

        return new Proxy(this._socket, this);
    }

    /**
     * Decompress data when receive it if compression is enabled.
     * Override on data event.
     */
    on(event, cb) {
        if (event === 'data') {
            const mainCb = cb;
            cb = (data) => {
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
     * Compress data before sending to socket if compression is enabled.
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
                this._socket.write(Buffer.concat(this.compressorBuffer));
                this.compressorBuffer = []; // Reset buffer
            });
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
