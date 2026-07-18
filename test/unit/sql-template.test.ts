import { describe, expect, it } from 'vitest';
import { makeSqlTag, quoteIdentifier, SqlIdentifier, SqlQuery } from '../../src/sql-template';

// executor that records what would run and resolves a marker
function recordingTag() {
    const calls: { text: string; params: any[]; options?: any }[] = [];
    const sql = makeSqlTag(async (text, params, options) => {
        calls.push({ text, params, options });
        return ['ROWS'];
    });
    return { sql, calls };
}

describe('sql tagged-template compiler', () => {
    it('interpolations become positional ? params', () => {
        const { sql } = recordingTag();
        const q = sql`SELECT * FROM T WHERE ID = ${42} AND NAME = ${'Ada'}`;
        expect(q.toQuery()).toEqual({
            text: 'SELECT * FROM T WHERE ID = ? AND NAME = ?',
            params: [42, 'Ada'],
        });
    });

    it('arrays expand to placeholder lists (IN clauses)', () => {
        const { sql } = recordingTag();
        const q = sql`SELECT * FROM T WHERE ID IN (${[1, 2, 3]}) AND X = ${9}`;
        expect(q.toQuery()).toEqual({
            text: 'SELECT * FROM T WHERE ID IN (?, ?, ?) AND X = ?',
            params: [1, 2, 3, 9],
        });
    });

    it('sql(name) quotes identifiers, dot-qualified and quote-safe', () => {
        const { sql } = recordingTag();
        expect(sql('EMP')).toBeInstanceOf(SqlIdentifier);
        const q = sql`SELECT ${sql('NAME')} FROM ${sql('S1.EMP')} ORDER BY ${sql('we"ird')}`;
        expect(q.toQuery().text).toBe('SELECT "NAME" FROM "S1"."EMP" ORDER BY "we""ird"');
        expect(q.toQuery().params).toEqual([]);
        expect(quoteIdentifier('a.b')).toBe('"a"."b"');
    });

    it('embedded queries compose as fragments with their params', () => {
        const { sql } = recordingTag();
        const filter = sql`NAME = ${'Ada'} AND DEPT_ID = ${1}`;
        const q = sql`SELECT * FROM EMP WHERE ${filter} ORDER BY ID`;
        expect(q.toQuery()).toEqual({
            text: 'SELECT * FROM EMP WHERE NAME = ? AND DEPT_ID = ? ORDER BY ID',
            params: ['Ada', 1],
        });
    });

    it('executes lazily, exactly once, through the executor', async () => {
        const { sql, calls } = recordingTag();
        const q = sql`SELECT ${1}`;
        expect(calls.length).toBe(0); // nothing ran yet
        const [a, b] = await Promise.all([q, q]);
        expect(a).toEqual(['ROWS']);
        expect(b).toEqual(['ROWS']);
        expect(calls.length).toBe(1); // double await, single execution
        expect(calls[0]).toEqual({ text: 'SELECT ?', params: [1], options: undefined });
    });

    it('options() and withMeta() forward query options', async () => {
        const { sql, calls } = recordingTag();
        await sql`SELECT ${1}`.options({ timeout: 5000 });
        expect(calls[0].options).toEqual({ timeout: 5000 });

        await sql`SELECT ${2}`.options({ timeout: 1 }).withMeta();
        expect(calls[1].options).toEqual({ timeout: 1, withMeta: true });
    });

    it('a fragment embedded elsewhere is never executed itself', async () => {
        const { sql, calls } = recordingTag();
        const frag = sql`ID = ${7}`;
        await sql`SELECT * FROM T WHERE ${frag}`;
        expect(calls.length).toBe(1);
        expect(calls[0].text).toBe('SELECT * FROM T WHERE ID = ?');
    });

    it('rejects misuse with a clear error', () => {
        const { sql } = recordingTag();
        expect(() => (sql as any)(42)).toThrow(/template tag|identifier/);
    });

    it('rejects empty array interpolations (would compile to IN ())', () => {
        const { sql } = recordingTag();
        expect(() => sql`SELECT * FROM T WHERE ID IN (${[]})`.toQuery())
            .toThrow(/empty array/);
    });

    it('rejects circular fragments instead of overflowing the stack', () => {
        const values: any[] = [];
        const q = new SqlQuery(async () => [], ['A ', ' B'], values);
        values.push(q); // q embeds itself
        expect(() => q.toQuery()).toThrow(/circular sql fragment/);
    });

    it('allows the same fragment twice (DAG), only cycles are rejected', () => {
        const { sql } = recordingTag();
        const frag = sql`X = ${1}`;
        const q = sql`SELECT * FROM T WHERE ${frag} OR ${frag}`;
        expect(q.toQuery()).toEqual({
            text: 'SELECT * FROM T WHERE X = ? OR X = ?',
            params: [1, 1],
        });
    });

    it('throws when consumed again in a different shape after executing', async () => {
        const { sql } = recordingTag();
        const q = sql`SELECT ${1}`;
        await q;
        expect(() => q.withMeta()).toThrow(/already executed as plain rows/);
        expect(() => q.options({ timeout: 1 })).toThrow(/already executed/);

        const q2 = sql`SELECT ${2}`;
        await q2.withMeta();
        await expect(async () => { await q2; }).rejects.toThrow(/already executed via .withMeta/);
    });
});
