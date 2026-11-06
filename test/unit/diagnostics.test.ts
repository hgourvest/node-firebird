import { describe, it, expect, afterEach } from 'vitest';
import dc from 'node:diagnostics_channel';
import * as Firebird from '../../src';
import {
    DIAGNOSTICS_CHANNELS,
    channels,
    hasQuerySubscribers,
    hasPoolCheckoutSubscribers,
    hasTransactionSubscribers,
    type QueryStartEvent,
    type QueryEndEvent,
    type QueryErrorEvent,
    type PoolCheckoutEvent,
    type TransactionEvent,
} from '../../src/diagnostics';
import Transaction from '../../src/wire/transaction';
import Connection from '../../src/wire/connection';
import Pool from '../../src/pool';
import Const from '../../src/wire/const';
import EventEmitter from 'node:events';

describe('Zero-Overhead Diagnostics Channel (node:diagnostics_channel)', () => {
    const activeSubs: Array<{ name: string; fn: dc.ChannelListener }> = [];

    function sub<T>(name: string, list: T[]) {
        const fn: dc.ChannelListener = (msg: unknown) => {
            list.push(msg as T);
        };
        dc.subscribe(name, fn);
        activeSubs.push({ name, fn });
    }

    afterEach(() => {
        while (activeSubs.length > 0) {
            const { name, fn } = activeSubs.pop()!;
            dc.unsubscribe(name, fn);
        }
    });

    it('exports DIAGNOSTICS_CHANNELS and diagnosticsChannels on main entry point', () => {
        expect(Firebird.DIAGNOSTICS_CHANNELS).toEqual({
            QUERY_START: 'firebird:query:start',
            QUERY_END: 'firebird:query:end',
            QUERY_ERROR: 'firebird:query:error',
            POOL_CHECKOUT: 'firebird:pool:checkout',
            TRANSACTION: 'firebird:transaction',
        });
        expect(Firebird.diagnosticsChannels).toBe(channels);
    });

    it('reports zero active subscribers when no listeners are registered', () => {
        expect(hasQuerySubscribers()).toBe(false);
        expect(hasPoolCheckoutSubscribers()).toBe(false);
        expect(hasTransactionSubscribers()).toBe(false);
    });

    it('publishes firebird:query:start and firebird:query:end on SELECT and DML queries', async () => {
        const starts: QueryStartEvent[] = [];
        const ends: QueryEndEvent[] = [];
        const errors: QueryErrorEvent[] = [];

        sub(DIAGNOSTICS_CHANNELS.QUERY_START, starts);
        sub(DIAGNOSTICS_CHANNELS.QUERY_END, ends);
        sub(DIAGNOSTICS_CHANNELS.QUERY_ERROR, errors);

        expect(hasQuerySubscribers()).toBe(true);

        const fakeStmt = {
            type: Const.isc_info_sql_stmt_select,
            output: [],
            release: () => {},
            execute: (_tx: any, _params: any, cb: any) => {
                cb(null, {});
            },
            fetchAll: (_tx: any, cb: any) => {
                cb(null, [{ id: 1 }, { id: 2 }, { id: 3 }]);
            },
        };

        const fakeConn: any = {
            options: {
                host: '127.0.0.1',
                port: 3050,
                database: '/tmp/diag_test.fdb',
            },
            db: new EventEmitter(),
            takeCachedStatement: () => fakeStmt,
        };

        const tx = new Transaction(fakeConn);
        const rows = await tx.queryAsync('SELECT id FROM items WHERE active = ?', [true]);
        expect(rows).toHaveLength(3);

        expect(starts).toHaveLength(1);
        expect(starts[0].query).toBe('SELECT id FROM items WHERE active = ?');
        expect(starts[0].params).toEqual([true]);
        expect(starts[0].database).toBe('/tmp/diag_test.fdb');
        expect(starts[0].host).toBe('127.0.0.1');
        expect(starts[0].port).toBe(3050);
        expect(starts[0].transaction).toBe(tx);
        expect(starts[0].batch).toBe(false);
        expect(typeof starts[0].timestamp).toBe('number');

        expect(ends).toHaveLength(1);
        expect(ends[0].query).toBe('SELECT id FROM items WHERE active = ?');
        expect(ends[0].rowCount).toBe(3);
        expect(ends[0].isSelect).toBe(true);
        expect(ends[0].batch).toBe(false);
        expect(ends[0].durationMs).toBeGreaterThanOrEqual(0);
        expect(errors).toHaveLength(0);
    });

    it('publishes firebird:query:error on execution failure and AbortSignal cancellation', async () => {
        const starts: QueryStartEvent[] = [];
        const ends: QueryEndEvent[] = [];
        const errors: QueryErrorEvent[] = [];

        sub(DIAGNOSTICS_CHANNELS.QUERY_START, starts);
        sub(DIAGNOSTICS_CHANNELS.QUERY_END, ends);
        sub(DIAGNOSTICS_CHANNELS.QUERY_ERROR, errors);

        const boom = new Error('violation of PRIMARY or UNIQUE KEY constraint');
        const fakeStmt = {
            type: Const.isc_info_sql_stmt_insert,
            output: [],
            _failed: false,
            release: () => {},
            execute: (_tx: any, _params: any, cb: any) => {
                cb(boom);
            },
        };

        const fakeConn: any = {
            options: {
                host: 'db.internal',
                port: 3050,
                filename: '/var/lib/firebird/app.fdb',
            },
            db: new EventEmitter(),
            takeCachedStatement: () => fakeStmt,
        };

        const tx = new Transaction(fakeConn);
        await expect(tx.executeAsync('INSERT INTO t VALUES (?)', [42])).rejects.toThrow(boom.message);

        expect(starts).toHaveLength(1);
        expect(ends).toHaveLength(0);
        expect(errors).toHaveLength(1);
        expect(errors[0].query).toBe('INSERT INTO t VALUES (?)');
        expect(errors[0].params).toEqual([42]);
        expect(errors[0].database).toBe('/var/lib/firebird/app.fdb');
        expect(errors[0].host).toBe('db.internal');
        expect(errors[0].error).toBe(boom);
        expect(errors[0].durationMs).toBeGreaterThanOrEqual(0);

        // Pre-aborted AbortSignal should also publish start + error
        const ac = new AbortController();
        ac.abort();
        await expect(tx.queryAsync('SELECT 1 FROM RDB$DATABASE', undefined, { signal: ac.signal })).rejects.toThrow(
            /aborted/i
        );
        expect(starts).toHaveLength(2);
        expect(errors).toHaveLength(2);
    });

    it('publishes batch=true events on executeBatch', async () => {
        const starts: QueryStartEvent[] = [];
        const ends: QueryEndEvent[] = [];

        sub(DIAGNOSTICS_CHANNELS.QUERY_START, starts);
        sub(DIAGNOSTICS_CHANNELS.QUERY_END, ends);

        const fakeStmt = {
            type: Const.isc_info_sql_stmt_insert,
            output: [],
            release: () => {},
            executeBatch: (_tx: any, rows: any[], cb: any) => {
                cb(null, {
                    recordCount: rows.length,
                    updateCounts: rows.map(() => 1),
                    errors: [],
                    errorRecordNumbers: [],
                    success: true,
                });
            },
        };

        const fakeConn: any = {
            options: { host: 'localhost', port: 3050, database: '/tmp/batch.fdb' },
            db: new EventEmitter(),
            takeCachedStatement: () => fakeStmt,
        };

        const tx = new Transaction(fakeConn);
        const res = await tx.executeBatchAsync('INSERT INTO t VALUES (?)', [[1], [2], [3], [4]]);
        expect(res.recordCount).toBe(4);

        expect(starts).toHaveLength(1);
        expect(starts[0].batch).toBe(true);
        expect(ends).toHaveLength(1);
        expect(ends[0].batch).toBe(true);
        expect(ends[0].rowCount).toBe(4);
    });

    it('publishes firebird:pool:checkout on fresh attach, idle reuse, and destroyed pool', async () => {
        const checkouts: PoolCheckoutEvent[] = [];
        sub(DIAGNOSTICS_CHANNELS.POOL_CHECKOUT, checkouts);

        let attachCount = 0;
        const fakeAttach = (_opts: any, cb: any) => {
            attachCount++;
            const db: any = new EventEmitter();
            db.connection = {
                _isClosed: false,
                _isDetach: false,
                _pooled: true,
                _socket: { destroyed: false },
            };
            db.detach = (detachCb?: any) => {
                db.emit('detach', false);
                if (detachCb) detachCb();
            };
            cb(null, db);
        };

        const pool = new Pool(fakeAttach, 2, {
            host: '127.0.0.1',
            port: 3050,
            database: '/tmp/pool_diag.fdb',
        });

        // 1. Fresh connection creation (created: true)
        const db1 = await pool.getAsync();
        expect(attachCount).toBe(1);
        expect(checkouts).toHaveLength(1);
        expect(checkouts[0].created).toBe(true);
        expect(checkouts[0].db).toBe(db1);
        expect(checkouts[0].database).toBe('/tmp/pool_diag.fdb');
        expect(checkouts[0].activeCount).toBe(1);
        expect(checkouts[0].error).toBeUndefined();

        // Return to pool
        db1.detach();

        // 2. Idle reuse (created: false)
        const db2 = await pool.getAsync();
        expect(db2).toBe(db1);
        expect(attachCount).toBe(1);
        expect(checkouts).toHaveLength(2);
        expect(checkouts[1].created).toBe(false);
        expect(checkouts[1].db).toBe(db1);

        db2.detach();
        await pool.destroyAsync();

        // 3. Checkout on destroyed pool records error
        await expect(pool.getAsync()).rejects.toThrow(/destroyed/i);
        expect(checkouts).toHaveLength(3);
        expect(checkouts[2].error).toBeInstanceOf(Error);
    });

    it('publishes firebird:transaction events on start, commit, rollback, commitRetaining, rollbackRetaining', async () => {
        const events: TransactionEvent[] = [];
        sub(DIAGNOSTICS_CHANNELS.TRANSACTION, events);

        const conn = Object.create(Connection.prototype) as any;
        conn._isClosed = false;
        conn._pending = [];
        conn._blr = { pos: 0, addByte: () => {}, addBytes: () => {}, addNumeric: () => {} };
        conn._msg = { pos: 0, addInt: () => {}, addBlr: () => {} };
        conn.dbhandle = 1;
        conn.db = new EventEmitter();
        conn.options = { host: '127.0.0.1', port: 3050, database: '/tmp/tx_diag.fdb' };
        conn._queueEvent = (cb?: any) => {
            if (cb) {
                if (cb.response) {
                    cb.response.handle = 99;
                    cb(null, cb.response);
                } else {
                    cb(null, { handle: 99 });
                }
            }
        };

        const tx: Transaction = await new Promise((resolve, reject) => {
            conn.startTransaction(Const.ISOLATION_READ_COMMITTED, (err: any, t: Transaction) => {
                if (err) reject(err);
                else resolve(t);
            });
        });

        await tx.commitRetainingAsync();
        await tx.rollbackRetainingAsync();
        await tx.commitAsync();
        await tx.rollbackAsync();

        expect(events.map((e) => e.action)).toEqual([
            'start',
            'commitRetaining',
            'rollbackRetaining',
            'commit',
            'rollback',
        ]);
        for (const ev of events) {
            expect(ev.database).toBe('/tmp/tx_diag.fdb');
            expect(ev.host).toBe('127.0.0.1');
            expect(ev.port).toBe(3050);
            expect(ev.transaction).toBe(tx);
            expect(ev.durationMs).toBeGreaterThanOrEqual(0);
            expect(ev.error).toBeUndefined();
        }
    });
});
