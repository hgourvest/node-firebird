import net from 'net';
import { XdrReader } from './serialize';
import Const from './const';

const DEFAULT_ENCODING = 'utf8';

class EventConnection {
    db: any;
    emgr: any;
    _isClosed: boolean;
    _isOpened: boolean;
    _socket: net.Socket;
    _xdr?: XdrReader;
    error: any;
    eventcallback: ((err: any, ret?: any) => void) | null;
    _connectSettled: boolean;
    _terminalErrorReported: boolean;

    constructor(host: string, port: number, callback: ((err?: Error) => void) | undefined, db: any) {
        var self = this;
        this.db = db;
        this.emgr = null;
        this._isClosed = false;
        this._isOpened = false;
        this._connectSettled = false;
        this._terminalErrorReported = false;
        this._socket = net.createConnection(port, host);
        this._bind_events(host, port, callback);
        this.error = null;
        this.eventcallback = null;
    }

    _bind_events(host: string, port: number, callback?: (err?: Error) => void): void {
        var self = this;

        function finishConnect(err?: Error) {
            if (self._connectSettled) return;
            self._connectSettled = true;
            if (callback) callback(err);
        }

        function reportTerminalError(err: Error) {
            if (self._terminalErrorReported) return;
            self._terminalErrorReported = true;
            const wasOpened = self._isOpened;
            self.error = err;
            self._isClosed = true;
            self._isOpened = false;

            if (!wasOpened) {
                finishConnect(err);
            } else if (self.eventcallback) {
                self.eventcallback(err);
            } else if (self.db && self.db.connection && typeof self.db.connection._emitError === 'function') {
                self.db.connection._emitError(err);
            }

            if (!self._socket.destroyed) self._socket.destroy();
        }

        self._socket.on('close', function () {
            self._isClosed = true;
            if (!self._isOpened) {
                finishConnect(self.error || new Error(`Event connection to ${host}:${port} closed before connecting.`));
            } else if (self.eventcallback && !self._terminalErrorReported) {
                reportTerminalError(new Error(`Event connection to ${host}:${port} closed unexpectedly.`));
            }
            self._isOpened = false;
        })

        self._socket.on('error', function (e) {
            reportTerminalError(e);
        })

        self._socket.on('connect', function () {
            self._isClosed = false;
            self._isOpened = true;
            finishConnect();
        });

        self._socket.on('data', function (data: Buffer) {
            var xdr: XdrReader, buf: Buffer | undefined;

            if (!self._xdr) {
                xdr = new XdrReader(data);
            } else {
                xdr = self._xdr;
                delete (self._xdr);
                buf = Buffer.alloc(data.length + xdr.buffer.length);
                xdr.buffer.copy(buf);
                data.copy(buf, xdr.buffer.length);
                xdr.buffer = buf;
            }

            var op_pos = xdr.pos;

            try {

                var tmp_event: Record<string, number>;
                while (xdr.pos < xdr.buffer.length) {
                    op_pos = xdr.pos;
                    do {
                        var r = xdr.readInt();
                    } while (r === Const.op_dummy);

                    switch (r) {
                        case Const.op_event:
                            xdr.readInt(); // db handle
                            // op_event always carries a payload; readArray only
                            // returns undefined for zero-length arrays
                            buf = xdr.readArray()!;
                            // first byte is always set to 1
                            tmp_event = {};
                            var lst_event: { name: string; count: number }[] = [];
                            var eventname = '';
                            var eventcount = 0;
                            var pos = 1;
                            while (pos < buf.length) {
                                var len = buf.readUInt8(pos++);
                                if (pos + len + 4 > buf.length) throw new RangeError('Incomplete event payload');
                                eventname = buf.toString(DEFAULT_ENCODING, pos, pos + len);
                                var prevcount = self.emgr.events[eventname] || 0;
                                pos += len;
                                eventcount = buf.readInt32LE(pos);
                                tmp_event[eventname] = eventcount;
                                pos += 4;
                                if (prevcount !== eventcount)
                                    lst_event.push({ name: eventname, count: eventcount });
                            }
                            xdr.readInt64(); // ignore AST INFO
                            var event_id = xdr.readInt();
                            // set the new count in global event hash
                            // Only update events that are still registered; do not
                            // re-add events that unregisterEvent() has deleted, since
                            // that would cause subscribe() to re-subscribe for them.
                            for (var evt in tmp_event) {
                                if (Object.prototype.hasOwnProperty.call(self.emgr.events, evt)) {
                                    self.emgr.events[evt] = tmp_event[evt];
                                }
                            }
                            if (self.eventcallback)
                                self.eventcallback(null, { eventid: event_id, events: lst_event });
                            break;
                        default:
                            reportTerminalError(new Error('Unexpected event connection opcode: ' + r));
                            return;
                    }
                }
            } catch (err) {
                if (err instanceof RangeError) { // incomplete packet case
                    xdr.buffer = xdr.buffer = xdr.buffer.slice(op_pos);
                    xdr.pos = 0;
                    self._xdr = xdr;
                } else {
                    reportTerminalError(err instanceof Error ? err : new Error(String(err)));
                }
            }
        })
    }

    throwClosed(callback?: (err: any) => void): this {
        var err = new Error('Event Connection is closed.');
        if (callback)
            callback(err);
        return this;
    }
}

export = EventConnection;
