import { describe, expect, it } from 'vitest';
import { computeColumnKeys } from '../../src/wire/xsqlvar';

// Only the metadata fields matter for key computation.
const col = (alias: string, relation?: string, relationAlias?: string) =>
    ({ alias, relation, relationAlias } as any);

describe('computeColumnKeys', () => {
    const output = [
        col('ID', 'EMP', 'E'),
        col('NAME', 'DEPT'), // no query alias → relation name
        col('ANSWER'),       // expression column → no relation at all
    ];

    it('returns bare aliases when nestTables is off', () => {
        expect(computeColumnKeys(output, undefined, false)).toEqual([
            { key: 'ID' }, { key: 'NAME' }, { key: 'ANSWER' },
        ]);
        expect(computeColumnKeys(output, false, false)).toEqual([
            { key: 'ID' }, { key: 'NAME' }, { key: 'ANSWER' },
        ]);
    });

    it('nestTables: true qualifies by relationAlias, then relation, then ""', () => {
        expect(computeColumnKeys(output, true, false)).toEqual([
            { table: 'E', key: 'ID' },
            { table: 'DEPT', key: 'NAME' },
            { table: '', key: 'ANSWER' },
        ]);
    });

    it('separator mode folds the qualifier in; expression columns get the bare separator (mysql2)', () => {
        // always prefixing keeps qualified keys collision-free: a bare
        // expression alias 'E_ID' could otherwise collide with E.ID
        expect(computeColumnKeys(output, '_', false)).toEqual([
            { key: 'E_ID' }, { key: 'DEPT_NAME' }, { key: '_ANSWER' },
        ]);
    });

    it('lowercase_keys lowers both table and column parts', () => {
        expect(computeColumnKeys(output, true, true)).toEqual([
            { table: 'e', key: 'id' },
            { table: 'dept', key: 'name' },
            { table: '', key: 'answer' },
        ]);
        expect(computeColumnKeys(output, '_', true)).toEqual([
            { key: 'e_id' }, { key: 'dept_name' }, { key: '_answer' },
        ]);
    });
});
