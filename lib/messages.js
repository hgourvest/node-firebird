var fs = require('fs');

//const ISC_MASK   = 0x14000000; // Defines the code as a valid ISC code
const FAC_MASK   = 0x00FF0000; // Specifies the facility where the code is located
const CODE_MASK  = 0x0000FFFF; // Specifies the code in the message file
const CLASS_MASK = 0xF0000000; // Defines the code as warning, error, info, or other

var msgNumber = exports.msgNumber = function(facility, code) {
  return (facility * 10000 + code);
};

var getCode = exports.getCode = function(code) {
  return (code & CODE_MASK);
};

var getFacility = exports.getFacility =  function(code) {
  return (code & FAC_MASK) >> 16;
};

exports.getClass = function(code) {
  return (code & CLASS_MASK) >> 30;
};

exports.lookupMessages = function(status, callback) {

  var handle;
  var bucketSize;
  var topTree;
  var levels;
  var buffer;

  function lookup(item, callback) {

    var code = msgNumber(getFacility(item.gdscode), getCode(item.gdscode));

    function readIndex(stackSize, position) {

      function readNode(from) {
        var ret = {};
        ret.code = buffer.readUInt32LE(from);
        ret.seek = buffer.readUInt32LE(from + 4);
        return ret;
      }

      fs.read(handle, buffer, 0, bucketSize, position, function(err, bufferSize) {

        if (bufferSize <= 0) {
          callback();
          return;
        }

        if (stackSize === levels) {
          search();
          return;
        }

        var from = 0;
        var node = readNode(from);

        while (true) {

          if (node.code >= code)
          {
            readIndex(stackSize + 1, node.seek);
            break;
          }

          from += 8;
          if (from >= bufferSize)
          {
            callback();
            break;
          }

          node = readNode(from);
        }
      });
    }

    function search() {

      function readRec(from) {

        function align(v) {
                  return (v + 3) & ~3;
                }

        var ret = {};
        ret.code = buffer.readUInt32LE(from);
        ret.length = buffer.readUInt16LE(from + 4);

        from += 8;
        if (ret.code == code) {
          ret.text = buffer.toString(null, from, from + ret.length);
        } else
          ret.seek = from + align(8 + ret.length, 4);

        return ret;
      }

      var rec = readRec(0);

      while (rec.seek) {
        if (rec.seek >= buffer.length)
          break;
        else
          rec = readRec(rec.seek);
      }

      var str = rec.text;
      if (item.params) {
        for (var i = 0; i < item.params.length; i++)
          str = str.replace('@' + String(i + 1), item.params[i]);
      }

      callback(str);
    }

    readIndex(1, topTree);
  }

  fs.open(__dirname + '/firebird.msg', 'r', function(err, h) {

    if (!h) {
      callback();
      return;

    }

    buffer = new Buffer(14);
    fs.read(h, buffer, 0, 14, 0, function() {

      handle = h;
      bucketSize = buffer.readUInt16LE(2);
      topTree = buffer.readUInt32LE(4);
      levels = buffer.readUInt16LE(12);
      buffer = new Buffer(bucketSize);

      var i = 0;
      var text;

      function loop() {
        lookup(status[i], function(line) {
          if (text)
            text = text + ', ' + line;
          else
          text = line;

          if (i === status.length - 1) {
            fs.close(handle);
            callback(text);
          } else {
            i++;
            loop();
          }
        });
      }

      loop(0);
    });
  });
};
