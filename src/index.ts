import Const from './wire/const';
import { doError, doCallback, fromCallback } from './callback';
import Connection from './wire/connection';
import Pool from './pool';
import { escape as escapeValue } from './utils';
import { parseConnectionUri, parseConnectionString, normalizeOptions } from './uri';
import type {
    Options,
    SvcMgrOptions,
    DatabaseCallback,
    ServiceManagerCallback,
    SimpleCallback,
    ConnectionPool,
    Database,
    ServiceManager,
} from './types';

export * from './types';
export { GDSCode } from './gdscodes';

if (typeof(setImmediate) === 'undefined') {
    (global as any).setImmediate = function(cb: () => void) {
        process.nextTick(cb);
    };
}

export const AUTH_PLUGIN_LEGACY: string = Const.AUTH_PLUGIN_LEGACY;
export const AUTH_PLUGIN_SRP: string = Const.AUTH_PLUGIN_SRP;
export const AUTH_PLUGIN_SRP256: string = Const.AUTH_PLUGIN_SRP256;
export const AUTH_PLUGIN_SRP384: string = Const.AUTH_PLUGIN_SRP384;
export const AUTH_PLUGIN_SRP512: string = Const.AUTH_PLUGIN_SRP512;

export const WIRE_CRYPT_DISABLE: number = Const.WIRE_CRYPT_DISABLE;
export const WIRE_CRYPT_ENABLE: number = Const.WIRE_CRYPT_ENABLE;

/** A transaction sees changes done by uncommitted transactions. */
export const ISOLATION_READ_UNCOMMITTED: number[] = Const.ISOLATION_READ_UNCOMMITTED;
/** A transaction sees only data committed before the statement has been executed. */
export const ISOLATION_READ_COMMITTED: number[] = Const.ISOLATION_READ_COMMITTED;
/** A transaction sees during its lifetime only data committed before the transaction has been started. */
export const ISOLATION_REPEATABLE_READ: number[] = Const.ISOLATION_REPEATABLE_READ;
/**
 * This is the strictest isolation level, which enforces transaction serialization.
 * Data accessed in the context of a serializable transaction cannot be accessed by any other transaction.
 */
export const ISOLATION_SERIALIZABLE: number[] = Const.ISOLATION_SERIALIZABLE;
export const ISOLATION_READ_COMMITTED_READ_ONLY: number[] = Const.ISOLATION_READ_COMMITTED_READ_ONLY;

export const escape = escapeValue;

/**
 * The most recent Connection created by attach()/create()/attachOrCreate().
 * Kept for backwards compatibility with the previous CommonJS module where
 * the connection was stored on the module object itself.
 */
export let connection: Connection | undefined;

export function attach(options: Options | string, callback: DatabaseCallback): void;
export function attach(options: SvcMgrOptions, callback: ServiceManagerCallback): void;
export function attach(options: any, callback: any): void {
    options = normalizeOptions(options);
    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;
    var manager = options.manager || false;
    var cnx = connection = new Connection(host, port, function(err: any) {

        if (err) {
            doError(err, callback);
            return;
        }

        cnx.connect(options, function(err: any) {
            if (err) {
                doError(err, callback);
            } else {
                if (manager)
                    cnx.svcattach(options, callback);
                else
                    cnx.attach(options, callback);
            }
        });

    }, options);
}

export function drop(options: Options | string, callback: SimpleCallback): void {
	attach(normalizeOptions(options), function(err: any, db: any) {
		if (err) {
			callback({ error: err, message: "Drop error" });
			return;
		}

		db.drop(callback);
	});
}

export function create(options: Options | string, callback: DatabaseCallback): void {
    options = normalizeOptions(options);
    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;
    var cnx = connection = new Connection(host, port, function(err: any) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" }, undefined as any);
            return;
        }

        cnx.connect(options, function(err: any) {
            if (err) {
                if (self.db) self.db.emit('error', err);
                doError(err, callback);
                return;
            }

            cnx.createDatabase(options, callback);
        });
    }, options);
}

export function attachOrCreate(options: Options | string, callback: DatabaseCallback): void {
    options = normalizeOptions(options);

    var host = options.host || Const.DEFAULT_HOST;
    var port = options.port || Const.DEFAULT_PORT;

    var cnx = connection = new Connection(host, port, function(err: any) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" }, undefined as any);
            return;
        }

        cnx.connect(options, function(err: any) {

            if (err) {
                doError(err, callback);
                return;
            }

            cnx.attach(options, function(err: any, ret: any) {

                if (!err) {
                    if (self.db)
                        self.db.emit('connect', ret);
                    doCallback(ret, callback);
                    return;
                }

                cnx.createDatabase(options, callback);
            });
        });

    }, options);
}

// Pooling
export function pool(max: number, options: Options | string): ConnectionPool {
	return new Pool(attach, max, Object.assign({}, normalizeOptions(options), { isPool: true }));
}

export { parseConnectionUri, parseConnectionString };
export { parseNamedPlaceholders } from './named-params';

/*
 * Promise / async-await API.
 * Wrappers over the callback functions above; the callback API stays
 * untouched. Rejections are always Error instances carrying the usual
 * Firebird properties (gdscode, gdsparams, ...).
 */

export function attachAsync(options: SvcMgrOptions): Promise<ServiceManager>;
export function attachAsync(options: Options | string): Promise<Database>;
export function attachAsync(options: any): Promise<any> {
    return fromCallback(function(cb) { attach(options, cb); });
}

export function createAsync(options: Options | string): Promise<Database> {
    return fromCallback(function(cb) { create(options, cb); });
}

export function attachOrCreateAsync(options: Options | string): Promise<Database> {
    return fromCallback(function(cb) { attachOrCreate(options, cb); });
}

export function dropAsync(options: Options | string): Promise<void> {
    return fromCallback(function(cb) { drop(options, cb); });
}
