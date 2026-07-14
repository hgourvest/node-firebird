/***************************************
 *
 *   Connection URI strings
 *
 ***************************************/

import type { Options } from './types';

/**
 * Option keys coerced to boolean when they arrive as URI query parameters.
 * "1"/"true"/"yes"/"on" (case-insensitive) → true, everything else → false.
 */
const BOOLEAN_KEYS = new Set([
    'lowercase_keys', 'blobAsText', 'wireCompression', 'manager',
]);

/** Option keys coerced to number when they arrive as URI query parameters. */
const NUMBER_KEYS = new Set([
    'port', 'pageSize', 'timeout', 'retryConnectionInterval',
    'blobChunkSize', 'blobReadChunkSize', 'wireCrypt', 'parallelWorkers',
    'maxInlineBlobSize', 'maxNegotiatedProtocols', 'connectTimeout',
    'min', 'idleTimeoutMillis',
]);

function coerce(key: string, value: string): any {
    if (BOOLEAN_KEYS.has(key)) {
        return /^(1|true|yes|on)$/i.test(value);
    }
    if (NUMBER_KEYS.has(key)) {
        var n = Number(value);
        if (Number.isNaN(n)) {
            throw new Error('Invalid numeric value for connection URI option "' + key + '": ' + value);
        }
        return n;
    }
    return value;
}

/**
 * Parse a firebird:// connection URI into an options object.
 *
 *   firebird://user:password@host:port/database?option=value&...
 *
 * The database part:
 *   firebird://host/employee              → alias "employee"
 *   firebird://host//var/db/prod.fdb      → absolute path "/var/db/prod.fdb"
 *   firebird://host/var/db/prod.fdb       → "/var/db/prod.fdb" (a database
 *                                           part with slashes is a path —
 *                                           aliases cannot contain "/")
 *   firebird://host/C:/db/prod.fdb        → Windows path "C:/db/prod.fdb"
 *
 * Credentials and the database path are URL-decoded, so reserved characters
 * can be percent-encoded (e.g. p%40ss for "p@ss"). Query parameters map
 * 1:1 to option keys and are coerced to the option's type (booleans accept
 * 1/true/yes/on). `user` and `password` may be given as query parameters
 * instead of in the authority.
 */
export function parseConnectionUri(uri: string): Options {
    var url: URL;
    try {
        url = new URL(uri);
    } catch (e) {
        throw new Error('Invalid connection URI: ' + uri);
    }

    if (url.protocol !== 'firebird:') {
        throw new Error('Unsupported connection URI scheme "' + url.protocol.replace(/:$/, '') +
            '" (expected firebird://...)');
    }

    var options: any = {};

    if (url.hostname) {
        // URL keeps IPv6 hostnames bracketed ([::1]); net.connect wants them bare
        options.host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    }
    if (url.port) {
        options.port = Number(url.port);
    }
    if (url.username) {
        options.user = decodeURIComponent(url.username);
    }
    if (url.password) {
        options.password = decodeURIComponent(url.password);
    }

    var database = decodeURIComponent(url.pathname || '');
    if (database.startsWith('/')) {
        database = database.slice(1);
    }
    // A database part with path separators is a filesystem path, not an
    // alias (aliases cannot contain "/") — restore the leading slash unless
    // it is a Windows drive path or already absolute (double-slash form).
    if (database.includes('/') && !database.startsWith('/') && !/^[A-Za-z]:\//.test(database)) {
        database = '/' + database;
    }
    if (database) {
        options.database = database;
    }

    url.searchParams.forEach(function(value, key) {
        options[key] = coerce(key, value);
    });

    return options as Options;
}

/**
 * Accept either an options object or a firebird:// URI string everywhere
 * options are taken. Strings are parsed; objects pass through unchanged.
 */
export function normalizeOptions<T>(options: T | string): T {
    if (typeof options === 'string') {
        return parseConnectionUri(options) as T;
    }
    return options;
}
