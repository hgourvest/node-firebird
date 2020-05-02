
var Long = require('long');

function align(n) {
    return (n + 3) & ~3;
}

/***************************************
 *
 *   BLR Writer
 *
 ***************************************/

const
    MAX_STRING_SIZE = 255;

var BlrWriter = exports.BlrWriter = function(size){
    this.buffer = Buffer.alloc(size || 32);
    this.pos = 0;
};

BlrWriter.prototype.addByte = function (b) {
    this.ensure(1);
    this.buffer.writeUInt8(b, this.pos);
    this.pos++;
};

BlrWriter.prototype.addShort = function (b) {
    this.ensure(1);
    this.buffer.writeInt8(b, this.pos);
    this.pos++;
};

BlrWriter.prototype.addSmall = function (b) {
    this.ensure(2);
    this.buffer.writeInt16LE(b, this.pos);
    this.pos += 2;
};

BlrWriter.prototype.addWord = function (b) {
    this.ensure(2);
    this.buffer.writeUInt16LE(b, this.pos);
    this.pos += 2;
};

BlrWriter.prototype.addInt32 = function (b) {
    this.ensure(4);
    this.buffer.writeUInt32LE(b, this.pos);
    this.pos += 4;
};

BlrWriter.prototype.addByteInt32 = function (c, b) {
    this.addByte(c);
    this.ensure(4);
    this.buffer.writeUInt32LE(b, this.pos);
    this.pos += 4;
};

BlrWriter.prototype.addNumeric = function (c, v) {

    if (v < 256){
        this.ensure(3);
        this.buffer.writeUInt8(c, this.pos);
        this.pos++;
        this.buffer.writeUInt8(1, this.pos);
        this.pos++;
        this.buffer.writeUInt8(v, this.pos);
        this.pos++;
        return;
    }

    this.ensure(6);
    this.buffer.writeUInt8(c, this.pos);
    this.pos++;
    this.buffer.writeUInt8(4, this.pos);
    this.pos++;
    this.buffer.writeInt32BE(v, this.pos);
    this.pos += 4;

};

BlrWriter.prototype.addBytes = function (b) {

    this.ensure(b.length);
    for (var i = 0, length = b.length; i < length; i++) {
        this.buffer.writeUInt8(b[i], this.pos);
        this.pos++;
    }
};

BlrWriter.prototype.addString = function (c, s, encoding) {
    this.addByte(c);

    var len = Buffer.byteLength(s, encoding);
    if (len > MAX_STRING_SIZE)
        throw new Error('blr string is too big');

    this.ensure(len + 1);
    this.buffer.writeUInt8(len, this.pos);
    this.pos++;
    this.buffer.write(s, this.pos, len, encoding);
    this.pos += len;
};

BlrWriter.prototype.addBuffer = function (b) {
    this.addSmall(b.length);
    this.ensure(b.length);
    b.copy(this.buffer, this.pos);
    this.pos += b.length;
};

BlrWriter.prototype.addString2 = function (c, s, encoding) {
    this.addByte(c);
    
    var len = Buffer.byteLength(s, encoding);
    if (len > MAX_STRING_SIZE* MAX_STRING_SIZE)
        throw new Error('blr string is too big');
    
    this.ensure(len + 2);
    this.buffer.writeUInt16LE(len, this.pos);
    this.pos += 2;
    this.buffer.write(s, this.pos, len, encoding);
    this.pos += len;
};

BlrWriter.prototype.addBuffer = function (b) {
    this.addSmall(b.length);
    this.ensure(b.length);
    b.copy(this.buffer, this.pos);
    this.pos += b.length;
};

/***************************************
 *
 *   BLR Reader
 *
 ***************************************/

var BlrReader = exports.BlrReader = function(buffer) {
    this.buffer = buffer;
    this.pos = 0;
};

BlrReader.prototype.readByteCode = function(){
    return this.buffer.readUInt8(this.pos++);
};

BlrReader.prototype.readInt32 = function () {
    var value = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
}

BlrReader.prototype.readInt = function(){
    var len = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    var value;
    switch (len) {
        case 1:
            value = this.buffer.readInt8(this.pos);
            break;
        case 2:
            value = this.buffer.readInt16LE(this.pos);
            break;
        case 4:
            value = this.buffer.readInt32LE(this.pos)
    }
    this.pos += len;
    return value;
};

BlrReader.prototype.readString = function(encoding){

    var len = this.buffer.readUInt16LE(this.pos);
    var str;

    this.pos += 2;
    if (len <= 0)
        return '';

    str = this.buffer.toString(encoding, this.pos, this.pos + len);
    this.pos += len;
    return str;
};

BlrReader.prototype.readSegment = function() {

    var ret, tmp;
    var len = this.buffer.readUInt16LE(this.pos);

    this.pos += 2;

    while (len > 0) {

        if (ret) {
            tmp = ret;
            ret = Buffer.alloc(tmp.length + len);
            tmp.copy(ret);
            this.buffer.copy(ret, tmp.length, this.pos, this.pos + len);
        } else {
            ret = Buffer.alloc(len);
            this.buffer.copy(ret, 0, this.pos, this.pos + len);
        }

        this.pos += len;

        if (this.pos === this.buffer.length)
            break;

        len = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
    }

    return ret;
};

/***************************************
 *
 *   XDR Writer
 *
 ***************************************/

var XdrWriter = exports.XdrWriter = function(size){
    this.buffer = Buffer.alloc(size || 32);
    this.pos = 0;
};

XdrWriter.prototype.ensure = BlrWriter.prototype.ensure = function (len) {
    var newlen = this.buffer.length;

    while (newlen < this.pos + len)
        newlen *= 2

    if (this.buffer.length >= newlen)
        return;

    var b = Buffer.alloc(newlen);
    this.buffer.copy(b);
    delete(this.buffer);
    this.buffer = b;
};

XdrWriter.prototype.addInt = function (value) {
    this.ensure(4);
    this.buffer.writeInt32BE(value, this.pos);
    this.pos += 4;
};

XdrWriter.prototype.addInt64 = function (value) {
    this.ensure(8);
    var l = Long.fromNumber(value);
    this.buffer.writeInt32BE(l.high, this.pos);
    this.pos += 4;
    this.buffer.writeInt32BE(l.low, this.pos);
    this.pos += 4;
};

XdrWriter.prototype.addUInt = function (value) {
    this.ensure(4);
    this.buffer.writeUInt32BE(value, this.pos);
    this.pos += 4;
};

XdrWriter.prototype.addString = function(s, encoding) {
    var len = Buffer.byteLength(s, encoding);
    var alen = align(len);
    this.ensure(alen + 4);
    this.buffer.writeInt32BE(len, this.pos);
    this.pos += 4;
    this.buffer.write(s, this.pos, len, encoding);
    this.pos += alen;
};

XdrWriter.prototype.addText = function(s, encoding) {
    var len = Buffer.byteLength(s, encoding);
    var alen = align(len);
    this.ensure(alen);
    this.buffer.write(s, this.pos, len, encoding);
    this.pos += alen;
};

XdrWriter.prototype.addBlr = function(blr) {
    var alen = align(blr.pos);
    this.ensure(alen + 4);
    this.buffer.writeInt32BE(blr.pos, this.pos);
    this.pos += 4;
    blr.buffer.copy(this.buffer, this.pos);
    this.pos += alen;
};

XdrWriter.prototype.getData = function() {
    return this.buffer.slice(0, this.pos);
};

XdrWriter.prototype.addDouble = function(value) {
    this.ensure(8);
    this.buffer.writeDoubleBE(value, this.pos);
    this.pos += 8;
};

XdrWriter.prototype.addQuad = function(quad) {
    this.ensure(8);
    var b = this.buffer;
    b.writeInt32BE(quad.high, this.pos);
    this.pos += 4;
    b.writeInt32BE(quad.low, this.pos);
    this.pos += 4;
};

/***************************************
 *
 *   XDR Reader
 *
 ***************************************/

var XdrReader = exports.XdrReader = function(buffer){
    this.buffer = buffer;
    this.pos = 0;
};

XdrReader.prototype.readInt = function () {
    var r = this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    return r;
};

XdrReader.prototype.readUInt = function () {
    var r = this.buffer.readUInt32BE(this.pos);
    this.pos += 4;
    return r;
};

XdrReader.prototype.readInt64 = function () {
    var high = this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    var low = this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    return new Long(low, high).toNumber();
};

XdrReader.prototype.readShort = function () {
    var r = this.buffer.readInt16BE(this.pos);
    this.pos += 2;
    return r;
};

XdrReader.prototype.readQuad = function () {
    var b = this.buffer;
    var high = b.readInt32BE(this.pos);
    this.pos += 4;
    var low = b.readInt32BE(this.pos);
    this.pos += 4;
    return {low: low, high: high}
};

XdrReader.prototype.readFloat = function () {
    var r = this.buffer.readFloatBE(this.pos);
    this.pos += 4;
    return r;
};

XdrReader.prototype.readDouble = function () {
    var r = this.buffer.readDoubleBE(this.pos);
    this.pos += 8;
    return r;
};

XdrReader.prototype.readArray = function () {
    var len = this.readInt();
    if (!len)
        return;
    var r = this.buffer.slice(this.pos, this.pos + len);
    this.pos += align(len);
    return r;
};

XdrReader.prototype.readBuffer = function (len) {
    if (!arguments.length)
       len = this.readInt();

    if (!len)
        return;

    var r = this.buffer.slice(this.pos, this.pos + len);
    this.pos += align(len);
    return r;
};

XdrReader.prototype.readString = function (encoding) {
    var len = this.readInt();
    return this.readText(len, encoding);
};

XdrReader.prototype.readText = function (len, encoding) {
    if (len <= 0)
        return '';

    var r = this.buffer.toString(encoding, this.pos, this.pos + len);
    this.pos += align(len);
    return r;
};
