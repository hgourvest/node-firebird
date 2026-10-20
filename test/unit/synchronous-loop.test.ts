import { describe, it, expect } from 'vitest';
import Connection from '../../src/wire/connection';

const doSynchronousLoop = Connection.doSynchronousLoop;

describe('doSynchronousLoop', () => {
    it('calls done once for an empty batch', () => {
        let calls = 0;
        doSynchronousLoop([], () => { throw new Error('not called'); }, (err) => {
            expect(err).toBeUndefined();
            calls++;
        });
        expect(calls).toBe(1);
    });

    it('does not grow the stack with a large synchronous batch', () => {
        const rows = new Array(100000).fill(0).map((_, i) => i);
        const seen: number[] = [];
        let doneCalls = 0;
        let doneErr: any = 'not called';

        doSynchronousLoop(rows, (row, index, next) => {
            expect(index).toBe(row);
            seen.push(row);
            next();
        }, (err) => {
            doneCalls++;
            doneErr = err;
        });

        expect(doneCalls).toBe(1);
        expect(doneErr).toBeUndefined();
        expect(seen.length).toBe(rows.length);
    });

    it('resumes after asynchronous next() calls, keeping row order', async () => {
        const rows = new Array(3000).fill(0).map((_, i) => i);
        const seen: number[] = [];

        await new Promise<void>((resolve, reject) => {
            doSynchronousLoop(rows, (row, _index, next) => {
                seen.push(row);
                if (row % 3 === 0) {
                    setImmediate(next);
                } else {
                    next();
                }
            }, (err) => (err ? reject(err) : resolve()));
        });

        expect(seen).toEqual(rows);
    });

    it('stops at the first error and calls done once with it', async () => {
        const boom = new Error('boom');
        const seen: number[] = [];
        const results: any[] = [];

        doSynchronousLoop([0, 1, 2, 3], (row, _index, next) => {
            seen.push(row);
            next(row === 1 ? boom : undefined);
            // a misbehaving consumer calling next() again must not restart the loop
            if (row === 1) {
                next();
            }
        }, (err) => results.push(err));

        // asynchronous error path
        const asyncResults: any[] = [];
        await new Promise<void>((resolve) => {
            doSynchronousLoop([0, 1, 2], (row, _index, next) => {
                setImmediate(() => next(row === 1 ? boom : undefined));
            }, (err) => {
                asyncResults.push(err);
                setImmediate(resolve);
            });
        });

        expect(seen).toEqual([0, 1]);
        expect(results).toEqual([boom]);
        expect(asyncResults).toEqual([boom]);
    });

    it('ignores duplicate and stale next() calls', async () => {
        // duplicate synchronous call must not skip a row
        const seen: number[] = [];
        let doneCalls = 0;
        doSynchronousLoop([0, 1, 2], (row, _index, next) => {
            seen.push(row);
            next();
            next();
        }, () => doneCalls++);
        expect(seen).toEqual([0, 1, 2]);
        expect(doneCalls).toBe(1);

        // a late duplicate from row 0 must not advance row 1, which is
        // still waiting for its own asynchronous next()
        const seenAsync: number[] = [];
        let staleNext: (() => void) | undefined;
        let pendingNext: (() => void) | undefined;
        let asyncDone = 0;
        doSynchronousLoop([0, 1, 2], (row, _index, next) => {
            seenAsync.push(row);
            if (row === 0) {
                staleNext = next;
                next();
            } else {
                pendingNext = next;
            }
        }, () => asyncDone++);
        expect(seenAsync).toEqual([0, 1]);
        staleNext!();
        expect(seenAsync).toEqual([0, 1]);
        pendingNext!();
        pendingNext!();
        expect(seenAsync).toEqual([0, 1, 2]);
        expect(asyncDone).toBe(1);
    });

    it('propagates an exception thrown by processData', () => {
        const done: any[] = [];
        expect(() => doSynchronousLoop([0, 1], () => {
            throw new TypeError('consumer bug');
        }, (err) => done.push(err))).toThrow(TypeError);
        expect(done).toEqual([]);
    });
});
