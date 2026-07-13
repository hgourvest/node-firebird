import { describe, it, expect, vi } from 'vitest';
import { doError, doCallback, type FbError } from '../../src/callback';

describe('callback.doError', () => {
    it('invokes the callback with the error object', () => {
        const cb = vi.fn();
        const err = new Error('boom');
        doError(err, cb);
        expect(cb).toHaveBeenCalledWith(err);
    });

    it('is a no-op without a callback', () => {
        expect(() => doError(new Error('x'), undefined)).not.toThrow();
    });
});

describe('callback.doCallback', () => {
    it('is a no-op without a callback', () => {
        expect(() => doCallback({ anything: 1 })).not.toThrow();
    });

    it('passes Error instances through as the error argument', () => {
        const cb = vi.fn();
        const err = new Error('fail');
        doCallback(err, cb);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(err);
    });

    it('converts Firebird status objects into an Error with gdscode/gdsparams', () => {
        const cb = vi.fn();
        const statusObj = {
            message: 'lock conflict on no wait transaction',
            status: [{ gdscode: 335544345, params: ['MYTABLE'] }],
        };
        doCallback(statusObj as any, cb);

        expect(cb).toHaveBeenCalledTimes(1);
        const err = cb.mock.calls[0][0] as FbError;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('lock conflict on no wait transaction');
        expect(err.gdscode).toBe(335544345);
        expect(err.gdsparams).toEqual(['MYTABLE']);
    });

    it('treats an empty status vector as an error without gdscode', () => {
        const cb = vi.fn();
        doCallback({ message: 'm', status: [] } as any, cb);
        const err = cb.mock.calls[0][0] as FbError;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('m');
        expect(err.gdscode).toBeUndefined();
    });

    it('invokes callback(undefined, result) for plain results', () => {
        const cb = vi.fn();
        const rows = [{ n: 1 }];
        doCallback(rows, cb);
        expect(cb).toHaveBeenCalledWith(undefined, rows);
    });

    it('treats arrays as results even when non-empty', () => {
        const cb = vi.fn();
        doCallback([{ status: 'not-an-error' }], cb);
        expect(cb.mock.calls[0][0]).toBeUndefined();
    });
});
