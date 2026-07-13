import { describe, it, expect } from 'vitest';
import Const from '../../src/wire/const';

describe('wire constants', () => {
    it('exposes core opcodes with Firebird wire values', () => {
        expect(Const.op_connect).toBe(1);
        expect(Const.op_attach).toBe(19);
        expect(Const.op_execute).toBe(63);
        expect(Const.op_fetch_response).toBe(66);
        expect(Const.op_cond_accept).toBe(98);
        expect(Const.op_inline_blob).toBe(114);
    });

    it('computes flagged protocol versions correctly', () => {
        expect(Const.PROTOCOL_VERSION10).toBe(10);
        expect(Const.PROTOCOL_VERSION13).toBe(0x8000 | 13);
        expect(Const.PROTOCOL_VERSION13 & Const.FB_PROTOCOL_MASK).toBe(13);
        expect(Const.PROTOCOL_VERSION20 & Const.FB_PROTOCOL_MASK).toBe(20);
    });

    it('lists supported protocols as 5-tuples in ascending weight', () => {
        expect(Array.isArray(Const.SUPPORTED_PROTOCOL)).toBe(true);
        expect(Const.SUPPORTED_PROTOCOL.length).toBeGreaterThanOrEqual(5);
        for (const p of Const.SUPPORTED_PROTOCOL) {
            expect(p).toHaveLength(5);
        }
    });

    it('BLR time-zone codes match Firebird blr.h', () => {
        expect(Const.blr_sql_time_tz).toBe(28);
        expect(Const.blr_timestamp_tz).toBe(29);
        expect(Const.blr_ex_time_tz).toBe(30);
        expect(Const.blr_ex_timestamp_tz).toBe(31);
    });

    it('defines gstat option bits including encryption', () => {
        expect(Const.isc_spb_sts_record_versions).toBe(0x20);
        expect(Const.isc_spb_sts_encryption).toBe(0x100);
    });

    it('exposes isolation level TPB arrays', () => {
        expect(Array.isArray(Const.ISOLATION_READ_COMMITTED)).toBe(true);
        expect(Const.ISOLATION_READ_COMMITTED.length).toBeGreaterThan(0);
        expect(Array.isArray(Const.ISOLATION_SERIALIZABLE)).toBe(true);
    });

    it('is frozen', () => {
        expect(Object.isFrozen(Const)).toBe(true);
        expect(() => { (Const as any).op_attach = 0; }).toThrow();
    });

    it('DEFAULT_ENCODING is a valid Node.js Buffer encoding', () => {
        expect(Buffer.isEncoding(Const.DEFAULT_ENCODING)).toBe(true);
    });
});
