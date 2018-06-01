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
    messages = require('./messages.js')

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
/*   ISC Services      */
/***********************/
const
	isc_action_svc_backup = 1, /* Starts database backup process on the server	*/
	isc_action_svc_restore = 2, /* Starts database restore process on the server */
	isc_action_svc_repair = 3, /* Starts database repair process on the server	*/
	isc_action_svc_add_user = 4, /* Adds	a new user to the security database	*/
	isc_action_svc_delete_user = 5, /* Deletes a user record from the security database	*/
	isc_action_svc_modify_user = 6, /* Modifies	a user record in the security database */
	isc_action_svc_display_user = 7, /* Displays	a user record from the security	database */
	isc_action_svc_properties = 8, /* Sets	database properties	*/
	isc_action_svc_add_license = 9, /* Adds	a license to the license file */
	isc_action_svc_remove_license = 10, /* Removes a license from the license file */
	isc_action_svc_db_stats = 11, /* Retrieves database statistics */
	isc_action_svc_get_ib_log = 12, /* Retrieves the InterBase log file	from the server	*/
    isc_action_svc_get_fb_log = isc_action_svc_get_ib_log, /* Retrieves the Firebird log file	from the server	*/
    isc_action_svc_nbak = 20, /* start nbackup */
    isc_action_svc_nrest = 21,  /* start nrestore */
    isc_action_svc_trace_start = 22,
    isc_action_svc_trace_stop = 23,
    isc_action_svc_trace_suspend = 24,
    isc_action_svc_trace_resume = 25,
    isc_action_svc_trace_list = 26;

const
	isc_info_svc_svr_db_info = 50, /* Retrieves the number	of attachments and databases */
	isc_info_svc_get_license = 51, /* Retrieves all license keys and IDs from the license file	*/
	isc_info_svc_get_license_mask = 52, /* Retrieves a bitmask representing	licensed options on	the	server */
	isc_info_svc_get_config = 53, /* Retrieves the parameters	and	values for IB_CONFIG */
	isc_info_svc_version = 54, /* Retrieves the version of	the	services manager */
	isc_info_svc_server_version = 55, /* Retrieves the version of	the	InterBase server */
	isc_info_svc_implementation = 56, /* Retrieves the implementation	of the InterBase server	*/
	isc_info_svc_capabilities = 57, /* Retrieves a bitmask representing	the	server's capabilities */
	isc_info_svc_user_dbpath = 58, /* Retrieves the path to the security database in use by the server	*/
	isc_info_svc_get_env = 59, /* Retrieves the setting of	$INTERBASE */
	isc_info_svc_get_env_lock = 60, /* Retrieves the setting of	$INTERBASE_LCK */
	isc_info_svc_get_env_msg = 61, /* Retrieves the setting of	$INTERBASE_MSG */
	isc_info_svc_line = 62, /* Retrieves 1 line	of service output per call */
	isc_info_svc_to_eof = 63, /* Retrieves as much of	the	server output as will fit in the supplied buffer */
	isc_info_svc_timeout = 64, /* Sets	/ signifies	a timeout value	for	reading	service	information	*/
	isc_info_svc_get_licensed_users = 65, /* Retrieves the number	of users licensed for accessing	the	server */
	isc_info_svc_limbo_trans = 66, /* Retrieve	the	limbo transactions */
	isc_info_svc_running = 67, /* Checks to see if	a service is running on	an attachment */
	isc_info_svc_get_users = 68, /* Returns the user	information	from isc_action_svc_display_users */
    isc_info_svc_stdin = 78;

/* Services Properties */
const
	isc_spb_prp_page_buffers = 5,
	isc_spb_prp_sweep_interval = 6,
	isc_spb_prp_shutdown_db = 7,
	isc_spb_prp_deny_new_attachments = 9,
	isc_spb_prp_deny_new_transactions = 10,
	isc_spb_prp_reserve_space = 11,
	isc_spb_prp_write_mode = 12,
	isc_spb_prp_access_mode = 13,
	isc_spb_prp_set_sql_dialect = 14,
    isc_spb_num_att = 5,
    isc_spb_num_db = 6,
    // SHUTDOWN OPTION FOR 2.0
    isc_spb_prp_force_shutdown = 41,
    isc_spb_prp_attachments_shutdown = 42,
    isc_spb_prp_transactions_shutdown = 43,
    isc_spb_prp_shutdown_mode = 44,
    isc_spb_prp_online_mode = 45,

    isc_spb_prp_sm_normal = 0,
    isc_spb_prp_sm_multi = 1,
    isc_spb_prp_sm_single = 2,
    isc_spb_prp_sm_full = 3,


		// WRITE_MODE_PARAMETERS
	isc_spb_prp_wm_async = 37,
	isc_spb_prp_wm_sync = 38,

		// ACCESS_MODE_PARAMETERS
	isc_spb_prp_am_readonly = 39,
	isc_spb_prp_am_readwrite = 40,

		// RESERVE_SPACE_PARAMETERS
	isc_spb_prp_res_use_full = 35,
	isc_spb_prp_res = 36,

		// Option Flags
	isc_spb_prp_activate = 0x0100,
	isc_spb_prp_db_online = 0x0200;

    // SHUTDOWN MODE

/* · Backup Service ·*/
const
	isc_spb_bkp_file = 5,
	isc_spb_bkp_factor = 6,
	isc_spb_bkp_length = 7,
    isc_spb_bkp_ignore_checksums = 0x01,
    isc_spb_bkp_ignore_limbo = 0x02,
    isc_spb_bkp_metadata_only = 0x04,
    isc_spb_bkp_no_garbage_collect = 0x08,
    isc_spb_bkp_old_descriptions = 0x10,
    isc_spb_bkp_non_transportable = 0x20,
    isc_spb_bkp_convert = 0x40,
    isc_spb_bkp_expand = 0x80,
    isc_spb_bkp_no_triggers = 0x8000,
    // nbackup
    isc_spb_nbk_level = 5,
    isc_spb_nbk_file = 6,
    isc_spb_nbk_direct = 7,
    isc_spb_nbk_no_triggers = 0x01;

/*	Restore Service ·*/
const
	isc_spb_res_buffers = 9,
	isc_spb_res_page_size = 10,
	isc_spb_res_length = 11,
	isc_spb_res_access_mode = 12,
    isc_spb_res_fix_fss_data = 13,
    isc_spb_res_fix_fss_metadata = 14,
	isc_spb_res_am_readonly = isc_spb_prp_am_readonly,
	isc_spb_res_am_readwrite = isc_spb_prp_am_readwrite,
    isc_spb_res_deactivate_idx = 0x0100,
    isc_spb_res_no_shadow = 0x0200,
    isc_spb_res_no_validity = 0x0400,
    isc_spb_res_one_at_a_time = 0x0800,
    isc_spb_res_replace = 0x1000,
    isc_spb_res_create = 0x2000,
    isc_spb_res_use_all_space = 0x4000;


/* · Repair Service ·*/
const
    isc_spb_rpr_commit_trans = 15,
	isc_spb_rpr_rollback_trans = 34,
	isc_spb_rpr_recover_two_phase = 17,
	isc_spb_tra_id = 18,
	isc_spb_single_tra_id = 19,
	isc_spb_multi_tra_id = 20,
	isc_spb_tra_state = 21,
	isc_spb_tra_state_limbo = 22,
	isc_spb_tra_state_commit = 23,
	isc_spb_tra_state_rollback = 24,
	isc_spb_tra_state_unknown = 25,
	isc_spb_tra_host_site = 26,
	isc_spb_tra_remote_site = 27,
	isc_spb_tra_db_path = 28,
	isc_spb_tra_advise = 29,
	isc_spb_tra_advise_commit = 30,
	isc_spb_tra_advise_rollback = 31,
	isc_spb_tra_advise_unknown = 33,
    isc_spb_rpr_validate_db = 0x01,
    isc_spb_rpr_sweep_db = 0x02,
    isc_spb_rpr_mend_db = 0x04,
    isc_spb_rpr_list_limbo_trans = 0x08,
    isc_spb_rpr_check_db = 0x10,
    isc_spb_rpr_ignore_checksum = 0x20,
    isc_spb_rpr_kill_shadows = 0x40,
    isc_spb_rpr_full = 0x80,
    isc_spb_rpr_icu = 0x0800;

/* · Security Service ·*/
const
	isc_spb_sec_userid = 5,
	isc_spb_sec_groupid = 6,
	isc_spb_sec_username = 7,
	isc_spb_sec_password = 8,
	isc_spb_sec_groupname = 9,
	isc_spb_sec_firstname = 10,
	isc_spb_sec_middlename = 11,
	isc_spb_sec_lastname = 12,
    isc_spb_sec_admin = 13;

/* License Service */
const
    isc_spb_lic_key = 5,
    isc_spb_lic_id = 6,
    isc_spb_lic_desc = 7;

/* Statistics Service */
const
    isc_spb_sts_data_pages = 0x01,
    isc_spb_sts_db_log = 0x02,
    isc_spb_sts_hdr_pages = 0x04,
    isc_spb_sts_idx_pages = 0x08,
    isc_spb_sts_sys_relations = 0x10,
    isc_spb_sts_record_versions = 0x20,
    isc_spb_sts_table = 0x40,
    isc_spb_sts_nocreation = 0x80;

/* Trace Service */
const
    isc_spb_trc_id = 1,
    isc_spb_trc_name = 2,
    isc_spb_trc_cfg = 3;


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
/* Services parameter block stuff    */
/*************************************/
const
    isc_spb_version1 = 1,
    isc_spb_current_version = 2,
    isc_spb_version = isc_spb_current_version,
    isc_spb_user_name = isc_dpb_user_name,
    isc_spb_sys_user_name = isc_dpb_sys_user_name,
    isc_spb_sys_user_name_enc = isc_dpb_sys_user_name_enc,
    isc_spb_password = isc_dpb_password,
    isc_spb_password_enc = isc_dpb_password_enc,
    isc_spb_command_line = 105,
    isc_spb_dbname = 106,
    isc_spb_verbose = 107,
    isc_spb_options = 108;

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
    DEFAULT_LOWERCASE_KEYS = false,
    DEFAULT_PAGE_SIZE = 4096,
    DEFAULT_SVC_NAME = 'service_mgr';

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
 *   SQLVar
 *
 ***************************************/


const
    ScaleDivisor = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000, 100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
const
    DateOffset = 40587,
    TimeCoeff = 86400000,
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

        // check overflow
        if (time < 0) {
            date--;
            time = TimeCoeff*10 + time;
        }

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

    if (obj instanceof Error) {
        callback(obj);
        return;
    }

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
        cnx.allocateStatement(function (err, statement) {
            if (err) {
                doError(err, callback);
                return;
            }
            cnx.prepareStatement(self, statement, query, false, callback);
        });
    }
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
            statement.release();
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

                        statement.release();

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
    return exports.escape(value);
};

Database.prototype.detach = function(callback, force) {

    var self = this;

    if (!force && self.connection._pending.length > 0) {
        self.connection._detachAuto = true;
        self.connection._detachCallback = callback;
        return self;
    }

    if (self.connection._pooled == false) {
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
    var manager = options.manager || false;
    var cnx = this.connection = new Connection(host, port, function(err) {

        if (err) {
            doError(err, callback);
            return;
        }

        cnx.connect(options.database || options.filename, function(err) {
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

/***************************************
 *
 *   Service Manager
 *
 ***************************************/

function ServiceManager(connection) {
    this.connection = connection;
    connection.svc = this;
}

ServiceManager.prototype.__proto__ = Object.create(Events.EventEmitter.prototype, {
    constructor: {
        value: ServiceManager,
        enumberable: false
    }
});

ServiceManager.prototype._createOutputStream = function (optread, buffersize, callback) {
    var self = this;
    optread = optread || 'byline';
    var t = new stream.Readable({ objectMode: optread == 'byline'?true:false }); // chunk by line
    t.__proto__._read = function () {
        var selfread = this;
        var fct = optread == 'byline'?self.readline:self.readeof;
        fct.call(self, { buffersize: buffersize }, function (err, data) {
            if (err) {
                selfread.push(err.message, DEFAULT_ENCODING);
                return;
            }
            if (data.line && data.line.length)
                selfread.push(data.line, DEFAULT_ENCODING);
            else
                selfread.push(null);
        });
    }

    callback(null, t);
}


ServiceManager.prototype._infosmapping = {
    "50"/*isc_info_svc_svr_db_info*/ : "dbinfo",
    "51"/*isc_info_svc_get_license*/ : "licenses",
    "52"/*isc_info_svc_get_license_mask*/ : "licenseoptions",
    "53"/*isc_info_svc_get_config*/ : "fbconfig",
    "54"/*isc_info_svc_version*/ : "svcversion",
    "55"/*isc_info_svc_server_version*/ : "fbversion",
    "56"/*isc_info_svc_implementation*/ : "fbimplementation",
    "57"/*isc_info_svc_capabilities*/ : "fbcapatibilities",
    "58"/*isc_info_svc_user_dbpath*/ : "pathsecuritydb",
    "59"/*isc_info_svc_get_env*/ : "fbenv",
    "60"/*isc_info_svc_get_env_lock*/ : "fbenvlock",
    "61"/*isc_info_svc_get_env_msg*/ : "fbenvmsg",
    "62"/*isc_info_svc_line*/ : "",
    "63"/*isc_info_svc_to_eof*/ : "",
    "64"/*isc_info_svc_timeout*/ : "",
    "65"/*isc_info_svc_get_licensed_users*/ : "",
    "66"/*isc_info_svc_limbo_trans*/ : "",
    "67"/*isc_info_svc_running*/ : "",
    "68"/*isc_info_svc_get_users*/ : "fbusers",
    "78"/*isc_info_svc_stdin*/ : ""
};

ServiceManager.prototype._processcapabilities = function (blr, res) {
    var capArray = [
        "WAL_SUPPORT",
        "MULTI_CLIENT_SUPPORT",
        "REMOTE_HOP_SUPPORT",
        "NO_SVR_STATS_SUPPORT",
        "NO_DB_STATS_SUPPORT",
        "LOCAL_ENGINE_SUPPORT",
        "NO_FORCED_WRITE_SUPPORT",
        "NO_SHUTDOWN_SUPPORT",
        "NO_SERVER_SHUTDOWN_SUPPORT",
        "SERVER_CONFIG_SUPPORT",
        "QUOTED_FILENAME_SUPPORT"
    ];
    var dbcapa = res[this._infosmapping[57]] = [];
    var caps = blr.readInt32();

	for (var i = 0; i < capArray.length; ++i)
		if (caps & (1 << i))
            dbcapa.push(capArray[i]);
}

ServiceManager.prototype._processdbinfo = function (blr, res) {
    var tinfo = blr.readByteCode();
    var dbinfo = res[this._infosmapping[50]] = {};

    dbinfo.database = [];
    for (; tinfo != isc_info_flag_end; tinfo = blr.readByteCode()) {
        switch (tinfo) {
            case isc_spb_dbname:
                dbinfo.database.push(blr.readString());
                break;
            case isc_spb_num_att:
                dbinfo.nbattachment = blr.readInt32();
                break;
            case isc_spb_num_db:
                dbinfo.nbdatabase = blr.readInt32();
                break;
        }
    }
}

ServiceManager.prototype._processquery = function (buffer, callback) {
    //console.log(buffer);
    var br = new BlrReader(buffer);
    var tinfo = br.readByteCode();
    var res = {};
    res.result = 0;
    for (; tinfo != isc_info_end; tinfo = br.readByteCode()) {
        switch (tinfo) {
            case isc_info_svc_server_version:
            case isc_info_svc_implementation:
            case isc_info_svc_user_dbpath:
            case isc_info_svc_get_env:
            case isc_info_svc_get_env_lock:
            case isc_info_svc_get_env_msg:
                res[this._infosmapping[tinfo]] = br.readString();
                break;
            case isc_info_svc_version:
                res[this._infosmapping[tinfo]] = br.readInt32();
                break;
            case isc_info_svc_svr_db_info:
                this._processdbinfo(br, res);
                break;
            case isc_info_svc_limbo_trans:
                // not implemented
                for (; tinfo != isc_info_flag_end; tinfo = br.readByteCode())
                break;
            case isc_info_svc_get_users:
                br.pos += 2
                res[this._infosmapping[tinfo]] = [];
                break;
            case isc_spb_sec_username:
                var tuser = res[this._infosmapping[68]];
                tuser.push({});
                tuser[tuser.length - 1].username = br.readString();
                break;
            case isc_spb_sec_firstname:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.firstname = br.readString();
                break;
            case isc_spb_sec_middlename:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.middlename = br.readString();
                break;
            case isc_spb_sec_lastname:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.lastname = br.readString();
                break;
            case isc_spb_sec_groupid:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.groupid = br.readInt32();
                break;
            case isc_spb_sec_userid:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.userid = br.readInt32();

                break;
            case isc_spb_sec_admin:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.admin = br.readInt32();
                break;

            case isc_info_svc_line:
                res.line = br.readString();
                break;

            case isc_info_svc_to_eof:
                res.line = br.readString();
                break;

            case isc_info_truncated:
                res.result = 1; // too much data for the result buffer increase size of it (buffersize parameter))
                break;

            case isc_info_data_not_ready:
                res.result = 2;
                break;

            case isc_info_svc_timeout:
                res.result = 3;
                break;

            case isc_info_svc_stdin:

                break;

            case isc_info_svc_capabilities:
                this._processcapabilities(br, res);
                break;
        }
    }
    callback(null, res);
}

ServiceManager.prototype.detach = function(callback, force) {
    var self = this;

    if (!force && self.connection._pending.length > 0) {
        self.connection._detachAuto = true;
        self.connection._detachCallback = callback;
        return self;
    }

    self.connection.svcdetach(function (err, obj) {

        self.connection.disconnect();
        self.emit('detach', false);

        if (callback)
            callback(err, obj);

    }, force);

    return self;
}

ServiceManager.prototype.backup = function (options, callback) {
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
    var verbose = options.verbose || false;
    // format of bckfile {filename:'name', sizefile:''} sizefile is length of part in bytes
    var bckfiles = options.backupfiles || options.files || null;
    // for convenience
    if (bckfiles) bckfiles = bckfiles.constructor !== Array?[{ filename: bckfiles, sizefile: '0' }]:bckfiles;
    var factor = options.factor || 0; //If backing up to a physical tape device, this switch lets you specify the tape's blocking factor
    var ignorechecksums = options.ignorechecksums || false;
    var ignorelimbo = options.ignorelimbo || false;
    var metadataonly = options.metadataonly || false;
    var nogarbagecollect = options.nogarbasecollect || false;
    var olddescriptions = options.olddescriptions || false;
    var nontransportable = options.nontransportable || false;
    var convert = options.convert || false;
    var expand = options.expand || false;
    var notriggers = options.notriggers || false;

    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    if (bckfiles == null || bckfiles.length == 0) {
        doError(new Error('No backup path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_backup);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(isc_spb_bkp_file, bckfiles[i].filename, DEFAULT_ENCODING);
        if (i != bckfiles.length - 1) // not the end, so we need to write the size of this part (gsplit)
            blr.addString2(isc_spb_bkp_length, bckfiles[i].sizefile, DEFAULT_ENCODING);
    }
    if (factor)
        blr.addByteInt32(isc_spb_bkp_factor, factor);

    var opts = 0;
    if (ignorechecksums) opts = opts | isc_spb_bkp_ignore_checksums;
    if (ignorelimbo) opts = opts | isc_spb_bkp_ignore_limbo;
    if (metadataonly) opts = opts | isc_spb_bkp_metadata_only;
    if (nogarbagecollect) opts = opts | isc_spb_bkp_no_garbage_collect;
    if (olddescriptions) opts = opts | isc_spb_bkp_old_descriptions;
    if (nontransportable) opts = opts | isc_spb_bkp_non_transportable;
    if (convert) opts = opts | isc_spb_bkp_convert;
    if (expand) opts = opts | isc_spb_bkp_expand;
    if (notriggers) opts = opts | isc_spb_bkp_no_triggers;
    if (opts)
        blr.addByteInt32(isc_spb_options, opts);
    if (verbose)
        blr.addByte(isc_spb_verbose);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.nbackup = function (options, callback) {
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
    var bckfile = options.backupfile || options.file || null;
    var level = options.level || 0; // nb day for incremental
    var notriggers = options.notriggers || false;
    var direct = options.direct || 'on'; // on or off direct write I/O

    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    if (bckfile == null || bckfile.length == 0) {
        doError(new Error('No backup path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_nba);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    blr.addString2(isc_spb_dbname, bckfile, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_nbk_level, level);
    blr.addString2(isc_spb_nbk_direct, direct, DEFAULT_ENCODING);
    var opts = 0;
    if (notriggers) opts = opts | isc_spb_nbk_no_triggers;
    blr.addByteInt32(isc_spb_options, opts);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.restore = function(options, callback) {
    var bckfiles = options.backupfiles || options.files || null; // format bckfiles ['file1', 'file2', 'file3']
    // for convenience
    if (bckfiles) bckfiles = bckfiles.constructor !== Array?[bckfiles]:bckfiles;
    var dbfile = options.database || this.connection.options.filename || this.connection.options.database;;
    var verbose = options.verbose || false;
    var cachebuffers = options.cachebuffers || 2048; // gbak -buffers
    var pagesize = options.pagesize || 4096; // gbak -page_size
    var readonly = options.readonly || false; // gbak -mode
    var deactivateindexes = options.deactivateindexes || false;
    var	noshadow = options.noshadow || false;
    var	novalidity = options.novalidity || false;
    var	individualcommit = options.individualcommit || true; // otherwise no data
    var	replace = options.replace || false;
    var	create = options.create || true;
    var useallspace = options.useallspace || false;
    var metadataonly = options.metadataonly || false;
    var fixfssdata = options.fixfssdata || null;
    var fixfssmetadata = options.fixfssmetadata || null;

    if (bckfiles == null || bckfiles.length == 0) {
        doError(new Error('No backup file specified'), callback);
        return;
    }

    if (dbfile == null || dbfile.length == 0) {
        doError(new Error('No database path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_restore);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(isc_spb_bkp_file, bckfiles[i], DEFAULT_ENCODING);
    }
    blr.addString2(isc_spb_dbname, dbfile, DEFAULT_ENCODING);
    blr.addByte(isc_spb_res_buffers);
    blr.addInt32(cachebuffers);
    blr.addByte(isc_spb_res_page_size);
    blr.addInt32(pagesize);
    blr.addByte(isc_spb_res_access_mode);
    if (readonly)
        blr.addByte(isc_spb_prp_am_readonly);
    else
        blr.addByte(isc_spb_prp_am_readwrite);
    if (fixfssdata) blr.addString2(isc_spb_res_fix_fss_data, fixfssdata, DEFAULT_ENCODING);
    if (fixfssmetadata) blr.addString2(isc_spb_res_fix_fss_metadata, fixfssmetadata, DEFAULT_ENCODING);
    var opts = 0;
    if (deactivateindexes) opts = opts | isc_spb_res_deactivate_idx;
    if (noshadow) opts = opts | isc_spb_res_no_shadow;
    if (novalidity) opts = opts | isc_spb_res_no_validity;
    if (individualcommit) opts = opts | isc_spb_res_one_at_a_time;
    if (replace) opts = opts | isc_spb_res_replace;
    if (create) opts = opts | isc_spb_res_create;
    if (useallspace) opts = opts | isc_spb_res_use_all_space;
    if (metadataonly) opts = opts | isc_spb_res_fix_fss_metadata;
    if (opts)
        blr.addByteInt32(isc_spb_options, opts);
    if (verbose)
        blr.addByte(isc_spb_verbose);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.nrestore = function (options, callback) {
    var bckfiles = options.backupfiles || options.files || null; // format bckfiles ['file1', 'file2', 'file3']
    // for convenience
    if (bckfiles) bckfiles = bckfiles.constructor !== Array?[bckfiles]:bckfiles;
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;;

    if (bckfiles == null || bckfiles.length == 0) {
        doError(new Error('No backup file specified'), callback);
        return;
    }

    if (dbpath == null || dbfile.length == 0) {
        doError(new Error('No database path specified'), callback);
        return;
    }
    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_nrest);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(isc_spb_nbk_file, bckfiles[i], DEFAULT_ENCODING);
    }
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

// only one at time don't use this function directly
ServiceManager.prototype._fixpropertie = function (options, callback) {
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
    var dialect = options.dialect || null;
    var sweep = options.sweepinterval || null;
    var pagebuffers = options.nbpagebuffers || null;
    var online = options.bringonline || false;
    var shutdown = options.shutdown || null; // 0 Forced, 1 deny transaction, 2 deny attachment
    var shutdowndelay = options.shutdowndelay || 0;
    var shutdownmode = options.shutdownmode || null; // 0 normal 1 multi 2 single 3 full
    var shadow = options.activateshadow || false;
    var forcewrite = options.forcewrite!=null?options.forcewrite:null;
    var reservespace = options.reservespace!=null?options.reservespace:null;
    var accessmode = options.accessmode!=null?options.accesmode:null; // 0 readonly 1 readwrite

    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_properties);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    if (dialect) blr.addByteInt32(isc_spb_prp_set_sql_dialect, dialect);
    if (sweep) blr.addByteInt32(isc_spb_prp_sweep_interval, sweep);
    if (pagebuffers) blr.addByteInt32(isc_spb_prp_page_buffers, pagebuffers);
    if (shutdown) {
        switch (shutdown) {
            case 0:
                blr.addByteInt32(isc_spb_prp_shutdown_db, shutdowndelay);
                break;
            case 1:
                blr.addByteInt32(isc_spb_prp_deny_new_transactions, shutdowndelay);
                break;
            case 2:
                blr.addByteInt32(isc_spb_prp_deny_new_attachments, shutdowndelay);
                break;
        }
        if (shutdownmode != null) {
            switch (shutdownmode) {
                case 0:
                    blr.addByteInt32(isc_spb_prp_shutdown_mode, isc_spb_prp_sm_normal);
                    break;
                case 1:
                    blr.addByteInt32(isc_spb_prp_shutdown_mode, isc_spb_prp_sm_multi);
                    break;
                case 2:
                    blr.addByteInt32(isc_spb_prp_shutdown_mode, isc_spb_prp_sm_single);
                    break;
                case 3:
                    blr.addByteInt32(isc_spb_prp_shutdown_mode, isc_spb_prp_sm_full);
                    break;
            }
        }
    }
    if (forcewrite) blr.addBytes([isc_spb_prp_write_mode, isc_spb_prp_wm_sync]);
    if (forcewrite != null && !forcewrite) blr.addBytes([isc_spb_prp_write_mode, isc_spb_prp_wm_async]);
    if (accessmode) blr.addBytes([isc_spb_prp_access_mode, isc_spb_prp_am_readwrite]);
    if (accessmode != null && !accessmode) blr.addBytes([isc_spb_prp_access_mode, isc_spb_prp_am_readonly]);
    if (reservespace) blr.addBytes([isc_spb_prp_reserve_space, sc_spb_prp_res]);
    if (reservespace != null && !reservespace) blr.addBytes([isc_spb_prp_reserve_space, isc_spb_prp_res_use_full]);
    var opts = 0;
    if (shadow) opts = opts | sc_spb_prp_activate;
    if (online) opts = opts | isc_spb_prp_db_online;
    if (opts)
        blr.addByteInt32(isc_spb_options, opts);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.setDialect = function (db, dialect, callback) {
    this._fixpropertie({ database: db, dialect: dialect }, callaback);
}

ServiceManager.prototype.setSweepinterval = function (db, sweepinterval, callback) {
    this._fixpropertie({ database: db, sweepinterval: sweepinterval }, callback);
}

ServiceManager.prototype.setCachebuffer = function (db, nbpages, callback) {
    this._fixpropertie({ database: db, nbpagebuffers: nbpages }, callback);
}

ServiceManager.prototype.BringOnline = function (db, callback) {
    this._fixpropertie({ database: db, bringonline: true }, callback);
}

ServiceManager.prototype.Shutdown = function (db, kind, delay, mode, callback) {
    // mode parameter is for server version >= 2.0
    this._fixpropertie({ database: db, shutdown: kind, shutdowndelay: delay, shutdownmode: mode }, callback);
}

ServiceManager.prototype.setShadow = function (db, val, callback) {
    this._fixpropertie({ database: db, activateshadow : val }, callback);
}

ServiceManager.prototype.setForcewrite = function (db, val, callback) {
    this._fixpropertie({ database: db, forcewrite : val }, callback);
}

ServiceManager.prototype.setReservespace = function (db, val, callback) {
    this._fixpropertie({ database: db, reservespace : val }, callback);
}

ServiceManager.prototype.setReadonlyMode = function (db, callback) {
    this._fixpropertie({ database: db, accessmode : 0 }, callback);
}

ServiceManager.prototype.setReadwriteMode = function (db, callback) {
    this._fixpropertie({ database: db, accessmode : 1 }, callback);
}

ServiceManager.prototype.validate = function (options, callback) {
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
    var checkdb = options.checkdb || false;
    var ignorechecksums = options.ignorechecksums || false;
    var killshadows = options.killshadows || false;
    var mend = options.mend || false;
    var validate = options.validate || false;
    var full = options.full || false;
    var sweep = options.sweep || false;
    var listlimbo = options.listlimbo || false;
    var icu = options.icu || false;

    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_repair);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    var opts = 0;
    if (checkdb) opts = opts | isc_spb_rpr_check_db;
    if (ignorechecksums) opts = opts | isc_spb_rpr_ignore_checksum;
    if (killshadows) opts = opts | isc_spb_rpr_kill_shadows;
    if (mend) opts = opts | isc_spb_rpr_mend_db;
    if (validate) opts = opts | isc_spb_rpr_validate_db;
    if (full) opts = opts | isc_spb_rpr_full;
    if (sweep) opts = opts | isc_spb_rpr_sweep_db;
    if (listlimbo) opts = opts | isc_spb_rpr_list_limbo_trans;
    if (icu) opts = opts | isc_spb_rpr_icu;
    blr.addByteInt32(isc_spb_options, opts);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.commit = function(db, transactid, callback) {
    var dbpath = db || this.connection.options.filename || this.connection.options.database;
    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_repair);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_rpr_commit_trans, transactid);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.rollback = function (db, transactid, callback) {
    var dbpath = db || this.connection.options.filename || this.connection.options.database;
    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_repair);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_rpr_rollback_trans, transactid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.recover = function (db, transactid, callback) {
    var dbpath = db || this.connection.options.filename || this.connection.options.database;
    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_repair);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_rpr_recover_two_phase, transactid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.getStats = function (options, callback) {
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
    var record = options.record || false;
    var nocreation = options.nocreation || false;
    var tables = options.tables || false;
    var pages = options.pages || false;
    var header = options.header || false;
    var indexes = options.indexes || false;
    var tablesystem = options.tablesystem || false;
    var encryption = options.encryption || false;
    var objects = options.objects || null; // space-separated list of object index,table,systemtable
    if (dbpath == null || dbpath.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_db_stats);
    blr.addString2(isc_spb_dbname, dbpath, DEFAULT_ENCODING);
    var opts = 0;
    if (record) opts = opts | isc_spb_sts_record_versions;
    if (nocreation) opts = opts | isc_spb_sts_nocreation;
    if (tables) opts = opts | isc_spb_sts_table;
    if (pages) opts = opts | isc_spb_sts_data_pages;
    if (header) opts = opts | isc_spb_sts_hdr_pages;
    if (indexes) opts = opts | isc_spb_sts_idx_pages;
    if (tablesystem) opts = opts | isc_spb_sts_sys_relations;
    if (encryption) opts = opts | isc_spb_sts_encryption;
    if (opts)
        blr.addByteInt32(isc_spb_options, opts);
    if (objects) blr.addString2(isc_spb_command_line, objects, DEFAULT_ENCODING);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });

}

ServiceManager.prototype.getLog = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var optread = options.optread || 'byline';
    blr.pos = 0;
    blr.addByte(isc_action_svc_get_fb_log);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.getUsers = function (username, callback) {
    var self = this;
    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_display_user);
    if (username) blr.addString2(isc_spb_sec_username, username, DEFAULT_ENCODING);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self.readusers({}, callback);
    });
}

ServiceManager.prototype.addUser = function (username, password, options, callback) {
    var rolename = options.rolename || null;
    var groupname = options.groupname || null;
    var firsname = options.firstname || null;
    var middlename = options.middlename || null;
    var lastname = options.lastname || null;
    var userid = options.userid || null;
    var groupid = options.groupid || null;
    var admin = options.admin || null;

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_add_user);
    blr.addString2(isc_spb_sec_username, username, DEFAULT_ENCODING);
    blr.addString2(isc_spb_sec_password, password, DEFAULT_ENCODING);
    if (rolename) blr.addString2(isc_dpb_sql_role_name, rolename, DEFAULT_ENCODING);
    if (groupname) blr.addString2(isc_spb_sec_groupname, groupname, DEFAULT_ENCODING);
    if (firsname) blr.addString2(isc_spb_sec_firstname, firsname, DEFAULT_ENCODING);
    if (middlename) blr.addString2(isc_spb_sec_middlename, middlename, DEFAULT_ENCODING);
    if (lastname) blr.addString2(isc_spb_sec_lastname, lastname, DEFAULT_ENCODING);
    if (userid != null) blr.addByteInt32(isc_spb_sec_userid, userid);
    if (groupid != null) blr.addByteInt32(isc_spb_sec_groupid, groupid);
    if (admin != null) blr.addByteInt32(isc_spb_sec_admin, admin);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.editUser = function (username, options, callback) {
    var rolename = options.rolename || null;
    var groupname = options.groupname || null;
    var firsname = options.firstname || null;
    var middlename = options.middlename || null;
    var lastname = options.lastname || null;
    var userid = options.userid || null;
    var groupid = options.groupid || null;
    var admin = options.admin || null;
	var password = options.password || null;
    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_modify_user);
    blr.addString2(isc_spb_sec_username, username, DEFAULT_ENCODING);
    if (password) blr.addString2(isc_spb_sec_password, password, DEFAULT_ENCODING);
    if (rolename) blr.addString2(isc_dpb_sql_role_name, rolename, DEFAULT_ENCODING);
    if (groupname) blr.addString2(isc_spb_sec_groupname, groupname, DEFAULT_ENCODING);
    if (firsname) blr.addString2(isc_spb_sec_firstname, firsname, DEFAULT_ENCODING);
    if (middlename) blr.addString2(isc_spb_sec_middlename, middlename, DEFAULT_ENCODING);
    if (lastname) blr.addString2(isc_spb_sec_lastname, lastname, DEFAULT_ENCODING);
    if (userid != null) blr.addByteInt32(isc_spb_sec_userid, userid);
    if (groupid != null) blr.addByteInt32(isc_spb_sec_groupid, groupid);
    if (admin != null) blr.addByteInt32(isc_spb_sec_admin, admin);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.removeUser = function (username, rolename, callback) {
    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(isc_action_svc_delete_user);
    blr.addString2(isc_spb_sec_username, username, DEFAULT_ENCODING);
    if (rolename) blr.addString2(isc_dpb_sql_role_name, rolename, DEFAULT_ENCODING);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.getFbserverInfos = function (infos, options, callback) {
    var buffersize = options.buffersize || 2048;
    var timeout = options.timeout || 1;
    var opts = {
        "dbinfo" : isc_info_svc_svr_db_info,
        "fbconfig" : isc_info_svc_get_config,
        "svcversion" : isc_info_svc_version,
        "fbversion" : isc_info_svc_server_version,
        "fbimplementation" : isc_info_svc_implementation,
        "fbcapatibilities" : isc_info_svc_capabilities,
        "pathsecuritydb" : isc_info_svc_user_dbpath,
        "fbenv" : isc_info_svc_get_env,
        "fbenvlock" : isc_info_svc_get_env_lock,
        "fbenvmsg" : isc_info_svc_get_env_msg
    };
    // if infos is empty all options are asked to the service

    var tops = [];
    for (popts in opts)
        if (infos[popts] || infos.length == 0)
            tops.push(opts[popts]);


    var self = this;
    this.connection.svcquery(tops, buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

ServiceManager.prototype.startTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var configfile = options.configfile || '';
    var tracename = options.tracename || '';

    if (configfile.length == 0) {
        doError(new Error('No config filename specified'), callback);
        return;
    }
    if (tracename.length == 0) {
        doError(new Error('No tracename specified'), callback);
        return;
    }

    blr.pos = 0;
    blr.addByte(isc_action_svc_trace_start);
    blr.addString2(isc_spb_trc_cfg, configfile, DEFAULT_ENCODING);
    blr.addString2(isc_spb_trc_name, tracename, DEFAULT_ENCODING);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.suspendTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var traceid = options.traceid || null;
    var tracename = options.tracename || '';

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }
    if (tracename.length == 0) {
        doError(new Error('No tracename specified'), callback);
        return;
    }
    blr.pos = 0;
    blr.addByte(isc_action_svc_trace_suspend);
    blr.addString2(isc_spb_trc_name, tracename, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_trc_id, traceid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.resumeTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var traceid = options.traceid || null;
    var tracename = options.tracename || '';

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }
    if (tracename.length == 0) {
        doError(new Error('No tracename specified'), callback);
        return;
    }
    blr.pos = 0;
    blr.addByte(isc_action_svc_trace_resume);
    blr.addString2(isc_spb_trc_name, tracename, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_trc_id, traceid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error('Invalid RESUMETRACE Action'), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.stopTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var traceid = options.traceid || null;
    var tracename = options.tracename || '';

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }

    if (tracename.length == 0) {
        doError(new Error('No tracename specified'), callback);
        return;
    }
    blr.pos = 0;
    blr.addByte(isc_action_svc_trace_stop);
    blr.addString2(isc_spb_trc_name, tracename, DEFAULT_ENCODING);
    blr.addByteInt32(isc_spb_trc_id, traceid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.getTraceList = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var optread = options.optread || 'byline';
    blr.pos = 0;
    blr.addByte(isc_action_svc_trace_list);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.readline = function (options, callback) {
    var buffersize = options.buffersize || 2048;
    var timeout = options.timeout || 60;
    var self = this;
    this.connection.svcquery([isc_info_svc_line], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

ServiceManager.prototype.readeof = function (options, callback) {
    var buffersize = options.buffersize || (8 * 1024);
    var timeout = options.timeout || 60;
    var self = this;
    this.connection.svcquery([isc_info_svc_to_eof], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

ServiceManager.prototype.hasRunningAction = function (options, callback) {
    var buffersize = options.buffersize || 2048;
    var timeout = options.timeout || 60;
    var self = this;
    this.connection.svcquery([isc_info_svc_running], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

ServiceManager.prototype.readusers = function (options, callback) {
    var buffersize = options.buffersize || 2048;
    var timeout = options.timeout || 60;
    var self = this;
    this.connection.svcquery([isc_info_svc_get_users], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

ServiceManager.prototype.readlimbo = function (options, callback) {
    var buffersize = options.buffersize || 2048;
    var timeout = options.timeout || 60;
    var self = this;
    this.connection.svcquery([isc_info_svc_limbo_trans], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

// Pooling
exports.pool = function(max, options, callback) {
    var defaults = { isPool: true };
    var pool = new Pool(max, Object.assign({}, options, defaults));
    return pool;
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
                    if (self.pooldb.indexOf(db) != -1 || self.internaldb.indexOf(db) == -1)
                        return;
                    // if not usable don't put in again in the pool and remove reference on it
                    if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled == false)
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

Pool.prototype.destroy = function() {
    var self = this;
    this.internaldb.forEach(function(db) {
        if (db.connection._pooled == false)
            return;
        // check if the db is not free into the pool otherwise user should manual detach it
        var _db_in_pool = self.pooldb.indexOf(db);
        if (_db_in_pool != -1) {
            self.pooldb.splice(_db_in_pool, 1);
            db.connection._pooled = false;
            db.detach();
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
    this._isClosed = false;
    this._isDetach = false;
    this._isUsed = false;
    this._pooled = options.isPool||false;
    this.options = options;
    this._bind_events(host, port, callback);
    this.error;
    this._max_cached_query = options.maxCachedQuery || -1;
    this._cache_query = options.cacheQuery?{}:null;
};

exports.Connection.prototype._setcachedquery = function (query, statement) {
    if (this._cache_query)
        if (this._max_cached_query == -1 || this._max_cached_query > Object.keys(this._cache_query).length)
            this._cache_query[query] = statement;
};

exports.Connection.prototype.getCachedQuery = function (query) {
    if (this._cache_query)
        return this._cache_query[query];
    return null;
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
                obj = decodeResponse(xdr, cb, self.db, self._lowercase_keys);
                if (obj && obj.error) {
                    // packet is not complete
                    xdr.buffer = xdr.buffer.slice(xdr.pos);
                    xdr.pos = 0;
                    self._xdr = xdr;
                    return;
                }
                // remove the op flag, needed for partial packet
                if (xdr.r) delete(xdr.r);

            } catch(err) {
                xdr.buffer = xdr.buffer = xdr.buffer.slice(pos);
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

function decodeResponse(data, callback, db, lowercase_keys){
    do {
        var r = data.r || data.readInt();
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
            var statement = callback.statement;
            var output = statement.output;
            var custom = statement.custom || {};
            statement.nbrowsfetched = statement.nbrowsfetched || 0;

            if (data.fop) { // could be set when a packet is not complete
                op = data.readInt(); // ??
                data.fop = false;
            }
            data.fstatus = data.fstatus!==undefined?data.fstatus:data.readInt();
            data.fcount = data.fcount!==undefined?data.fcount:data.readInt();
            data.fcolumn = data.fcolumn || 0;
            data.frow = data.frow || (custom.asObject ? {} : new Array(output.length));
            data.frows = data.frows || [];

            if (custom.asObject && !data.fcols) {
                data.fcols = [];
                for (var i = 0, length = output.length; i < length; i++)
                    data.fcols.push(lowercase_keys ? output[i].alias.toLowerCase() : output[i].alias);
            }

            while (data.fcount && (data.fstatus !== 100)) {

                for (length = output.length; data.fcolumn < length; data.fcolumn++) {
                    item = output[data.fcolumn];
                    try {
                        var _xdrpos = data.pos;
                        var value = item.decode(data);
                        if (custom.asObject) {
                            if (item.type === SQL_BLOB)
                                value = fetch_blob_async(statement, value, data.fcols[data.fcolumn]);
                            data.frow[data.fcols[data.fcolumn]] = value;
                        }
                        else {
                            if (item.type === SQL_BLOB)
                                value = fetch_blob_async(statement, value, data.fcolumn);
                            data.frow[data.fcolumn] = value;
                        }
                    } catch (e) {
                        // uncomplete packet read
                        data.pos = _xdrpos;
                        data.r = r;
                        return { error : new Error("Packet is not complete") };
                    }

                }

                data.fcolumn = 0;
                statement.connection.db.emit('row', data.frow, statement.nbrowsfetched, custom.asObject);

                if (!custom.asStream)
                    data.frows.push(data.frow);
                if (custom.on)
                    custom.on(data.frow, statement.nbrowsfetched);
                data.frow = custom.asObject?{}:new Array(output.length);

                try {
                    delete data.fstatus;
                    delete data.fcount;
                    var _xdrpos = data.pos;
                    op = data.readInt(); // ??
                    data.fstatus = data.readInt();
                    data.fcount = data.readInt();

                } catch (e) {
                    if (_xdrpos == data.pos)
                        data.fop = true;
                    data.r = r;
                    return { error : new Error("Packet is not complete") };
                }
                statement.nbrowsfetched++;
            }

            statement.connection.db.emit('result', data.frows);
            return { data: data.frows, fetched: Boolean(data.fstatus === 100) };

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
    this._lowercase_keys = options.lowercase_keys || DEFAULT_LOWERCASE_KEYS;
    
    var database = options.database || options.filename;
    if (database == null || database.length == 0) {
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
        delete(self.dbhandle);
        if (callback)
            callback(err, ret);
    });
};

Connection.prototype.createDatabase = function (options, callback) {

    var database = options.database || options.filename;
    if (database == null || database.length == 0) {
        doError(new Error('No database specified'), callback);
        return;
    }
    
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

            if (value === null || value === undefined) {
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
                                //throw new Error('Unexpected parametter: ' + JSON.stringify(params) + ' - ' + JSON.stringify(input));
                                ret[i] = new SQLParamString(value.toString());
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

        if (params === undefined || params.length !== input.length) {
            self._pending.pop();
            callback(new Error('Expected parameters: (params=' + params.length + ' vs. expected=' + input.length + ') - ' + statement.query));
            return;
        }

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
                            transaction.rollback(function() {
                                e.emit('error', err);
                            });
                            return;
                        }

                        if (ret.buffer) {
                            var blr = new BlrReader(ret.buffer);
                            var data = blr.readSegment();

                            e.emit('data', data);
                        }

                        if (ret.handle !== 2) {
                            read();
                            return;
                        }

                        statement.connection.closeBlob(blob);
                        transaction.commit(function(err) {
                            if (err) {
                                e.emit('error', err);
                            } else {
                                e.emit('end');
                            }
                            e = null;
                        });

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

Connection.prototype.svcattach = function (options, callback, svc) {
    this._lowercase_keys = options.lowercase_keys || DEFAULT_LOWERCASE_KEYS;
    var database = options.database || options.filename;
    var user = options.user || DEFAULT_USER;
    var password = options.password || DEFAULT_PASSWORD;
    var role = options.role;
    var self = this;
    var msg = this._msg;
    var blr = this._blr;
    msg.pos = 0;
    blr.pos = 0;

    blr.addBytes([isc_dpb_version2, isc_dpb_version2]);
    blr.addString(isc_dpb_lc_ctype, 'UTF8', DEFAULT_ENCODING);
    blr.addString(isc_dpb_user_name, user, DEFAULT_ENCODING);
    blr.addString(isc_dpb_password, password, DEFAULT_ENCODING);
    blr.addByte(isc_dpb_dummy_packet_interval);
    blr.addByte(4);
    blr.addBytes([120, 10, 0, 0]); // FROM DOT NET PROVIDER
    if (role)
        blr.addString(isc_dpb_sql_role_name, role, DEFAULT_ENCODING);

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
    blr.addByte(isc_spb_current_version);
    //blr.addByteInt32(isc_info_svc_timeout, timeout);
    msg.addInt(op_service_info);
    msg.addInt(this.svchandle);
    msg.addInt(0)
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
