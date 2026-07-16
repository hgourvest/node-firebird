/***************************************
 *
 *   Named placeholders (:name → ?)
 *
 ***************************************/

/**
 * Result of scanning a SQL string for named placeholders.
 */
export interface ParsedNamedPlaceholders {
    /** SQL with every named placeholder replaced by a positional "?". */
    sql: string;
    /**
     * Placeholder names in positional order (a repeated name appears once
     * per occurrence), or null when the SQL contains none.
     */
    names: string[] | null;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

// Parsing is pure string work, so identical SQL (the common case with
// query builders and hot paths) is scanned only once.
const CACHE_MAX = 100;
const cache = new Map<string, ParsedNamedPlaceholders>();

/**
 * Scan `sql` for named placeholders (`:name`) and rewrite them to positional
 * `?` markers, returning the rewritten SQL and the names in positional
 * order. Placeholders inside string literals ('...'), quoted identifiers
 * ("..."), line comments (--), block comments and Firebird alternative
 * string literals (q'{...}') are left untouched.
 *
 * Note: the scanner has no SQL grammar — inside an EXECUTE BLOCK body every
 * `:variable` reference looks like a placeholder too. Use positional params
 * (or per-call `namedPlaceholders: false`) for EXECUTE BLOCK.
 */
export function parseNamedPlaceholders(sql: string): ParsedNamedPlaceholders {
    var cached = cache.get(sql);
    if (cached)
        return cached;

    var out = '';
    var names: string[] = [];
    var i = 0;
    var n = sql.length;

    while (i < n) {
        var c = sql[i];

        if (c === "'" || c === '"') {
            // string literal or quoted identifier; doubled quotes escape
            var quote = c;
            var end = i + 1;
            while (end < n) {
                if (sql[end] === quote) {
                    if (sql[end + 1] === quote) {
                        end += 2;
                        continue;
                    }
                    end++;
                    break;
                }
                end++;
            }
            out += sql.slice(i, end);
            i = end;
        } else if (c === '-' && sql[i + 1] === '-') {
            var eol = sql.indexOf('\n', i);
            if (eol === -1) eol = n;
            out += sql.slice(i, eol);
            i = eol;
        } else if (c === '/' && sql[i + 1] === '*') {
            var close = sql.indexOf('*/', i + 2);
            close = close === -1 ? n : close + 2;
            out += sql.slice(i, close);
            i = close;
        } else if ((c === 'q' || c === 'Q') && sql[i + 1] === "'" && i + 2 < n &&
                   (i === 0 || !IDENT_PART.test(sql[i - 1]))) {
            // Firebird 3+ alternative string literal: q'{...}' / q'!...!'
            var open = sql[i + 2];
            var closer = open === '(' ? ')'
                       : open === '[' ? ']'
                       : open === '{' ? '}'
                       : open === '<' ? '>'
                       : open;
            var stop = sql.indexOf(closer + "'", i + 3);
            stop = stop === -1 ? n : stop + 2;
            out += sql.slice(i, stop);
            i = stop;
        } else if (c === ':' && i + 1 < n && IDENT_START.test(sql[i + 1])) {
            var end2 = i + 2;
            while (end2 < n && IDENT_PART.test(sql[end2]))
                end2++;
            names.push(sql.slice(i + 1, end2));
            out += '?';
            i = end2;
        } else {
            out += c;
            i++;
        }
    }

    var result: ParsedNamedPlaceholders = names.length
        ? { sql: out, names: names }
        : { sql: sql, names: null };

    if (cache.size >= CACHE_MAX) {
        cache.delete(cache.keys().next().value as string);
    }
    cache.set(sql, result);
    return result;
}

/**
 * True when `params` is a plain values-by-name object (and not one of the
 * values the driver accepts as a single positional parameter, like Date or
 * Buffer).
 */
export function isNamedParamsObject(params: any): params is Record<string, any> {
    return params !== null &&
        typeof params === 'object' &&
        !Array.isArray(params) &&
        !Buffer.isBuffer(params) &&
        !(params instanceof Date);
}

/**
 * Map a values-by-name object onto the positional order collected by
 * parseNamedPlaceholders. A name may be bound multiple times; every name
 * must be an own property of `params` (a present key holding null is a
 * NULL parameter, a missing key is an error).
 */
export function bindNamedParams(names: string[], params: Record<string, any>): any[] {
    var missing: string[] = [];
    var values = names.map(function(name) {
        if (!Object.prototype.hasOwnProperty.call(params, name))
            missing.push(name);
        return params[name];
    });
    if (missing.length)
        throw new Error('Missing value for named placeholder(s): ' + missing.join(', '));
    return values;
}
