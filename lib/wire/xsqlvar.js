const Const= require('./const');

/***************************************
 *
 *   SQLVar
 *
 ***************************************/

const
    ScaleDivisor = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000, 100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
const
    DateOffset = 40587,
    TimeCoeff = 86400000,
    MsPerMinute = 60000;

//------------------------------------------------------

function SQLVarText() {}

SQLVarText.prototype.decode = function(data, lowerV13) {
    let ret;
    if (this.subType > 1) {
        // ToDo: with column charset
        ret = data.readText(this.length, Const.DEFAULT_ENCODING);
    } else if (this.subType === 0) {
        // without charset definition
        ret = data.readText(this.length, Const.DEFAULT_ENCODING);
    } else {
        ret = data.readBuffer(this.length);
    }

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarText.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_text);
    blr.addWord(this.length);
};

//------------------------------------------------------

function SQLVarNull() {}
SQLVarNull.prototype = new SQLVarText();
SQLVarNull.prototype.constructor = SQLVarNull;

//------------------------------------------------------

function SQLVarString() {}

SQLVarString.prototype.decode = function(data, lowerV13) {
    let ret;
    if (this.subType > 1) {
        // ToDo: with column charset
        ret = data.readString(Const.DEFAULT_ENCODING);
    } else if (this.subType === 0) {
        // without charset definition
        ret = data.readString(Const.DEFAULT_ENCODING);
    } else {
        ret = data.readBuffer();
    }

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarString.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_varying);
    blr.addWord(this.length);
};

//------------------------------------------------------

function SQLVarQuad() {}

SQLVarQuad.prototype.decode = function(data, lowerV13) {
    var ret = data.readQuad();

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarQuad.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_quad);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarBlob() {}
SQLVarBlob.prototype = new SQLVarQuad();
SQLVarBlob.prototype.constructor = SQLVarBlob;

SQLVarBlob.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLVarArray() {}
SQLVarArray.prototype = new SQLVarQuad();
SQLVarArray.prototype.constructor = SQLVarArray;

SQLVarArray.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLVarInt() {}

SQLVarInt.prototype.decode = function(data, lowerV13) {
    var ret = data.readInt();

    if (this.scale) {
        ret = ret / ScaleDivisor[Math.abs(this.scale)];
    }

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarInt.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_long);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarShort() {}
SQLVarShort.prototype = new SQLVarInt();
SQLVarShort.prototype.constructor = SQLVarShort;

SQLVarShort.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_short);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarInt64() {}

SQLVarInt64.prototype.decode = function(data, lowerV13) {
    var ret = data.readInt64();

    if (this.scale) {
        ret = ret / ScaleDivisor[Math.abs(this.scale)];
    }

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarInt64.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_int64);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarInt128() {}

SQLVarInt128.prototype.decode = function (data, lowerV13) {
    var retBigInt = BigInt(data.readInt128())

    if (retBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        var ret = retBigInt.toString();

        var integerPart = ret.slice(0, Math.abs(this.scale) * -1)
        var decimalPart = ret.slice(Math.abs(this.scale) * -1)

        if (integerPart === '') integerPart = '0'

        ret = `${integerPart}.${decimalPart}`
    } else {
        var ret = Number(retBigInt);
        ret = ret / ScaleDivisor[Math.abs(this.scale)];
    }

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarInt128.prototype.calcBlr = function (blr) {
    blr.addByte(Const.blr_int128);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarFloat() { }

SQLVarFloat.prototype.decode = function(data, lowerV13) {
    var ret = data.readFloat();

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarFloat.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_float);
};

//------------------------------------------------------

function SQLVarDouble() {}

SQLVarDouble.prototype.decode = function(data, lowerV13) {
    var ret = data.readDouble();

    if (!lowerV13 || !data.readInt()) {
        return ret;
    }

    return null;
};

SQLVarDouble.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_double);
};

//------------------------------------------------------

function SQLVarDate() {}

SQLVarDate.prototype.decode = function(data, lowerV13) {
    var ret = data.readInt();

    if (!lowerV13 || !data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds((ret - DateOffset) * TimeCoeff + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }

    return null;
};

SQLVarDate.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_sql_date);
};

//------------------------------------------------------

function SQLVarTime() {}

SQLVarTime.prototype.decode = function(data, lowerV13) {
    var ret = data.readUInt();

    if (!lowerV13 || !data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds(Math.floor(ret / 10) + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }
    return null;
};

SQLVarTime.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_sql_time);
};

//------------------------------------------------------

function SQLVarTimeStamp() {}

SQLVarTimeStamp.prototype.decode = function(data, lowerV13) {
    var date = data.readInt();
    var time = data.readUInt();

    if (!lowerV13 || !data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }

    return null;
};

SQLVarTimeStamp.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_timestamp);
};

//------------------------------------------------------

function SQLVarBoolean() {}

SQLVarBoolean.prototype.decode = function(data, lowerV13) {
    var ret = data.readInt();

    if (!lowerV13 || !data.readInt()) {
        return Boolean(ret);
    }
    return null;
};

SQLVarBoolean.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_bool);
};

//------------------------------------------------------

function SQLParamInt(value){
    this.value = value;
}

SQLParamInt.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_long);
    blr.addShort(0);
};

SQLParamInt.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value);
    } else {
        data.addInt(0);
        data.addInt(1);
    }
};

//------------------------------------------------------

function SQLParamInt64(value){
    this.value = value;
}

SQLParamInt64.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_int64);
    blr.addShort(0);
};

SQLParamInt64.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt64(this.value);
    } else {
        data.addInt64(0);
        data.addInt(1);
    }
};

//------------------------------------------------------

function SQLParamInt128(value) {
    this.value = value;
}

SQLParamInt128.prototype.calcBlr = function (blr) {
    blr.addByte(Const.blr_int128);
    blr.addShort(0);
};

SQLParamInt128.prototype.encode = function (data) {
    if (this.value != null) {
        data.addInt128(this.value);
    } else {
        data.addInt128(0);
        data.addInt(1);
    }
};

//------------------------------------------------------

function SQLParamDouble(value) {
    this.value = value;
}

SQLParamDouble.prototype.encode = function(data) {
    if (this.value != null) {
        data.addDouble(this.value);
    } else {
        data.addDouble(0);
        data.addInt(1);
    }
};

SQLParamDouble.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_double);
};

//------------------------------------------------------

function SQLParamString(value) {
    this.value = value;
}

SQLParamString.prototype.encode = function(data) {
    if (this.value != null) {
        data.addText(this.value, Const.DEFAULT_ENCODING);
    } else {
        data.addInt(1);
    }
};

SQLParamString.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_text);
    var len = this.value ? Buffer.byteLength(this.value, Const.DEFAULT_ENCODING) : 0;
    blr.addWord(len);
};

//------------------------------------------------------

function SQLParamQuad(value) {
    this.value = value;
}

SQLParamQuad.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value.high);
        data.addInt(this.value.low);
    } else {
        data.addInt(0);
        data.addInt(0);
        data.addInt(1);
    }
};

SQLParamQuad.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLParamDate(value) {
    this.value = value;
}

SQLParamDate.prototype.encode = function(data) {
    if (this.value != null) {

        var value = this.value.getTime() - this.value.getTimezoneOffset() * MsPerMinute;
        var time = value % TimeCoeff;
        var date = (value - time) / TimeCoeff + DateOffset;
        time *= 10;

        // check overflow
        if (time < 0) {
            date--;
            time = TimeCoeff*10 + time;
        }

        data.addInt(date);
        data.addUInt(time);
    } else {
        data.addInt(0);
        data.addUInt(0);
        data.addInt(1);
    }
};

SQLParamDate.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_timestamp);
};

//------------------------------------------------------

function SQLParamBool(value) {
    this.value = value;
}

SQLParamBool.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value ? 1 : 0);
    } else {
        data.addInt(0);
        data.addInt(1);
    }
};

SQLParamBool.prototype.calcBlr = function(blr) {
    blr.addByte(Const.blr_short);
    blr.addShort(0);
};

module.exports = {
    SQLVarArray,
    SQLVarDate,
    SQLVarBlob,
    SQLVarBoolean,
    SQLVarDouble,
    SQLVarInt,
    SQLVarInt64,
    SQLVarInt128,
    SQLVarFloat,
    SQLVarNull,
    SQLVarShort,
    SQLVarString,
    SQLVarText,
    SQLVarTime,
    SQLVarTimeStamp,
    SQLParamBool,
    SQLParamDate,
    SQLParamDouble,
    SQLParamInt,
    SQLParamInt64,
    SQLParamInt128,
    SQLParamQuad,
    SQLParamString,
};
