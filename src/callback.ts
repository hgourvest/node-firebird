/** A single Firebird status-vector entry (gds code plus optional parameters). */
export interface FbStatusItem {
    gdscode: number;
    params?: any[];
}

/** Error-like object produced by the wire protocol layer. */
export interface FbStatusObject {
    status?: FbStatusItem[];
    message?: string;
    sqlcode?: number;
}

/** An Error enriched with the Firebird gds code and its parameters. */
export interface FbError extends Error {
    gdscode?: number;
    gdsparams?: any[];
}

export type SimpleCallback = (err?: any) => void;
export type Callback<T = any> = (err?: any, result?: T) => void;

export function doError(obj: any, callback?: (...args: any[]) => void): void {
    if (callback)
        callback(obj)
}

function isError(obj: any): obj is FbStatusObject {
    return Boolean(
        obj != null && typeof obj === "object" && !Array.isArray(obj) && obj.status
    );
}

export function doCallback<T>(obj: T, callback?: Callback<T>): void {

    if (!callback)
        return;

    if (obj instanceof Error) {
        callback(obj);
        return;
    }

    if (isError(obj)) {
        var error: FbError = new Error(obj.message);
        var status = obj.status && obj.status.length && obj.status[0] || {} as FbStatusItem;
        error.gdscode = status.gdscode; // main error gds code
        error.gdsparams = status.params; // parameters (constraint name, table, etc.)
        callback(error);
        return;
    }

    callback(undefined, obj);

}
