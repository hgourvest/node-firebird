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
    'namedPlaceholders', 'enableKeepAlive',
]);

/** Option keys coerced to number when they arrive as URI query parameters. */
const NUMBER_KEYS = new Set([
    'port', 'pageSize', 'timeout', 'retryConnectionInterval',
    'blobChunkSize', 'blobReadChunkSize', 'wireCrypt', 'parallelWorkers',
    'maxInlineBlobSize', 'maxNegotiatedProtocols', 'connectTimeout',
    'min', 'idleTimeoutMillis', 'keepAliveInitialDelay',
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
 * Parse a traditional ("old style") Firebird connection string:
 *
 *   [host[/port]:]{path | alias}
 *
 *   employee                              → alias "employee" (default host)
 *   /var/fb/prod.fdb                      → local path (default host)
 *   C:\fbdata\prod.fdb                    → Windows path — a single character
 *                                           before ":" is a drive letter, not
 *                                           a host (same rule as Firebird)
 *   db.example.com:employee               → host + alias
 *   db.example.com/3051:/var/fb/prod.fdb  → host + port + path
 *   myserver:C:\fbdata\prod.fdb           → host + Windows path
 *   [::1]/3050:employee                   → IPv6 host + port + alias
 *
 * Unlike firebird:// URIs, traditional strings carry no credentials or
 * options — the driver defaults apply (SYSDBA/masterkey, port 3050).
 * The port must be numeric; /etc/services names are not resolved.
 */
export function parseOldStyleConnectionString(str: string): Options {
    var options: any = {};
    var host: string | null = null;
    var port: string | null = null;
    var database = str;

    var ipv6 = /^\[([^\]]+)\](?:\/([^:]*))?:(.*)$/.exec(str);
    if (ipv6) {
        host = ipv6[1];
        port = ipv6[2] !== undefined ? ipv6[2] : null;
        database = ipv6[3];
    } else {
        var colon = str.indexOf(':');
        if (colon === 0) {
            throw new Error('Invalid connection string (empty host): ' + str);
        }
        // colon === 1 → single character before ":" is a drive letter;
        // colon === -1 → no host part. Both leave the whole string as database.
        if (colon > 1) {
            var hostPart = str.slice(0, colon);
            database = str.slice(colon + 1);
            var slash = hostPart.indexOf('/');
            if (slash !== -1) {
                host = hostPart.slice(0, slash);
                port = hostPart.slice(slash + 1);
                if (!host) {
                    throw new Error('Invalid connection string (empty host): ' + str);
                }
            } else {
                host = hostPart;
            }
        }
    }

    if (!database) {
        throw new Error('Invalid connection string (empty database): ' + str);
    }

    if (host) {
        options.host = host;
    }
    if (port !== null) {
        var n = Number(port);
        if (!/^\d+$/.test(port) || n < 1 || n > 65535) {
            throw new Error('Invalid port in connection string "' + str +
                '" (service names are not supported — use a numeric port)');
        }
        options.port = n;
    }
    options.database = database;

    return options as Options;
}

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Parse any connection string the driver accepts: a firebird:// URI, or a
 * traditional [host[/port]:]database string when there is no scheme.
 */
export function parseConnectionString(str: string): Options {
    return URI_SCHEME.test(str)
        ? parseConnectionUri(str)
        : parseOldStyleConnectionString(str);
}

/**
 * Accept either an options object or a connection string (firebird:// URI
 * or traditional host[/port]:database) everywhere options are taken.
 * Strings are parsed; objects pass through unchanged.
 */
export function normalizeOptions<T>(options: T | string): T {
    if (typeof options === 'string') {
        return parseConnectionString(options) as T;
    }
    return options;
}
