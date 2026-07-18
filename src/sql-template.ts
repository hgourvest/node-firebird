/***************************************
 *
 *   Tagged-template query API (Postgres.js-style)
 *
 *   db.sql`SELECT * FROM EMP WHERE ID = ${id}`   →  lazy thenable query
 *   db.sql('COLUMN NAME')                        →  quoted identifier
 *
 *   Interpolated values become positional `?` parameters — never string
 *   concatenation — so the API is injection-safe by construction. A query
 *   embedded inside another tag is treated as a fragment: its text and
 *   parameters are spliced in place. Arrays expand to `?, ?, ?` lists for
 *   IN clauses. Execution is lazy (on await/then) and happens exactly once.
 *
 ***************************************/

import type { QueryOptions, QueryResult } from './types';

/** Executor provided by Database/Transaction: runs text+params, resolves rows
 *  (or the full QueryResult when options.withMeta is set). */
export type SqlExecutor = (text: string, params: any[], options?: QueryOptions) => Promise<any>;

/** A dynamically quoted identifier produced by sql('name'). */
export class SqlIdentifier {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

/**
 * Quote a (possibly dot-qualified) identifier for dialect 3: each part is
 * wrapped in double quotes with embedded quotes doubled, so user input can
 * never break out of the identifier position.
 */
export function quoteIdentifier(name: string): string {
    return String(name)
        .split('.')
        .map((part) => '"' + part.replace(/"/g, '""') + '"')
        .join('.');
}

/** Compiled form of a tagged query: SQL text with `?` placeholders + params. */
export interface CompiledQuery {
    text: string;
    params: any[];
}

function compile(strings: readonly string[], values: any[], active?: Set<any>): CompiledQuery {
    let text = '';
    const params: any[] = [];

    for (let i = 0; i < strings.length; i++) {
        text += strings[i];
        if (i >= values.length) {
            continue;
        }
        const value = values[i];

        if (value instanceof SqlIdentifier) {
            text += quoteIdentifier(value.name);
        } else if (value instanceof SqlQuery) {
            // embedded fragment: splice its text and params in place. The
            // same fragment may appear several times (a DAG), but a fragment
            // containing itself would recurse forever — track the expansion
            // stack and reject cycles with a diagnosable error.
            active = active || new Set();
            if (active.has(value)) {
                throw new Error('circular sql fragment: a query is embedded (transitively) inside itself');
            }
            active.add(value);
            const inner = compile(value.strings, value.values, active);
            active.delete(value);
            text += inner.text;
            params.push(...inner.params);
        } else if (Array.isArray(value)) {
            // IN (${[1, 2, 3]}) → IN (?, ?, ?)
            if (!value.length) {
                // '' would compile to `IN ()` — invalid SQL raising a server
                // syntax error the caller never wrote; fail early instead
                throw new Error('cannot interpolate an empty array (would compile to invalid SQL like "IN ()")');
            }
            text += value.map(() => '?').join(', ');
            params.push(...value);
        } else {
            text += '?';
            params.push(value);
        }
    }

    return { text, params };
}

/**
 * A lazily executed tagged query. Awaiting it (or calling then/catch/
 * finally) runs it through the owning Database/Transaction exactly once;
 * embedding it in another tag uses it as a fragment instead and never
 * executes it.
 */
export class SqlQuery<T = any> implements PromiseLike<T[]> {
    readonly strings: readonly string[];
    readonly values: any[];
    private executor: SqlExecutor;
    private queryOptions?: QueryOptions;
    private executed?: Promise<any>;
    private executedMeta?: boolean;

    constructor(executor: SqlExecutor, strings: readonly string[], values: any[]) {
        this.executor = executor;
        this.strings = strings;
        this.values = values;
    }

    /** The compiled SQL text (`?` placeholders) and parameter array. */
    toQuery(): CompiledQuery {
        return compile(this.strings, this.values);
    }

    /**
     * Attach per-query options (timeout, signal, nestTables, …). Must be
     * called before the query executes — options attached afterwards would
     * be silently ignored, so that throws instead.
     */
    options(queryOptions: QueryOptions): this {
        if (this.executed) {
            throw new Error('sql query already executed — call .options() before awaiting it');
        }
        this.queryOptions = { ...this.queryOptions, ...queryOptions };
        return this;
    }

    /** Execute resolving the full { rows, fields, affectedRows, … } result. */
    withMeta(): Promise<QueryResult<T>> {
        return this.run(true);
    }

    /**
     * A query executes exactly once, in the shape of its first consumer
     * (plain rows via then/await, or the full result via withMeta).
     * Consuming it again in the OTHER shape cannot be honoured from the
     * cached promise, so it throws rather than silently returning the
     * wrong shape.
     */
    private run(withMeta: boolean): Promise<any> {
        if (this.executed) {
            if (withMeta !== this.executedMeta) {
                throw new Error(this.executedMeta
                    ? 'sql query already executed via .withMeta() — await that result instead of the query'
                    : 'sql query already executed as plain rows — call .withMeta() first, or build a new query');
            }
            return this.executed;
        }
        this.executedMeta = withMeta;
        const { text, params } = compile(this.strings, this.values);
        const options = withMeta ? { ...this.queryOptions, withMeta: true } : this.queryOptions;
        this.executed = this.executor(text, params, options);
        return this.executed;
    }

    then<R1 = T[], R2 = never>(
        onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
        onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
    ): Promise<R1 | R2> {
        return this.run(false).then(onfulfilled, onrejected);
    }

    catch<R = never>(onrejected?: ((reason: any) => R | PromiseLike<R>) | null): Promise<T[] | R> {
        return this.then(undefined, onrejected);
    }

    finally(onfinally?: (() => void) | null): Promise<T[]> {
        return this.run(false).finally(onfinally) as Promise<T[]>;
    }
}

/** The dual-use tag: template tag executes, string call quotes an identifier. */
export interface SqlTag {
    <T = any>(strings: TemplateStringsArray, ...values: any[]): SqlQuery<T>;
    (identifier: string): SqlIdentifier;
}

/**
 * Build the `sql` tag for a Database/Transaction. `executor` receives the
 * compiled text, params and per-query options and must return a promise
 * (Database/Transaction pass their queryAsync).
 */
export function makeSqlTag(executor: SqlExecutor): SqlTag {
    return function sql(first: any, ...values: any[]): any {
        if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw')) {
            return new SqlQuery(executor, first, values);
        }
        if (typeof first === 'string') {
            return new SqlIdentifier(first);
        }
        throw new Error('sql must be used as a template tag (sql`...`) or called with an identifier string (sql(\'NAME\'))');
    } as SqlTag;
}
