import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import Pool from '../../src/pool';

interface FakeDb extends EventEmitter {
    connection: any;
    detach: (cb?: (err?: any) => void) => void;
}

function makeFakeAttach(behavior: { neverCallback?: boolean } = {}) {
    const created: FakeDb[] = [];
    function attach(options: any, callback: (err: any, db?: any) => void) {
        if (behavior.neverCallback) return;
        const db = new EventEmitter() as FakeDb;
        db.connection = {
            _isClosed: false,
            _isDetach: false,
            _socket: { destroyed: false },
        };
        db.detach = (cb) => {
            db.emit('detach');
            if (cb) cb();
        };
        created.push(db);
        setImmediate(() => callback(null, db));
    }
    return { attach, created };
}

function poolGet(pool: Pool): Promise<FakeDb> {
    return new Promise((resolve, reject) => {
        pool.get((err, db) => (err ? reject(err) : resolve(db)));
    });
}

describe('Pool', () => {
    it('hands out a connection created by the attach function', async () => {
        const { attach, created } = makeFakeAttach();
        const pool = new Pool(attach, 2, {});
        const db = await poolGet(pool);
        expect(created).toHaveLength(1);
        expect(db).toBe(created[0]);
        expect(pool.dbinuse).toBe(1);
    });

    it('reuses an idle connection after detach', async () => {
        const { attach, created } = makeFakeAttach();
        const pool = new Pool(attach, 2, {});
        const db1 = await poolGet(pool);
        db1.detach();
        await new Promise(setImmediate);
        const db2 = await poolGet(pool);
        expect(db2).toBe(db1);
        expect(created).toHaveLength(1);
    });

    it('queues requests beyond max until a slot frees up', async () => {
        const { attach, created } = makeFakeAttach();
        const pool = new Pool(attach, 1, {});
        const db1 = await poolGet(pool);

        let second: FakeDb | undefined;
        const secondPromise = poolGet(pool).then(db => { second = db; return db; });

        await new Promise(r => setTimeout(r, 20));
        expect(second).toBeUndefined(); // still waiting
        expect(created).toHaveLength(1);

        db1.detach();
        const db2 = await secondPromise;
        expect(db2).toBe(db1); // recycled, max respected
    });

    it('discards idle connections whose socket died', async () => {
        const { attach, created } = makeFakeAttach();
        const pool = new Pool(attach, 2, {});
        const db1 = await poolGet(pool);
        db1.detach();
        await new Promise(setImmediate);

        db1.connection._socket.destroyed = true; // dies while idle
        const db2 = await poolGet(pool);
        expect(db2).not.toBe(db1);
        expect(created).toHaveLength(2);
    });

    it('rejects get() after destroy()', async () => {
        const { attach } = makeFakeAttach();
        const pool = new Pool(attach, 1, {});
        await new Promise<void>(resolve => pool.destroy(() => resolve()));
        await expect(poolGet(pool)).rejects.toThrow('Pool has been destroyed');
    });

    it('drains pending waiters on destroy()', async () => {
        const { attach } = makeFakeAttach();
        const pool = new Pool(attach, 1, {});
        const db1 = await poolGet(pool);

        const waiting = poolGet(pool); // queued, no free slot
        pool.destroy();
        await expect(waiting).rejects.toThrow('Pool is being destroyed');

        expect(db1).toBeDefined(); // in-use connection stays with the caller
    });

    it('detaches idle connections on destroy()', async () => {
        const { attach } = makeFakeAttach();
        const pool = new Pool(attach, 2, {});
        const db1 = await poolGet(pool);
        const detachSpy = vi.spyOn(db1, 'detach');
        db1.detach(); // return to pool
        detachSpy.mockClear();
        await new Promise(setImmediate);

        await new Promise<void>((resolve, reject) =>
            pool.destroy(err => (err ? reject(err) : resolve())));
        expect(detachSpy).toHaveBeenCalled();
    });

    it('times out attach() when connectTimeout expires', async () => {
        const { attach } = makeFakeAttach({ neverCallback: true });
        const pool = new Pool(attach, 1, { connectTimeout: 40 });
        await expect(poolGet(pool)).rejects.toThrow('Connection timeout after 40ms');
        // slot must be freed for subsequent behaviour
        expect(pool._creating).toBe(0);
    });
});
