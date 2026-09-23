import { afterEach, describe, expect, it, vi } from 'vitest';
import net from 'net';
import EventConnection from '../../src/wire/eventConnection';
import FbEventManager from '../../src/wire/fbEventManager';

const servers: net.Server[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(err => err ? reject(err) : resolve());
    })));
});

describe('EventConnection attachment', () => {
    it('reports a socket that closes before connecting without an error event', () => {
        const socket = new net.Socket();
        vi.spyOn(net, 'createConnection').mockReturnValue(socket);

        const errors: Array<Error | undefined> = [];
        const connection = new EventConnection('event-host', 3050, err => errors.push(err), {});

        socket.emit('close');
        socket.emit('close');

        expect(errors).toHaveLength(1);
        expect(errors[0]).toEqual(new Error('Event connection to event-host:3050 closed before connecting.'));
        expect(connection._isOpened).toBe(false);
        expect(connection._isClosed).toBe(true);
        socket.destroy();
    });

    it('reports a refused auxiliary connection exactly once and closes its socket', async () => {
        const probe = net.createServer();
        servers.push(probe);
        await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
        const address = probe.address() as net.AddressInfo;
        await new Promise<void>((resolve, reject) => probe.close(err => err ? reject(err) : resolve()));

        let callbackCount = 0;
        let connection!: EventConnection;
        const error = await new Promise<Error>(resolve => {
            connection = new EventConnection('127.0.0.1', address.port, err => {
                callbackCount++;
                if (err) resolve(err);
            }, {});
        });

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(error).toBeInstanceOf(Error);
        expect(callbackCount).toBe(1);
        expect(connection._isOpened).toBe(false);
        expect(connection._isClosed).toBe(true);
        expect(connection._socket.destroyed).toBe(true);
    });
});

describe('EventConnection post-attachment failures', () => {
    function createConnected(db: any = { connection: { _emitError: vi.fn() } }) {
        const socket = new net.Socket();
        vi.spyOn(net, 'createConnection').mockReturnValue(socket);
        const attachmentResults: Array<Error | undefined> = [];
        const connection = new EventConnection('event-host', 3050, err => attachmentResults.push(err), db);
        socket.emit('connect');
        return { socket, connection, attachmentResults };
    }

    it('reports an unexpected socket error once after connecting', () => {
        const { socket, connection, attachmentResults } = createConnected();
        const errors: Error[] = [];
        connection.eventcallback = err => errors.push(err);
        const failure = Object.assign(new Error('aux socket failed'), { code: 'ECONNRESET' });

        socket.emit('error', failure);
        socket.emit('error', new Error('duplicate'));

        expect(attachmentResults).toEqual([undefined]);
        expect(errors).toEqual([failure]);
        expect(connection._isOpened).toBe(false);
        expect(connection._isClosed).toBe(true);
        expect(connection._socket.destroyed).toBe(true);
    });

    it('reports an unexpected close after connecting', () => {
        const { socket, connection, attachmentResults } = createConnected();
        const errors: Error[] = [];
        connection.eventcallback = err => errors.push(err);

        socket.emit('close');
        socket.emit('close');

        expect(attachmentResults).toEqual([undefined]);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('Event connection to event-host:3050 closed unexpectedly.');
        expect(connection._isOpened).toBe(false);
        expect(connection._isClosed).toBe(true);
    });

    it('does not report a caller-initiated close after the event callback is cleared', () => {
        const guardedError = vi.fn();
        const { socket, connection } = createConnected({ connection: { _emitError: guardedError } });
        connection.eventcallback = null;
        connection._intentionalClose = true;

        socket.emit('error', new Error('ECONNRESET during shutdown'));
        socket.emit('close');

        expect(guardedError).not.toHaveBeenCalled();
        expect(connection._isClosed).toBe(true);
    });

    it('turns an unexpected protocol opcode into a terminal error', () => {
        const { socket, connection } = createConnected();
        const errors: Error[] = [];
        connection.eventcallback = err => errors.push(err);
        const packet = Buffer.alloc(4);
        packet.writeInt32BE(999, 0);

        socket.emit('data', packet);

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('Unexpected event connection opcode: 999');
        expect(connection._isClosed).toBe(true);
    });
});

describe('FbEventManager post-attachment failures', () => {
    function createManager() {
        const guardedError = vi.fn();
        const db = {
            connection: {
                _isClosed: false,
                _emitError: guardedError,
                queEvents: vi.fn(),
                closeEvents: vi.fn(),
            },
        };
        const socket = {
            destroyed: false,
            destroy: vi.fn(function(this: { destroyed: boolean }) { this.destroyed = true; }),
            end: vi.fn(),
            once: vi.fn(),
        };
        const eventconnection: any = {
            _isClosed: false,
            _isOpened: true,
            _socket: socket,
            eventcallback: null,
            emgr: null,
        };
        const ready = vi.fn();
        const manager = new FbEventManager(db, eventconnection, 7, ready);
        return { db, eventconnection, guardedError, manager, ready, socket };
    }

    it('emits a post-attachment failure on the manager without recalling the attachment callback', async () => {
        const { eventconnection, guardedError, manager, ready, socket } = createManager();
        await new Promise(resolve => setImmediate(resolve));
        const errors: Error[] = [];
        manager.on('error', error => errors.push(error));
        const failure = new Error('auxiliary connection lost');

        eventconnection.eventcallback(failure);
        eventconnection.eventcallback?.(new Error('duplicate'));

        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith(null);
        expect(errors).toEqual([failure]);
        expect(guardedError).not.toHaveBeenCalled();
        expect(socket.destroy).toHaveBeenCalledTimes(1);
        expect(manager.getState().state).toBe('CLOSED');
    });

    it('uses the guarded database error path when the manager has no error listener', async () => {
        const { eventconnection, guardedError, manager } = createManager();
        await new Promise(resolve => setImmediate(resolve));
        const failure = new Error('auxiliary connection lost');

        eventconnection.eventcallback(failure);

        expect(guardedError).toHaveBeenCalledTimes(1);
        expect(guardedError).toHaveBeenCalledWith(failure);
        expect(manager.getState().state).toBe('CLOSED');
    });

    it('fails attachment exactly once when the manager closes before becoming ready', async () => {
        const { eventconnection, guardedError, ready } = createManager();
        const failure = new Error('auxiliary connection lost during attachment');

        eventconnection.eventcallback(failure);
        await new Promise(resolve => setImmediate(resolve));

        expect(ready).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledWith(failure);
        expect(guardedError).not.toHaveBeenCalled();
    });

    it('marks caller-initiated shutdown before ending the auxiliary socket', () => {
        const { eventconnection, manager, socket } = createManager();

        manager.close();

        expect(eventconnection._intentionalClose).toBe(true);
        expect(eventconnection.eventcallback).toBeNull();
        expect(socket.end).toHaveBeenCalledTimes(1);
    });
});

describe('FbEventManager optional baseline', () => {
    function createManager(eventBaseline: boolean) {
        const queuedEventSets: string[][] = [];
        const connection = {
            options: { eventBaseline },
            _isClosed: false,
            queEvents: vi.fn((events, _id, callback) => {
                queuedEventSets.push(Object.keys(events));
                callback(null);
            }),
            closeEvents: vi.fn((_id, callback) => callback(null)),
        };
        const eventconnection: any = {
            _isClosed: false,
            _isOpened: true,
            eventcallback: null,
            emgr: null,
        };
        const manager = new FbEventManager({ connection, eventid: 8 }, eventconnection, 7, vi.fn());
        function packet(counts: Record<string, number>, eventId = manager.eventid) {
            const events = Object.entries(counts).filter(([name, count]) =>
                Object.prototype.hasOwnProperty.call(manager.events, name) && manager.events[name] !== count
            ).map(([name, count]) => ({ name, count }));
            if (!eventBaseline) {
                for (const [name, count] of Object.entries(counts)) {
                    if (Object.prototype.hasOwnProperty.call(manager.events, name)) manager.events[name] = count;
                }
            }
            eventconnection.eventcallback(null, { eventid: eventId, events, counts });
        }
        return { connection, manager, packet, queuedEventSets };
    }

    it('preserves the existing first post_event when the option is off', () => {
        const { manager, packet } = createManager(false);
        const posts: Array<[string, number]> = [];
        const baselines: Record<string, number>[] = [];
        manager.on('post_event', (name, count) => posts.push([name, count]));
        manager.on('baseline', counts => baselines.push(counts));

        manager.registerEvent(['EXISTING'], vi.fn());
        packet({ EXISTING: 4 });

        expect(posts).toEqual([['EXISTING', 4]]);
        expect(baselines).toEqual([]);
    });

    it('emits a defensive baseline, then delivers the first real change', () => {
        const { connection, manager, packet } = createManager(true);
        const posts: Array<[string, number]> = [];
        const baselines: Readonly<Record<string, number>>[] = [];
        manager.on('post_event', (name, count) => posts.push([name, count]));
        manager.on('baseline', counts => baselines.push(counts));

        manager.registerEvent(['EXISTING'], vi.fn());
        packet({ EXISTING: 4 });
        expect(posts).toEqual([]);
        expect(baselines).toEqual([{ EXISTING: 4 }]);
        expect(Object.isFrozen(baselines[0])).toBe(true);
        packet({ EXISTING: 5 });
        expect(posts).toEqual([['EXISTING', 5]]);
        expect(baselines).toHaveLength(1);
        expect(connection.queEvents).toHaveBeenCalledTimes(3);
    });

    it('starts a new baseline on reconfiguration and never queues an empty event set', () => {
        const { manager, packet, queuedEventSets } = createManager(true);
        const posts: Array<[string, number]> = [];
        const baselines: Readonly<Record<string, number>>[] = [];
        manager.on('post_event', (name, count) => posts.push([name, count]));
        manager.on('baseline', counts => baselines.push(counts));

        manager.registerEvent(['A'], vi.fn());
        packet({ A: 2 });
        manager.registerEvent(['B'], vi.fn());
        packet({ A: 2, B: 7 });
        manager.unregisterEvent(['A'], vi.fn());
        packet({ B: 7 });
        packet({ B: 8 });
        manager.unregisterEvent(['B'], vi.fn());

        expect(baselines).toEqual([{ A: 2 }, { A: 2, B: 7 }, { B: 7 }]);
        expect(posts).toEqual([['B', 8]]);
        expect(queuedEventSets.every(events => events.length > 0)).toBe(true);
    });

    it('ignores a late packet after the last event is removed', () => {
        const { connection, manager, packet } = createManager(true);
        const posts = vi.fn();
        const baseline = vi.fn();
        manager.on('post_event', posts);
        manager.on('baseline', baseline);
        manager.registerEvent(['A'], vi.fn());
        packet({ A: 3 });

        let finishCancellation!: (err?: Error) => void;
        connection.closeEvents.mockImplementationOnce((_id, callback) => { finishCancellation = callback; });
        const callback = vi.fn();
        manager.unregisterEvent(['A'], callback);
        const queuedBeforeLatePacket = connection.queEvents.mock.calls.length;
        packet({ A: 4 });

        expect(posts).not.toHaveBeenCalled();
        expect(baseline).toHaveBeenCalledTimes(1);
        expect(manager.events).toEqual({});
        expect(connection.queEvents).toHaveBeenCalledTimes(queuedBeforeLatePacket);
        finishCancellation();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(connection.queEvents).toHaveBeenCalledTimes(queuedBeforeLatePacket);
    });

    it('ignores a delayed packet even when the old and new subscriptions share a name', () => {
        const { manager, packet } = createManager(true);
        const baseline = vi.fn();
        const posts = vi.fn();
        manager.on('baseline', baseline);
        manager.on('post_event', posts);
        manager.registerEvent(['A', 'B'], vi.fn());
        packet({ A: 1, B: 2 });
        const oldId = manager.eventid;

        manager.unregisterEvent(['A'], vi.fn());
        expect(manager.eventid).not.toBe(oldId);
        packet({ B: 3 }, oldId);
        expect(baseline).toHaveBeenCalledTimes(1);
        expect(manager.events.B).toBe(0);
        expect(posts).not.toHaveBeenCalled();

        packet({ B: 3 });
        packet({ B: 4 });
        expect(baseline).toHaveBeenCalledTimes(2);
        expect(baseline).toHaveBeenLastCalledWith({ B: 3 });
        expect(posts).toHaveBeenCalledExactlyOnceWith('B', 4);
    });

    it('keeps constant retired-ID state across many reconfigurations', async () => {
        const { manager, packet } = createManager(true);
        const baseline = vi.fn();
        const posts = vi.fn();
        const errors = vi.fn();
        manager.on('baseline', baseline);
        manager.on('post_event', posts);
        manager.on('error', errors);
        manager.registerEvent(['A'], vi.fn());

        const retiredIds: number[] = [];
        for (let i = 0; i < 50; i++) {
            retiredIds.push(manager.eventid);
            manager.registerEvent(['B' + i], vi.fn());
        }
        expect(manager._retiredEventIdLimit).toBe(retiredIds[retiredIds.length - 1]);

        // Every older generation is still recognised and silently dropped.
        for (const id of retiredIds) packet({ A: 9 }, id);
        expect(baseline).not.toHaveBeenCalled();
        expect(posts).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();

        // An ID that was never allocated is still reported once ready.
        await new Promise(resolve => process.nextTick(resolve));
        packet({ A: 9 }, manager.eventid + 1);
        expect(errors).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Bad eventid' }));
    });

    it('coalesces changes made before cancellation completes', () => {
        const { connection, manager, packet, queuedEventSets } = createManager(true);
        manager.registerEvent(['A', 'B'], vi.fn());
        packet({ A: 1, B: 2 });

        let finishCancellation!: (err?: Error) => void;
        connection.closeEvents.mockImplementationOnce((_id, callback) => { finishCancellation = callback; });
        const removed = vi.fn();
        const added = vi.fn();
        manager.unregisterEvent(['A'], removed);
        manager.registerEvent(['C'], added);
        expect(connection.closeEvents).toHaveBeenCalledTimes(1);
        expect(connection.queEvents).toHaveBeenCalledTimes(2);
        expect(removed).not.toHaveBeenCalled();
        expect(added).not.toHaveBeenCalled();

        finishCancellation();
        expect(connection.closeEvents).toHaveBeenCalledTimes(1);
        expect(queuedEventSets.at(-1)).toEqual(['B', 'C']);
        expect(removed).toHaveBeenCalledExactlyOnceWith(null, undefined);
        expect(added).toHaveBeenCalledExactlyOnceWith(null, undefined);
        packet({ B: 2, C: 5 });
        expect(manager.events).toEqual({ B: 2, C: 5 });
    });

    it('replaces a subscription changed before its queue acknowledgement', () => {
        const { connection, manager, packet, queuedEventSets } = createManager(true);
        let acknowledgeFirst!: (err?: Error) => void;
        connection.queEvents.mockImplementationOnce((_events, _id, callback) => { acknowledgeFirst = callback; });
        const first = vi.fn();
        const second = vi.fn();
        manager.registerEvent(['A'], first);
        const oldId = manager.eventid;
        manager.registerEvent(['B'], second);
        packet({ A: 2 }, oldId);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        acknowledgeFirst();
        expect(connection.closeEvents).toHaveBeenCalledExactlyOnceWith(oldId, expect.any(Function));
        expect(manager.eventid).not.toBe(oldId);
        expect(queuedEventSets.at(-1)).toEqual(['A', 'B']);
        packet({ A: 2, B: 3 }, oldId);
        expect(manager.events).toEqual({ A: 0, B: 0 });
        packet({ A: 2, B: 3 });
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(manager.events).toEqual({ A: 2, B: 3 });
    });

    it('does not subscribe again when closed during an in-flight cancellation', () => {
        const { connection, manager, packet } = createManager(true);
        manager.registerEvent(['A'], vi.fn());
        packet({ A: 1 });
        let finishCancellation!: (err?: Error) => void;
        connection.closeEvents.mockImplementationOnce((_id, callback) => { finishCancellation = callback; });

        const change = vi.fn();
        const closed = vi.fn();
        manager.registerEvent(['B'], change);
        const queuedBeforeClose = connection.queEvents.mock.calls.length;
        manager.close(closed);
        finishCancellation();

        expect(connection.queEvents).toHaveBeenCalledTimes(queuedBeforeClose);
        expect(change).toHaveBeenCalledTimes(1);
        expect(change.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(closed).toHaveBeenCalledOnce();
    });
});
