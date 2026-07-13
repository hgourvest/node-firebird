import { describe, it, expect } from 'vitest';
import { GDSCode } from '../../src/gdscodes';

describe('GDSCode', () => {
    it('maps symbolic names to numeric codes', () => {
        expect(GDSCode.ARITH_EXCEPT).toBe(335544321);
        expect(GDSCode.LOGIN).toBe(335544472);
        expect(GDSCode.LOCK_CONFLICT).toBe(335544345);
        expect(GDSCode.DEADLOCK).toBe(335544336);
    });

    it('provides the reverse numeric-to-name mapping', () => {
        expect((GDSCode as any)[335544321]).toBe('ARITH_EXCEPT');
        expect((GDSCode as any)[GDSCode.LOGIN]).toBe('LOGIN');
    });

    it('is frozen', () => {
        expect(Object.isFrozen(GDSCode)).toBe(true);
        expect(() => { (GDSCode as any).ARITH_EXCEPT = 0; }).toThrow();
    });
});
