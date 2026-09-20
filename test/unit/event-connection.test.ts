import { afterEach, describe, expect, it, vi } from 'vitest';
import net from 'net';
import EventConnection from '../../src/wire/eventConnection';

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
