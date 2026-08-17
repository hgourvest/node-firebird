import Const from './wire/const';
import { doError, doCallback, fromCallback, type Callback } from './callback';
import Connection from './wire/connection';
import Pool from './pool';
import PoolCluster from './pool-cluster';
import type { PoolClusterOptions } from './pool-cluster';
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

/** Preserve the result types produced by older node-firebird releases. */
export const NUMERIC_MODE_LEGACY = Const.NUMERIC_MODE_LEGACY;
/** Return safe INT64/INT128 coefficients as numbers and unsafe ones as exact strings. */
export const NUMERIC_MODE_SAFE = Const.NUMERIC_MODE_SAFE;
/** Return every INT64/INT128-backed fixed-point value as an exact string. */
export const NUMERIC_MODE_STRING = Const.NUMERIC_MODE_STRING;

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

// Database Parameter Buffer (DPB) constants
export const isc_dpb_version1: number = Const.isc_dpb_version1;
export const isc_dpb_version2: number = Const.isc_dpb_version2;
export const isc_dpb_cdd_pathname: number = Const.isc_dpb_cdd_pathname;
export const isc_dpb_allocation: number = Const.isc_dpb_allocation;
export const isc_dpb_journal: number = Const.isc_dpb_journal;
export const isc_dpb_page_size: number = Const.isc_dpb_page_size;
export const isc_dpb_num_buffers: number = Const.isc_dpb_num_buffers;
export const isc_dpb_buffer_length: number = Const.isc_dpb_buffer_length;
export const isc_dpb_debug: number = Const.isc_dpb_debug;
export const isc_dpb_garbage_collect: number = Const.isc_dpb_garbage_collect;
export const isc_dpb_verify: number = Const.isc_dpb_verify;
export const isc_dpb_sweep: number = Const.isc_dpb_sweep;
export const isc_dpb_enable_journal: number = Const.isc_dpb_enable_journal;
export const isc_dpb_disable_journal: number = Const.isc_dpb_disable_journal;
export const isc_dpb_dbkey_scope: number = Const.isc_dpb_dbkey_scope;
export const isc_dpb_number_of_users: number = Const.isc_dpb_number_of_users;
export const isc_dpb_trace: number = Const.isc_dpb_trace;
export const isc_dpb_no_garbage_collect: number = Const.isc_dpb_no_garbage_collect;
export const isc_dpb_damaged: number = Const.isc_dpb_damaged;
export const isc_dpb_license: number = Const.isc_dpb_license;
export const isc_dpb_sys_user_name: number = Const.isc_dpb_sys_user_name;
export const isc_dpb_encrypt_key: number = Const.isc_dpb_encrypt_key;
export const isc_dpb_activate_shadow: number = Const.isc_dpb_activate_shadow;
export const isc_dpb_sweep_interval: number = Const.isc_dpb_sweep_interval;
export const isc_dpb_delete_shadow: number = Const.isc_dpb_delete_shadow;
export const isc_dpb_force_write: number = Const.isc_dpb_force_write;
export const isc_dpb_begin_log: number = Const.isc_dpb_begin_log;
export const isc_dpb_quit_log: number = Const.isc_dpb_quit_log;
export const isc_dpb_no_reserve: number = Const.isc_dpb_no_reserve;
export const isc_dpb_user_name: number = Const.isc_dpb_user_name;
export const isc_dpb_password: number = Const.isc_dpb_password;
export const isc_dpb_password_enc: number = Const.isc_dpb_password_enc;
export const isc_dpb_sys_user_name_enc: number = Const.isc_dpb_sys_user_name_enc;
export const isc_dpb_interp: number = Const.isc_dpb_interp;
export const isc_dpb_online_dump: number = Const.isc_dpb_online_dump;
export const isc_dpb_old_file_size: number = Const.isc_dpb_old_file_size;
export const isc_dpb_old_num_files: number = Const.isc_dpb_old_num_files;
export const isc_dpb_old_file: number = Const.isc_dpb_old_file;
export const isc_dpb_old_start_page: number = Const.isc_dpb_old_start_page;
export const isc_dpb_old_start_seqno: number = Const.isc_dpb_old_start_seqno;
export const isc_dpb_old_start_file: number = Const.isc_dpb_old_start_file;
export const isc_dpb_old_dump_id: number = Const.isc_dpb_old_dump_id;
export const isc_dpb_lc_messages: number = Const.isc_dpb_lc_messages;
export const isc_dpb_lc_ctype: number = Const.isc_dpb_lc_ctype;
export const isc_dpb_cache_manager: number = Const.isc_dpb_cache_manager;
export const isc_dpb_shutdown: number = Const.isc_dpb_shutdown;
export const isc_dpb_online: number = Const.isc_dpb_online;
export const isc_dpb_shutdown_delay: number = Const.isc_dpb_shutdown_delay;
export const isc_dpb_reserved: number = Const.isc_dpb_reserved;
export const isc_dpb_overwrite: number = Const.isc_dpb_overwrite;
export const isc_dpb_sec_attach: number = Const.isc_dpb_sec_attach;
export const isc_dpb_connect_timeout: number = Const.isc_dpb_connect_timeout;
export const isc_dpb_dummy_packet_interval: number = Const.isc_dpb_dummy_packet_interval;
export const isc_dpb_gbak_attach: number = Const.isc_dpb_gbak_attach;
export const isc_dpb_sql_role_name: number = Const.isc_dpb_sql_role_name;
export const isc_dpb_set_page_buffers: number = Const.isc_dpb_set_page_buffers;
export const isc_dpb_working_directory: number = Const.isc_dpb_working_directory;
export const isc_dpb_sql_dialect: number = Const.isc_dpb_sql_dialect;
export const isc_dpb_set_db_readonly: number = Const.isc_dpb_set_db_readonly;
export const isc_dpb_set_db_sql_dialect: number = Const.isc_dpb_set_db_sql_dialect;
export const isc_dpb_gfix_attach: number = Const.isc_dpb_gfix_attach;
export const isc_dpb_gstat_attach: number = Const.isc_dpb_gstat_attach;
export const isc_dpb_set_db_charset: number = Const.isc_dpb_set_db_charset;
export const isc_dpb_gsec_attach: number = Const.isc_dpb_gsec_attach;
export const isc_dpb_address_path: number = Const.isc_dpb_address_path;
export const isc_dpb_process_id: number = Const.isc_dpb_process_id;
export const isc_dpb_no_db_triggers: number = Const.isc_dpb_no_db_triggers;
export const isc_dpb_trusted_auth: number = Const.isc_dpb_trusted_auth;
export const isc_dpb_process_name: number = Const.isc_dpb_process_name;
export const isc_dpb_trusted_role: number = Const.isc_dpb_trusted_role;
export const isc_dpb_org_filename: number = Const.isc_dpb_org_filename;
export const isc_dpb_utf8_filename: number = Const.isc_dpb_utf8_filename;
export const isc_dpb_ext_call_depth: number = Const.isc_dpb_ext_call_depth;
export const isc_dpb_auth_block: number = Const.isc_dpb_auth_block;
export const isc_dpb_client_version: number = Const.isc_dpb_client_version;
export const isc_dpb_remote_protocol: number = Const.isc_dpb_remote_protocol;
export const isc_dpb_host_name: number = Const.isc_dpb_host_name;
export const isc_dpb_os_user: number = Const.isc_dpb_os_user;
export const isc_dpb_specific_auth_data: number = Const.isc_dpb_specific_auth_data;
export const isc_dpb_auth_plugin_list: number = Const.isc_dpb_auth_plugin_list;
export const isc_dpb_auth_plugin_name: number = Const.isc_dpb_auth_plugin_name;
export const isc_dpb_config: number = Const.isc_dpb_config;
export const isc_dpb_nolinger: number = Const.isc_dpb_nolinger;
export const isc_dpb_reset_icu: number = Const.isc_dpb_reset_icu;
export const isc_dpb_map_attach: number = Const.isc_dpb_map_attach;
export const isc_dpb_session_time_zone: number = Const.isc_dpb_session_time_zone;
export const isc_dpb_set_db_replica: number = Const.isc_dpb_set_db_replica;
export const isc_dpb_set_bind: number = Const.isc_dpb_set_bind;
export const isc_dpb_decfloat_round: number = Const.isc_dpb_decfloat_round;
export const isc_dpb_decfloat_traps: number = Const.isc_dpb_decfloat_traps;
export const isc_dpb_clear_map: number = Const.isc_dpb_clear_map;
export const isc_dpb_upgrade_db: number = Const.isc_dpb_upgrade_db;
export const isc_dpb_parallel_workers: number = Const.isc_dpb_parallel_workers;
export const isc_dpb_worker_attach: number = Const.isc_dpb_worker_attach;
export const isc_dpb_owner: number = Const.isc_dpb_owner;
export const isc_dpb_max_blob_cache_size: number = Const.isc_dpb_max_blob_cache_size;
export const isc_dpb_max_inline_blob_size: number = Const.isc_dpb_max_inline_blob_size;
export const isc_dpb_search_path: number = Const.isc_dpb_search_path;

export const escape = escapeValue;

/**
 * Firebird SQL type codes, as seen in `column.type` inside a `typeCast`
 * hook (each code also has a friendly `column.typeName`).
 */
export const SQL_TYPES: Readonly<Record<string, number>> = Object.freeze({
    SQL_TEXT: Const.SQL_TEXT,
    SQL_VARYING: Const.SQL_VARYING,
    SQL_SHORT: Const.SQL_SHORT,
    SQL_LONG: Const.SQL_LONG,
    SQL_FLOAT: Const.SQL_FLOAT,
    SQL_DOUBLE: Const.SQL_DOUBLE,
    SQL_D_FLOAT: Const.SQL_D_FLOAT,
    SQL_TIMESTAMP: Const.SQL_TIMESTAMP,
    SQL_BLOB: Const.SQL_BLOB,
    SQL_ARRAY: Const.SQL_ARRAY,
    SQL_QUAD: Const.SQL_QUAD,
    SQL_TYPE_TIME: Const.SQL_TYPE_TIME,
    SQL_TYPE_DATE: Const.SQL_TYPE_DATE,
    SQL_INT64: Const.SQL_INT64,
    SQL_INT128: Const.SQL_INT128,
    SQL_TIMESTAMP_TZ: Const.SQL_TIMESTAMP_TZ,
    SQL_TIMESTAMP_TZ_EX: Const.SQL_TIMESTAMP_TZ_EX,
    SQL_TIME_TZ: Const.SQL_TIME_TZ,
    SQL_TIME_TZ_EX: Const.SQL_TIME_TZ_EX,
    SQL_DEC16: Const.SQL_DEC16,
    SQL_DEC34: Const.SQL_DEC34,
    SQL_BOOLEAN: Const.SQL_BOOLEAN,
    SQL_NULL: Const.SQL_NULL,
});

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

            cnx.createDatabase(options, callback as any);
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
                    // DatabaseCallback stays permissive (db non-optional) for
                    // API users; internally the error path passes no db
                    doCallback(ret, callback as Callback<Database>);
                    return;
                }

                cnx.createDatabase(options, callback as any);
            });
        });

    }, options);
}

// Pooling
export function pool(max: number, options: Options | string): ConnectionPool {
	return new Pool(attach, max, Object.assign({}, normalizeOptions(options), { isPool: true }));
}

/**
 * Multi-host pooling (primaries/replicas, failover): named nodes, each
 * backed by a regular pool, selected by glob pattern + 'rr'/'random'/
 * 'order' selector, with connection-failure failover and error-based
 * node offlining. See README § Multi-host pooling.
 */
export function poolCluster(options?: PoolClusterOptions): PoolCluster {
	const normalized: PoolClusterOptions = { ...(options || {}) };
	normalized.defaults = normalizeOptions(normalized.defaults || {});
	return new PoolCluster(attach, normalized);
}
export type { PoolClusterOptions, ClusterSelector } from './pool-cluster';

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
