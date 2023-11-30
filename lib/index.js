var
    net = require('net'),
    os = require('os'),
    Events = require('events'),
    stream = require('stream'),
    serialize = require('./serialize.js'),
    XdrReader = serialize.XdrReader,
    BlrReader = serialize.BlrReader,
    XdrWriter = serialize.XdrWriter,
    BlrWriter = serialize.BlrWriter,
	BitSet = serialize.BitSet,
    MessagesError = require('./firebird.msg.json'),
    crypt = require('./unix-crypt.js'),
    path = require('path'),
	srp = require('./srp'),
	BigInt = require('big-integer');

const Const = require('./wire/const');
const Xsql = require('./wire/xsqlvar');
const ServiceManager = require('./wire/service');
const {doError, doCallback} = require("./callback");

if (typeof(setImmediate) === 'undefined') {
    global.setImmediate = function(cb) {
        process.nextTick(cb);
    };
}

/**
 * Get Error Message per gdscode
 * @param {{gdscode: Number, params: Any[]}[]} status
 * @returns {String} - Error message
 */
const lookupMessages = (status) => {
    const messages = status.map((item) => {
        let text = MessagesError[item.gdscode];
        if (text === undefined) {
            return 'Unknow error';
        }
        if (item.params !== undefined) {
            item.params.forEach((param, i) => {
                text = text.replace('@' + (i + 1), param);
            });
        }
        return text;
    });
    return messages.join(', ');
}

/**
 * Parse date from string
 * @param {String} str
 * @return {Date}
 */
const parseDate = (str) => {
    const self = str.trim();
    const arr = self.indexOf(' ') === -1 ? self.split('T') : self.split(' ');
    let index = arr[0].indexOf(':');
    const length = arr[0].length;

    if (index !== -1) {
        const tmp = arr[1];
        arr[1] = arr[0];
        arr[0] = tmp;
    }

    if (arr[0] === undefined) {
        arr[0] = '';
    }

    const noTime = arr[1] === undefined || arr[1].length === 0;

    for (let i = 0; i < length; i++) {
        const c = arr[0].charCodeAt(i);
        if (c > 47 && c < 58) {
            continue;
        }
        if (c === 45 || c === 46) {
            continue;
        }
        if (noTime) {
            return new Date(self);
        }
    }

    if (arr[1] === undefined) {
        arr[1] = '00:00:00';
    }

    const firstDay = arr[0].indexOf('-') === -1;

    const date = (arr[0] || '').split(firstDay ? '.' : '-');
    const time = (arr[1] || '').split(':');

    if (date.length < 4 && time.length < 2) {
        return new Date(self);
    }

    index = (time[2] || '').indexOf('.');

    // milliseconds
    if (index !== -1) {
        time[3] = time[2].substring(index + 1);
        time[2] = time[2].substring(0, index);
    } else {
        time[3] = '0';
    }

    const parsed = [
        parseInt(date[firstDay ? 2 : 0], 10), // year
        parseInt(date[1], 10), // month
        parseInt(date[firstDay ? 0 : 2], 10), // day
        parseInt(time[0], 10), // hours
        parseInt(time[1], 10), // minutes
        parseInt(time[2], 10), // seconds
        parseInt(time[3], 10) // miliseconds
    ];

    const def = new Date();

    for (let i = 0; i < parsed.length; i++) {
        if (isNaN(parsed[i])) {
            parsed[i] = 0;
        }

        const value = parsed[i];
        if (value !== 0) {
            continue;
        }

        switch (i) {
            case 0:
                if (value <= 0) {
                    parsed[i] = def.getFullYear();
                }
                break;
            case 1:
                if (value <= 0) {
                    parsed[i] = def.getMonth() + 1;
                }
                break;
            case 2:
                if (value <= 0) {
                    parsed[i] = def.getDate();
                }
                break;
        }
    }

    return new Date(parsed[0], parsed[1] - 1, parsed[2], parsed[3], parsed[4], parsed[5]);
}

function noop() {}

const
    MAX_BUFFER_SIZE = 8192;

const
    op_void                   = 0,  // Packet has been voided
    op_connect                = 1,  // Connect to remote server
    op_exit                   = 2,  // Remote end has exitted
    op_accept                 = 3,  // Server accepts connection
    op_reject                 = 4,  // Server rejects connection
    op_disconnect             = 6,  // Connect is going away
    op_response               = 9,  // Generic response block

    // Full context server operations

    op_attach                 = 19, // Attach database
    op_create                 = 20, // Create database
    op_detach                 = 21, // Detach database
    op_compile                = 22, // Request based operations
    op_start                  = 23,
    op_start_and_send         = 24,
    op_send                   = 25,
    op_receive                = 26,
    op_unwind                 = 27, // apparently unused, see protocol.cpp's case op_unwind
    op_release                = 28,

    op_transaction            = 29, // Transaction operations
    op_commit                 = 30,
    op_rollback               = 31,
    op_prepare                = 32,
    op_reconnect              = 33,

    op_create_blob            = 34, // Blob operations
    op_open_blob              = 35,
    op_get_segment            = 36,
    op_put_segment            = 37,
    op_cancel_blob            = 38,
    op_close_blob             = 39,

    op_info_database          = 40, // Information services
    op_info_request           = 41,
    op_info_transaction       = 42,
    op_info_blob              = 43,

    op_batch_segments         = 44, // Put a bunch of blob segments

    op_que_events             = 48, // Que event notification request
    op_cancel_events          = 49, // Cancel event notification request
    op_commit_retaining       = 50, // Commit retaining (what else)
    op_prepare2               = 51, // Message form of prepare
    op_event                  = 52, // Completed event request (asynchronous)
    op_connect_request        = 53, // Request to establish connection
    op_aux_connect            = 54, // Establish auxiliary connection
    op_ddl                    = 55, // DDL call
    op_open_blob2             = 56,
    op_create_blob2           = 57,
    op_get_slice              = 58,
    op_put_slice              = 59,
    op_slice                  = 60, // Successful response to op_get_slice
    op_seek_blob              = 61, // Blob seek operation

// DSQL operations

    op_allocate_statement     = 62, // allocate a statment handle
    op_execute                = 63, // execute a prepared statement
    op_exec_immediate         = 64, // execute a statement
    op_fetch                  = 65, // fetch a record
    op_fetch_response         = 66, // response for record fetch
    op_free_statement         = 67, // free a statement
    op_prepare_statement      = 68, // prepare a statement
    op_set_cursor             = 69, // set a cursor name
    op_info_sql               = 70,

    op_dummy                  = 71, // dummy packet to detect loss of client
    op_response_piggyback     = 72, // response block for piggybacked messages
    op_start_and_receive      = 73,
    op_start_send_and_receive = 74,
    op_exec_immediate2        = 75, // execute an immediate statement with msgs
    op_execute2               = 76, // execute a statement with msgs
    op_insert                 = 77,
    op_sql_response           = 78, // response from execute, exec immed, insert
    op_transact               = 79,
    op_transact_response      = 80,
    op_drop_database          = 81,
    op_service_attach         = 82,
    op_service_detach         = 83,
    op_service_info           = 84,
    op_service_start          = 85,
    op_rollback_retaining     = 86,
    op_partial                = 89, // packet is not complete - delay processing
    op_trusted_auth           = 90,
    op_cancel                 = 91,
    op_cont_auth              = 92,
    op_ping                   = 93,
    op_accept_data            = 94, // Server accepts connection and returns some data to client
    op_abort_aux_connection   = 95, // Async operation - stop waiting for async connection to arrive
    op_crypt                  = 96,
    op_crypt_key_callback     = 97,
    op_cond_accept            = 98; // Server accepts connection, returns some data to client
                                    // and asks client to continue authentication before attach call

const
    CONNECT_VERSION2          = 2,
    CONNECT_VERSION3          = 3,
    ARCHITECTURE_GENERIC      = 1;

const
	// Protocol 10 includes support for warnings and removes the requirement for
	// encoding and decoding status codes
    PROTOCOL_VERSION10  = 10,

	// Since protocol 11 we must be separated from Borland Interbase.
	// Therefore always set highmost bit in protocol version to 1.
	// For unsigned protocol version this does not break version's compare.

    FB_PROTOCOL_FLAG    = 0x8000,
    FB_PROTOCOL_MASK    = ~FB_PROTOCOL_FLAG & 0xFFFF,

	// Protocol 11 has support for user authentication related
	// operations (op_update_account_info, op_authenticate_user and
	// op_trusted_auth). When specific operation is not supported,
	// we say "sorry".

    PROTOCOL_VERSION11  = (FB_PROTOCOL_FLAG | 11),

	// Protocol 12 has support for asynchronous call op_cancel.
	// Currently implemented asynchronously only for TCP/IP.

    PROTOCOL_VERSION12  = (FB_PROTOCOL_FLAG | 12),

	// Protocol 13 has support for authentication plugins (op_cont_auth).

    PROTOCOL_VERSION13  = (FB_PROTOCOL_FLAG | 13);

const
    CNCT_user = 1, // User name
    CNCT_passwd = 2,
	// CNCT_ppo = 3, // Apollo person, project, organization. OBSOLETE.
    CNCT_host = 4,
    CNCT_group = 5, // Effective Unix group id
    CNCT_user_verification = 6, // Attach/create using this connection will use user verification
    CNCT_specific_data = 7, // Some data, needed for user verification on server
    CNCT_plugin_name = 8, // Name of plugin, which generated that data
    CNCT_login = 9, // Same data as isc_dpb_user_name
    CNCT_plugin_list = 10, // List of plugins, available on client
    CNCT_client_crypt = 11, // Client encyption level (DISABLED/ENABLED/REQUIRED)
    WIRE_CRYPT_DISABLED = 0,
    WIRE_CRYPT_ENABLED = 1,
    WIRE_CRYPT_REQUIRED = 2;

const
    DSQL_close      = 1,
    DSQL_drop       = 2,
    DSQL_unprepare  = 4; // >= 2.5

// Protocols types (accept_type)
const
	ptype_rpc = 2, 			 // Simple remote procedure call
    ptype_batch_send = 3,    // Batch sends, no asynchrony
	ptype_out_of_band = 4,   // Batch sends w/ out of band notification
	ptype_lazy_send = 5,     // Deferred packets delivery;
	ptype_mask = 0xFF,       // Mask - up to 255 types of protocol
	pflag_compress = 0x100;  // Turn on compression if possible

const SUPPORTED_PROTOCOL = [
	[PROTOCOL_VERSION10, ARCHITECTURE_GENERIC, ptype_rpc, ptype_batch_send, 1],
	[PROTOCOL_VERSION11, ARCHITECTURE_GENERIC, ptype_lazy_send, ptype_lazy_send, 2],
	[PROTOCOL_VERSION12, ARCHITECTURE_GENERIC, ptype_lazy_send, ptype_lazy_send, 3],
	[PROTOCOL_VERSION13, ARCHITECTURE_GENERIC, ptype_lazy_send, ptype_lazy_send, 4],
];

const
    SQL_TEXT      = 452, // Array of char
    SQL_VARYING   = 448,
    SQL_SHORT     = 500,
    SQL_LONG      = 496,
    SQL_FLOAT     = 482,
    SQL_DOUBLE    = 480,
    SQL_D_FLOAT   = 530,
    SQL_TIMESTAMP = 510,
    SQL_BLOB      = 520,
    SQL_ARRAY     = 540,
    SQL_QUAD      = 550,
    SQL_TYPE_TIME = 560,
    SQL_TYPE_DATE = 570,
    SQL_INT64     = 580,
    SQL_BOOLEAN   = 32764, // >= 3.0
    SQL_NULL      = 32766; // >= 2.5



    // SHUTDOWN MODE



/***********************/
/*   ISC Error Codes   */
/***********************/
const
    isc_arg_end                     = 0,  // end of argument list
    isc_arg_gds                     = 1,  // generic DSRI status value
    isc_arg_string                  = 2,  // string argument
    isc_arg_cstring                 = 3,  // count & string argument
    isc_arg_number                  = 4,  // numeric argument (long)
    isc_arg_interpreted             = 5,  // interpreted status code (string)
    isc_arg_unix                    = 7,  // UNIX error code
    isc_arg_next_mach               = 15, // NeXT/Mach error code
    isc_arg_win32                   = 17, // Win32 error code
    isc_arg_warning                 = 18, // warning argument
    isc_arg_sql_state               = 19; // SQLSTATE

const
    isc_sqlerr = 335544436;

/*************************************/
/* Transaction parameter block stuff */
/*************************************/
const
    isc_tpb_version1                =  1,
    isc_tpb_version3                =  3,
    isc_tpb_consistency             =  1,
    isc_tpb_concurrency             =  2,
    isc_tpb_shared                  =  3, // < FB21
    isc_tpb_protected               =  4, // < FB21
    isc_tpb_exclusive               =  5, // < FB21
    isc_tpb_wait                    =  6,
    isc_tpb_nowait                  =  7,
    isc_tpb_read                    =  8,
    isc_tpb_write                   =  9,
    isc_tpb_lock_read               =  10,
    isc_tpb_lock_write              =  11,
    isc_tpb_verb_time               =  12,
    isc_tpb_commit_time             =  13,
    isc_tpb_ignore_limbo            =  14,
    isc_tpb_read_committed          =  15,
    isc_tpb_autocommit              =  16,
    isc_tpb_rec_version             =  17,
    isc_tpb_no_rec_version          =  18,
    isc_tpb_restart_requests        =  19,
    isc_tpb_no_auto_undo            =  20,
    isc_tpb_lock_timeout            =  21; // >= FB20

/*************************/
/* SQL information items */
/*************************/
const
    isc_info_sql_select             = 4,
    isc_info_sql_bind               = 5,
    isc_info_sql_num_variables      = 6,
    isc_info_sql_describe_vars      = 7,
    isc_info_sql_describe_end       = 8,
    isc_info_sql_sqlda_seq          = 9,
    isc_info_sql_message_seq        = 10,
    isc_info_sql_type               = 11,
    isc_info_sql_sub_type           = 12,
    isc_info_sql_scale              = 13,
    isc_info_sql_length             = 14,
    isc_info_sql_null_ind           = 15,
    isc_info_sql_field              = 16,
    isc_info_sql_relation           = 17,
    isc_info_sql_owner              = 18,
    isc_info_sql_alias              = 19,
    isc_info_sql_sqlda_start        = 20,
    isc_info_sql_stmt_type          = 21,
    isc_info_sql_get_plan           = 22,
    isc_info_sql_records            = 23,
    isc_info_sql_batch_fetch        = 24,
    isc_info_sql_relation_alias     = 25, // >= 2.0
    isc_info_sql_explain_plan       = 26; // >= 3.0

/*******************/
/* Blr definitions */
/*******************/
const
    blr_text            = 14,
    blr_text2           = 15,
    blr_short           = 7,
    blr_long            = 8,
    blr_quad            = 9,
    blr_float           = 10,
    blr_double          = 27,
    blr_d_float         = 11,
    blr_timestamp       = 35,
    blr_varying         = 37,
    blr_varying2        = 38,
    blr_blob            = 261,
    blr_cstring         = 40,
    blr_cstring2        = 41,
    blr_blob_id         = 45,
    blr_sql_date        = 12,
    blr_sql_time        = 13,
    blr_int64           = 16,
    blr_blob2           = 17, // >= 2.0
    blr_domain_name     = 18, // >= 2.1
    blr_domain_name2    = 19, // >= 2.1
    blr_not_nullable    = 20, // >= 2.1
    blr_column_name     = 21, // >= 2.5
    blr_column_name2    = 22, // >= 2.5
    blr_bool            = 23, // >= 3.0

    blr_version4        = 4,
    blr_version5        = 5, // dialect 3
    blr_eoc             = 76,
    blr_end             = 255,

    blr_assignment      = 1,
    blr_begin           = 2,
    blr_dcl_variable    = 3,
    blr_message         = 4;

const
    isc_info_sql_stmt_select          = 1,
    isc_info_sql_stmt_insert          = 2,
    isc_info_sql_stmt_update          = 3,
    isc_info_sql_stmt_delete          = 4,
    isc_info_sql_stmt_ddl             = 5,
    isc_info_sql_stmt_get_segment     = 6,
    isc_info_sql_stmt_put_segment     = 7,
    isc_info_sql_stmt_exec_procedure  = 8,
    isc_info_sql_stmt_start_trans     = 9,
    isc_info_sql_stmt_commit          = 10,
    isc_info_sql_stmt_rollback        = 11,
    isc_info_sql_stmt_select_for_upd  = 12,
    isc_info_sql_stmt_set_generator   = 13,
    isc_info_sql_stmt_savepoint       = 14;

const
    isc_blob_text = 1;

const DESCRIBE = [
	isc_info_sql_stmt_type,
	isc_info_sql_select,
	isc_info_sql_describe_vars,
	isc_info_sql_sqlda_seq,
	isc_info_sql_type,
	isc_info_sql_sub_type,
	isc_info_sql_scale,
	isc_info_sql_length,
	isc_info_sql_field,
	isc_info_sql_relation,
	//isc_info_sql_owner,
	isc_info_sql_alias,
	isc_info_sql_describe_end,
	isc_info_sql_bind,
	isc_info_sql_describe_vars,
	isc_info_sql_sqlda_seq,
	isc_info_sql_type,
	isc_info_sql_sub_type,
	isc_info_sql_scale,
	isc_info_sql_length,
	isc_info_sql_describe_end
];

const
    ISOLATION_READ_UNCOMMITTED          = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_rec_version],
    ISOLATION_READ_COMMITTED             = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version],
    ISOLATION_REPEATABLE_READ           = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_concurrency],
    ISOLATION_SERIALIZABLE              = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_consistency],
    ISOLATION_READ_COMMITTED_READ_ONLY   = [isc_tpb_version3, isc_tpb_read, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version];

const
    DEFAULT_HOST = '127.0.0.1',
    DEFAULT_PORT = 3050,
    DEFAULT_USER = 'SYSDBA',
    DEFAULT_PASSWORD = 'masterkey',
    DEFAULT_LOWERCASE_KEYS = false,
    DEFAULT_PAGE_SIZE = 4096,
    DEFAULT_SVC_NAME = 'service_mgr';

const AUTH_PLUGIN_LEGACY = 'Legacy_Auth',
 	  AUTH_PLUGIN_SRP = 'Srp';
	  // AUTH_PLUGIN_SRP256 = 'Srp256';

const
	// AUTH_PLUGIN_LIST = [AUTH_PLUGIN_SRP256, AUTH_PLUGIN_SRP, AUTH_PLUGIN_LEGACY],
	AUTH_PLUGIN_LIST = [AUTH_PLUGIN_SRP, AUTH_PLUGIN_LEGACY],
	// AUTH_PLUGIN_SRP_LIST = [AUTH_PLUGIN_SRP256, AUTH_PLUGIN_SRP],
	AUTH_PLUGIN_SRP_LIST = [AUTH_PLUGIN_SRP],
    LEGACY_AUTH_SALT = '9z',
	WIRE_CRYPT_DISABLE = 0,
	WIRE_CRYPT_ENABLE = 1;

exports.AUTH_PLUGIN_LEGACY = AUTH_PLUGIN_LEGACY;
exports.AUTH_PLUGIN_SRP = AUTH_PLUGIN_SRP;
// exports.AUTH_PLUGIN_SRP256 = AUTH_PLUGIN_SRP256;

exports.WIRE_CRYPT_DISABLE = WIRE_CRYPT_DISABLE;
exports.WIRE_CRYPT_ENABLE = WIRE_CRYPT_ENABLE;

exports.ISOLATION_READ_UNCOMMITTED = ISOLATION_READ_UNCOMMITTED;
exports.ISOLATION_READ_COMMITTED = ISOLATION_READ_COMMITTED;
exports.ISOLATION_REPEATABLE_READ = ISOLATION_REPEATABLE_READ;
exports.ISOLATION_SERIALIZABLE = ISOLATION_SERIALIZABLE;
exports.ISOLATION_READ_COMMITTED_READ_ONLY = ISOLATION_READ_COMMITTED_READ_ONLY;

if (!String.prototype.padLeft) {
    String.prototype.padLeft = function(max, c) {
        var self = this;
        return new Array(Math.max(0, max - self.length + 1)).join(c || ' ') + self;
    };
}

/**
 * Escape value
 * @param {Object} value
 * @param {Number} protocolVersion (optional, default: PROTOCOL_VERSION13)
 * @return {String}
 */
exports.escape = function(value, protocolVersion) {

    if (value === null || value === undefined)
        return 'NULL';

    switch (typeof(value)) {
        case 'boolean':
            if ((protocolVersion || PROTOCOL_VERSION13) >= PROTOCOL_VERSION13)
                return value ? 'true' : 'false';
            else
                return value ? '1' : '0';
        case 'number':
            return value.toString();
        case 'string':
            return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
    }

    if (value instanceof Date)
        return "'" + value.getFullYear() + '-' + (value.getMonth()+1).toString().padLeft(2, '0') + '-' + value.getDate().toString().padLeft(2, '0') + ' ' + value.getHours().toString().padLeft(2, '0') + ':' + value.getMinutes().toString().padLeft(2, '0') + ':' + value.getSeconds().toString().padLeft(2, '0') + '.' + value.getMilliseconds().toString().padLeft(3, '0') + "'";

    throw new Error('Escape supports only primitive values.');
};

const
    DEFAULT_ENCODING = 'utf8',
    DEFAULT_FETCHSIZE = 200;

const
    MAX_INT = Math.pow(2, 31) - 1,
    MIN_INT = - Math.pow(2, 31);

/***************************************
 *
 *   Statement
 *
 ***************************************/

function Statement(connection) {
    this.connection = connection;
}

Statement.prototype.close = function(callback) {
    this.connection.closeStatement(this, callback);
};

Statement.prototype.drop = function(callback) {
    this.connection.dropStatement(this, callback);
};

Statement.prototype.release = function(callback) {
    var cache_query = this.connection.getCachedQuery(this.query);
    if (cache_query)
        this.connection.closeStatement(this, callback);
    else
        this.connection.dropStatement(this, callback);
};

Statement.prototype.execute = function(transaction, params, callback, custom) {

    if (params instanceof Function) {
        custom = callback;
        callback = params;
        params = undefined;
    }

    this.custom = custom;
    this.connection.executeStatement(transaction, this, params, callback, custom);
};

Statement.prototype.fetch = function(transaction, count, callback) {
    this.connection.fetch(this, transaction, count, callback);
};

Statement.prototype.fetchAll = function(transaction, callback) {
    this.connection.fetchAll(this, transaction, callback);
};

/***************************************
 *
 *   Transaction
 *
 ***************************************/

function Transaction(connection) {
    this.connection = connection;
    this.db = connection.db;
}

Transaction.prototype.newStatement = function(query, callback) {
    var cnx = this.connection;
    var self = this;
    var query_cache = cnx.getCachedQuery(query);

    if (query_cache) {
        callback(null, query_cache);
    } else {
    	cnx.prepare(self, query, false, callback);
    }
};

Transaction.prototype.execute = function(query, params, callback, custom) {

    if (params instanceof Function) {
        custom = callback;
        callback = params;
        params = undefined;
    }

    var self = this;
    this.newStatement(query, function(err, statement) {
        if (err) {
            doError(err, callback);
            return;
        }

        function dropError(err) {
            statement.release();
            doCallback(err, callback);
        }

        statement.execute(self, params, function(err, ret) {
            if (err) {
                dropError(err);
                return;
            }

            switch (statement.type) {
                case isc_info_sql_stmt_select:
                    statement.fetchAll(self, function(err, r) {
                        if (err) {
                            dropError(err);
                            return;
                        }

                        statement.release();

                        if (callback)
                            callback(undefined, r, statement.output, true);

                    });

                    break;

                case isc_info_sql_stmt_exec_procedure:
                	if (ret && ret.data && ret.data.length > 0) {
						statement.release();

						if (callback)
							callback(undefined, ret.data[0], statement.output, true);

						break;
					} else if (statement.output.length) {
                        statement.fetch(self, 1, function(err, ret) {
                            if (err) {
                                dropError(err);
                                return;
                            }

                            statement.release();

                            if (callback)
                                callback(undefined, ret.data[0], statement.output, false);
                        });

                        break;
                    }

                // Fall through is normal
                default:
                    statement.release();
                    if (callback)
                        callback()
                    break;
            }

        }, custom);
    });
};

Transaction.prototype.sequentially = function (query, params, on, callback, asArray) {

	if (params instanceof Function) {
		asArray = callback;
		callback = on;
		on = params;
		params = undefined;
	}

	if (on === undefined){
		throw new Error('Expected "on" delegate.');
	}

	if (callback instanceof Boolean) {
		asArray = callback;
		callback = undefined;
	}

	var self = this;
	self.execute(query, params, callback, { asObject: !asArray, asStream: true, on: on });
	return self;
};

Transaction.prototype.query = function(query, params, callback) {

    if (params instanceof Function) {
        callback = params;
        params = undefined;
    }

    if (callback === undefined)
        callback = noop;

    this.execute(query, params, callback, { asObject: true, asStream: callback === undefined || callback === null });

};

Transaction.prototype.commit = function(callback) {
    this.connection.commit(this, callback);
};

Transaction.prototype.rollback = function(callback) {
    this.connection.rollback(this, callback);
};

Transaction.prototype.commitRetaining = function(callback) {
    this.connection.commitRetaining(this, callback);
};

Transaction.prototype.rollbackRetaining = function(callback) {
    this.connection.rollbackRetaining(this, callback);
};

/***************************************
 *
 *   Database
 *
 ***************************************/

function Database(connection) {
    this.connection = connection;
    connection.db = this;
}

Database.prototype.__proto__ = Object.create(Events.EventEmitter.prototype, {
    constructor: {
        value: Database,
        enumberable: false
    }
});

Database.prototype.escape = function(value) {
    return exports.escape(value, this.connection.accept.protocolVersion);
};

Database.prototype.detach = function(callback, force) {

    var self = this;

    if (!force && self.connection._pending.length > 0) {
        self.connection._detachAuto = true;
        self.connection._detachCallback = callback;
        return self;
    }

    if (self.connection._pooled === false) {
        self.connection.detach(function (err, obj) {

            self.connection.disconnect();
            self.emit('detach', false);

            if (callback)
                callback(err, obj);

        }, force);
    } else {
        self.emit('detach', false);
        if (callback)
            callback();
    }

    return self;
};

Database.prototype.transaction = function(isolation, callback) {
    return this.startTransaction(isolation, callback);
};

Database.prototype.startTransaction = function(isolation, callback) {
    this.connection.startTransaction(isolation, callback);
    return this;
};

Database.prototype.newStatement = function (query, callback) {

    this.startTransaction(function(err, transaction) {

        if (err) {
            callback(err);
            return;
        }

        transaction.newStatement(query, function(err, statement) {

            if (err) {
                callback(err);
                return;
            }

            transaction.commit(function(err) {
                callback(err, statement);
            });
        });
    });

    return this;
};

Database.prototype.execute = function(query, params, callback, custom) {

    if (params instanceof Function) {
        custom = callback;
        callback = params;
        params = undefined;
    }

    var self = this;

    self.connection.startTransaction(function(err, transaction) {

        if (err) {
            doError(err, callback);
            return;
        }

        transaction.execute(query, params, function(err, result, meta, isSelect) {
            if (err) {
                transaction.rollback(function() {
                    doError(err, callback);
                });
                return;
            }

            transaction.commit(function(err) {
                if (callback)
                    callback(err, result, meta, isSelect);
            });

        }, custom);
    });

    return self;
};

Database.prototype.sequentially = function(query, params, on, callback, asArray) {

	if (params instanceof Function) {
		asArray = callback;
		callback = on;
		on = params;
		params = undefined;
	}

	if (on === undefined){
		throw new Error('Expected "on" delegate.');
	}

	if (callback instanceof Boolean) {
		asArray = callback;
		callback = undefined;
	}

	var self = this;
	self.execute(query, params, callback, { asObject: !asArray, asStream: true, on: on });
	return self;
};

Database.prototype.query = function(query, params, callback) {

    if (params instanceof Function) {
        callback = params;
        params = undefined;
    }

    var self = this;
    self.execute(query, params, callback, { asObject: true, asStream: callback === undefined || callback === null });
    return self;
};

Database.prototype.drop = function(callback) {
	return this.connection.dropDatabase(callback);
};

exports.attach = function(options, callback) {

    var host = options.host || DEFAULT_HOST;
    var port = options.port || DEFAULT_PORT;
    var manager = options.manager || false;
    var cnx = this.connection = new Connection(host, port, function(err) {

        if (err) {
            doError(err, callback);
            return;
        }

        cnx.connect(options, function(err) {
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
};

exports.drop = function(options, callback) {
	exports.attach(options, function(err, db) {
		if (err) {
			callback({ error: err, message: "Drop error" });
			return;
		}

		db.drop(callback);
	});
};

exports.create = function(options, callback) {
    var host = options.host || DEFAULT_HOST;
    var port = options.port || DEFAULT_PORT;
    var cnx = this.connection = new Connection(host, port, function(err) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" });
            return;
        }

        cnx.connect(options, function(err) {
            if (err) {
                self.db.emit('error', err);
                doError(err, callback);
                return;
            }

            cnx.createDatabase(options, callback);
        });
    }, options);
};

exports.attachOrCreate = function(options, callback) {

    var host = options.host || DEFAULT_HOST;
    var port = options.port || DEFAULT_PORT;

    var cnx = this.connection = new Connection(host, port, function(err) {

        var self = cnx;

        if (err) {
            callback({ error: err, message: "Connect error" });
            return;
        }

        cnx.connect(options, function(err) {

            if (err) {
                doError(err, callback);
                return;
            }

            cnx.attach(options, function(err, ret) {

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
};

// Pooling
exports.pool = function(max, options) {
	return new Pool(max, Object.assign({}, options, { isPool: true }));
};

/***************************************
 *
 *   Simple Pooling
 *
 ***************************************/

function Pool(max, options) {
    this.internaldb = []; // connection created by the pool (for destroy)
    this.pooldb = []; // available connection in the pool
    this.dbinuse = 0; // connection currently in use into the pool
    this.max = max || 4;
    this.pending = [];
    this.options = options;
}

Pool.prototype.get = function(callback) {
    var self = this;
    self.pending.push(callback);
    self.check();
    return self;
};

Pool.prototype.check = function() {

    var self = this;
    if (self.dbinuse >= self.max)
        return self;

    var cb = self.pending.shift();
    if (!cb)
        return self;
    self.dbinuse++;
    if (self.pooldb.length) {
        cb(null, self.pooldb.shift());
    } else {
        exports.attach(self.options, function (err, db) {
            if (!err) {
                self.internaldb.push(db);
                db.on('detach', function () {
                    // also in pool (could be a twice call to detach)
                    if (self.pooldb.indexOf(db) !== -1 || self.internaldb.indexOf(db) === -1)
                        return;
                    // if not usable don't put in again in the pool and remove reference on it
                    if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled === false)
                        self.internaldb.splice(self.internaldb.indexOf(db), 1);
                    else
                        self.pooldb.push(db);

                    if (db.connection._pooled)
                        self.dbinuse--;
                    self.check();
                });
            } else {
                // attach fail so not in the pool
                self.dbinuse--;
            }

            cb(err, db);
        });
    }
    setImmediate(function() {
        self.check();
    });

    return self;
};

Pool.prototype.destroy = function(callback) {
    var self = this;

    var connectionCount = this.internaldb.length;

    if (connectionCount === 0 && callback) {
        callback();
    }

    function detachCallback(err) {
        if (err) {
            if (callback) {
                callback(err);
            }
            return;
        }

        connectionCount--;
        if (connectionCount === 0 && callback) {
            callback();
        }
    }

    this.internaldb.forEach(function(db) {
        if (db.connection._pooled === false) {
            detachCallback();
            return;
        }
        // check if the db is not free into the pool otherwise user should manual detach it
        var _db_in_pool = self.pooldb.indexOf(db);
        if (_db_in_pool !== -1) {
            self.pooldb.splice(_db_in_pool, 1);
            db.connection._pooled = false;
            db.detach(detachCallback);
        }
    });
};

/***************************************
 *
 *   Connection
 *
 ***************************************/

var Connection = exports.Connection = function (host, port, callback, options, db, svc) {
    var self = this;
    this.db = db;
    this.svc = svc
    this._msg = new XdrWriter(32);
    this._blr = new BlrWriter(32);
    this._queue = [];
    this._detachTimeout;
    this._detachCallback;
    this._detachAuto;
    this._socket = net.createConnection(port, host);
    this._pending = [];
    this._isOpened = false;
    this._isClosed = false;
    this._isDetach = false;
    this._isUsed = false;
    this._pooled = options.isPool||false;
    this.options = options;
    this._bind_events(host, port, callback);
    this.error;
    this._retry_connection_id;
    this._retry_connection_interval = options.retryConnectionInterval || 1000;
    this._max_cached_query = options.maxCachedQuery || -1;
    this._cache_query = options.cacheQuery?{}:null;
    this._messageFile = options.messageFile || path.join(__dirname, 'firebird.msg');
};

exports.Connection.prototype._setcachedquery = function (query, statement) {
    if (this._cache_query){
		if (this._max_cached_query === -1 || this._max_cached_query > Object.keys(this._cache_query).length){
			this._cache_query[query] = statement;
		}
	}


};

exports.Connection.prototype.getCachedQuery = function (query) {
        return this._cache_query ? this._cache_query[query] : null;
};

exports.Connection.prototype._bind_events = function(host, port, callback) {

    var self = this;

    self._socket.on('close', function() {

        if (!self._isOpened || self._isDetach) {
            return;
        }

        self._isOpened = false;

        if (!self.db) {
            if (callback)
                callback(self.error);
            return;
        }

       self._retry_connection_id = setTimeout(function() {
            self._socket.removeAllListeners();
            self._socket = null;

            var ctx = new Connection(host, port, function(err) {
                ctx.connect(self.options, function(err) {

                    if (err) {
                        self.db.emit('error', err);
                        return;
                    }

                    ctx.attach(self.options, function(err) {

                        if (err) {
                            self.db.emit('error', err);
                            return;
                        }

                        ctx._queue = ctx._queue.concat(self._queue);
                        ctx._pending = ctx._pending.concat(self._pending);
                        self.db.emit('reconnect');

                    }, self.db);
                });

				Object.assign(self, ctx);

            }, self.options, self.db);
        }, self._retry_connection_interval);

    });

    self._socket.on('error', function(e) {

        self.error = e;

        if (self.db)
            self.db.emit('error', e)

        if (callback)
            callback(e);

    });

    self._socket.on('connect', function() {
        self._isClosed = false;
        self._isOpened = true;
        if (callback)
            callback();
    });

    self._socket.on('data', function (data) {
        var xdr;

        if (!self._xdr) {
            xdr = new XdrReader(data);
        } else {
            xdr = new XdrReader(Buffer.concat([self._xdr.buffer, data], self._xdr.buffer.length + data.length));
            delete (self._xdr);
        }

        while (xdr.pos < xdr.buffer.length) {
            var cb = self._queue[0], pos = xdr.pos;

            decodeResponse(xdr, cb, self, self._lowercase_keys, function (err, obj) {

                if (err) {
                    xdr.buffer = xdr.buffer.slice(pos);
                    xdr.pos = 0;
                    self._xdr = xdr;

                    if (self.accept.protocolMinimumType === ptype_lazy_send && self._queue.length > 0) {
                        self._queue[0].lazy_count = 2;
                    }
                    return;
                }

                // remove the op flag, needed for partial packet
                if (xdr.r) {
                    delete (xdr.r);
                }

                self._queue.shift();
                self._pending.shift();

                if (obj && obj.status) {
                    obj.message = lookupMessages(obj.status);
                    doCallback(obj, cb);
                } else {
                    doCallback(obj, cb);
                }

            });

            if (xdr.pos === 0) {
                break;
            }
        }

        if (!self._detachAuto || self._pending.length !== 0) {
            return;
        }

        clearTimeout(self._detachTimeout);
        self._detachTimeout = setTimeout(function () {
            self.db.detach(self._detachCallback);
            self._detachAuto = false;
        }, 100);

    });
}

exports.Connection.prototype.disconnect = function() {
    this._socket.end();
};


function decodeResponse(data, callback, cnx, lowercase_keys, cb) {
    try {
        do {
            var r = data.r || data.readInt();
        } while (r === op_dummy);

        var item, op, response;

        switch (r) {
            case op_response:

                if (callback) {
                    response = callback.response || {};
                } else {
                    response = {};
                }

                let loop = function (err) {
                    if (err) {
                        return cb(err);
                    } else {
                        if (callback && callback.lazy_count) {
                            callback.lazy_count--;
                            if (callback.lazy_count > 0) {
                                r = data.readInt(); // Read new op
                                parseOpResponse(data, response, loop);
                            } else {
                                cb(null, response);
                            }
                        } else {
                            cb(null, response);
                        }
                    }
                };
                // Parse normal and lazy response
                return parseOpResponse(data, response, loop);
            case op_fetch_response:
            case op_sql_response:
                var statement = callback.statement;
                var output = statement.output;
                var custom = statement.custom || {};
                var isOpFetch = r === op_fetch_response;
                var _xdrpos;
                statement.nbrowsfetched = statement.nbrowsfetched || 0;

                if (isOpFetch && data.fop) { // could be set when a packet is not complete
                    data.readBuffer(68); // ??
                    op = data.readInt(); // ??
                    data.fop = false;
                    if (op === op_response) {
                        return parseOpResponse(data, {}, cb);
                    }
                }

                if (!isOpFetch) {
                    data.fstatus = 0;
                }

                data.fstatus = data.fstatus !== undefined ? data.fstatus : data.readInt();
                data.fcount = data.fcount !== undefined ? data.fcount : data.readInt();
                data.fcolumn = data.fcolumn || 0;
                data.frow = data.frow || (custom.asObject ? {} : new Array(output.length));
                data.frows = data.frows || [];

                if (custom.asObject && !data.fcols) {
                    if (lowercase_keys) {
                        data.fcols = output.map((column) => column.alias.toLowerCase());
                    } else {
                        data.fcols = output.map((column) => column.alias);
                    }
                }

                const arrBlob = [];
                const lowerV13 = statement.connection.accept.protocolVersion < PROTOCOL_VERSION13;

                while (data.fcount && (data.fstatus !== 100)) {
                    let nullBitSet;
                    if (!lowerV13) {
                        const nullBitsLen = Math.floor((output.length + 7) / 8);
                        nullBitSet = new BitSet(data.readBuffer(nullBitsLen, false));
                        data.readBuffer((4 - nullBitsLen) & 3, false); // Skip padding
                    }

                    for (let length = output.length; data.fcolumn < length; data.fcolumn++) {
                        item = output[data.fcolumn];
                        
                        if (!lowerV13 && nullBitSet.get(data.fcolumn)) {
                            if (custom.asObject) {
                                data.frow[data.fcols[data.fcolumn]] = null;
                            } else {
                                data.frow[data.fcolumn] = null;
                            }

                            continue;
                        }

                        try {
                            _xdrpos = data.pos;
                            const key = custom.asObject ? data.fcols[data.fcolumn] : data.fcolumn;
                            const row = data.frows.length;
                            let value = item.decode(data, lowerV13);

                            if (item.type === SQL_BLOB && value !== null) {
                                if (item.subType === isc_blob_text && cnx.options.blobAsText) {
                                    value = fetch_blob_async_transaction(statement, value, key, row);
                                    arrBlob.push(value);
                                } else {
                                    value = fetch_blob_async(statement, value, key, row);
                                }
                            }

                            data.frow[key] = value;
                        } catch (e) {
                            // uncomplete packet read
                            data.pos = _xdrpos;
                            data.r = r;
                            return cb(new Error('Packet is not complete'));
                        }

                    }

                    data.fcolumn = 0;
                    // ToDo: emit "row" with blob subtype string decoded
                    // use: data.frow['fieldBlob'](transaction?).then(({ value }) => console.log(value))
                    // arg "transaction" is optional
                    statement.connection.db.emit('row', data.frow, statement.nbrowsfetched, custom.asObject);
                    data.frows.push(data.frow);
                    data.frow = custom.asObject ? {} : new Array(output.length);

                    try {
                        _xdrpos = data.pos;
                        if (isOpFetch) {
                            delete data.fstatus;
                            delete data.fcount;
                            op = data.readInt(); // ??
                            if (op === op_response) {
                                return parseOpResponse(data, {}, cb);
                            }
                            data.fstatus = data.readInt();
                            data.fcount = data.readInt();
                        } else {
                            data.fcount--;
                            if (r === op_sql_response) {
                                op = data.readInt();
                                if (op === op_response) {
                                    parseOpResponse(data, {});
                                }
                            }
                        }
                    } catch (e) {
                        if (_xdrpos === data.pos) {
                            data.fop = true;
                        }
                        data.r = r;
                        return cb(new Error("Packet is not complete"));
                    }
                    statement.nbrowsfetched++;
                }

                // ToDo: emit "result" with blob subtype string decoded
                statement.connection.db.emit('result', data.frows, arrBlob);
                return cb(null, {data: data.frows, fetched: Boolean(!isOpFetch || data.fstatus === 100), arrBlob});
            case op_accept:
            case op_cond_accept:
            case op_accept_data:
                let accept = {
                    protocolVersion: data.readInt(),
                    protocolArchitecture: data.readInt(),
                    protocolMinimumType: data.readInt(),
                    pluginName: '',
                    authData: '',
					sessionKey: ''
                };

                accept.protocolMinimumType = accept.protocolMinimumType & 0xFF;
				//accept.compress = (accept.acceptType & pflag_compress) !== 0; // TODO Handle zlib compression
                if (accept.protocolVersion < 0) {
                    accept.protocolVersion = (accept.protocolVersion & FB_PROTOCOL_MASK) | FB_PROTOCOL_FLAG;
                }

                if (r === op_cond_accept || r === op_accept_data) {
                    var d = new BlrReader(data.readArray());
                    accept.pluginName = data.readString(DEFAULT_ENCODING);
                    var is_authenticated = data.readInt();
                    var keys = data.readString(DEFAULT_ENCODING); // keys

                    if (is_authenticated === 0) {
                    	if (cnx.options.pluginName && cnx.options.pluginName !== accept.pluginName) {
                    		doError(new Error('Server don\'t accept plugin : ' + cnx.options.pluginName + ', but support : ' + accept.pluginName), callback);
						}

                    	if (AUTH_PLUGIN_SRP_LIST.indexOf(accept.pluginName) !== -1) {
							var crypto = {
								Srp: 'sha1',
								Srp256: 'sha256'
							};
							accept.srpAlgo = crypto[accept.pluginName];

							// TODO : Fallback Srp256 to Srp ?
							/*if (!d.buffer) {
								cnx.sendOpContAuth(
									cnx.clientKeys.public.toString(16),
									DEFAULT_ENCODING,
									accept.pluginName
								);

								return cb(new Error('login'));
							}*/

							// Check buffer contains salt
							var saltLen = d.buffer.readUInt16LE(0);
							if (saltLen > 32 * 2) {
								console.log('salt to long'); // TODO : Throw error
							}

							// Check buffer contains key
							var keyLen = d.buffer.readUInt16LE(saltLen + 2);
							var keyStart = saltLen + 4;
							if (d.buffer.length - keyStart !== keyLen) {
								console.log('key error'); // TODO : Throw error
							}

							// Server keys
							cnx.serverKeys = {
								salt: d.buffer.slice(2, saltLen + 2).toString('utf8'),
								public: BigInt(d.buffer.slice(keyStart, d.buffer.length).toString('utf8'), 16)
							};

							var proof = srp.clientProof(
								cnx.options.user.toUpperCase(),
								cnx.options.password,
								cnx.serverKeys.salt,
								cnx.clientKeys.public,
								cnx.serverKeys.public,
								cnx.clientKeys.private,
								accept.srpAlgo
							);

							accept.authData = proof.authData.toString(16);
							accept.sessionKey = proof.clientSessionKey;
						} else if (accept.pluginName === AUTH_PLUGIN_LEGACY) {
                            accept.authData = crypt.crypt(cnx.options.password, LEGACY_AUTH_SALT).substring(2);
                        } else {
                            return cb(new Error('Unknow auth plugin : ' + accept.pluginName));
                        }
                    } else {
                        accept.authData = '';
                        accept.sessionKey = '';
                    }
                }

                return cb(undefined, accept);
			case op_cont_auth:
				var d = new BlrReader(data.readArray());
				var pluginName = data.readString(DEFAULT_ENCODING);
				data.readString(DEFAULT_ENCODING); // plist
				data.readString(DEFAULT_ENCODING); // pkey

				if (!cnx.options.pluginName) {
					if (cnx.accept.pluginName === pluginName) {
						// Erreur plugin not able to connect
						return cb(new Error("Unable to connect with plugin " + cnx.accept.pluginName));
					}

					if (pluginName === AUTH_PLUGIN_LEGACY) { // Fallback to LegacyAuth
						cnx.accept.pluginName = pluginName;
						cnx.accept.authData = crypt.crypt(cnx.options.password, LEGACY_AUTH_SALT).substring(2);

						cnx.sendOpContAuth(
							cnx.accept.authData,
							DEFAULT_ENCODING,
							pluginName
						);

						return {error: new Error('login')};
					}
				}

				return data.accept;
            default:
                return cb(new Error('Unexpected:' + r));
        }
    } catch (err) {
        if (err instanceof RangeError) {
            return cb(err);
        }
        throw err;
    }
}

function parseOpResponse(data, response, cb) {
    var handle = data.readInt();

    if (!response.handle) {
        response.handle = handle;
    }

    var oid = data.readQuad();
    if (oid.low || oid.high) {
        response.oid = oid;
    }

    var buf = data.readArray();
    if (buf) {
        response.buffer = buf;
    }

    var num, op, item = {};
    while (true) {
        op = data.readInt();

        switch (op) {
            case isc_arg_end:
                return cb ? cb(undefined, response) : response;
            case isc_arg_gds:
                num = data.readInt();
                if (!num) {
                    break;
                }

                item = {gdscode: num};

                if (response.status) {
                    response.status.push(item);
                } else {
                    response.status = [item];
                }

                break;
            case isc_arg_string:
            case isc_arg_interpreted:
            case isc_arg_sql_state:
                if (item.params) {
                    var str = data.readString(DEFAULT_ENCODING);
                    item.params.push(str);
                } else {
                    item.params = [data.readString(DEFAULT_ENCODING)];
                }

                break;
            case isc_arg_number:
                num = data.readInt();

                if (item.params) {
                    item.params.push(num);
                } else {
                    item.params = [num];
                }

                if (item.gdscode === isc_sqlerr) {
                    response.sqlcode = num;
                }

                break;
            default:
                if (cb) {
                    cb(new Error('Unexpected: ' + op))
                } else {
                    throw new Error('Unexpected: ' + op);
                }
        }
    }
}

Connection.prototype.sendOpContAuth = function(authData, authDataEnc, pluginName) {
	var msg = this._msg;
	msg.pos = 0;

	msg.addInt(op_cont_auth);
	msg.addString(authData, authDataEnc);
	msg.addString(pluginName, DEFAULT_ENCODING)
	msg.addString(AUTH_PLUGIN_LIST.join(','), DEFAULT_ENCODING);
	// msg.addInt(0); // p_list
	msg.addInt(0); // keys

	this._socket.write(msg.getData());
}

Connection.prototype._queueEvent = function(callback){
    var self = this;

    if (self._isClosed) {
        if (callback)
            callback(new Error('Connection is closed.'));
        return;
    }

    self._queue.push(callback);
    self._socket.write(self._msg.getData());
};

Connection.prototype.connect = function (options, callback) {
	var pluginName = options.manager ? AUTH_PLUGIN_LEGACY : options.pluginName || AUTH_PLUGIN_LIST[0]; // TODO Srp for service
    var msg = this._msg;
    var blr = this._blr;

    this._pending.push('connect');

    msg.pos = 0;
    blr.pos = 0;

	blr.addString(CNCT_login, options.user, DEFAULT_ENCODING);
	blr.addString(CNCT_plugin_name, pluginName, DEFAULT_ENCODING);
	blr.addString(CNCT_plugin_list, AUTH_PLUGIN_LIST.join(','), DEFAULT_ENCODING);

	var specificData = '';
	if (AUTH_PLUGIN_SRP_LIST.indexOf(pluginName) > -1) {
		this.clientKeys = srp.clientSeed();
		specificData = this.clientKeys.public.toString(16);
		blr.addMultiblockPart(CNCT_specific_data, specificData, DEFAULT_ENCODING);
	} else if (pluginName === AUTH_PLUGIN_LEGACY) {
		specificData = crypt.crypt(options.password, LEGACY_AUTH_SALT).substring(2);
		blr.addMultiblockPart(CNCT_specific_data, specificData, DEFAULT_ENCODING);
	} else {
		doError(new Error('Invalide auth plugin \'' + pluginName + '\''), callback);
		return;
	}
	blr.addBytes([CNCT_client_crypt, 4, WIRE_CRYPT_DISABLE, 0, 0, 0]); // WireCrypt = Disabled
	blr.addString(CNCT_user, os.userInfo().username || 'Unknown', DEFAULT_ENCODING);
    blr.addString(CNCT_host, os.hostname(), DEFAULT_ENCODING);
    blr.addBytes([CNCT_user_verification, 0]);

	msg.addInt(op_connect);
	msg.addInt(op_attach);
	msg.addInt(CONNECT_VERSION3);
	msg.addInt(ARCHITECTURE_GENERIC);
	msg.addString(options.database || options.filename, DEFAULT_ENCODING);
	msg.addInt(SUPPORTED_PROTOCOL.length);  // Count of Protocol version understood count.
    msg.addBlr(this._blr);

    for (var protocol of SUPPORTED_PROTOCOL) {
    	msg.addInt(protocol[0]); // Version
    	msg.addInt(protocol[1]); // Architecture
    	msg.addInt(protocol[2]); // Min type
    	msg.addInt(protocol[3]); // Max type
    	msg.addInt(protocol[4]); // Preference weight
	}

	var self = this;
	function cb(err, ret) {
		if (err) {
			doError(err, callback);
			return;
		}

		self.accept = ret;
		if (callback)
			callback(undefined, ret);
	}

    this._queueEvent(cb);
};

Connection.prototype.attach = function (options, callback, db) {
    this._lowercase_keys = options.lowercase_keys || DEFAULT_LOWERCASE_KEYS;

    var database = options.database || options.filename;
    if (database == null || database.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var role = options.role;
    var self = this;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addByte(Const.isc_dpb_version1);
    blr.addString(Const.isc_dpb_lc_ctype, options.encoding || 'UTF8', DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, DEFAULT_ENCODING);
	if (options.password && !this.accept.authData) {
		if (this.accept.protocolVersion < PROTOCOL_VERSION13) {
			if (this.accept.protocolVersion === PROTOCOL_VERSION10) {
				blr.addString(Const.isc_dpb_password, password, DEFAULT_ENCODING);
			} else {
				blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, LEGACY_AUTH_SALT).substring(2), DEFAULT_ENCODING);
			}
		}
	}

    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

	blr.addBytes([Const.isc_dpb_process_id, 4]);
	blr.addInt32(process.pid);

	let processName  = process.title || "";
	blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255,  processName.length) : processName, DEFAULT_ENCODING);

	if (this.accept.authData) {
		blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, DEFAULT_ENCODING);
	}

    msg.addInt(op_attach);
    msg.addInt(0);  // Database Object ID
    msg.addString(database, DEFAULT_ENCODING);
    msg.addBlr(this._blr);

    function cb(err, ret) {
        if (err) {
            doError(err, callback);
            return;
        }

        self.dbhandle = ret.handle;
        if (callback)
            callback(undefined, ret);
    }

    // For reconnect
    if (db) {
        db.connection = this;
        cb.response = db;
    } else {
        cb.response = new Database(this);
        cb.response.removeAllListeners('error');
        cb.response.on('error', noop);
    }

    this._queueEvent(cb);
};

Connection.prototype.detach = function (callback) {

    var self = this;

    if (self._isClosed)
        return;

    self._isUsed = false;
    self._isDetach = true;

    var msg = self._msg;

    msg.pos = 0;
    msg.addInt(op_detach);
    msg.addInt(0); // Database Object ID

    self._queueEvent(function(err, ret) {
        clearTimeout(self._retry_connection_id);
        delete(self.dbhandle);
        if (callback)
            callback(err, ret);
    });
};

Connection.prototype.createDatabase = function (options, callback) {
    var database = options.database || options.filename;
    if (database == null || database.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
    var role = options.role;
    var blr = this._blr;

    blr.pos = 0;
    blr.addByte(Const.isc_dpb_version1);
    blr.addString(Const.isc_dpb_set_db_charset, 'UTF8', DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, DEFAULT_ENCODING);
	if (this.accept.protocolVersion < PROTOCOL_VERSION13) {
		if (this.accept.protocolVersion === PROTOCOL_VERSION10) {
			blr.addString(Const.isc_dpb_password, password, DEFAULT_ENCODING);
		} else {
			blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, LEGACY_AUTH_SALT).substring(2), DEFAULT_ENCODING);
		}
	}
    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

	blr.addBytes([Const.isc_dpb_process_id, 4]);
	blr.addInt32(process.pid);

	let processName  = process.title || "";
	blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255,  processName.length) : processName, DEFAULT_ENCODING);

	if (this.accept.authData) {
		blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, DEFAULT_ENCODING);
	}

    blr.addNumeric(Const.isc_dpb_sql_dialect, 3);
    blr.addNumeric(Const.isc_dpb_force_write, 1);
    blr.addNumeric(Const.isc_dpb_overwrite, 1);
    blr.addNumeric(Const.isc_dpb_page_size, pageSize);

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_create);  // op_create
    msg.addInt(0);          // Database Object ID
    msg.addString(database, DEFAULT_ENCODING);
    msg.addBlr(blr);

    var self = this;

    function cb(err, ret) {

        if (ret)
            self.dbhandle = ret.handle;

        setImmediate(function() {
            if (self.db)
                self.db.emit('attach', ret);
        });

        if (callback)
            callback(err, ret);
    }

    cb.response = new Database(this);
    this._queueEvent(cb);
};

Connection.prototype.dropDatabase = function (callback) {
	var msg = this._msg;
	msg.pos = 0;

	msg.addInt(op_drop_database);
	msg.addInt(this.dbhandle);

	var self = this;
	this._queueEvent(function(err) {
		self.detach(function() {
			self.disconnect();

			if (callback)
				callback(err);
		});
	});
};

Connection.prototype.throwClosed = function(callback) {
    var err = new Error('Connection is closed.');
    this.db.emit('error', err);
    if (callback)
        callback(err);
    return this;
};

Connection.prototype.startTransaction = function(isolation, callback) {

    if (typeof(isolation) === 'function') {
        var tmp = isolation;
        isolation = callback;
        callback = tmp;
    }

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('startTransaction');

    var blr = this._blr;
    var msg = this._msg;

    blr.pos = 0;
    msg.pos = 0;

    blr.addBytes(isolation || ISOLATION_REPEATABLE_READ);
    msg.addInt(op_transaction);
    msg.addInt(this.dbhandle);
    msg.addBlr(blr);
    callback.response = new Transaction(this);

    this.db.emit('transaction', isolation);
    this._queueEvent(callback);
};

Connection.prototype.commit = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('commit');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_commit);
    msg.addInt(transaction.handle);
    this.db.emit('commit');
    this._queueEvent(callback);
};

Connection.prototype.rollback = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('rollback');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_rollback);
    msg.addInt(transaction.handle);
    this.db.emit('rollback');
    this._queueEvent(callback);
};

Connection.prototype.commitRetaining = function (transaction, callback) {

    if (this._isClosed)
        throw new Error('Connection is closed.');

    // for auto detach
    this._pending.push('commitRetaining');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_commit_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback);
};

Connection.prototype.rollbackRetaining = function (transaction, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('rollbackRetaining');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_rollback_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback);
};

Connection.prototype.allocateStatement = function (callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('allocateStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_allocate_statement);
    msg.addInt(this.dbhandle);
    callback.response = new Statement(this);
    this._queueEvent(callback);
};

Connection.prototype.dropStatement = function (statement, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('dropStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(DSQL_drop);
    this._queueEvent(callback);
};

Connection.prototype.closeStatement = function (statement, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('closeStatement');

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(DSQL_close);

    this._queueEvent(callback);
};

Connection.prototype.allocateAndPrepareStatement = function (transaction, query, plan, callback) {
	var self = this;
	var mainCallback = function(err, ret) {
		if (!err) {
			mainCallback.response.handle = ret.handle;
			describe(ret.buffer, mainCallback.response);
			mainCallback.response.query = query;
			self.db.emit('query', query);
			ret = mainCallback.response;
			self._setcachedquery(query, ret);
		}

		if (callback)
			callback(err, ret);
	};

	// for auto detach
	this._pending.push('allocateAndPrepareStatement');

	var msg = this._msg;
	var blr = this._blr;

	msg.pos = 0;
	blr.pos = 0;

	msg.addInt(op_allocate_statement);
	msg.addInt(this.dbhandle);
	mainCallback.lazy_count = 1;

	blr.addBytes(DESCRIBE);
	if (plan)
		blr.addByte(isc_info_sql_get_plan);

	msg.addInt(op_prepare_statement);
	msg.addInt(transaction.handle);
	msg.addInt(0xFFFF);
	msg.addInt(3); // dialect = 3
	msg.addString(query, DEFAULT_ENCODING);
	msg.addBlr(blr);
	msg.addInt(65535); // buffer_length
	mainCallback.lazy_count += 1;

	mainCallback.response = new Statement(this);
	this._queueEvent(mainCallback);
};

Connection.prototype.prepare = function (transaction, query, plan, callback) {
	var self = this;

	if (this.accept.protocolMinimumType === ptype_lazy_send) { // V11 Statement or higher
		self.allocateAndPrepareStatement(transaction, query, plan, callback);
	} else { // V10 Statement
		self.allocateStatement(function (err, statement) {
			if (err) {
				doError(err, callback);
				return;
			}

			self.prepareStatement(transaction, statement, query, plan, callback);
		});
	}
};

function describe(buff, statement) {
    var br = new BlrReader(buff);
    var parameters = null;
    var type, param;

    while (br.pos < br.buffer.length) {
        switch (br.readByteCode()) {
            case isc_info_sql_stmt_type:
                statement.type = br.readInt();
                break;
            case isc_info_sql_get_plan:
                statement.plan = br.readString(DEFAULT_ENCODING);
                break;
            case isc_info_sql_select:
                statement.output = parameters = [];
                break;
            case isc_info_sql_bind:
                statement.input = parameters = [];
                break;
            case isc_info_sql_num_variables:
                br.readInt(); // eat int
                break;
            case isc_info_sql_describe_vars:
                if (!parameters) {return}
                br.readInt(); // eat int ?
                var finishDescribe = false;
                param = null;
                while (!finishDescribe){
                    switch (br.readByteCode()) {
                        case isc_info_sql_describe_end:
                            break;
                        case isc_info_sql_sqlda_seq:
                            var num = br.readInt();
                            break;
                        case isc_info_sql_type:
                            type = br.readInt();
                            switch (type&~1) {
                                case SQL_VARYING:   param = new Xsql.SQLVarString(); break;
                                case SQL_NULL:      param = new Xsql.SQLVarNull(); break;
                                case SQL_TEXT:      param = new Xsql.SQLVarText(); break;
                                case SQL_DOUBLE:    param = new Xsql.SQLVarDouble(); break;
                                case SQL_FLOAT:
                                case SQL_D_FLOAT:   param = new Xsql.SQLVarFloat(); break;
                                case SQL_TYPE_DATE: param = new Xsql.SQLVarDate(); break;
                                case SQL_TYPE_TIME: param = new Xsql.SQLVarTime(); break;
                                case SQL_TIMESTAMP: param = new Xsql.SQLVarTimeStamp(); break;
                                case SQL_BLOB:      param = new Xsql.SQLVarBlob(); break;
                                case SQL_ARRAY:     param = new Xsql.SQLVarArray(); break;
                                case SQL_QUAD:      param = new Xsql.SQLVarQuad(); break;
                                case SQL_LONG:      param = new Xsql.SQLVarInt(); break;
                                case SQL_SHORT:     param = new Xsql.SQLVarShort(); break;
                                case SQL_INT64:     param = new Xsql.SQLVarInt64(); break;
                                case SQL_BOOLEAN:   param = new Xsql.SQLVarBoolean(); break;
                                default:
                                    throw new Error('Unexpected');
                            }
                            parameters[num-1] = param;
                            param.type = type;
                            param.nullable = Boolean(param.type & 1);
                            param.type &= ~1;
                            break;
                        case isc_info_sql_sub_type:
                            param.subType = br.readInt();
                            break;
                        case isc_info_sql_scale:
                            param.scale = br.readInt();
                            break;
                        case isc_info_sql_length:
                            param.length = br.readInt();
                            break;
                        case isc_info_sql_null_ind:
                            param.nullable = Boolean(br.readInt());
                            break;
                        case isc_info_sql_field:
                            param.field = br.readString(DEFAULT_ENCODING);
                            break;
                        case isc_info_sql_relation:
                            param.relation = br.readString(DEFAULT_ENCODING);
                            break;
                        case isc_info_sql_owner:
                            param.owner = br.readString(DEFAULT_ENCODING);
                            break;
                        case isc_info_sql_alias:
                            param.alias = br.readString(DEFAULT_ENCODING);
                            break;
                        case isc_info_sql_relation_alias:
                            param.relationAlias = br.readString(DEFAULT_ENCODING);
                            break;
                        case Const.isc_info_truncated:
                            throw new Error('Truncated');
                        default:
                            finishDescribe = true;
                            br.pos--;
                    }
                }
        }
    }
}

Connection.prototype.prepareStatement = function (transaction, statement, query, plan, callback) {

    if (this._isClosed)
        return this.throwClosed(callback);

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    if (plan instanceof Function) {
        callback = plan;
        plan = false;
    }

    blr.addBytes(DESCRIBE);

    if (plan)
        blr.addByte(isc_info_sql_get_plan);

    msg.addInt(op_prepare_statement);
    msg.addInt(transaction.handle);
    msg.addInt(statement.handle);
    msg.addInt(3); // dialect = 3
    msg.addString(query, DEFAULT_ENCODING);
    msg.addBlr(blr);
    msg.addInt(65535); // buffer_length

    var self = this;
    this._queueEvent(function(err, ret) {

        if (!err) {
            describe(ret.buffer, statement);
            statement.query = query;
            self.db.emit('query', query);
            ret = statement;
            self._setcachedquery(query, ret);
        }

        if (callback)
            callback(err, ret);
    });

};

function CalcBlr(blr, xsqlda) {
    blr.addBytes([blr_version5, blr_begin, blr_message, 0]); // + message number
    blr.addWord(xsqlda.length * 2);

    for (var i = 0, length = xsqlda.length; i < length; i++) {
        xsqlda[i].calcBlr(blr);
        blr.addByte(blr_short);
        blr.addByte(0);
    }

    blr.addByte(blr_end);
    blr.addByte(blr_eoc);
}

Connection.prototype.executeStatement = function(transaction, statement, params, callback, custom) {

    if (this._isClosed)
        return this.throwClosed(callback);

    // for auto detach
    this._pending.push('executeStatement');

    if (params instanceof Function) {
        callback = params;
        params = undefined;
    }

    var self = this;

	var op = op_execute;
	if (
		this.accept.protocolVersion >= PROTOCOL_VERSION13 &&
		statement.type === isc_info_sql_stmt_exec_procedure &&
		statement.output.length
	) {
		op = op_execute2;
	}

    function PrepareParams(params, input, callback) {

        var value, meta;
        var ret = new Array(params.length);
        var wait = params.length;

        function done() {
            wait--;
            if (wait === 0)
                callback(ret);
        }

        function putBlobData(index, value, callback) {

            self.createBlob2(transaction, function(err, blob) {

                var b;
                var isStream = value.readable;

                if (Buffer.isBuffer(value))
                    b = value;
                else if (typeof(value) === 'string')
                    b = Buffer.from(value, DEFAULT_ENCODING);
                else if (!isStream)
                    b = Buffer.from(JSON.stringify(value), DEFAULT_ENCODING);

                if (Buffer.isBuffer(b)) {
                    bufferReader(b, 1024, function(b, next) {
                        self.batchSegments(blob, b, next);
                    }, function() {
                        ret[index] = new Xsql.SQLParamQuad(blob.oid);
                        self.closeBlob(blob, callback);
                    });
                    return;
                }

                var isReading = false;
                var isEnd = false;

                value.on('data', function(chunk) {
                    value.pause();
                    isReading = true;
                    bufferReader(chunk, 1024, function(b, next) {
                        self.batchSegments(blob, b, next);
                    }, function() {
                        isReading = false;

                        if (isEnd) {
                            ret[index] = new Xsql.SQLParamQuad(blob.oid);
                            self.closeBlob(blob, callback);
                        } else
                            value.resume();
                    });
                });

                value.on('end', function() {
                    isEnd = true;
                    if (isReading)
                        return;
                    ret[index] = new Xsql.SQLParamQuad(blob.oid);
                    self.closeBlob(blob, callback);
                });
            });
        }

        for (var i = 0, length = params.length; i < length; i++) {
            value = params[i];
            meta = input[i];

            if (value === null || value === undefined) {
                switch (meta.type) {
                    case SQL_VARYING:
                    case SQL_NULL:
                    case SQL_TEXT:
                        ret[i] = new Xsql.SQLParamString(null);
                        break;
                    case SQL_DOUBLE:
                    case SQL_FLOAT:
                    case SQL_D_FLOAT:
                        ret[i] = new Xsql.SQLParamDouble(null);
                        break;
                    case SQL_TYPE_DATE:
                    case SQL_TYPE_TIME:
                    case SQL_TIMESTAMP:
                        ret[i] = new Xsql.SQLParamDate(null);
                        break;
                    case SQL_BLOB:
                    case SQL_ARRAY:
                    case SQL_QUAD:
                        ret[i] = new Xsql.SQLParamQuad(null);
                        break;
                    case SQL_LONG:
                    case SQL_SHORT:
                    case SQL_INT64:
                    case SQL_BOOLEAN:
                        ret[i] = new Xsql.SQLParamInt(null);
                        break;
                    default:
                        ret[i] = null;
                }
                done();
            } else {
                switch (meta.type) {
                    case SQL_BLOB:
                        putBlobData(i, value, done);
                        break;

                    case SQL_TIMESTAMP:
                    case SQL_TYPE_DATE:
                    case SQL_TYPE_TIME:

                        if (value instanceof Date)
                            ret[i] = new Xsql.SQLParamDate(value);
                        else if (typeof(value) === 'string')
                            ret[i] = new Xsql.SQLParamDate(parseDate(value));
                        else
                            ret[i] = new Xsql.SQLParamDate(new Date(value));

                        done();
                        break;

                    default:
                        switch (typeof value) {
                            case 'number':
                                if (value % 1 === 0) {
                                    if (value >= MIN_INT && value <= MAX_INT)
                                        ret[i] = new Xsql.SQLParamInt(value);
                                    else
                                        ret[i] = new Xsql.SQLParamInt64(value);
                                } else
                                    ret[i] = new Xsql.SQLParamDouble(value);
                                break;
                            case 'string':
                                ret[i] = new Xsql.SQLParamString(value);
                                break;
                            case 'boolean':
                                ret[i] = new Xsql.SQLParamBool(value);
                                break;
                            default:
                                //throw new Error('Unexpected parametter: ' + JSON.stringify(params) + ' - ' + JSON.stringify(input));
                                ret[i] = new Xsql.SQLParamString(value.toString());
                                break;
                        }
                        done();
                }
            }
        }
    }

    var input = statement.input;

    if (input.length) {

        if (!(params instanceof Array)) {
            if (params !== undefined)
                params = [params];
            else
                params = [];
        }

        if (params.length !== input.length) {
            self._pending.pop();
            callback(new Error('Expected parameters: (params=' + params.length + ' vs. expected=' + input.length + ') - ' + statement.query));
            return;
        }

        PrepareParams(params, input, function(prms) {
			self.sendExecute(op, statement, transaction, callback, prms);
        });

        return;
    }

    this.sendExecute(op, statement, transaction, callback);
};

Connection.prototype.sendExecute = function (op, statement, transaction, callback, parameters) {
	var msg = this._msg;
	var blr = this._blr;
	msg.pos = 0;
	blr.pos = 0;

	msg.addInt(op);
	msg.addInt(statement.handle);
	msg.addInt(transaction.handle);

	if (parameters && parameters.length) {
		CalcBlr(blr, parameters);
		msg.addBlr(blr);    // params blr
		msg.addInt(0); // message number
		msg.addInt(1); // param count

		if (this.accept.protocolVersion >= PROTOCOL_VERSION13) {
			// start with null indicator bitmap
			var nullBits = new BitSet();

			for (var i = 0; i < parameters.length; i++) {
				nullBits.set(i, (parameters[i].value === null) & 1);
			}

			var nullBuffer = nullBits.toBuffer();
			var requireBytes = Math.floor((parameters.length + 7) / 8);
			var remainingBytes = requireBytes - nullBuffer.length;

			if (nullBuffer.length) {
				msg.addBuffer(nullBuffer);
			}
			if (remainingBytes > 0) {
				msg.addBuffer(Buffer.alloc(remainingBytes));
			}
			msg.addAlignment(requireBytes);

			for(var i = 0; i < parameters.length; i++) {
				if (parameters[i].value !== null) {
					parameters[i].encode(msg);
				}
			}
		} else {
			for(var i = 0; i < parameters.length; i++) {
				parameters[i].encode(msg);
                if (parameters[i].value !== null) {
                    msg.addInt(0);
                }
            }
		}
	} else {
		msg.addBlr(blr);    // empty
		msg.addInt(0); // message number
		msg.addInt(0); // param count
	}

	if (op === op_execute2) {
		var outputBlr = new BlrWriter(32);

		if (statement.output && statement.output.length) {
			CalcBlr(outputBlr, statement.output);
			msg.addBlr(outputBlr);
		} else {
			msg.addBlr(outputBlr); // empty
		}
		msg.addInt(0); // out_message_number = out_message_type
	}

	callback.statement = statement;
	this._queueEvent(callback);
}

function fetch_blob_async_transaction(statement, id, column, row) {
    const infoValue = { row, column, value: '' };

    return (transactionArg) => {
        const singleTransaction = transactionArg === undefined;

        let promiseTransaction;
        if (singleTransaction) {
            promiseTransaction = new Promise((resolve, reject) => {
                statement.connection.startTransaction(ISOLATION_READ_UNCOMMITTED, (err, transaction) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(transaction);
                });
            });
        } else {
            promiseTransaction = Promise.resolve(transactionArg);
        }

        return promiseTransaction.then((transaction) => {
            return new Promise((resolve, reject) => {
                statement.connection._pending.push('openBlob');
                statement.connection.openBlob(id, transaction, (err, blob) => {
    
                    if (err) {
                        reject(err);
                        return;
                    }
    
                    const read = () => {
                        statement.connection.getSegment(blob, (err, ret) => {
    
                            if (err) {
                                if (singleTransaction) {
                                    transaction.rollback(() => reject(err));
                                } else {
                                    reject(err);
                                }
                                return;
                            }
    
                            if (ret.buffer) {
                                const blr = new BlrReader(ret.buffer);
                                const data = blr.readSegment();
                                infoValue.value += data.toString(DEFAULT_ENCODING);
                            }
    
                            if (ret.handle !== 2) {
                                read();
                                return;
                            }
    
                            statement.connection.closeBlob(blob);
                            if (singleTransaction) {
                                transaction.commit((err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(infoValue);
                                    }
                                });
                            } else {
                                resolve(infoValue);
                            }
                        });
                    };
    
                    read();
                });
            });
        });
    };
}

function fetch_blob_async(statement, id, name, row) {
    const cbTransaction = (transaction, close, callback) => {
        statement.connection._pending.push('openBlob');
        statement.connection.openBlob(id, transaction, (err, blob) => {
            let e = new Events.EventEmitter();

            e.pipe = (stream) => {
                e.on('data', (chunk) => {
                    stream.write(chunk);
                });
                e.on('end', () => {
                    stream.end();
                });
            };

            if (err) {
                return callback(err, name, e, row);
            }

            const read = () => {
                statement.connection.getSegment(blob, (err, ret) => {

                    if (err) {
                        transaction.rollback(() => {
                            e.emit('error', err);
                        });
                        return;
                    }

                    if (ret.buffer) {
                        const blr = new BlrReader(ret.buffer);
                        const data = blr.readSegment();

                        e.emit('data', data);
                    }

                    if (ret.handle !== 2) {
                        read();
                        return;
                    }

                    statement.connection.closeBlob(blob);
                    if (close) {
                        transaction.commit((err) => {
                            if (err) {
                                e.emit('error', err);
                            } else {
                                e.emit('end');
                            }
                            e = null;
                        });
                    } else {
                        e.emit('end');
                        e = null;
                    }
                });
            };

            callback(err, name, e, row);
            read();
        });
    };

    return (transaction, callback) => {
        // callback(error, nameField, eventEmitter, row)
        const singleTransaction = callback === undefined;
        if (singleTransaction) {
            callback = transaction;
            statement.connection.startTransaction(ISOLATION_READ_UNCOMMITTED, (err, transaction) => {
                if (err) {
                    callback(err);
                    return;
                }
                cbTransaction(transaction, singleTransaction, callback);
            });
        } else {
            cbTransaction(transaction, singleTransaction, callback);
        }
    };
}

Connection.prototype.fetch = function(statement, transaction, count, callback) {

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    if (count instanceof Function) {
        callback = count;
        count = DEFAULT_FETCHSIZE;
    }

    msg.addInt(op_fetch);
    msg.addInt(statement.handle);
    CalcBlr(blr, statement.output);
    msg.addBlr(blr);
    msg.addInt(0); // message number
    msg.addInt(count || DEFAULT_FETCHSIZE); // fetch count

    callback.statement = statement;
    this._queueEvent(callback);
};

Connection.prototype.fetchAll = function (statement, transaction, callback) {
	const self = this, data = [];
	const loop = (err, ret) => {
		if (err) {
			return callback(err);
		} else if (ret && ret.data && ret.data.length) {
            const arrPromise = (ret.arrBlob || []).map(value => value(transaction));

            Promise.all(arrPromise).then((arrBlob) => {
                for (let i = 0; i < arrBlob.length; i++) {
                    const blob = arrBlob[i];
                    ret.data[blob.row][blob.column] = blob.value;
                }

                const lastIndex = ret.data.length - 1;
                for (let i = 0; i < ret.data.length; i++) {
                    const pos = data.push(ret.data[i]);
                    if (statement.custom && statement.custom.asStream && statement.custom.on) {
                        statement.custom.on(ret.data[i], pos - 1);
                    }
                    if (i === lastIndex) {
                        if (ret.fetched) {
                            return callback(undefined, data);
                        } else {
                            self.fetch(statement, transaction, DEFAULT_FETCHSIZE, loop);
                        }
                    }
                }
            }).catch(callback);
		} else if (ret.fetched) {
			callback(undefined, data);
		} else {
			self.fetch(statement, transaction, DEFAULT_FETCHSIZE, loop);
		}
	}

	this.fetch(statement, transaction, DEFAULT_FETCHSIZE, loop);
};


Connection.prototype.openBlob = function(blob, transaction, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_open_blob);
    msg.addInt(transaction.handle);
    msg.addQuad(blob);
    this._queueEvent(callback);
};

Connection.prototype.closeBlob = function(blob, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_close_blob);
    msg.addInt(blob.handle);
    this._queueEvent(callback);
};

Connection.prototype.getSegment = function(blob, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_get_segment);
    msg.addInt(blob.handle);
    msg.addInt(1024); // buffer length
    msg.addInt(0); // ???
    this._queueEvent(callback);
};

Connection.prototype.createBlob2 = function (transaction, callback) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_create_blob2);
    msg.addInt(0);
    msg.addInt(transaction.handle);
    msg.addInt(0);
    msg.addInt(0);
    this._queueEvent(callback);
};

Connection.prototype.batchSegments = function(blob, buffer, callback){
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    msg.addInt(op_batch_segments);
    msg.addInt(blob.handle);
    msg.addInt(buffer.length + 2);
    blr.addBuffer(buffer);
    msg.addBlr(blr);
    this._queueEvent(callback);
};

Connection.prototype.svcattach = function (options, callback, svc) {
    this._lowercase_keys = options.lowercase_keys || DEFAULT_LOWERCASE_KEYS;
    var database = options.database || options.filename;
    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var role = options.role;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addBytes([Const.isc_dpb_version2, Const.isc_dpb_version2]);
    blr.addString(Const.isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(Const.isc_dpb_password, password, DEFAULT_ENCODING);
    blr.addByte(Const.isc_dpb_dummy_packet_interval);
    blr.addByte(4);
    blr.addBytes([120, 10, 0, 0]); // FROM DOT NET PROVIDER
    if (role)
        blr.addString(Const.isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

    msg.addInt(op_service_attach);
    msg.addInt(0);
    msg.addString(DEFAULT_SVC_NAME, DEFAULT_ENCODING); // only local for moment
    msg.addBlr(this._blr);

    var self = this;

    function cb(err, ret) {

        if (err) {
            doError(err, callback);
            return;
        }

        self.svchandle = ret.handle;
        if (callback)
            callback(undefined, ret);
    }

    // For reconnect
    if (svc) {
        svc.connection = this;
        cb.response = svc;
    } else {
        cb.response = new ServiceManager(this);
        cb.response.removeAllListeners('error');
        cb.response.on('error', noop);
    }

    this._queueEvent(cb);
}

Connection.prototype.svcstart = function (spbaction, callback) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    msg.addInt(op_service_start);
    msg.addInt(this.svchandle);
    msg.addInt(0)
    msg.addBlr(spbaction);
    this._queueEvent(callback);
}

Connection.prototype.svcquery = function (spbquery, resultbuffersize, timeout,callback) {
    if (resultbuffersize > MAX_BUFFER_SIZE) {
        doError(new Error('Buffer is too big'), callback);
        return;
    }

    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    blr.addByte(Const.isc_spb_current_version);
    //blr.addByteInt32(isc_info_svc_timeout, timeout);
    msg.addInt(op_service_info);
    msg.addInt(this.svchandle);
    msg.addInt(0);
    msg.addBlr(blr);
    blr.pos = 0
    blr.addBytes(spbquery);
    msg.addBlr(blr);
    msg.addInt(resultbuffersize);
    this._queueEvent(callback);
}

Connection.prototype.svcdetach = function (callback) {
    var self = this;

    if (self._isClosed)
        return;

    self._isUsed = false;
    self._isDetach = true;

    var msg = self._msg;

    msg.pos = 0;
    msg.addInt(op_service_detach);
    msg.addInt(this.svchandle); // Database Object ID

    self._queueEvent(function (err, ret) {
        delete (self.svchandle);
        if (callback)
            callback(err, ret);
    });
}

function bufferReader(buffer, max, writer, cb, beg, end) {

    if (!beg)
        beg = 0;

    if (!end)
        end = max;

    if (end >= buffer.length)
        end = undefined;

    var b = buffer.slice(beg, end);

    writer(b, function() {

        if (end === undefined) {
            cb();
            return;
        }

        bufferReader(buffer, max, writer, cb, beg + max, end + max);
    });
}
