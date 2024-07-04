/***************************************
 *
 *   Constantes
 *
 ***************************************/

const defaultOptions = {
    DEFAULT_HOST : '127.0.0.1',
    DEFAULT_PORT : 3050,
    DEFAULT_USER : 'SYSDBA',
    DEFAULT_PASSWORD : 'masterkey',
    DEFAULT_LOWERCASE_KEYS : false,
    DEFAULT_PAGE_SIZE : 4096,
    DEFAULT_SVC_NAME : 'service_mgr',
    DEFAULT_ENCODING : 'UTF8',
    DEFAULT_FETCHSIZE : 200,
};

const buffer= {
    MAX_BUFFER_SIZE : 8192,
};

const int = {
    MAX_INT : Math.pow(2, 31) - 1,
    MIN_INT : -Math.pow(2, 31),
};

const op = {
    op_void                   : 0,  // Packet has been voided
    op_connect                : 1,  // Connect to remote server
    op_exit                   : 2,  // Remote end has exitted
    op_accept                 : 3,  // Server accepts connection
    op_reject                 : 4,  // Server rejects connection
    op_disconnect             : 6,  // Connect is going away
    op_response               : 9,  // Generic response block

    // Full context server operations

    op_attach                 : 19, // Attach database
    op_create                 : 20, // Create database
    op_detach                 : 21, // Detach database
    op_compile                : 22, // Request based operations
    op_start                  : 23,
    op_start_and_send         : 24,
    op_send                   : 25,
    op_receive                : 26,
    op_unwind                 : 27, // apparently unused, see protocol.cpp's case op_unwind
    op_release                : 28,

    op_transaction            : 29, // Transaction operations
    op_commit                 : 30,
    op_rollback               : 31,
    op_prepare                : 32,
    op_reconnect              : 33,

    op_create_blob            : 34, // Blob operations
    op_open_blob              : 35,
    op_get_segment            : 36,
    op_put_segment            : 37,
    op_cancel_blob            : 38,
    op_close_blob             : 39,

    op_info_database          : 40, // Information services
    op_info_request           : 41,
    op_info_transaction       : 42,
    op_info_blob              : 43,

    op_batch_segments         : 44, // Put a bunch of blob segments

    op_que_events             : 48, // Que event notification request
    op_cancel_events          : 49, // Cancel event notification request
    op_commit_retaining       : 50, // Commit retaining (what else)
    op_prepare2               : 51, // Message form of prepare
    op_event                  : 52, // Completed event request (asynchronous)
    op_connect_request        : 53, // Request to establish connection
    op_aux_connect            : 54, // Establish auxiliary connection
    op_ddl                    : 55, // DDL call
    op_open_blob2             : 56,
    op_create_blob2           : 57,
    op_get_slice              : 58,
    op_put_slice              : 59,
    op_slice                  : 60, // Successful response to op_get_slice
    op_seek_blob              : 61, // Blob seek operation

// DSQL operations

    op_allocate_statement     : 62, // allocate a statment handle
    op_execute                : 63, // execute a prepared statement
    op_exec_immediate         : 64, // execute a statement
    op_fetch                  : 65, // fetch a record
    op_fetch_response         : 66, // response for record fetch
    op_free_statement         : 67, // free a statement
    op_prepare_statement      : 68, // prepare a statement
    op_set_cursor             : 69, // set a cursor name
    op_info_sql               : 70,

    op_dummy                  : 71, // dummy packet to detect loss of client
    op_response_piggyback     : 72, // response block for piggybacked messages
    op_start_and_receive      : 73,
    op_start_send_and_receive : 74,
    op_exec_immediate2        : 75, // execute an immediate statement with msgs
    op_execute2               : 76, // execute a statement with msgs
    op_insert                 : 77,
    op_sql_response           : 78, // response from execute, exec immed, insert
    op_transact               : 79,
    op_transact_response      : 80,
    op_drop_database          : 81,
    op_service_attach         : 82,
    op_service_detach         : 83,
    op_service_info           : 84,
    op_service_start          : 85,
    op_rollback_retaining     : 86,
    op_partial                : 89, // packet is not complete - delay processing
    op_trusted_auth           : 90,
    op_cancel                 : 91,
    op_cont_auth              : 92,
    op_ping                   : 93,
    op_accept_data            : 94, // Server accepts connection and returns some data to client
    op_abort_aux_connection   : 95, // Async operation - stop waiting for async connection to arrive
    op_crypt                  : 96,
    op_crypt_key_callback     : 97,
    op_cond_accept            : 98, // Server accepts connection, returns some data to client
                                    // and asks client to continue authentication before attach call
};

const dsql = {
    DSQL_close : 1,
    DSQL_drop : 2,
    DSQL_unprepare : 4, // >: 2.5
};

/***********************/
/*   ISC Error Codes   */
/***********************/
const iscError = {
    isc_sqlerr: 335544436,
    isc_arg_end : 0,  // end of argument list
    isc_arg_gds : 1,  // generic DSRI status value
    isc_arg_string : 2,  // string argument
    isc_arg_cstring : 3,  // count & string argument
    isc_arg_number : 4,  // numeric argument (long)
    isc_arg_interpreted : 5,  // interpreted status code (string)
    isc_arg_unix : 7,  // UNIX error code
    isc_arg_next_mach : 15, // NeXT/Mach error code
    isc_arg_win32 : 17, // Win32 error code
    isc_arg_warning : 18, // warning argument
    isc_arg_sql_state : 19, // SQLSTATE
};

const connect = {
    CONNECT_VERSION2 : 2,
    CONNECT_VERSION3 : 3,
    ARCHITECTURE_GENERIC : 1,
};

/*******************/
/*    Protocols    */
/*******************/
const FB_PROTOCOL_FLAG = 0x8000;
const protocol = {
    // Protocol 10 includes support for warnings and removes the requirement for
    // encoding and decoding status codes
    PROTOCOL_VERSION10  : 10,

    // Since protocol 11 we must be separated from Borland Interbase.
    // Therefore always set highmost bit in protocol version to 1.
    // For unsigned protocol version this does not break version's compare.
    FB_PROTOCOL_FLAG    : FB_PROTOCOL_FLAG,
    FB_PROTOCOL_MASK    : ~FB_PROTOCOL_FLAG & 0xFFFF,

    // Protocol 11 has support for user authentication related
    // operations (op_update_account_info, op_authenticate_user and
    // op_trusted_auth). When specific operation is not supported,
    // we say "sorry".
    PROTOCOL_VERSION11  : (FB_PROTOCOL_FLAG | 11),

    // Protocol 12 has support for asynchronous call op_cancel.
    // Currently implemented asynchronously only for TCP/IP.
    PROTOCOL_VERSION12  : (FB_PROTOCOL_FLAG | 12),

    // Protocol 13 has support for authentication plugins (op_cont_auth).
    PROTOCOL_VERSION13  : (FB_PROTOCOL_FLAG | 13),
};

// Protocols types (accept_type)
const acceptType = {
    ptype_rpc : 2, 			 // Simple remote procedure call
    ptype_batch_send : 3,    // Batch sends, no asynchrony
    ptype_out_of_band : 4,   // Batch sends w/ out of band notification
    ptype_lazy_send : 5,     // Deferred packets delivery;
    ptype_mask : 0xFF,       // Mask - up to 255 types of protocol
    pflag_compress : 0x100  // Turn on compression if possible
};

const SUPPORTED_PROTOCOL = [
    [protocol.PROTOCOL_VERSION10, connect.ARCHITECTURE_GENERIC, acceptType.ptype_rpc, acceptType.ptype_batch_send, 1],
    [protocol.PROTOCOL_VERSION11, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 2],
    [protocol.PROTOCOL_VERSION12, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 3],
    [protocol.PROTOCOL_VERSION13, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 4],
];

const authPlugin = {
    AUTH_PLUGIN_LEGACY : 'Legacy_Auth',
    AUTH_PLUGIN_SRP : 'Srp',
    // AUTH_PLUGIN_SRP256 : 'Srp256',
};

const authOptions = {
    // AUTH_PLUGIN_LIST : [authPlugin.AUTH_PLUGIN_SRP256, authPlugin.AUTH_PLUGIN_SRP, authPlugin.AUTH_PLUGIN_LEGACY],
    AUTH_PLUGIN_LIST : [authPlugin.AUTH_PLUGIN_SRP, authPlugin.AUTH_PLUGIN_LEGACY],
    // AUTH_PLUGIN_SRP_LIST : [authPlugin.AUTH_PLUGIN_SRP256, authPlugin.AUTH_PLUGIN_SRP],
    AUTH_PLUGIN_SRP_LIST : [authPlugin.AUTH_PLUGIN_SRP],
    LEGACY_AUTH_SALT : '9z',
    WIRE_CRYPT_DISABLE : 0,
    WIRE_CRYPT_ENABLE : 1,
};

/*******************/
/*    SQL Type     */
/*******************/
const sqlType = {
    SQL_TEXT : 452, // Array of char
    SQL_VARYING : 448,
    SQL_SHORT : 500,
    SQL_LONG : 496,
    SQL_FLOAT : 482,
    SQL_DOUBLE : 480,
    SQL_D_FLOAT : 530,
    SQL_TIMESTAMP : 510,
    SQL_BLOB : 520,
    SQL_ARRAY : 540,
    SQL_QUAD : 550,
    SQL_TYPE_TIME : 560,
    SQL_TYPE_DATE : 570,
    SQL_INT64 : 580,
    SQL_INT128: 32752, // >= 4.0
    SQL_BOOLEAN : 32764, // >: 3.0
    SQL_NULL : 32766, // >= 2.5
};

const blobType = {
    isc_blob_text : 1,
};

/*******************/
/* Blr definitions */
/*******************/
const blr = {
    blr_text : 14,
    blr_text2 : 15,
    blr_short : 7,
    blr_long : 8,
    blr_quad : 9,
    blr_float : 10,
    blr_double : 27,
    blr_d_float : 11,
    blr_timestamp : 35,
    blr_varying : 37,
    blr_varying2 : 38,
    blr_blob : 261,
    blr_cstring : 40,
    blr_cstring2 : 41,
    blr_blob_id : 45,
    blr_sql_date : 12,
    blr_sql_time : 13,
    blr_int64 : 16,
    blr_int128 : 26, // >: 4.0
    blr_blob2 : 17, // >: 2.0
    blr_domain_name : 18, // >: 2.1
    blr_domain_name2 : 19, // >: 2.1
    blr_not_nullable : 20, // >: 2.1
    blr_column_name : 21, // >: 2.5
    blr_column_name2 : 22, // >: 2.5
    blr_bool : 23, // >: 3.0

    blr_version4 : 4,
    blr_version5 : 5, // dialect 3
    blr_eoc : 76,
    blr_end : 255,

    blr_assignment : 1,
    blr_begin : 2,
    blr_dcl_variable : 3,
    blr_message : 4,
};

/**********************************/
/* Database parameter block stuff */
/**********************************/
const dpb = {
    isc_dpb_version1                : 1,
    isc_dpb_version2                : 2, // >: FB30
    isc_dpb_cdd_pathname            : 1,
    isc_dpb_allocation              : 2,
    isc_dpb_journal                 : 3,
    isc_dpb_page_size               : 4,
    isc_dpb_num_buffers             : 5,
    isc_dpb_buffer_length           : 6,
    isc_dpb_debug                   : 7,
    isc_dpb_garbage_collect         : 8,
    isc_dpb_verify                  : 9,
    isc_dpb_sweep                   : 10,
    isc_dpb_enable_journal          : 11,
    isc_dpb_disable_journal         : 12,
    isc_dpb_dbkey_scope             : 13,
    isc_dpb_number_of_users         : 14,
    isc_dpb_trace                   : 15,
    isc_dpb_no_garbage_collect      : 16,
    isc_dpb_damaged                 : 17,
    isc_dpb_license                 : 18,
    isc_dpb_sys_user_name           : 19,
    isc_dpb_encrypt_key             : 20,
    isc_dpb_activate_shadow         : 21,
    isc_dpb_sweep_interval          : 22,
    isc_dpb_delete_shadow           : 23,
    isc_dpb_force_write             : 24,
    isc_dpb_begin_log               : 25,
    isc_dpb_quit_log                : 26,
    isc_dpb_no_reserve              : 27,
    isc_dpb_user_name               : 28,
    isc_dpb_password                : 29,
    isc_dpb_password_enc            : 30,
    isc_dpb_sys_user_name_enc       : 31,
    isc_dpb_interp                  : 32,
    isc_dpb_online_dump             : 33,
    isc_dpb_old_file_size           : 34,
    isc_dpb_old_num_files           : 35,
    isc_dpb_old_file                : 36,
    isc_dpb_old_start_page          : 37,
    isc_dpb_old_start_seqno         : 38,
    isc_dpb_old_start_file          : 39,
    isc_dpb_old_dump_id             : 41,
    isc_dpb_lc_messages             : 47,
    isc_dpb_lc_ctype                : 48,
    isc_dpb_cache_manager           : 49,
    isc_dpb_shutdown                : 50,
    isc_dpb_online                  : 51,
    isc_dpb_shutdown_delay          : 52,
    isc_dpb_reserved                : 53,
    isc_dpb_overwrite               : 54,
    isc_dpb_sec_attach              : 55,
    isc_dpb_connect_timeout         : 57,
    isc_dpb_dummy_packet_interval   : 58,
    isc_dpb_gbak_attach             : 59,
    isc_dpb_sql_role_name           : 60,
    isc_dpb_set_page_buffers        : 61,
    isc_dpb_working_directory       : 62,
    isc_dpb_sql_dialect             : 63,
    isc_dpb_set_db_readonly         : 64,
    isc_dpb_set_db_sql_dialect      : 65,
    isc_dpb_gfix_attach             : 66,
    isc_dpb_gstat_attach            : 67,
    isc_dpb_set_db_charset          : 68,
    isc_dpb_gsec_attach             : 69,
    isc_dpb_address_path            : 70,
    isc_dpb_process_id              : 71,
    isc_dpb_no_db_triggers          : 72,
    isc_dpb_trusted_auth            : 73,
    isc_dpb_process_name            : 74,
    isc_dpb_trusted_role            : 75,
    isc_dpb_org_filename            : 76,
    isc_dpb_utf8_filename           : 77,
    isc_dpb_ext_call_depth          : 78,
    isc_dpb_auth_block 				: 79,
    isc_dpb_client_version 			: 80,
    isc_dpb_remote_protocol 		: 81,
    isc_dpb_host_name 				: 82,
    isc_dpb_os_user 				: 83,
    isc_dpb_specific_auth_data 		: 84,
    isc_dpb_auth_plugin_list 		: 85,
    isc_dpb_auth_plugin_name 		: 86,
    isc_dpb_config 					: 87,
    isc_dpb_nolinger 				: 88,
    isc_dpb_reset_icu 				: 89,
    isc_dpb_map_attach 				: 90,
    isc_dpb_session_time_zone 		: 91,
};

const cnct = {
    CNCT_user : 1, // User name
    CNCT_passwd : 2,
    // CNCT_ppo : 3, // Apollo person, project, organization. OBSOLETE.
    CNCT_host : 4,
    CNCT_group : 5, // Effective Unix group id
    CNCT_user_verification : 6, // Attach/create using this connection will use user verification
    CNCT_specific_data : 7, // Some data, needed for user verification on server
    CNCT_plugin_name : 8, // Name of plugin, which generated that data
    CNCT_login : 9, // Same data as isc_dpb_user_name
    CNCT_plugin_list : 10, // List of plugins, available on client
    CNCT_client_crypt : 11, // Client encyption level (DISABLED/ENABLED/REQUIRED)
    WIRE_CRYPT_DISABLED : 0,
    WIRE_CRYPT_ENABLED : 1,
    WIRE_CRYPT_REQUIRED : 2,
};

/****************************/
/* Common, structural codes */
/****************************/
const common = {
    isc_info_end                    : 1,
    isc_info_truncated              : 2,
    isc_info_error                  : 3,
    isc_info_data_not_ready         : 4,
    isc_info_length                 : 126,
    isc_info_flag_end               : 127,
};

/*************************************/
/* Transaction parameter block stuff */
/*************************************/
const tpb = {
    isc_tpb_version1 : 1,
    isc_tpb_version3 : 3,
    isc_tpb_consistency : 1,
    isc_tpb_concurrency : 2,
    isc_tpb_shared : 3, // < FB21
    isc_tpb_protected : 4, // < FB21
    isc_tpb_exclusive : 5, // < FB21
    isc_tpb_wait : 6,
    isc_tpb_nowait : 7,
    isc_tpb_read : 8,
    isc_tpb_write : 9,
    isc_tpb_lock_read : 10,
    isc_tpb_lock_write : 11,
    isc_tpb_verb_time : 12,
    isc_tpb_commit_time : 13,
    isc_tpb_ignore_limbo : 14,
    isc_tpb_read_committed : 15,
    isc_tpb_autocommit : 16,
    isc_tpb_rec_version : 17,
    isc_tpb_no_rec_version : 18,
    isc_tpb_restart_requests : 19,
    isc_tpb_no_auto_undo : 20,
    isc_tpb_lock_timeout : 21, // >= FB20
};

const transactionIsolation = {
    ISOLATION_READ_UNCOMMITTED         : [tpb.isc_tpb_version3, tpb.isc_tpb_write, tpb.isc_tpb_wait, tpb.isc_tpb_read_committed, tpb.isc_tpb_rec_version],
    ISOLATION_READ_COMMITTED           : [tpb.isc_tpb_version3, tpb.isc_tpb_write, tpb.isc_tpb_wait, tpb.isc_tpb_read_committed, tpb.isc_tpb_no_rec_version],
    ISOLATION_REPEATABLE_READ          : [tpb.isc_tpb_version3, tpb.isc_tpb_write, tpb.isc_tpb_wait, tpb.isc_tpb_concurrency],
    ISOLATION_SERIALIZABLE             : [tpb.isc_tpb_version3, tpb.isc_tpb_write, tpb.isc_tpb_wait, tpb.isc_tpb_consistency],
    ISOLATION_READ_COMMITTED_READ_ONLY : [tpb.isc_tpb_version3, tpb.isc_tpb_read, tpb.isc_tpb_wait, tpb.isc_tpb_read_committed, tpb.isc_tpb_no_rec_version],
};

/*************************/
/* SQL information items */
/*************************/
const sqlInfo = {
    isc_info_sql_select : 4,
    isc_info_sql_bind : 5,
    isc_info_sql_num_variables : 6,
    isc_info_sql_describe_vars : 7,
    isc_info_sql_describe_end : 8,
    isc_info_sql_sqlda_seq : 9,
    isc_info_sql_message_seq : 10,
    isc_info_sql_type : 11,
    isc_info_sql_sub_type : 12,
    isc_info_sql_scale : 13,
    isc_info_sql_length : 14,
    isc_info_sql_null_ind : 15,
    isc_info_sql_field : 16,
    isc_info_sql_relation : 17,
    isc_info_sql_owner : 18,
    isc_info_sql_alias : 19,
    isc_info_sql_sqlda_start : 20,
    isc_info_sql_stmt_type : 21,
    isc_info_sql_get_plan : 22,
    isc_info_sql_records : 23,
    isc_info_sql_batch_fetch : 24,
    isc_info_sql_relation_alias : 25, // >: 2.0
    isc_info_sql_explain_plan : 26, // >= 3.0
};

const statementInfo = {
    isc_info_sql_stmt_select : 1,
    isc_info_sql_stmt_insert : 2,
    isc_info_sql_stmt_update : 3,
    isc_info_sql_stmt_delete : 4,
    isc_info_sql_stmt_ddl : 5,
    isc_info_sql_stmt_get_segment : 6,
    isc_info_sql_stmt_put_segment : 7,
    isc_info_sql_stmt_exec_procedure : 8,
    isc_info_sql_stmt_start_trans : 9,
    isc_info_sql_stmt_commit : 10,
    isc_info_sql_stmt_rollback : 11,
    isc_info_sql_stmt_select_for_upd : 12,
    isc_info_sql_stmt_set_generator : 13,
    isc_info_sql_stmt_savepoint : 14,
};

const DESCRIBE = [
    sqlInfo.isc_info_sql_stmt_type,
    sqlInfo.isc_info_sql_select,
    sqlInfo.isc_info_sql_describe_vars,
    sqlInfo.isc_info_sql_sqlda_seq,
    sqlInfo.isc_info_sql_type,
    sqlInfo.isc_info_sql_sub_type,
    sqlInfo.isc_info_sql_scale,
    sqlInfo.isc_info_sql_length,
    sqlInfo.isc_info_sql_field,
    sqlInfo.isc_info_sql_relation,
    //isc_info_sql_owner,
    sqlInfo.isc_info_sql_alias,
    sqlInfo.isc_info_sql_describe_end,
    sqlInfo.isc_info_sql_bind,
    sqlInfo.isc_info_sql_describe_vars,
    sqlInfo.isc_info_sql_sqlda_seq,
    sqlInfo.isc_info_sql_type,
    sqlInfo.isc_info_sql_sub_type,
    sqlInfo.isc_info_sql_scale,
    sqlInfo.isc_info_sql_length,
    sqlInfo.isc_info_sql_describe_end
];

/***********************/
/*   ISC Services      */
/***********************/
const iscAction = {
    isc_action_svc_backup : 1, /* Starts database backup process on the server	*/
    isc_action_svc_restore : 2, /* Starts database restore process on the server */
    isc_action_svc_repair : 3, /* Starts database repair process on the server	*/
    isc_action_svc_add_user : 4, /* Adds	a new user to the security database	*/
    isc_action_svc_delete_user : 5, /* Deletes a user record from the security database	*/
    isc_action_svc_modify_user : 6, /* Modifies	a user record in the security database */
    isc_action_svc_display_user : 7, /* Displays	a user record from the security	database */
    isc_action_svc_properties : 8, /* Sets	database properties	*/
    isc_action_svc_add_license : 9, /* Adds	a license to the license file */
    isc_action_svc_remove_license : 10, /* Removes a license from the license file */
    isc_action_svc_db_stats : 11, /* Retrieves database statistics */
    isc_action_svc_get_ib_log : 12, /* Retrieves the InterBase log file	from the server	*/
    isc_action_svc_get_fb_log : 12, // isc_action_svc_get_ib_log, /* Retrieves the Firebird log file	from the server	*/
    isc_action_svc_nbak : 20, /* start nbackup */
    isc_action_svc_nrest : 21,  /* start nrestore */
    isc_action_svc_trace_start : 22,
    isc_action_svc_trace_stop : 23,
    isc_action_svc_trace_suspend : 24,
    isc_action_svc_trace_resume : 25,
    isc_action_svc_trace_list : 26,
};

/* Services Properties */
const service = {
    isc_spb_prp_page_buffers : 5,
    isc_spb_prp_sweep_interval : 6,
    isc_spb_prp_shutdown_db : 7,
    isc_spb_prp_deny_new_attachments : 9,
    isc_spb_prp_deny_new_transactions : 10,
    isc_spb_prp_reserve_space : 11,
    isc_spb_prp_write_mode : 12,
    isc_spb_prp_access_mode : 13,
    isc_spb_prp_set_sql_dialect : 14,
    isc_spb_num_att : 5,
    isc_spb_num_db : 6,
    // SHUTDOWN OPTION FOR 2.0
    isc_spb_prp_force_shutdown : 41,
    isc_spb_prp_attachments_shutdown : 42,
    isc_spb_prp_transactions_shutdown : 43,
    isc_spb_prp_shutdown_mode : 44,
    isc_spb_prp_online_mode : 45,

    isc_spb_prp_sm_normal : 0,
    isc_spb_prp_sm_multi : 1,
    isc_spb_prp_sm_single : 2,
    isc_spb_prp_sm_full : 3,

    // WRITE_MODE_PARAMETERS
    isc_spb_prp_wm_async : 37,
    isc_spb_prp_wm_sync : 38,

    // ACCESS_MODE_PARAMETERS
    isc_spb_prp_am_readonly : 39,
    isc_spb_prp_am_readwrite : 40,

    // RESERVE_SPACE_PARAMETERS
    isc_spb_prp_res_use_full : 35,
    isc_spb_prp_res : 36,

    // Option Flags
    isc_spb_prp_activate : 0x0100,
    isc_spb_prp_db_online : 0x0200,
};

/****************************/
/*       Service info       */
/****************************/
const serviceInfo = {
    isc_info_svc_svr_db_info: 50, /* Retrieves the number	of attachments and databases */
    isc_info_svc_get_license: 51, /* Retrieves all license keys and IDs from the license file	*/
    isc_info_svc_get_license_mask: 52, /* Retrieves a bitmask representing	licensed options on	the	server */
    isc_info_svc_get_config: 53, /* Retrieves the parameters	and	values for IB_CONFIG */
    isc_info_svc_version: 54, /* Retrieves the version of	the	services manager */
    isc_info_svc_server_version: 55, /* Retrieves the version of	the	InterBase server */
    isc_info_svc_implementation: 56, /* Retrieves the implementation	of the InterBase server	*/
    isc_info_svc_capabilities: 57, /* Retrieves a bitmask representing	the	server's capabilities */
    isc_info_svc_user_dbpath: 58, /* Retrieves the path to the security database in use by the server	*/
    isc_info_svc_get_env: 59, /* Retrieves the setting of	$INTERBASE */
    isc_info_svc_get_env_lock: 60, /* Retrieves the setting of	$INTERBASE_LCK */
    isc_info_svc_get_env_msg: 61, /* Retrieves the setting of	$INTERBASE_MSG */
    isc_info_svc_line: 62, /* Retrieves 1 line	of service output per call */
    isc_info_svc_to_eof: 63, /* Retrieves as much of	the	server output as will fit in the supplied buffer */
    isc_info_svc_timeout: 64, /* Sets	/ signifies	a timeout value	for	reading	service	information	*/
    isc_info_svc_get_licensed_users: 65, /* Retrieves the number	of users licensed for accessing	the	server */
    isc_info_svc_limbo_trans: 66, /* Retrieve	the	limbo transactions */
    isc_info_svc_running: 67, /* Checks to see if	a service is running on	an attachment */
    isc_info_svc_get_users: 68, /* Returns the user	information	from isc_action_svc_display_users */
    isc_info_svc_stdin: 78,
};

/*************************************/
/* Services parameter block stuff    */
/*************************************/
const spb = {
    isc_spb_version1 : 1,
    isc_spb_current_version : 2,
    isc_spb_version : 2, // isc_spb_current_version,
    isc_spb_user_name : dpb.isc_dpb_user_name,
    isc_spb_sys_user_name : dpb.isc_dpb_sys_user_name,
    isc_spb_sys_user_name_enc : dpb.isc_dpb_sys_user_name_enc,
    isc_spb_password : dpb.isc_dpb_password,
    isc_spb_password_enc : dpb.isc_dpb_password_enc,
    isc_spb_command_line : 105,
    isc_spb_dbname : 106,
    isc_spb_verbose : 107,
    isc_spb_options : 108,
};

/* · Backup Service ·*/
const serviceBackup = {
    isc_spb_bkp_file : 5,
    isc_spb_bkp_factor : 6,
    isc_spb_bkp_length : 7,
    isc_spb_bkp_ignore_checksums : 0x01,
    isc_spb_bkp_ignore_limbo : 0x02,
    isc_spb_bkp_metadata_only : 0x04,
    isc_spb_bkp_no_garbage_collect : 0x08,
    isc_spb_bkp_old_descriptions : 0x10,
    isc_spb_bkp_non_transportable : 0x20,
    isc_spb_bkp_convert : 0x40,
    isc_spb_bkp_expand : 0x80,
    isc_spb_bkp_no_triggers : 0x8000,
    // nbackup
    isc_spb_nbk_level : 5,
    isc_spb_nbk_file : 6,
    isc_spb_nbk_direct : 7,
    isc_spb_nbk_no_triggers : 0x01,
};

/*	Restore Service ·*/
const serviceRestore = {
    isc_spb_res_buffers : 9,
    isc_spb_res_page_size : 10,
    isc_spb_res_length : 11,
    isc_spb_res_access_mode : 12,
    isc_spb_res_fix_fss_data : 13,
    isc_spb_res_fix_fss_metadata : 14,
    isc_spb_res_am_readonly : service.isc_spb_prp_am_readonly,
    isc_spb_res_am_readwrite : service.isc_spb_prp_am_readwrite,
    isc_spb_res_deactivate_idx : 0x0100,
    isc_spb_res_no_shadow : 0x0200,
    isc_spb_res_no_validity : 0x0400,
    isc_spb_res_one_at_a_time : 0x0800,
    isc_spb_res_replace : 0x1000,
    isc_spb_res_create : 0x2000,
    isc_spb_res_use_all_space : 0x4000,
};

/* · Repair Service ·*/
const serviceRepair = {
    isc_spb_rpr_commit_trans : 15,
    isc_spb_rpr_rollback_trans : 34,
    isc_spb_rpr_recover_two_phase : 17,
    isc_spb_tra_id : 18,
    isc_spb_single_tra_id : 19,
    isc_spb_multi_tra_id : 20,
    isc_spb_tra_state : 21,
    isc_spb_tra_state_limbo : 22,
    isc_spb_tra_state_commit : 23,
    isc_spb_tra_state_rollback : 24,
    isc_spb_tra_state_unknown : 25,
    isc_spb_tra_host_site : 26,
    isc_spb_tra_remote_site : 27,
    isc_spb_tra_db_path : 28,
    isc_spb_tra_advise : 29,
    isc_spb_tra_advise_commit : 30,
    isc_spb_tra_advise_rollback : 31,
    isc_spb_tra_advise_unknown : 33,
    isc_spb_rpr_validate_db : 0x01,
    isc_spb_rpr_sweep_db : 0x02,
    isc_spb_rpr_mend_db : 0x04,
    isc_spb_rpr_list_limbo_trans : 0x08,
    isc_spb_rpr_check_db : 0x10,
    isc_spb_rpr_ignore_checksum : 0x20,
    isc_spb_rpr_kill_shadows : 0x40,
    isc_spb_rpr_full : 0x80,
    isc_spb_rpr_icu : 0x0800,
};

/* · Security Service ·*/
const serviceSecurity = {
    isc_spb_sec_userid : 5,
    isc_spb_sec_groupid : 6,
    isc_spb_sec_username : 7,
    isc_spb_sec_password : 8,
    isc_spb_sec_groupname : 9,
    isc_spb_sec_firstname : 10,
    isc_spb_sec_middlename : 11,
    isc_spb_sec_lastname : 12,
    isc_spb_sec_admin : 13,
};

/* License Service */
const serviceLicence = {
    isc_spb_lic_key : 5,
    isc_spb_lic_id : 6,
    isc_spb_lic_desc : 7,
};

/* Statistics Service */
const serviceStatistics = {
    isc_spb_sts_data_pages : 0x01,
    isc_spb_sts_db_log : 0x02,
    isc_spb_sts_hdr_pages : 0x04,
    isc_spb_sts_idx_pages : 0x08,
    isc_spb_sts_sys_relations : 0x10,
    isc_spb_sts_record_versions : 0x20,
    isc_spb_sts_table : 0x40,
    isc_spb_sts_nocreation : 0x80,
};

/* Trace Service */
const serviceTrace = {
    isc_spb_trc_id : 1,
    isc_spb_trc_name : 2,
    isc_spb_trc_cfg : 3,
};

module.exports = Object.freeze({
    ...acceptType,
    ...authPlugin,
    ...authOptions,
    ...blr,
    ...blobType,
    ...buffer,
    ...cnct,
    ...common,
    ...connect,
    ...defaultOptions,
    DESCRIBE,
    ...dpb,
    ...dsql,
    ...int,
    ...iscAction,
    ...iscError,
    ...op,
    ...protocol,
    ...service,
    ...serviceBackup,
    ...serviceInfo,
    ...serviceLicence,
    ...serviceRestore,
    ...serviceRepair,
    ...serviceSecurity,
    ...serviceStatistics,
    ...serviceTrace,
    ...sqlInfo,
    ...sqlType,
    ...spb,
    ...statementInfo,
    SUPPORTED_PROTOCOL,
    ...tpb,
    ...transactionIsolation,
});
