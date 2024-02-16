function doError(obj, callback) {
    if (callback)
        callback(obj)
}

function isError(obj) {
    return Boolean(
        obj != null && typeof obj === "object" && !Array.isArray(obj) && obj.status
    );
}

function doCallback(obj, callback) {

    if (!callback)
        return;

    if (obj instanceof Error) {
        callback(obj);
        return;
    }

    if (isError(obj)) {
        var error = new Error(obj.message);
        var status = obj.status && obj.status.length && obj.status[0] || {};
        error.gdscode = status.gdscode; // main error gds code
        error.gdsparams = status.params; // parameters (constraint name, table, etc.)
        callback(error);
        return;
    }

    callback(undefined, obj);

}

module.exports = {
    doError,
    doCallback
}
