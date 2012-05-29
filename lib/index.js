var
	net = require("net"),
    os = require("os"),
    serialize = require("./serialize.js"),
    XdrReader = serialize.XdrReader,
    BlrReader = serialize.BlrReader,
    XdrWriter = serialize.XdrWriter,
    BlrWriter = serialize.BlrWriter;


const
    op_void				= 0,	// Packet has been voided
    op_connect			= 1,	// Connect to remote server
    op_exit				= 2,	// Remote end has exitted
    op_accept			= 3,	// Server accepts connection
    op_reject			= 4,	// Server rejects connection
    op_disconnect		= 6,	// Connect is going away
    op_response			= 9,	// Generic response block

// Full context server operations

    op_attach			= 19,	// Attach database
    op_create			= 20,	// Create database
    op_detach			= 21,	// Detach database
    op_compile			= 22,	// Request based operations
    op_start			= 23,
    op_start_and_send	= 24,
    op_send				= 25,
    op_receive			= 26,
    op_unwind			= 27,	// apparently unused, see protocol.cpp's case op_unwind
    op_release			= 28,

    op_transaction		= 29,	// Transaction operations
    op_commit			= 30,
    op_rollback			= 31,
    op_prepare			= 32,
    op_reconnect		= 33,

    op_create_blob		= 34,	// Blob operations
    op_open_blob		= 35,
    op_get_segment		= 36,
    op_put_segment		= 37,
    op_cancel_blob		= 38,
    op_close_blob		= 39,

    op_info_database	= 40,	// Information services
    op_info_request		= 41,
    op_info_transaction	= 42,
    op_info_blob		= 43,

    op_batch_segments	= 44,	// Put a bunch of blob segments

    op_que_events		= 48,	// Que event notification request
    op_cancel_events	= 49,	// Cancel event notification request
    op_commit_retaining	= 50,	// Commit retaining (what else)
    op_prepare2			= 51,	// Message form of prepare
    op_event			= 52,	// Completed event request (asynchronous)
    op_connect_request	= 53,	// Request to establish connection
    op_aux_connect		= 54,	// Establish auxiliary connection
    op_ddl				= 55,	// DDL call
    op_open_blob2		= 56,
    op_create_blob2		= 57,
    op_get_slice		= 58,
    op_put_slice		= 59,
    op_slice			= 60,	// Successful response to op_get_slice
    op_seek_blob		= 61,	// Blob seek operation

// DSQL operations

    op_allocate_statement 	= 62,	// allocate a statment handle
    op_execute				= 63,	// execute a prepared statement
    op_exec_immediate		= 64,	// execute a statement
    op_fetch				= 65,	// fetch a record
    op_fetch_response		= 66,	// response for record fetch
    op_free_statement		= 67,	// free a statement
    op_prepare_statement 	= 68,	// prepare a statement
    op_set_cursor			= 69,	// set a cursor name
    op_info_sql				= 70,

    op_dummy				= 71,	// dummy packet to detect loss of client
    op_response_piggyback 	= 72,	// response block for piggybacked messages
    op_start_and_receive 	= 73,
    op_start_send_and_receive 	= 74,
    op_exec_immediate2		= 75,	// execute an immediate statement with msgs
    op_execute2				= 76,	// execute a statement with msgs
    op_insert				= 77,
    op_sql_response			= 78,	// response from execute, exec immed, insert
    op_transact				= 79,
    op_transact_response 	= 80,
    op_drop_database		= 81,
    op_service_attach		= 82,
    op_service_detach		= 83,
    op_service_info			= 84,
    op_service_start		= 85,
    op_rollback_retaining	= 86,
    op_partial				= 89,	// packet is not complete - delay processing
    op_trusted_auth			= 90,
    op_cancel				= 91,
    op_cont_auth			= 92,
    op_ping					= 93,
    op_accept_data			= 94,	// Server accepts connection and returns some data to client
    op_abort_aux_connection	= 95,	// Async operation - stop waiting for async connection to arrive
    op_crypt				= 96;

const
    CONNECT_VERSION2	= 2;
    ARCHITECTURE_GENERIC = 1;

const
// Protocol 10 includes support for warnings and removes the requirement for
// encoding and decoding status codes
    PROTOCOL_VERSION10	= 10,

// Since protocol 11 we must be separated from Borland Interbase.
// Therefore always set highmost bit in protocol version to 1.
// For unsigned protocol version this does not break version's compare.

    FB_PROTOCOL_FLAG = 0x8000,

// Protocol 11 has support for user authentication related
// operations (op_update_account_info, op_authenticate_user and
// op_trusted_auth). When specific operation is not supported,
// we say "sorry".

    PROTOCOL_VERSION11	= (FB_PROTOCOL_FLAG | 11),

// Protocol 12 has support for asynchronous call op_cancel.
// Currently implemented asynchronously only for TCP/IP.

    PROTOCOL_VERSION12	= (FB_PROTOCOL_FLAG | 12),

// Protocol 13 has support for authentication plugins (op_cont_auth).

    PROTOCOL_VERSION13	= (FB_PROTOCOL_FLAG | 13);

const
    DSQL_close      = 1,
    DSQL_drop       = 2,
    DSQL_unprepare  = 4; // >= 2.5

const
    ptype_batch_send = 3;

const
    SQL_TEXT = 452, // Array of char
    SQL_VARYING = 448,
    SQL_SHORT = 500,
    SQL_LONG = 496,
    SQL_FLOAT = 482,
    SQL_DOUBLE = 480,
    SQL_D_FLOAT = 530,
    SQL_TIMESTAMP = 510,
    SQL_BLOB = 520,
    SQL_ARRAY = 540,
    SQL_QUAD = 550,
    SQL_TYPE_TIME = 560,
    SQL_TYPE_DATE = 570,
    SQL_INT64 = 580,
    SQL_BOOLEAN = 32764, // >= 3.0
    SQL_NULL = 32766; // >= 2.5

/***********************/
/*   ISC Error Codes   */
/***********************/
const
    isc_arg_end			= 0,	// end of argument list
    isc_arg_gds			= 1,	// generic DSRI status value
    isc_arg_string		= 2,	// string argument
    isc_arg_cstring		= 3,	// count & string argument
    isc_arg_number		= 4,	// numeric argument (long)
    isc_arg_interpreted	= 5,	// interpreted status code (string)
    isc_arg_vms			= 6,	// VAX/VMS status code (long)
    isc_arg_unix		= 7,	// UNIX error code
    isc_arg_domain		= 8,	// Apollo/Domain error code
    isc_arg_dos			= 9,	// MSDOS/OS2 error code
    isc_arg_mpexl		= 10,	// HP MPE/XL error code
    isc_arg_mpexl_ipc	= 11,	// HP MPE/XL IPC error code
    isc_arg_next_mach	= 15,	// NeXT/Mach error code
    isc_arg_netware		= 16,	// NetWare error code
    isc_arg_win32		= 17,	// Win32 error code
    isc_arg_warning		= 18,	// warning argument
    isc_arg_sql_state	= 19;	// SQLSTATE

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
    isc_dpb_drop_walfile            = 40,
    isc_dpb_old_dump_id             = 41,
    isc_dpb_wal_backup_dir          = 42,
    isc_dpb_wal_chkptlen            = 43,
    isc_dpb_wal_numbufs             = 44,
    isc_dpb_wal_bufsize             = 45,
    isc_dpb_wal_grp_cmt_wait        = 46,
    isc_dpb_lc_messages             = 47,
    isc_dpb_lc_ctype                = 48,
    isc_dpb_cache_manager           = 49,
    isc_dpb_shutdown                = 50,
    isc_dpb_online                  = 51,
    isc_dpb_shutdown_delay          = 52,
    isc_dpb_reserved                = 53,
    isc_dpb_overwrite               = 54,
    isc_dpb_sec_attach              = 55,
    isc_dpb_disable_wal             = 56,
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
    isc_dpb_trusted_auth			= 73,
    isc_dpb_process_name            = 74,
    isc_dpb_trusted_role			= 75,
    isc_dpb_org_filename			= 76,
    isc_dpb_utf8_filename			= 77,
    isc_dpb_ext_call_depth			= 78;

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
    isc_tpb_read_committed	        =  15,
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
    isc_info_sql_select = 4,
    isc_info_sql_bind = 5,
    isc_info_sql_num_variables = 6,
    isc_info_sql_describe_vars = 7,
    isc_info_sql_describe_end = 8,
    isc_info_sql_sqlda_seq = 9,
    isc_info_sql_message_seq = 10,
    isc_info_sql_type = 11,
    isc_info_sql_sub_type = 12,
    isc_info_sql_scale = 13,
    isc_info_sql_length = 14,
    isc_info_sql_null_ind = 15,
    isc_info_sql_field = 16,
    isc_info_sql_relation = 17,
    isc_info_sql_owner = 18,
    isc_info_sql_alias = 19,
    isc_info_sql_sqlda_start = 20,
    isc_info_sql_stmt_type = 21,
    isc_info_sql_get_plan = 22,
    isc_info_sql_records = 23,
    isc_info_sql_batch_fetch = 24,
    isc_info_sql_relation_alias = 25, // >= 2.0
    isc_info_sql_explain_plan = 26;   // >= 3.0

/*******************/
/* Blr definitions */
/*******************/
const
    blr_text = 14,
    blr_text2 = 15, /* added in 3.2 JPN */
    blr_short = 7,
    blr_long = 8,
    blr_quad = 9,
    blr_float = 10,
    blr_double = 27,
    blr_d_float = 11,
    blr_timestamp = 35,
    blr_varying = 37,
    blr_varying2 = 38,
    blr_blob = 261,
    blr_cstring = 40,
    blr_cstring2 = 41,
    blr_blob_id = 45,
    blr_sql_date = 12,
    blr_sql_time = 13,
    blr_int64 = 16,
    blr_blob2 = 17, // >= 2.0
    blr_domain_name = 18, // >= 2.1
    blr_domain_name2 = 19, // >= 2.1
    blr_not_nullable = 20, // >= 2.1
    blr_column_name = 21, // >= 2.5
    blr_column_name2 = 22, // >= 2.5
    blr_bool = 23, // >= 3.0

    blr_version4 = 4,
    blr_version5 = 5, // dialect 3
    blr_eoc = 76,
    blr_end = 255,

    blr_assignment = 1,
    blr_begin = 2,
    blr_dcl_variable = 3,
    blr_message = 4;

const
    isc_info_sql_stmt_select = 1,
    isc_info_sql_stmt_insert = 2,
    isc_info_sql_stmt_update = 3,
    isc_info_sql_stmt_delete = 4,
    isc_info_sql_stmt_ddl = 5,
    isc_info_sql_stmt_get_segment = 6,
    isc_info_sql_stmt_put_segment = 7,
    isc_info_sql_stmt_exec_procedure = 8,
    isc_info_sql_stmt_start_trans = 9,
    isc_info_sql_stmt_commit = 10,
    isc_info_sql_stmt_rollback = 11,
    isc_info_sql_stmt_select_for_upd = 12,
    isc_info_sql_stmt_set_generator = 13,
    isc_info_sql_stmt_savepoint = 14;

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
            //isc_info_sql_field,
            //isc_info_sql_relation,
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
    ISOLATION_READ_UNCOMMITTED  = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_rec_version],
    ISOLATION_READ_COMMITED     = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version],
    ISOLATION_REPEATABLE_READ   = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_concurrency],
    ISOLATION_SERIALIZABLE      = [isc_tpb_version3, isc_tpb_write, isc_tpb_wait, isc_tpb_consistency],
    ISOLATION_READ_COMMITED_READ_ONLY   = [isc_tpb_version3, isc_tpb_read, isc_tpb_wait, isc_tpb_read_committed, isc_tpb_no_rec_version];

exports.ISOLATION_READ_UNCOMMITTED = ISOLATION_READ_UNCOMMITTED;
exports.ISOLATION_READ_COMMITED = ISOLATION_READ_COMMITED;
exports.ISOLATION_REPEATABLE_READ = ISOLATION_REPEATABLE_READ;
exports.ISOLATION_SERIALIZABLE = ISOLATION_SERIALIZABLE;
exports.ISOLATION_READ_COMMITED_READ_ONLY = ISOLATION_READ_COMMITED_READ_ONLY;

const
    DEFAULT_ENCODING = 'utf8';
    DEFAULT_FETCHSIZE = 200;

/***************************************
 *
 *   SQLVar
 *
 ***************************************/


const
    ScaleDivisor = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000,
        100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
const
    DateOffset = 40587,
    TimeCoeff = 86400000;
    MsPerMinute = 60000;

//------------------------------------------------------

function SQLVarText() {}

SQLVarText.prototype.decode = function(data) {
    if (this.subType > 1) {
        var ret = data.readText(this.length, DEFAULT_ENCODING);
    } else {
        var ret = data.readBuffer(this.length);
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
    if (this.subType > 1) {
        var ret = data.readString(DEFAULT_ENCODING)
    } else {
        var ret = data.readBuffer()
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
        return new Date((ret - DateOffset) * TimeCoeff);
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
        return new Date(Math.floor(ret / 10));
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
        return new Date((date - DateOffset) * TimeCoeff + Math.floor(time / 10));
    }
    return null;
};

SQLVarTimeStamp.prototype.calcBlr = function(blr) {
    blr.addByte(blr_timestamp);
};

//------------------------------------------------------

// todo: test it
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

function SQLParamDouble(value) {
    this.value = value;
}

SQLParamDouble.prototype.encode = function(data) {
    if (this.value) {
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
    if (this.value) {
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
    if (this.value) {
        data.addInt(this.value.low);
        data.addInt(this.value.high);
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
    if (this.value) {
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
    return (obj instanceof Object && obj.status)
}

function getError(obj) {
    if (obj instanceof Object) {
        return obj.status
    } else {
        return undefined;
    }
}

function doCallback(obj, callback, error) {
    if (isError(obj) && error) {
        error(obj)
    } else if (callback) {
        callback(obj)
    }
}

/***************************************
 *
 *   Statement
 *
 ***************************************/

function Statement(connection) {
    this.connection = connection;
}

Statement.prototype.close = function(callback, error) {
    this.connection.closeStatement(this, callback, error);
};

Statement.prototype.drop = function(callback, error) {
    this.connection.dropStatement(this, callback, error);
};

Statement.prototype.fetchBlobs = function(transaction, callback, error) {
    if (this.rows && this.rows.length) {
        var indexes = [];
        for (var i = 0; i < this.output.length; i++) {
            if (this.output[i].type == SQL_BLOB) {
                indexes.push(i);
            }
        }
        if (indexes.length) {
            var self = this;
            function fetch(row, col, callback, error) {
                var blobid = self.rows[row][col];
                if (blobid) {
                    self.connection.openBlob(blobid, transaction, function(blob) {
                        var buffer;
                        function read() {
                            self.connection.getSegment(blob, function(ret) {
                                var blr = new BlrReader(ret.buffer);
                                var data = blr.readSegment();
                                if (buffer) {
                                    var tmp = buffer;
                                    buffer = new Buffer(tmp.length + data.length);
                                    tmp.copy(buffer);
                                    data.copy(buffer, tmp.length);
                                } else {
                                    buffer = data;
                                }
                                if (ret.handle == 2) { // ???
                                    if (self.output[col].subType == isc_blob_text) {
                                        self.rows[row][col] = buffer.toString()
                                    } else {
                                        self.rows[row][col] = buffer
                                    }
                                    callback();
                                    self.connection.closeBlob(blob);
                                } else {
                                    read();
                                }
                            }, error);
                        }
                        read()
                    }, error)
                } else {
                    callback()
                }
            }

            var count = this.rows.length * indexes.length;
            for (var r = 0; r < this.rows.length; r++) {
              for (var c = 0; c < indexes.length; c++) {
                  fetch(r, indexes[c],
                      function() {
                          count--;
                          if (count == 0) {
                              if (callback) {
                                  callback()
                              }
                          }
                      },
                      function(ret) {
                          if (error) {
                              error(ret);
                          } else if (callback) {
                              callback(ret);
                          }
                      });
              }
            }
        } else {
            if (callback) {
                callback()
            }
        }
    } else {
        if (callback) {
            callback()
        }
    }
};

Statement.prototype.execute = function(transaction, params, callback, error){
    if (params instanceof Function) {
        error = callback;
        callback = params;
        params = null;
    }
    var cnx = this.connection;
    var self = this;

    cnx.executeStatement(transaction, this, params, function(ret) {
        switch (self.type) {
            case isc_info_sql_stmt_select:
                cnx.fetchAll(self, function() {
                    if (callback) {
                        callback({meta: self.output, data: self.rows})
                    }
                }, error);
                return;
            case isc_info_sql_stmt_exec_procedure:
                if (self.output.length) {
                    cnx.fetch(self, 1, function() {
                        if (callback) {
                            callback({meta: self.output, data: self.rows[0]})
                        }
                    }, error);
                    return;
                }
        }
        if (callback) {
            callback(ret)
        }
    }, error);
};

/***************************************
 *
 *   Transaction
 *
 ***************************************/

function Transaction(connection) {
    this.connection = connection;
}

Transaction.prototype.newStatement = function(query, callback, error) {
    var cnx = this.connection;
    var self = this;
    cnx.allocateStatement(function(statement) {
        cnx.prepareStatement(self, statement, query, false, callback, error);
    }, error)
};

Transaction.prototype.execute = function(query, params, callback, error) {
    if (params instanceof Function) {
        error = callback;
        callback = params;
        params = null;
    }

    var self = this;
    this.newStatement(query,
        function(statement) {
            statement.execute(self, params, function(result) {
                statement.fetchBlobs(self, function() {
                    statement.drop(); // do not wait
                    doCallback(result, callback, error);
                }, error)
            }, error)
        },
        function(err) {
            // do not try to use invalid statement
            doCallback(err, callback, error);
        })
};

Transaction.prototype.commit = function(callback, error) {
    this.connection.commit(this, callback, error)
};

Transaction.prototype.rollback = function(callback, error) {
    this.connection.rollback(this, callback, error)
};

Transaction.prototype.commitRetaining = function(callback, error) {
    this.connection.commitRetaining(this, callback, error)
};

Transaction.prototype.rollbackRetaining = function(callback, error) {
    this.connection.rollbackRetaining(this, callback, error)
};

/***************************************
 *
 *   Database
 *
 ***************************************/

var Database = exports.Database = function(host, port, database, user, password, callback, error) {
    var cnx = this.connection = new Connection(host, port);
    cnx.connect(database, function(){
        cnx.attach(database, user, password, callback, error);
    }, error);
};

Database.prototype.detach = function(callback, error) {
    this.connection.detach(callback, error)
}

Database.prototype.startTransaction = function(isolation, callback, error) {
    this.connection.startTransaction(isolation, callback, error);
};

Database.prototype.newStatement = function (query, callback, error) {
    this.startTransaction(function(transaction) {
        transaction.newStatement(query, function(statement) {
            transaction.commit(function() {
                callback(statement);
            }, error);
        }, error);
    }, error)
};

Database.prototype.execute = function(query, params, callback, error) {
    this.connection.startTransaction(function(transaction) {
        transaction.execute(query, params,
            function(result) {
                transaction.commit(function() {
                    if (callback) {
                        callback(result)
                    }
                }, error);
            },
            function(result) {
                transaction.rollback(function() {
                    if (error) {
                        error(result)
                    } else
                    if (callback) {
                        callback(result);
                    }
                }, error)
            })
    }, error)
};

/***************************************
 *
 *   Connection
 *
 ***************************************/

var Connection = exports.Connection = function (host, port){
    this._msg = new XdrWriter(32);
	this._blr = new BlrWriter(32);
	this._queue = new Array();
	this._socket = net.createConnection(port, host);
    var self = this;
	this._socket.on('data', function(data) {
        var obj, cb, pos, xdr, buf;
        if (!self._xdr) {
            xdr = new XdrReader(data)
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
                obj = decodeResponse(xdr, cb.callback, cb.error);
            } catch(err) {
                buf = new Buffer(xdr.buffer.length - pos);
                xdr.buffer.copy(buf, 0, pos);
                xdr.buffer = buf;
                xdr.pos = 0;
                self._xdr = xdr;
                return;
            }
            self._queue.shift();
            doCallback(obj, cb.callback, cb.error);
        }
    });
};

function decodeResponse(data, callback, error){
    do {var r = data.readInt()} while (r == op_dummy);
    var item, op;
    switch (r) {
        case op_response:
            var response;
            if (callback) {
                response = callback.response || {}
            } else {
                response = {};
            }
            response.handle = data.readInt();
            var oid =  data.readQuad();
            if (oid.low || oid.high) {
                response.oid = oid
            }
            var buf = data.readArray();
            if (buf) {
                response.buffer = buf
            }
            var num;
            while (true) {
                op = data.readInt();
                switch (op){
                    case isc_arg_end:
                        return response;
                    case isc_arg_gds:
                        num = data.readInt();
                        if (num) {
                            item = {gdscode: num};
                            if (response.status) {
                                response.status.push(item)
                            } else {
                                response.status = [item]
                            }
                        }
                        break;
                    case isc_arg_string:
                    case isc_arg_interpreted:
                    case isc_arg_sql_state:
                        if (item.params) {
                            var str = data.readString(DEFAULT_ENCODING);
                            item.params.push(str);
                        } else {
                            item.params = [data.readString(DEFAULT_ENCODING)]
                        }
                        break;
                    case isc_arg_number:
                        num = data.readInt();
                        if (item.params) {
                            item.params.push(num)
                        } else {
                            item.params = [num]
                        }
                        if (item.gdscode == isc_sqlerr) {
                            response.sqlcode = num
                        }
                        break;
                    default:
                        throw new Error('unexpected: ' + op);
                }
            }
            break;
        case op_fetch_response:
            var status = data.readInt();
            var count = data.readInt();
            var statement = callback.statement;
            var output = statement.output;
            var rows = statement.rows;
            if (!rows) {
                rows = [];
                statement.rows = rows;
            }
            while (count && (status != 100)) {
                var row = new Array(output.length);
                for(var i = 0; i < output.length; i++) {
                    item = output[i];
                    row[i] = item.decode(data);
                }
                rows.push(row);
                op = data.readInt(); // ??
                status = data.readInt();
                count = data.readInt();
            }
            if (status == 100)
                statement.fetched = true;
            return;
        case op_accept:
            if (
                data.readInt() != PROTOCOL_VERSION10 ||
                    data.readInt() != ARCHITECTURE_GENERIC ||
                    data.readInt() != ptype_batch_send)
            {
                throw new Error('Invalid connect result')
            }
            return;
        default:
            throw new Error('unexpected:' + r)
    }
}

Connection.prototype._queueEvent = function(callback, error){
    this._queue.push({callback: callback, error: error});
    this._socket.write(this._msg.getData());
};


Connection.prototype.connect = function (filename, callback, error) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    msg.addInt(op_connect);
    msg.addInt(op_attach);
    msg.addInt(CONNECT_VERSION2);
    msg.addInt(ARCHITECTURE_GENERIC);
    msg.addString(filename || '', DEFAULT_ENCODING);
    msg.addInt(1);  // Protocol version understood count.

    blr.addString(1, process.env['USER'] || process.env['USERNAME'], DEFAULT_ENCODING);
    var hostname = os.hostname();
    blr.addString(4, hostname, DEFAULT_ENCODING);
    blr.addBytes([6, 0]);
    msg.addBlr(this._blr);

    msg.addInt(PROTOCOL_VERSION10);
    msg.addInt(ARCHITECTURE_GENERIC);
    msg.addInt(ptype_batch_send);  // Min type
    msg.addInt(ptype_batch_send);  // Max type
    msg.addInt(2);  // Preference weight

    this._queueEvent(callback, error);
};


Connection.prototype.attach = function (filename, user, password, callback, error) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addByte(1);
    blr.addString(isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(isc_dpb_password, password, DEFAULT_ENCODING);

    msg.addInt(op_attach);
    msg.addInt(0);  // Database Object ID
    msg.addString(filename, DEFAULT_ENCODING);
    msg.addBlr(this._blr);

    var self = this;
    this._queueEvent(function (ret) {
        self.dbhandle = ret.handle;
        if (callback) {callback(ret)}
    }, error);
};

Connection.prototype.detach = function (callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_detach);
    msg.addInt(0); // Database Object ID
    var self = this;
    this._queueEvent(function (ret) {
        delete(self.dbhandle);
        if (callback) {callback(ret)}
    }, error);
};

Connection.prototype.createDatabase = function (filename, user, password, pageSize, callback, error) {
    var blr = this._blr;
    blr.pos = 0;
    blr.addByte(1);
    blr.addString(isc_dpb_set_db_charset, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(isc_dpb_password, password, DEFAULT_ENCODING);
    blr.addNumeric(isc_dpb_sql_dialect, 3);
    blr.addNumeric(isc_dpb_force_write, 1);
    blr.addNumeric(isc_dpb_overwrite, 1);
    blr.addNumeric(isc_dpb_page_size, pageSize);

    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_create);	// op_create
    msg.addInt(0);	// Database Object ID
    msg.addString(filename, DEFAULT_ENCODING);
    msg.addBlr(blr);

    var self = this;
    this._queueEvent(function (ret) {
        self.dbhandle = ret.handle;
        if (callback) {callback(ret)}
    }, error);
};

Connection.prototype.startTransaction = function (isolation, callback, error) {
    var blr = this._blr;
    var msg = this._msg;
    blr.pos = 0;
    msg.pos = 0;
    if (isolation instanceof Function) {
        error = callback;
        callback = isolation;
        isolation = null;
    }

    blr.addBytes(isolation || ISOLATION_REPEATABLE_READ);
    msg.addInt(op_transaction);
    msg.addInt(this.dbhandle);
    msg.addBlr(blr);
    callback.response = new Transaction(this);
    this._queueEvent(callback, error);
};

Connection.prototype.commit = function (transaction, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_commit);
    msg.addInt(transaction.handle);
    this._queueEvent(callback, error);
};

Connection.prototype.rollback = function (transaction, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_rollback);
    msg.addInt(transaction.handle);
    this._queueEvent(callback, error);
};

Connection.prototype.commitRetaining = function (transaction, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_commit_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback, error);
};

Connection.prototype.rollbackRetaining = function (transaction, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_rollback_retaining);
    msg.addInt(transaction.handle);
    this._queueEvent(callback, error);
};

Connection.prototype.allocateStatement = function (callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_allocate_statement);
    msg.addInt(this.dbhandle);
    callback.response = new Statement(this);
    this._queueEvent(callback, error);
};

Connection.prototype.dropStatement = function (statement, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(DSQL_drop);
    this._queueEvent(callback, error);
};

Connection.prototype.closeStatement = function (statement, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_free_statement);
    msg.addInt(statement.handle);
    msg.addInt(DSQL_close);
    this._queueEvent(function(ret){
        delete(statement.fetched);
        delete(statement.rows);
        if (callback) {callback(ret)}
    }, error);
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
                                    throw new Error('unexpected')
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
                        default:
                            finishDescribe = true;
                            br.pos--;
                    }
                }
        }
    }
}

Connection.prototype.prepareStatement = function (transaction, statement, query, plan, callback, error) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    if (plan instanceof Function) {
        error = callback;
        callback = plan;
        plan = false;
    }

    blr.addBytes(DESCRIBE);
    if (plan) {blr.addByte(isc_info_sql_get_plan)}
    msg.addInt(op_prepare_statement);
    msg.addInt(transaction.handle);
    msg.addInt(statement.handle);
    msg.addInt(3); // dialect = 3
    msg.addString(query, DEFAULT_ENCODING);
    msg.addBlr(blr);
    msg.addInt(1024); // buffer_length

    this._queueEvent(function (ret) {
        if (!ret.status){
            describe(ret, statement);
            statement.query = query;
            ret = statement;
        }
        if (callback) {
            callback(ret);
        }
    }, error);
};

function CalcBlr(blr, xsqlda) {
    blr.addBytes([blr_version5, blr_begin, blr_message, 0]); // + message number
    blr.addWord(xsqlda.length * 2);
    for (var i = 0; i < xsqlda.length; i++) {
        xsqlda[i].calcBlr(blr);
        blr.addByte(blr_short);
        blr.addByte(0);
    }
    blr.addByte(blr_end);
    blr.addByte(blr_eoc);
}

function GetNullFor(type) {
    switch (type) {
        case SQL_VARYING:
        case SQL_NULL:
        case SQL_TEXT:
            return new SQLParamString(null);
        case SQL_DOUBLE:
        case SQL_FLOAT:
        case SQL_D_FLOAT:
            return new SQLParamDouble(null);
        case SQL_TYPE_DATE:
        case SQL_TYPE_TIME:
        case SQL_TIMESTAMP:
            return new SQLParamDate(null);
        case SQL_BLOB:
        case SQL_ARRAY:
        case SQL_QUAD:
            return new SQLParamQuad(null);
        case SQL_LONG:
        case SQL_SHORT:
        case SQL_INT64:
        case SQL_BOOLEAN:
            return new SQLParamInt(null);
        default:
            return null;
    }
}

function PrepareParams(params, input) {
    var value;
    var ret = new Array(params.length);
    for (var i = 0; i < params.length; i++) {
        value = params[i];
        switch (typeof value) {
            case 'number':
                ret[i] = new SQLParamDouble(value)
                break;
            case 'string':
                ret[i] = new SQLParamString(value);
                break;
            case 'boolean':
                ret[i] = new SQLParamBool(value);
                break;
            case 'undefined':
                ret[i] = GetNullFor(input[i].type);
                break;
            case 'object':
                if (value == null) {
                    ret[i] = GetNullFor(input[i].type);
                    break;
                }
                if (value instanceof Date) {
                    ret[i] = new SQLParamDate(value);
                    break;
                }
            default:
                throw new Error("Unexpected parametter");
        }
    }
    return ret;
}

Connection.prototype.executeStatement = function(transaction, statement, params, callback, error){
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    if (params instanceof Function) {
        error = callback;
        callback = params;
        params = null;
    }

    msg.addInt(op_execute);
    msg.addInt(statement.handle);
    msg.addInt(transaction.handle);
    var input = statement.input;
    if (input.length) {
        if (!(params instanceof Array)) {
            if (params != undefined) {
                params = [params];
            } else {
                params = [];
            }
        }
        if (!params || params.length != input.length) {
            throw new Error("expected parametters: " + input.length);
        }
        params = PrepareParams(params, input);
        CalcBlr(blr, params);
        msg.addBlr(blr);
        msg.addInt(0); // message number
        msg.addInt(1); // param count
        for(var i = 0; i < params.length; i++) {
            params[i].encode(msg);
        }
    } else {
        msg.addBlr(blr); // empty
        msg.addInt(0); // message number
        msg.addInt(0); // param count
    }
    this._queueEvent(callback, error);
};

Connection.prototype.fetch = function(statement, count, callback, error) {
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;
    if (count instanceof Function) {
        error = callback;
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
    this._queueEvent(callback, error);
};

Connection.prototype.fetchAll = function(statement, callback, error) {
    var self = this;
    var loop = function(){
        if (statement.fetched) {
            callback()
        } else {
            self.fetch(statement, DEFAULT_FETCHSIZE, loop, error)
        }
    };
    this.fetch(statement, DEFAULT_FETCHSIZE, loop, error);
};

Connection.prototype.openBlob = function(blob, transaction, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_open_blob);
    msg.addInt(transaction.handle);
    msg.addQuad(blob);
    this._queueEvent(callback, error);
};

Connection.prototype.closeBlob = function(blob, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_close_blob);
    msg.addInt(blob.handle);
    this._queueEvent(callback, error);
};

Connection.prototype.getSegment = function(blob, callback, error) {
    var msg = this._msg;
    msg.pos = 0;
    msg.addInt(op_get_segment);
    msg.addInt(blob.handle);
    msg.addInt(1024); // buffer length
    msg.addInt(0); // ???
    this._queueEvent(callback, error);
};