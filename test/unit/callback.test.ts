import { describe, it, expect, vi } from 'vitest';
import { doError, doCallback, toError, fromCallback, type FbError } from '../../src/callback';

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

describe('callback.toError', () => {
    it('returns Error instances unchanged', () => {
        const err = new Error('same');
        expect(toError(err)).toBe(err);
    });

    it('wraps plain error objects preserving their properties', () => {
        const err = toError({ message: 'wrapped', gdscode: 335544345, sqlcode: -913 }) as FbError & { sqlcode?: number };
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('wrapped');
        expect(err.gdscode).toBe(335544345);
        expect(err.sqlcode).toBe(-913);
    });

    it('wraps non-object values with a stringified message', () => {
        const err = toError('plain failure');
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('plain failure');
    });
});

describe('callback.fromCallback', () => {
    it('resolves with the callback result', async () => {
        await expect(fromCallback<number>(cb => cb(undefined, 42))).resolves.toBe(42);
    });

    it('rejects with an Error for Error failures', async () => {
        const boom = new Error('boom');
        await expect(fromCallback(cb => cb(boom))).rejects.toBe(boom);
    });

    it('rejects with a wrapped Error for plain-object failures', async () => {
        await expect(fromCallback(cb => cb({ message: 'obj', gdscode: 1 })))
            .rejects.toMatchObject({ message: 'obj', gdscode: 1 });
        await expect(fromCallback(cb => cb({ message: 'obj' }))).rejects.toBeInstanceOf(Error);
    });
});
