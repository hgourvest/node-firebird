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

/**
 * Normalize the values the driver passes as the callback error argument.
 * Most code paths already deliver Error instances, but a few older ones
 * pass plain objects (status vectors, `{error, message}` wrappers).  A
 * Promise must reject with an Error, so wrap those while preserving all
 * their properties (gdscode, gdsparams, status, sqlcode, ...).
 */
export function toError(err: any): Error {
    if (err instanceof Error)
        return err;

    var error: FbError = new Error(
        err != null && typeof err === 'object' && err.message ? err.message : String(err)
    );

    if (err != null && typeof err === 'object')
        Object.assign(error, err);

    return error;
}

/**
 * Run a callback-style operation and return a Promise for its result.
 * Usage: fromCallback<Database>(cb => attach(options, cb))
 */
/**
 * Run `work` with a pooled connection and always return it to its pool
 * (detach) when the promise settles — a detach hiccup never masks the
 * outcome of `work`. Shared by Pool.withConnection and
 * PoolCluster.withConnection so the release semantics cannot drift.
 */
export async function withPooledConnection<T>(getAsync: () => Promise<any>, work: (db: any) => Promise<T> | T): Promise<T> {
    const db = await getAsync();
    try {
        return await work(db);
    } finally {
        await new Promise<void>(function(resolve) { db.detach(function() { resolve(); }); });
    }
}

export function fromCallback<T = any>(executor: (cb: Callback<T>) => void): Promise<T> {
    return new Promise<T>(function(resolve, reject) {
        executor(function(err?: any, result?: T) {
            if (err)
                reject(toError(err));
            else
                resolve(result as T);
        });
    });
}

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
