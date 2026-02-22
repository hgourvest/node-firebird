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

class SQLVarText {
    decode(data, lowerV13) {
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
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_text);
        blr.addWord(this.length);
    }
}

//------------------------------------------------------

class SQLVarNull extends SQLVarText {
}

//------------------------------------------------------

class SQLVarString {
    decode(data, lowerV13) {
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
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_varying);
        blr.addWord(this.length);
    }
}

//------------------------------------------------------

class SQLVarQuad {
    decode(data, lowerV13) {
        var ret = data.readQuad();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }
        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

class SQLVarBlob extends SQLVarQuad {
    calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

class SQLVarArray extends SQLVarQuad {
    calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

class SQLVarInt {
    decode(data, lowerV13) {
        var ret = data.readInt();

        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_long);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

class SQLVarShort extends SQLVarInt {
    calcBlr(blr) {
        blr.addByte(Const.blr_short);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

class SQLVarInt64 {
    decode(data, lowerV13) {
        var ret = data.readInt64();

        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }
        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_int64);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

class SQLVarInt128 {
    decode(data, lowerV13) {
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
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_int128);
        blr.addShort(this.scale);
    }
}

//------------------------------------------------------

class SQLVarDecFloat16 {
    decode(data, lowerV13) {
        var ret = data.readDecFloat16();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_dec64);
        blr.addShort(0);
    }
}

//------------------------------------------------------

class SQLVarDecFloat34 {
    decode(data, lowerV13) {
        var ret = data.readDecFloat34();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_dec128);
        blr.addShort(0);
    }
}

//------------------------------------------------------

class SQLVarFloat {
    decode(data, lowerV13) {
        var ret = data.readFloat();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_float);
    }
}

//------------------------------------------------------

class SQLVarDouble {
    decode(data, lowerV13) {
        var ret = data.readDouble();

        if (!lowerV13 || !data.readInt()) {
            return ret;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_double);
    }
}

//------------------------------------------------------

class SQLVarDate {
    decode(data, lowerV13) {
        var ret = data.readInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((ret - DateOffset) * TimeCoeff + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_sql_date);
    }
}

//------------------------------------------------------

class SQLVarTime {
    decode(data, lowerV13) {
        var ret = data.readUInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds(Math.floor(ret / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }
        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_sql_time);
    }
}

//------------------------------------------------------

class SQLVarTimeStamp {
    decode(data, lowerV13) {
        var date = data.readInt();
        var time = data.readUInt();

        if (!lowerV13 || !data.readInt()) {
            var d = new Date(0);
            d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
            return d;
        }

        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_timestamp);
    }
}

//------------------------------------------------------

class SQLVarBoolean {
    decode(data, lowerV13) {
        var ret = data.readInt();

        if (!lowerV13 || !data.readInt()) {
            return Boolean(ret);
        }
        return null;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_bool);
    }
}

//------------------------------------------------------

class SQLParamInt {
    constructor(value) {
        this.value = value;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_long);
        blr.addShort(0);
    }

    encode(data) {
        if (this.value != null) {
            data.addInt(this.value);
        } else {
            data.addInt(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

class SQLParamInt64 {
    constructor(value) {
        this.value = value;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_int64);
        blr.addShort(0);
    }

    encode(data) {
        if (this.value != null) {
            data.addInt64(this.value);
        } else {
            data.addInt64(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

class SQLParamInt128 {
    constructor(value) {
        this.value = value;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_int128);
        blr.addShort(0);
    }

    encode(data) {
        if (this.value != null) {
            data.addInt128(this.value);
        } else {
            data.addInt128(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

class SQLParamDecFloat16 {
    constructor(value) {
        this.value = value;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_dec64);
        blr.addShort(0);
    }

    encode(data) {
        if (this.value != null) {
            data.addDecFloat16(this.value);
        } else {
            data.addDecFloat16(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

class SQLParamDecFloat34 {
    constructor(value) {
        this.value = value;
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_dec128);
        blr.addShort(0);
    }

    encode(data) {
        if (this.value != null) {
            data.addDecFloat34(this.value);
        } else {
            data.addDecFloat34(0);
            data.addInt(1);
        }
    }
}

//------------------------------------------------------

class SQLParamDouble {
    constructor(value) {
        this.value = value;
    }

    encode(data) {
        if (this.value != null) {
            data.addDouble(this.value);
        } else {
            data.addDouble(0);
            data.addInt(1);
        }
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_double);
    }
}

//------------------------------------------------------

class SQLParamString {
    constructor(value) {
        this.value = value;
    }

    encode(data) {
        if (this.value != null) {
            data.addText(this.value, Const.DEFAULT_ENCODING);
        } else {
            data.addInt(1);
        }
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_text);
        var len = this.value ? Buffer.byteLength(this.value, Const.DEFAULT_ENCODING) : 0;
        blr.addWord(len);
    }
}

//------------------------------------------------------

class SQLParamQuad {
    constructor(value) {
        this.value = value;
    }

    encode(data) {
        if (this.value != null) {
            data.addInt(this.value.high);
            data.addInt(this.value.low);
        } else {
            data.addInt(0);
            data.addInt(0);
            data.addInt(1);
        }
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
    }
}

//------------------------------------------------------

class SQLParamDate {
    constructor(value) {
        this.value = value;
    }

    encode(data) {
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
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_timestamp);
    }
}

//------------------------------------------------------

class SQLParamBool {
    constructor(value) {
        this.value = value;
    }

    encode(data) {
        if (this.value != null) {
            data.addInt(this.value ? 1 : 0);
        } else {
            data.addInt(0);
            data.addInt(1);
        }
    }

    calcBlr(blr) {
        blr.addByte(Const.blr_short);
        blr.addShort(0);
    }
}

module.exports = {
    SQLVarArray,
    SQLVarDate,
    SQLVarBlob,
    SQLVarBoolean,
    SQLVarDouble,
    SQLVarInt,
    SQLVarInt64,
    SQLVarInt128,
    SQLVarDecFloat16,
    SQLVarDecFloat34,
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
    SQLParamDecFloat16,
    SQLParamDecFloat34,
    SQLParamQuad,
    SQLParamString,
};
