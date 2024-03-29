const net = require('net');
const { XdrReader } = require('./serialize');
const DEFAULT_ENCODING = 'utf8';
const Const = require('./const');

var EventConnection = function (host, port, callback, db) {
    var self = this;
    this.db = db;
    this.emgr = null;
    this._isClosed = false;
    this._isOpened = false;
    this._socket = net.createConnection(port, host);
    this._bind_events(host, port, callback);
    this.error;
    this.eventcallback;
};

EventConnection.prototype._bind_events = function (host, port, callback) {
    var self = this;

    self._socket.on('close', function () {

        self._isClosed = true;
    })

    self._socket.on('error', function (e) {

        self.error = e;
    })

    self._socket.on('connect', function () {
        self._isClosed = false;
        self._isOpened = true;
        if (callback)
            callback();
    });

    self._socket.on('data', function (data) {
        var xdr, buf;

        if (!self._xdr) {
            xdr = new XdrReader(data);
        } else {
            xdr = self._xdr;
            delete (self._xdr);
            buf = Buffer.from(data.length + xdr.buffer.length);
            xdr.buffer.copy(buf);
            data.copy(buf, xdr.buffer.length);
            xdr.buffer = buf;
        }

        try {
            var item, op;
            var op_pos = xdr.pos;
            var tmp_event;
            while (xdr.pos < xdr.buffer.length) {
                do {
                    var r = xdr.readInt();
                } while (r === Const.op_dummy);

                switch (r) {
                    case Const.op_event:
                        xdr.readInt(); // db handle
                        var buf = xdr.readArray();
                        // first byte is always set to 1
                        tmp_event = {};
                        var lst_event = [];
                        var eventname = '';
                        var eventcount = 0;
                        var pos = 1;
                        while (pos < buf.length) {
                            var len = buf.readInt8(pos++);
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
                        for (var evt in tmp_event) {
                            self.emgr.events[evt] = tmp_event[evt];
                        }
                        if (self.eventcallback)
                            return self.eventcallback(null, { eventid: event_id, events: lst_event });

                    default:
                        return cb(new Error('Unexpected:' + r));
                }
            }
        } catch (err) {
            if (err instanceof RangeError) { // incomplete packet case
                xdr.buffer = xdr.buffer = xdr.buffer.slice(op_pos);
                xdr.pos = 0;
                self._xdr = xdr;
            }
        }
    })
}

EventConnection.prototype.throwClosed = function (callback) {
    var err = new Error('Event Connection is closed.');
    this.db.emit('error', err);
    if (callback)
        callback(err);
    return this;
};

module.exports = EventConnection;