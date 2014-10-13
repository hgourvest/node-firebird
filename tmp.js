function fetchBlobs(statement, transaction, rows, callback) {

    if (!(rows.data && rows.data.length)) {
        callback(undefined, rows);
        return;
    }

    var indexes = [];
    var names = [];

    for (var i = 0, length = statement.output.length; i < length; i++) {
        if (statement.output[i].type !== SQL_BLOB)
            continue;
        names.push(statement.custom.asObject ? statement.output[i].alias.toLowerCase() : i);
        indexes.push(i);
    }

    if (!indexes.length) {
        callback(undefined, rows);
        return;
    }

    function fetch(row, col, index, callback) {

        var blobid = rows.data[row][col];

        if (!blobid) {
            callback();
            return;
        }

        statement.connection.openBlob(blobid, transaction, function(err, blob) {

            if (err) {
                callback(err);
                return;
            }

            var buffer;

            function read() {

                statement.connection.getSegment(blob, function(err, ret) {

                    if (err) {
                        callback(err);
                        return;
                    }

                    var blr = new BlrReader(ret.buffer);
                    var data = blr.readSegment();

                    // TODO: data

                    if (buffer) {
                        var tmp = buffer;
                        buffer = new Buffer(tmp.length + data.length);
                        tmp.copy(buffer);
                        data.copy(buffer, tmp.length);
                    } else
                        buffer = data;

                    if (ret.handle === 2) { // ??? TODO: === or ==

                        if (statement.output[index].subType === isc_blob_text) { // TODO: === or ==
                            if (buffer)
                                rows.data[row][col] = buffer.toString(DEFAULT_ENCODING);
                            else
                                rows.data[row][col] = null;
                        } else
                            rows.data[row][col] = buffer

                        callback();
                        statement.connection.closeBlob(blob);
                    } else
                        read();
                });
            }
            read();
        });
    }

    var count = rows.data.length * indexes.length;
    for (var r = 0, length = rows.data.length; r < length; r++) {
        for (var c = 0, sublength = indexes.length; c < sublength; c++) {
            fetch(r, names[c], indexes[c], function(err) {
                if (!err) {
                    count--;
                    if (count === 0)
                       callback(undefined, rows)
                } else
                    callback(err);
            });
        }
    }
}