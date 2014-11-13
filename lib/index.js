var
    net = require('net'),
    os = require('os'),
    Events = require('events'),
    serialize = require('./serialize.js'),
    XdrReader = serialize.XdrReader,
    BlrReader = serialize.BlrReader,
    XdrWriter = serialize.XdrWriter,
    BlrWriter = serialize.BlrWriter,
    messages = require('./messages.js');

if (typeof(setImmediate) === 'undefined') {
    global.setImmediate = function(cb) {
        process.nextTick(cb);
    };
}

/**
 * Parse date from string
 * @return {Date}
 */
if (String.prototype.parseDate === undefined) {
    String.prototype.parseDate = function() {
        var self = this.trim();
        var arr = self.indexOf(' ') === -1 ? self.split('T') : self.split(' ');
        var index = arr[0].indexOf(':');
        var length = arr[0].length;

        if (index !== -1) {
            var tmp = arr[1];
            arr[1] = arr[0];
            arr[0] = tmp;
        }

        if (arr[0] === undefined)
            arr[0] = '';

        var noTime = arr[1] === undefined ? true : arr[1].length === 0;

        for (var i = 0; i < length; i++) {
            var c = arr[0].charCodeAt(i);
            if (c > 47 && c < 58)
                continue;
            if (c === 45 || c === 46)
                continue;

            if (noTime)
                return new Date(self);
        }

        if (arr[1] === undefined)
            arr[1] = '00:00:00';

        var firstDay = arr[0].indexOf('-') === -1;

        var date = (arr[0] || '').split(firstDay ? '.' : '-');
        var time = (arr[1] || '').split(':');
        var parsed = [];

        if (date.length < 4 && time.length < 2)
            return new Date(self);

        index = (time[2] || '').indexOf('.');

        // milliseconds
        if (index !== -1) {
            time[3] = time[2].substring(index + 1);
            time[2] = time[2].substring(0, index);
        } else
            time[3] = '0';

        parsed.push(parseInt(date[firstDay ? 2 : 0], 10)); // year
        parsed.push(parseInt(date[1], 10)); // month
        parsed.push(parseInt(date[firstDay ? 0 : 2], 10)); // day
        parsed.push(parseInt(time[0], 10)); // hours
        parsed.push(parseInt(time[1], 10)); // minutes
        parsed.push(parseInt(time[2], 10)); // seconds
        parsed.push(parseInt(time[3], 10)); // miliseconds

        var def = new Date();

        for (var i = 0, length = parsed.length; i < length; i++) {
            if (isNaN(parsed[i]))
                parsed[i] = 0;

            var value = parsed[i];
            if (value !== 0)
                continue;

            switch (i) {
                case 0:
                    if (value <= 0)
                        parsed[i] = def.getFullYear();
                    break;
                case 1:
                    if (value <= 0)
                        parsed[i] = def.getMonth() + 1;
                    break;
                case 2:
                    if (value <= 0)
                        parsed[i] = def.getDate();
                    break;
            }
        }

        return new Date(parsed[0], parsed[1] - 1, parsed[2], parsed[3], parsed[4], parsed[5]);
    };
}

function noop() {}

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
    CONNECT_VERSION2          = 2;
    ARCHITECTURE_GENERIC      = 1;

const
// Protocol 10 includes support for warnings and removes the requirement for
// encoding and decoding status codes
    PROTOCOL_VERSION10  = 10,

// Since protocol 11 we must be separated from Borland Interbase.
// Therefore always set highmost bit in protocol version to 1.
// For unsigned protocol version this does not break version's compare.

    FB_PROTOCOL_FLAG    = 0x8000,

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
    DSQL_close      = 1,
    DSQL_drop       = 2,
    DSQL_unprepare  = 4; // >= 2.5

const
    ptype_batch_send = 3;

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

/**********************************/
/* Database parameter block stuff */
/**********************************/
const
    isc_dpb_version1                = 1,
    isc_dpb_version2                = 2, // >= FB30
    isc_dpb_cdd_pathname            = 1,
    isc_dpb_allocation              = 2,
    isc_dpb_journal                 = 3,
    isc_dpb_page_size               = 4,
    isc_dpb_num_buffers             = 5,
    isc_dpb_buffer_length           = 6,
    isc_dpb_debug                   = 7,
    isc_dpb_garbage_collect         = 8,
    isc_dpb_verify                  = 9,
    isc_dpb_sweep                   = 10,
    isc_dpb_enable_journal          = 11,
    isc_dpb_disable_journal         = 12,
    isc_dpb_dbkey_scope             = 13,
    isc_dpb_number_of_users         = 14,
    isc_dpb_trace                   = 15,
    isc_dpb_no_garbage_collect      = 16,
    isc_dpb_damaged                 = 17,
    isc_dpb_license                 = 18,
    isc_dpb_sys_user_name           = 19,
    isc_dpb_encrypt_key             = 20,
    isc_dpb_activate_shadow         = 21,
    isc_dpb_sweep_interval          = 22,
    isc_dpb_delete_shadow           = 23,
    isc_dpb_force_write             = 24,
    isc_dpb_begin_log               = 25,
    isc_dpb_quit_log                = 26,
    isc_dpb_no_reserve              = 27,
    isc_dpb_user_name               = 28,
    isc_dpb_password                = 29,
    isc_dpb_password_enc            = 30,
    isc_dpb_sys_user_name_enc       = 31,
    isc_dpb_interp                  = 32,
    isc_dpb_online_dump             = 33,
    isc_dpb_old_file_size           = 34,
    isc_dpb_old_num_files           = 35,
    isc_dpb_old_file                = 36,
    isc_dpb_old_start_page          = 37,
    isc_dpb_old_start_seqno         = 38,
    isc_dpb_old_start_file          = 39,
    isc_dpb_old_dump_id             = 41,
    isc_dpb_lc_messages             = 47,
    isc_dpb_lc_ctype                = 48,
    isc_dpb_cache_manager           = 49,
    isc_dpb_shutdown                = 50,
    isc_dpb_online                  = 51,
    isc_dpb_shutdown_delay          = 52,
    isc_dpb_reserved                = 53,
    isc_dpb_overwrite               = 54,
    isc_dpb_sec_attach              = 55,
    isc_dpb_connect_timeout         = 57,
    isc_dpb_dummy_packet_interval   = 58,
    isc_dpb_gbak_attach             = 59,
    isc_dpb_sql_role_name           = 60,
    isc_dpb_set_page_buffers        = 61,
    isc_dpb_working_directory       = 62,
    isc_dpb_sql_dialect             = 63,
    isc_dpb_set_db_readonly         = 64,
    isc_dpb_set_db_sql_dialect      = 65,
    isc_dpb_gfix_attach             = 66,
    isc_dpb_gstat_attach            = 67,
    isc_dpb_set_db_charset          = 68,
    isc_dpb_gsec_attach             = 69,
    isc_dpb_address_path            = 70,
    isc_dpb_process_id              = 71,
    isc_dpb_no_db_triggers          = 72,
    isc_dpb_trusted_auth            = 73,
    isc_dpb_process_name            = 74,
    isc_dpb_trusted_role            = 75,
    isc_dpb_org_filename            = 76,
    isc_dpb_utf8_filename           = 77,
    isc_dpb_ext_call_depth          = 78;

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

/****************************/
/* Common, structural codes */
/****************************/
const
    isc_info_end                    = 1,
    isc_info_truncated              = 2,
    isc_info_error                  = 3,
    isc_info_data_not_ready         = 4,
    isc_info_length                 = 126,
    isc_info_flag_end               = 127;

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

const
    DESCRIBE =
        [isc_info_sql_stmt_type,
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
            isc_info_sql_describe_end];

const
    ISOLATION_READ_UNCOMMITTED          = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_rec_version],
    ISOLATION_READ_COMMITED             = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version],
    ISOLATION_REPEATABLE_READ           = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_concurrency],
    ISOLATION_SERIALIZABLE              = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_consistency],
    ISOLATION_READ_COMMITED_READ_ONLY   = [isc_tpb_version3, isc_tpb_read, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version];

const
    DEFAULT_HOST = '127.0.0.1',
    DEFAULT_PORT = 3050,
    DEFAULT_USER = 'SYSDBA',
    DEFAULT_PASSWORD = 'masterkey',
    DEFAULT_PAGE_SIZE = 4096;

exports.ISOLATION_READ_UNCOMMITTED = ISOLATION_READ_UNCOMMITTED;
exports.ISOLATION_READ_COMMITED = ISOLATION_READ_COMMITED;
exports.ISOLATION_REPEATABLE_READ = ISOLATION_REPEATABLE_READ;
exports.ISOLATION_SERIALIZABLE = ISOLATION_SERIALIZABLE;
exports.ISOLATION_READ_COMMITED_READ_ONLY = ISOLATION_READ_COMMITED_READ_ONLY;

if (!String.prototype.padLeft) {
    String.prototype.padLeft = function(max, c) {
        var self = this;
        return new Array(Math.max(0, max - self.length + 1)).join(c || ' ') + self;
    };
}

/**
 * Escape value
 * @param {Object} value
 * @return {String}
 */
exports.escape = function(value) {

    if (value === null || value === undefined)
        return 'NULL';

    switch (typeof(value)) {
        case 'boolean':
            return value ? '1' : '0';
        case 'number':
            return value.toString();
        case 'string':
            return "'" + value.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
    }

    if (value instanceof Date)
        return "'" + value.getFullYear() + '-' + value.getMonth().toString().padLeft(2, '0') + '-' + value.getDate().toString().padLeft(2, '0') + ' ' + value.getHours().toString().padLeft(2, '0') + ':' + value.getMinutes().toString().padLeft(2, '0') + ':' + value.getSeconds().toString().padLeft(2, '0') + "'";

    throw new Error('Escape supports only primitive values.');
};

const
    DEFAULT_ENCODING = 'utf8';
    DEFAULT_FETCHSIZE = 200;

const
    MAX_INT = Math.pow(2, 31) - 1;
    MIN_INT = - Math.pow(2, 31);

/***************************************
 *
 *   SQLVar
 *
 ***************************************/


const
    ScaleDivisor = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000, 100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
const
    DateOffset = 40587,
    TimeCoeff = 86400000;
    MsPerMinute = 60000;

//------------------------------------------------------

function SQLVarText() {}

SQLVarText.prototype.decode = function(data) {
    var ret;
    if (this.subType > 1) {
        ret = data.readText(this.length, DEFAULT_ENCODING);
    } else {
        ret = data.readBuffer(this.length);
    }

    if (!data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarText.prototype.calcBlr = function(blr) {
    blr.addByte(blr_text);
    blr.addWord(this.length);
};

//------------------------------------------------------

function SQLVarNull() {}
SQLVarNull.prototype = new SQLVarText();
SQLVarNull.prototype.constructor = SQLVarNull;

//------------------------------------------------------

function SQLVarString() {}

SQLVarString.prototype.decode = function(data) {
    var ret;
    if (this.subType > 1) {
        ret = data.readString(DEFAULT_ENCODING)
    } else {
        ret = data.readBuffer()
    }
    if (!data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarString.prototype.calcBlr = function(blr) {
    blr.addByte(blr_varying);
    blr.addWord(this.length);
};

//------------------------------------------------------

function SQLVarQuad() {}

SQLVarQuad.prototype.decode = function(data) {
    var ret = data.readQuad();
    if (!data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarQuad.prototype.calcBlr = function(blr) {
    blr.addByte(blr_quad);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarBlob() {}
SQLVarBlob.prototype = new SQLVarQuad();
SQLVarBlob.prototype.constructor = SQLVarBlob;

SQLVarBlob.prototype.calcBlr = function(blr) {
    blr.addByte(blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLVarArray() {}
SQLVarArray.prototype = new SQLVarQuad();
SQLVarArray.prototype.constructor = SQLVarArray;

SQLVarArray.prototype.calcBlr = function(blr) {
    blr.addByte(blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLVarInt() {}

SQLVarInt.prototype.decode = function(data) {
    var ret = data.readInt();
    if (!data.readInt()) {
        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }
        return ret;
    }
    return null;
};

SQLVarInt.prototype.calcBlr = function(blr) {
    blr.addByte(blr_long);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarShort() {}
SQLVarShort.prototype = new SQLVarInt();
SQLVarShort.prototype.constructor = SQLVarShort;

SQLVarShort.prototype.calcBlr = function(blr) {
    blr.addByte(blr_short);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarInt64() {}

SQLVarInt64.prototype.decode = function(data) {
    var ret = data.readInt64();
    if (!data.readInt()) {
        if (this.scale) {
            ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }
        return ret;
    }
    return null;
};

SQLVarInt64.prototype.calcBlr = function(blr) {
    blr.addByte(blr_int64);
    blr.addShort(this.scale);
};

//------------------------------------------------------

function SQLVarFloat() {}

SQLVarFloat.prototype.decode = function(data) {
    var ret = data.readFloat();
    if (!data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarFloat.prototype.calcBlr = function(blr) {
    blr.addByte(blr_float);
};

//------------------------------------------------------

function SQLVarDouble() {}

SQLVarDouble.prototype.decode = function(data) {
    var ret = data.readDouble();
    if (!data.readInt()) {
        return ret;
    }
    return null;
};

SQLVarDouble.prototype.calcBlr = function(blr) {
    blr.addByte(blr_double);
};

//------------------------------------------------------

function SQLVarDate() {}

SQLVarDate.prototype.decode = function(data) {
    var ret = data.readInt();
    if (!data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds((ret - DateOffset) * TimeCoeff + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }
    return null;
};

SQLVarDate.prototype.calcBlr = function(blr) {
    blr.addByte(blr_sql_date);
};

//------------------------------------------------------

function SQLVarTime() {}

SQLVarTime.prototype.decode = function(data) {
    var ret = data.readUInt();
    if (!data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds(Math.floor(ret / 10) + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }
    return null;
};

SQLVarTime.prototype.calcBlr = function(blr) {
    blr.addByte(blr_sql_time);
};

//------------------------------------------------------

function SQLVarTimeStamp() {}

SQLVarTimeStamp.prototype.decode = function(data) {
    var date = data.readInt();
    var time = data.readUInt();
    if (!data.readInt()) {
        var d = new Date(0);
        d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
        return d;
    }
    return null;
};

SQLVarTimeStamp.prototype.calcBlr = function(blr) {
    blr.addByte(blr_timestamp);
};

//------------------------------------------------------

function SQLVarBoolean() {}

SQLVarBoolean.prototype.decode = function(data) {
    var ret = data.readInt();
    if (!data.readInt()) {
        return Boolean(ret);
    }
    return null;
};

SQLVarBoolean.prototype.calcBlr = function(blr) {
    blr.addByte(blr_bool);
};

//------------------------------------------------------

function SQLParamInt(value){
    this.value = value;
}

SQLParamInt.prototype.calcBlr = function(blr) {
    blr.addByte(blr_long);
    blr.addShort(0);
};

SQLParamInt.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value);
        data.addInt(0);
    } else {
        data.addInt(0);
        data.addInt(1);
    }
};

//------------------------------------------------------

function SQLParamInt64(value){
    this.value = value;
}

SQLParamInt64.prototype.calcBlr = function(blr) {
    blr.addByte(blr_int64);
    blr.addShort(0);
};

SQLParamInt64.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt64(this.value);
        data.addInt(0);
    } else {
        data.addInt64(0);
        data.addInt(1);
    }
};

//------------------------------------------------------

function SQLParamDouble(value) {
    this.value = value;
}

SQLParamDouble.prototype.encode = function(data) {
    if (this.value != null) {
        data.addDouble(this.value);
        data.addInt(0);
    } else {
        data.addDouble(0);
        data.addInt(1);
    }
};

SQLParamDouble.prototype.calcBlr = function(blr) {
    blr.addByte(blr_double);
};

//------------------------------------------------------

function SQLParamString(value) {
    this.value = value;
}

SQLParamString.prototype.encode = function(data) {
    if (this.value != null) {
        data.addText(this.value, DEFAULT_ENCODING);
        data.addInt(0);
    } else {
        data.addInt(1);
    }
};

SQLParamString.prototype.calcBlr = function(blr) {
    blr.addByte(blr_text);
    var len = this.value ? Buffer.byteLength(this.value, DEFAULT_ENCODING) : 0;
    blr.addWord(len);
};

//------------------------------------------------------

function SQLParamQuad(value) {
    this.value = value;
}

SQLParamQuad.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value.high);
        data.addInt(this.value.low);
        data.addInt(0);
    } else {
        data.addInt(0);
        data.addInt(0);
        data.addInt(1);
    }
};

SQLParamQuad.prototype.calcBlr = function(blr) {
    blr.addByte(blr_quad);
    blr.addShort(0);
};

//------------------------------------------------------

function SQLParamDate(value) {
    this.value = value;
}

SQLParamDate.prototype.encode = function(data) {
    if (this.value != null) {

        var value = this.value.getTime() - this.value.getTimezoneOffset() * MsPerMinute;
        var time = value % TimeCoeff;
        var date = (value - time) / TimeCoeff + DateOffset;
        time *= 10;
        data.addInt(date);
        data.addUInt(time);
        data.addInt(0);
    } else {
        data.addInt(0);
        data.addUInt(0);
        data.addInt(1);
    }
};

SQLParamDate.prototype.calcBlr = function(blr) {
    blr.addByte(blr_timestamp);
};

//------------------------------------------------------

function SQLParamBool(value) {
    this.value = value;
}

SQLParamBool.prototype.encode = function(data) {
    if (this.value != null) {
        data.addInt(this.value ? 1 : 0);
        data.addInt(0);
    } else {
        data.addInt(0);
        data.addInt(1);
    }
};

SQLParamBool.prototype.calcBlr = function(blr) {
    blr.addByte(blr_short);
    blr.addShort(0);
};


/***************************************
 *
 *   Error handling
 *
 ***************************************/

function isError(obj) {
    return (obj instanceof Object && obj.status);
}

function doCallback(obj, callback) {

    if (!callback)
        return;

    if (isError(obj)) {
        callback(new Error(obj.message));
        return;
    }

    callback(undefined, obj);

}

function doError(obj, callback) {
    if (callback)
        callback(obj)
}

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

    cnx.allocateStatement(function(err, statement) {
        if (err) {
            doError(err, callback);
            return;
        }
        cnx.prepareStatement(self, statement, query, false, callback);
    });
};

Transaction.prototype.execute = function(query, params, callback, custom) {

    if (params instanceof Function) {
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
            statement.drop();
            doCallback(err, callback);
        }

        statement.execute(self, params, function(err) {

            if (err) {
                dropError(err);
                return;
            }

            switch (statement.type) {

                case isc_info_sql_stmt_select:
                    statement.fetchAll(self, function(err, ret) {

                        if (err) {
                            dropError(err);
                            return;
                        }

                        statement.drop();

                        if (callback)
                            callback(undefined, ret, statement.output, true);

                    });

                    break;

                case isc_info_sql_stmt_exec_procedure:
                    if (statement.output.length) {
                        statement.fetch(self, 1, function(err, ret) {
                            if (err) {
                                dropError(err);
                                return;
                            }

                            statement.drop();

                            if (callback)
                                callback(undefined, ret.data[0], statement.output, false);
                        });

                        break;
                    }

                // Fall through is normal
                default:
                    statement.drop();
                    if (callback)
                        callback()
                    break;
            }

        }, custom);
    });
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

Database.prototype.__proto__ = new Events.EventEmitter();

Database.prototype.escape = function(value) {
    return exports.escape(value);
};

Database.prototype.detach = function(callback, force) {

    var self = this;

    if (!force && self.connection._pending.length > 0) {
        self.connection._detachAuto = true;
        self.connection._detachCallback = callback;
        return self;
    }

    self.connection.detach(function(err, obj) {

        self.connection.disconnect();
        self.emit('detach', false);

        if (callback)
            callback(err, obj);

    }, force);

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

    if (on === undefined)
        throw new Error('Expected "on" delegate.');

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

exports.attach = function(options, callback) {

    var host = options.host || DEFAULT_HOST;
    var port = options.port || DEFAULT_PORT;

    var cnx = this.connection = new Connection(host, port, function(err) {

        if (err) {
            doError(err, callback);
            return;
        }

        cnx.connect(options.database || options.filename, function(err) {
            if (err)
                doError(err, callback);
            else
                cnx.attach(options, callback);
        });

    }, options);
};

exports.create = function(options, callback) {
    var host = options.host || DEFAULT_HOST;
    var port = options.port || DEFAULT_PORT;
    var cnx = this.connection = new Connection(host, port, function(err) {
        cnx.connect(options.database || options.filename, function(err) {

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

        cnx.connect(options.database || options.filename, function(err) {

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
exports.pool = function(max, options, callback) {

    var pool = new Pool();

    options.isPool = true;

    function create(max) {
        exports.attach(options, function(err, db) {

            if (err)
                throw err;

            max--;

            pool.db.push(db);
            poolEvents(db, pool);

            if (max <= 0) {
                pool.isReady = true;
                pool.check();
                if (callback)
                    callback(null, pool);
                return;
            }

            create(max);
        });
    };

    create(max);

    return pool;
};

function poolEvents(db, pool) {
    db.removeAllListeners('detach');
    db.on('detach', function(is) {

        if (!is)
            return;

        db.connection._queue = [];
        db.connection._pending = [];
        db.connection._isUsed = false;

        setImmediate(function() {
            pool.check();
        });
    });
}

/***************************************
 *
 *   Simple Pooling
 *
 ***************************************/

function Pool() {
    this.db = [];
    this.pending = [];
    this.isReady = false;
    this.isDestroy = false;
}

Pool.prototype.get = function(callback) {

    var self = this;
    if (self.isDestroy)
        return self;

    self.pending.push(callback);
    self.check();
    return self;
};

Pool.prototype.check = function() {

    var self = this;

    for (var i = 0, length = self.db.length; i < length; i++) {

        var db = self.db[i];
        if (db.connection._isUsed)
            continue;

        db.removeAllListeners('detach');
        poolEvents(db, self);

        var cb = self.pending.shift();
        if (cb) {
            db.connection._isUsed = true;
            cb(null, db);
        }

        return self;
    }

    return self;
};

Pool.prototype.detach = function() {

    var self = this;
    var count = self.db.length;

    var fn = function() {
        count--;
        if (count > 0 || !self.isDestroy)
            return;
        self.db = null;
        self.pending = null;
    };

    for (var i = 0; i < self.db.length; i++)
        self.db[i].detach(fn, true);

    return self;
};

Pool.prototype.destroy = function() {
    var self = this;
    self.detach();
    self.isDestroy = true;
    return self;
};

/***************************************
 *
 *   Connection
 *
 ***************************************/

var Connection = exports.Connection = function (host, port, callback, options, db) {
    var self = this;
    this.db = db;
    this._msg = new XdrWriter(32);
    this._blr = new BlrWriter(32);
    this._queue = [];
    this._detachTimeout;
    this._detachCallback;
    this._detachAuto;
    this._socket = net.createConnection(port, host);
    this._pending = [];
    this._isClosed = false;
    this._isDetach = false;
    this._isUsed = false;
    this.options = options;
    this._bind_events(host, port, callback);
    this.error;
};

exports.Connection.prototype._bind_events = function(host, port, callback) {

    var self = this;

    self._socket.on('close', function() {

        self._isClosed = true;

        if (self._isDetach)
            return;

        if (!self.db) {
            if (callback)
                callback(self.error);
            return;
        }

        setImmediate(function() {

            self._socket = null;
            self._msg = null;
            self._blr = null;

            var ctx = new Connection(host, port, function(err) {
                ctx.connect(self.options.filename, function(err) {

                    if (err) {
                        self.emit('error', err);
                        return;
                    }

                    ctx.attach(self.options, function(err) {

                        if (err) {
                            self.emit('error', err);
                            return;
                        }

                        ctx._queue = ctx._queue.concat(self._queue);
                        ctx._pending = ctx._pending.concat(self._pending);
                        self.db.emit('reconnect');

                    }, self.db);
                });

            }, self.options, self.db);
        });

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

    self._socket.on('data', function(data) {

        var obj, cb, pos, xdr, buf;

        if (!self._xdr) {
            xdr = new XdrReader(data);
        } else {
            xdr = self._xdr;
            delete(self._xdr);
            buf = new Buffer(data.length + xdr.buffer.length);
            xdr.buffer.copy(buf);
            data.copy(buf, xdr.buffer.length);
            xdr.buffer = buf;
        }


        while (xdr.pos < xdr.buffer.length) {

            pos = xdr.pos;

            try {
                cb = self._queue[0];
                obj = decodeResponse(xdr, cb, self.db);
            } catch(err) {
                buf = new Buffer(xdr.buffer.length - pos);
                xdr.buffer.copy(buf, 0, pos);
                xdr.buffer = buf;
                xdr.pos = 0;
                self._xdr = xdr;
                return;
            }

            self._queue.shift();
            self._pending.shift();

            if (obj && obj.status) {

                messages.lookupMessages(obj.status, function(message) {
                    obj.message = message;
                    doCallback(obj, cb);
                });

            } else
                doCallback(obj, cb);
        }

        if (!self._detachAuto || self._pending.length !== 0)
            return;

        clearTimeout(self._detachTimeout);
        self._detachTimeout = setTimeout(function() {
            self.db.detach(self._detachCallback);
            self._detachAuto = false;
        }, 100);

    });
}

exports.Connection.prototype.disconnect = function() {
    this._socket.end();
};

function decodeResponse(data, callback, db){

    do {
        var r = data.readInt();
    } while (r === op_dummy);

    var item, op;
    switch (r) {
        case op_response:

            var response;

            if (callback)
                response = callback.response || {};
            else
                response = {};

            response.handle = data.readInt();
            var oid = data.readQuad();
            if (oid.low || oid.high)
                response.oid = oid

            var buf = data.readArray();
            if (buf)
                response.buffer = buf;

            var num;
            while (true) {
                op = data.readInt();
                switch (op){
                    case isc_arg_end:
                        return response;
                    case isc_arg_gds:
                        num = data.readInt();
                        if (!num)
                            break;
                        item = { gdscode: num };
                        if (response.status)
                            response.status.push(item);
                        else
                            response.status = [item];
                        break;
                    case isc_arg_string:
                    case isc_arg_interpreted:
                    case isc_arg_sql_state:

                        if (item.params) {
                            var str = data.readString(DEFAULT_ENCODING);
                            item.params.push(str);
                        } else
                            item.params = [data.readString(DEFAULT_ENCODING)];

                        break;

                    case isc_arg_number:
                        num = data.readInt();

                        if (item.params)
                            item.params.push(num);
                        else
                            item.params = [num];

                        if (item.gdscode === isc_sqlerr)
                            response.sqlcode = num;

                        break;

                    default:
                        throw new Error('Unexpected: ' + op);
                }
            }
            break;

        case op_fetch_response:

            var status = data.readInt();
            var count = data.readInt();
            var statement = callback.statement;
            var output = statement.output;
            var custom = statement.custom || {};
            var cols = null;
            var rows = custom.asStream ? null : [];
            var index = 0;

            if (custom.asObject) {
                cols = [];
                for (var i = 0, length = output.length; i < length; i++)
                    cols.push(output[i].alias.toLowerCase());
            }

            while (count && (status !== 100)) {

                var row = custom.asObject ? {} : new Array(output.length);

                for (var i = 0, length = output.length; i < length; i++) {

                    item = output[i];
                    var value = item.decode(data);

                    if (custom.asObject) {
                        if (item.type === SQL_BLOB)
                            value = fetch_blob_async(statement, value, cols[i]);
                        row[cols[i]] = value;
                    }
                    else {
                        if (item.type === SQL_BLOB)
                            value = fetch_blob_async(statement, value, i);
                        row[i] = value;
                    }
                }

                statement.connection.db.emit('row', row, index, custom.asObject);

                op = data.readInt(); // ??
                status = data.readInt();
                count = data.readInt();

                if (!custom.asStream)
                    rows.push(row);

                if (custom.on)
                    custom.on(row, index);

                index++;
            }

            statement.connection.db.emit('result', rows);
            return { data: rows, fetched: Boolean(status === 100) };

        case op_accept:
            if (data.readInt() !== PROTOCOL_VERSION10 || data.readInt() !== ARCHITECTURE_GENERIC || data.readInt() !== ptype_batch_send)
                throw new Error('Invalid connect result');
            return {};

        default:
            throw new Error('Unexpected:' + r);
    }
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

Connection.prototype.connect = function (database, callback) {

    var msg = this._msg;
    var blr = this._blr;

    msg.pos = 0;
    blr.pos = 0;

    msg.addInt(op_connect);
    msg.addInt(op_attach);
    msg.addInt(CONNECT_VERSION2);
    msg.addInt(ARCHITECTURE_GENERIC);
    msg.addString(database || '', DEFAULT_ENCODING);
    msg.addInt(1);  // Protocol version understood count.

    blr.addString(1, process.env['USER'] || process.env['USERNAME'] || 'Unknown', DEFAULT_ENCODING);
    var hostname = os.hostname();
    blr.addString(4, hostname, DEFAULT_ENCODING);
    blr.addBytes([6, 0]);
    msg.addBlr(this._blr);

    msg.addInt(PROTOCOL_VERSION10);
    msg.addInt(ARCHITECTURE_GENERIC);
    msg.addInt(2);  // Min type
    msg.addInt(3);  // Max type
    msg.addInt(2);  // Preference weight

    this._queueEvent(callback);
};

Connection.prototype.attach = function (options, callback, db) {

    var database = options.database || options.filename;
    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var role = options.role;
    var self = this;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addByte(1);
    blr.addString(isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(isc_dpb_password, password, DEFAULT_ENCODING);

    if (role)
        blr.addString(isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

    msg.addInt(op_attach);
    msg.addInt(0);  // Database Object ID
    msg.addString(database, DEFAULT_ENCODING);
    msg.addBlr(this._blr);

    var self = this;

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

Connection.prototype.detach = function (callback, force) {

    var self = this;

    if (self._isClosed)
        return;

    if (self.options.isPool && !force) {
        self._isUsed = false;
        // self._queue = [];
        // self._pending = [];
        self.db.emit('detach', true);
        return;
    }

    self._isUsed = false;
    self._isDetach = true;

    var msg = self._msg;

    msg.pos = 0;
    msg.addInt(op_detach);
    msg.addInt(0); // Database Object ID

    self._queueEvent(function(err, ret) {
        delete(self.dbhandle);
        if (callback)
            callback(err, ret);
    });
};

Connection.prototype.createDatabase = function (options, callback) {

    var database = options.database || options.filename;
    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
    var role = options.role;
    var blr = this._blr;

    blr.pos = 0;
    blr.addByte(1);
    blr.addString(isc_dpb_set_db_charset, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(isc_dpb_password, password, DEFAULT_ENCODING);

    if (role)
        blr.addString(isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

    blr.addNumeric(isc_dpb_sql_dialect, 3);
    blr.addNumeric(isc_dpb_force_write, 1);
    blr.addNumeric(isc_dpb_overwrite, 1);
    blr.addNumeric(isc_dpb_page_size, pageSize);

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

    if (isolation instanceof Function) {
        callback = isolation;
        isolation = null;
    }

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

function describe(ret, statement){

    var br = new BlrReader(ret.buffer);
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
                                case SQL_VARYING:   param = new SQLVarString(); break;
                                case SQL_NULL:      param = new SQLVarNull(); break;
                                case SQL_TEXT:      param = new SQLVarText(); break;
                                case SQL_DOUBLE:    param = new SQLVarDouble(); break;
                                case SQL_FLOAT:
                                case SQL_D_FLOAT:   param = new SQLVarFloat(); break;
                                case SQL_TYPE_DATE: param = new SQLVarDate(); break;
                                case SQL_TYPE_TIME: param = new SQLVarTime(); break;
                                case SQL_TIMESTAMP: param = new SQLVarTimeStamp(); break;
                                case SQL_BLOB:      param = new SQLVarBlob(); break;
                                case SQL_ARRAY:     param = new SQLVarArray(); break;
                                case SQL_QUAD:      param = new SQLVarQuad(); break;
                                case SQL_LONG:      param = new SQLVarInt(); break;
                                case SQL_SHORT:     param = new SQLVarShort(); break;
                                case SQL_INT64:     param = new SQLVarInt64(); break;
                                case SQL_BOOLEAN:   param = new SQLVarBoolean(); break;
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
                        case isc_info_truncated:
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
            describe(ret, statement);
            statement.query = query;
            self.db.emit('query', query);
            ret = statement;
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
                    b = new Buffer(value, DEFAULT_ENCODING)
                else if (!isStream)
                    b = new Buffer(JSON.stringify(value), DEFAULT_ENCODING)

                if (Buffer.isBuffer(b)) {
                    bufferReader(b, 1024, function(b, next) {
                        self.batchSegments(blob, b, next);
                    }, function() {
                        ret[index] = new SQLParamQuad(blob.oid);
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
                            ret[index] = new SQLParamQuad(blob.oid);
                            self.closeBlob(blob, callback);
                        } else
                            value.resume();
                    });
                });

                value.on('end', function() {
                    isEnd = true;
                    if (isReading)
                        return;
                    ret[index] = new SQLParamQuad(blob.oid);
                    self.closeBlob(blob, callback);
                });
            });
        }

        for (var i = 0, length = params.length; i < length; i++) {
            value = params[i];
            meta = input[i];

            if (value === null) {
                switch (meta.type) {
                    case SQL_VARYING:
                    case SQL_NULL:
                    case SQL_TEXT:
                        ret[i] = new SQLParamString(null);
                        break;
                    case SQL_DOUBLE:
                    case SQL_FLOAT:
                    case SQL_D_FLOAT:
                        ret[i] = new SQLParamDouble(null);
                        break;
                    case SQL_TYPE_DATE:
                    case SQL_TYPE_TIME:
                    case SQL_TIMESTAMP:
                        ret[i] = new SQLParamDate(null);
                        break;
                    case SQL_BLOB:
                    case SQL_ARRAY:
                    case SQL_QUAD:
                        ret[i] = new SQLParamQuad(null);
                        break;
                    case SQL_LONG:
                    case SQL_SHORT:
                    case SQL_INT64:
                    case SQL_BOOLEAN:
                        ret[i] = new SQLParamInt(null);
                        break;
                    default:
                        ret[i] = null;
                }
                done();
            } else {
                switch (meta.type) {
                    case SQL_BLOB:
                        if (value === undefined || value === null) {
                            ret[i] = new SQLParamString(null);
                            done();
                        }
                        putBlobData(i, value, done);
                        break;

                    case SQL_TIMESTAMP:
                    case SQL_TYPE_DATE:
                    case SQL_TYPE_TIME:

                        if (value instanceof Date)
                            ret[i] = new SQLParamDate(value);
                        else if (typeof(value) === 'string')
                            ret[i] = new SQLParamDate(value.parseDate());
                        else
                            ret[i] = new SQLParamDate(new Date(value));

                        done();
                        break;

                    default:
                        switch (typeof value) {
                            case 'number':
                                if (value % 1 === 0) {
                                    if (value >= MIN_INT && value <= MAX_INT)
                                        ret[i] = new SQLParamInt(value);
                                    else
                                        ret[i] = new SQLParamInt64(value);
                                } else
                                    ret[i] = new SQLParamDouble(value);
                                break;
                            case 'string':
                                ret[i] = new SQLParamString(value);
                                break;
                            case 'boolean':
                                ret[i] = new SQLParamBool(value);
                                break;
                            default:
                                throw new Error('Unexpected parametter');
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

        if (params === undefined || params.length !== input.length)
            throw new Error('Expected parameters: ' + input.length);

        PrepareParams(params, input, function(prms) {

            var msg = self._msg;
            var blr = self._blr;
            msg.pos = 0;
            blr.pos = 0;
            CalcBlr(blr, prms);

            msg.addInt(op_execute);
            msg.addInt(statement.handle);
            msg.addInt(transaction.handle);
            msg.addBlr(blr);
            msg.addInt(0); // message number
            msg.addInt(1); // param count

            for(var i = 0, length = prms.length; i < length; i++)
                prms[i].encode(msg);

            self._queueEvent(callback);
        });

        return;
    }

    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    msg.addInt(op_execute);
    msg.addInt(statement.handle);
    msg.addInt(transaction.handle);

    msg.addBlr(blr); // empty
    msg.addInt(0); // message number
    msg.addInt(0); // param count

    this._queueEvent(callback);
};

function fetch_blob_async(statement, id, name) {

    if (!id)
        return null;

    return function(callback) {
        // callback(err, buffer, name);
        statement.connection.startTransaction(ISOLATION_READ_UNCOMMITTED, function(err, transaction) {

            if (err) {
                callback(err);
                return;
            }

            statement.connection._pending.push('openBlob');
            statement.connection.openBlob(id, transaction, function(err, blob) {

                var e = new Events.EventEmitter();

                e.pipe = function(stream) {
                    e.on('data', function(chunk) {
                        stream.write(chunk);
                    });
                    e.on('end', function() {
                        stream.end();
                    });
                };

                if (err) {
                    callback(err, name, e);
                    return;
                }

                function read() {
                    statement.connection.getSegment(blob, function(err, ret) {

                        if (err) {
                            e.emit('error', err);
                            return;
                        }

                        var blr = new BlrReader(ret.buffer);
                        var data = blr.readSegment();

                        e.emit('data', data);

                        if (ret.handle !== 2) {
                            read();
                            return;
                        }

                        e.emit('end');
                        e = null;
                        statement.connection.closeBlob(blob);

                    });
                }

                callback(err, name, e);
                read();

            });
        });
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

    if (!transaction) {
        callback.statement = statement;
        this._queueEvent(callback);
        return;
    }

    callback.statement = statement;
    this._queueEvent(callback);
};

Connection.prototype.fetchAll = function(statement, transaction, callback) {

    var self = this;
    var data;
    var loop = function(err, ret) {

        if (err) {
            callback(err);
            return;
        }

        if (!data) {
            data = ret.data;
        } else {
            for (var i = 0, length = ret.data.length; i < length; i++)
                data.push(ret.data[i]);
        }

        if (ret.fetched)
            callback(undefined, data);
        else
            self.fetch(statement, transaction, DEFAULT_FETCHSIZE, loop);
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
