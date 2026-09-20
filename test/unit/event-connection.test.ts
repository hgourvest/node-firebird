import { afterEach, describe, expect, it } from 'vitest';
import net from 'net';
import EventConnection from '../../src/wire/eventConnection';

const servers: net.Server[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(err => err ? reject(err) : resolve());
    })));
});

describe('EventConnection attachment', () => {
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
