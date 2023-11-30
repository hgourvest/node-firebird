exports.DEFAULT_ENCODING = 'UTF8';

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

// const cnct = {
//     CNCT_user : 1, // User name
//     CNCT_passwd : 2,
//     // CNCT_ppo : 3, // Apollo person, project, organization. OBSOLETE.
//     CNCT_host : 4,
//     CNCT_group : 5, // Effective Unix group id
//     CNCT_user_verification : 6, // Attach/create using this connection will use user verification
//     CNCT_specific_data : 7, // Some data, needed for user verification on server
//     CNCT_plugin_name : 8, // Name of plugin, which generated that data
//     CNCT_login : 9, // Same data as isc_dpb_user_name
//     CNCT_plugin_list : 10, // List of plugins, available on client
//     CNCT_client_crypt : 11, // Client encyption level (DISABLED/ENABLED/REQUIRED)
//     WIRE_CRYPT_DISABLED : 0,
//     WIRE_CRYPT_ENABLED : 1,
//     WIRE_CRYPT_REQUIRED : 2,
// };

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
    ...blr,
    ...common,
    ...dpb,
    ...iscAction,
    ...service,
    ...serviceBackup,
    ...serviceInfo,
    ...serviceLicence,
    ...serviceRestore,
    ...serviceRepair,
    ...serviceSecurity,
    ...serviceStatistics,
    ...serviceTrace,
    ...spb
});
