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
});
