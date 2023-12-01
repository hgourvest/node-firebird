const Events = require('events');
const stream = require('stream');
const Const = require('./const');
const {BlrReader} = require('./serialize');
const {doError} = require('../callback');

/***************************************
 *
 *   Service Manager
 *
 ***************************************/

const ServiceManager = function(connection) {
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
    var t = new stream.Readable({ objectMode: optread === 'byline' }); // chunk by line
    t.__proto__._read = function () {
        var selfread = this;
        var fct = optread === 'byline' ? self.readline : self.readeof;
        fct.call(self, { buffersize: buffersize }, function (err, data) {
            if (err) {
                selfread.push(err.message, Const.DEFAULT_ENCODING);
                return;
            }
            if (data.line && data.line.length)
                selfread.push(data.line, Const.DEFAULT_ENCODING);
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
    "66"/*isc_info_svc_limbo_trans*/ : "limbotrans",
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
    for (; tinfo != Const.isc_info_flag_end; tinfo = blr.readByteCode()) {
        switch (tinfo) {
            case Const.isc_spb_dbname:
                dbinfo.database.push(blr.readString());
                break;
            case Const.isc_spb_num_att:
                dbinfo.nbattachment = blr.readInt32();
                break;
            case Const.isc_spb_num_db:
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
    for (; tinfo !== Const.isc_info_end; tinfo = br.readByteCode()) {
        switch (tinfo) {
            case Const.isc_info_svc_server_version:
            case Const.isc_info_svc_implementation:
            case Const.isc_info_svc_user_dbpath:
            case Const.isc_info_svc_get_env:
            case Const.isc_info_svc_get_env_lock:
            case Const.isc_info_svc_get_env_msg:
                res[this._infosmapping[tinfo]] = br.readString();
                break;
            case Const.isc_info_svc_version:
                res[this._infosmapping[tinfo]] = br.readInt32();
                break;
            case Const.isc_info_svc_svr_db_info:
                this._processdbinfo(br, res);
                break;
            case Const.isc_info_svc_limbo_trans:
                // not implemented
                for (; tinfo !== isc_info_flag_end; tinfo = br.readByteCode())
                    break;
            case Const.isc_info_svc_get_users:
                br.pos += 2
                res[this._infosmapping[tinfo]] = [];
                break;
            case Const.isc_spb_sec_username:
                var tuser = res[this._infosmapping[68]];
                tuser.push({});
                tuser[tuser.length - 1].username = br.readString();
                break;
            case Const.isc_spb_sec_firstname:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.firstname = br.readString();
                break;
            case Const.isc_spb_sec_middlename:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.middlename = br.readString();
                break;
            case Const.isc_spb_sec_lastname:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.lastname = br.readString();
                break;
            case Const.isc_spb_sec_groupid:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.groupid = br.readInt32();
                break;
            case Const.isc_spb_sec_userid:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.userid = br.readInt32();

                break;
            case Const.isc_spb_sec_admin:
                var tuser = res[this._infosmapping[68]];
                var user = tuser[tuser.length-1];
                user.admin = br.readInt32();
                break;

            case Const.isc_info_svc_line:
                res.line = br.readString();
                break;

            case Const.isc_info_svc_to_eof:
                res.line = br.readString();
                break;

            case Const.isc_info_truncated:
                res.result = 1; // too much data for the result buffer increase size of it (buffersize parameter))
                break;

            case Const.isc_info_data_not_ready:
                res.result = 2;
                break;

            case Const.isc_info_svc_timeout:
                res.result = 3;
                break;

            case Const.isc_info_svc_stdin:

                break;

            case Const.isc_info_svc_capabilities:
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

    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    if (bckfiles == null || bckfiles.length === 0) {
        doError(new Error('No backup path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_backup);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(Const.isc_spb_bkp_file, bckfiles[i].filename, Const.DEFAULT_ENCODING);
        if (i !== bckfiles.length - 1) // not the end, so we need to write the size of this part (gsplit)
            blr.addString2(Const.isc_spb_bkp_length, bckfiles[i].sizefile, Const.DEFAULT_ENCODING);
    }
    if (factor)
        blr.addByteInt32(Const.isc_spb_bkp_factor, factor);

    var opts = 0;
    if (ignorechecksums) opts = opts | Const.isc_spb_bkp_ignore_checksums;
    if (ignorelimbo) opts = opts | Const.isc_spb_bkp_ignore_limbo;
    if (metadataonly) opts = opts | Const.isc_spb_bkp_metadata_only;
    if (nogarbagecollect) opts = opts | Const.isc_spb_bkp_no_garbage_collect;
    if (olddescriptions) opts = opts | Const.isc_spb_bkp_old_descriptions;
    if (nontransportable) opts = opts | Const.isc_spb_bkp_non_transportable;
    if (convert) opts = opts | Const.isc_spb_bkp_convert;
    if (expand) opts = opts | Const.isc_spb_bkp_expand;
    if (notriggers) opts = opts | Const.isc_spb_bkp_no_triggers;
    if (opts)
        blr.addByteInt32(Const.isc_spb_options, opts);
    if (verbose)
        blr.addByte(Const.isc_spb_verbose);
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

    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    if (bckfile == null || bckfile.length === 0) {
        doError(new Error('No backup path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_nbak);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    blr.addString2(Const.isc_spb_nbk_file, bckfile, Const.DEFAULT_ENCODING);
    blr.addByteInt32(Const.isc_spb_nbk_level, level);
    blr.addString2(Const.isc_spb_nbk_direct, direct, Const.DEFAULT_ENCODING);
    var opts = 0;
    if (notriggers) opts = opts | Const.isc_spb_nbk_no_triggers;
    blr.addByteInt32(Const.isc_spb_options, opts);
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

    if (bckfiles == null || bckfiles.length === 0) {
        doError(new Error('No backup file specified'), callback);
        return;
    }

    if (dbfile == null || dbfile.length === 0) {
        doError(new Error('No database path specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_restore);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(Const.isc_spb_bkp_file, bckfiles[i], Const.DEFAULT_ENCODING);
    }
    blr.addString2(Const.isc_spb_dbname, dbfile, Const.DEFAULT_ENCODING);
    blr.addByte(Const.isc_spb_res_buffers);
    blr.addInt32(cachebuffers);
    blr.addByte(Const.isc_spb_res_page_size);
    blr.addInt32(pagesize);
    blr.addByte(Const.isc_spb_res_access_mode);
    if (readonly)
        blr.addByte(Const.isc_spb_prp_am_readonly);
    else
        blr.addByte(Const.isc_spb_prp_am_readwrite);
    if (fixfssdata) blr.addString2(Const.isc_spb_res_fix_fss_data, fixfssdata, Const.DEFAULT_ENCODING);
    if (fixfssmetadata) blr.addString2(Const.isc_spb_res_fix_fss_metadata, fixfssmetadata, Const.DEFAULT_ENCODING);
    var opts = 0;
    if (deactivateindexes) opts = opts | Const.isc_spb_res_deactivate_idx;
    if (noshadow) opts = opts | Const.isc_spb_res_no_shadow;
    if (novalidity) opts = opts | Const.isc_spb_res_no_validity;
    if (individualcommit) opts = opts | Const.isc_spb_res_one_at_a_time;
    if (replace) opts = opts | Const.isc_spb_res_replace;
    if (create) opts = opts | Const.isc_spb_res_create;
    if (useallspace) opts = opts | Const.isc_spb_res_use_all_space;
    if (metadataonly) opts = opts | Const.isc_spb_res_fix_fss_metadata;
    if (opts)
        blr.addByteInt32(Const.isc_spb_options, opts);
    if (verbose)
        blr.addByte(Const.isc_spb_verbose);
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
    var dbpath = options.database || this.connection.options.filename || this.connection.options.database;

    if (bckfiles == null || bckfiles.length === 0) {
        doError(new Error('No backup file specified'), callback);
        return;
    }

    if (dbpath == null || bckfiles.length === 0) {
        doError(new Error('No database path specified'), callback);
        return;
    }
    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_nrest);
    for (var i = 0; i < bckfiles.length; i++) {
        blr.addString2(Const.isc_spb_nbk_file, bckfiles[i], Const.DEFAULT_ENCODING);
    }
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
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
    var shutdown = options.shutdown != null ? options.shutdown : null; // 0 Forced, 1 deny transaction, 2 deny attachment
    var shutdowndelay = options.shutdowndelay || 0;
    var shutdownmode = options.shutdownmode; // 0 normal 1 multi 2 single 3 full
    var shadow = options.activateshadow || false;
    var forcewrite = options.forcewrite;
    var reservespace = options.reservespace;
    var accessmode = options.accessmode; // 0 readonly 1 readwrite

    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_properties);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    if (dialect) blr.addByteInt32(Const.isc_spb_prp_set_sql_dialect, dialect);
    if (sweep) blr.addByteInt32(Const.isc_spb_prp_sweep_interval, sweep);
    if (pagebuffers) blr.addByteInt32(Const.isc_spb_prp_page_buffers, pagebuffers);
    if (shutdown != null) {
        if (shutdownmode != null) {
            if (SHUTDOWNEX_KIND[shutdown] === undefined) {
                doError(new Error('Invalid shutdown kind'), callback);
                return;
            }
            if (SHUTDOWNEX_MODE[shutdownmode] === undefined) {
                doError(new Error('Invalid shutdown mode'), callback);
                return;
            }

            // New shutdown with mode
            blr.addBytes([Const.isc_spb_prp_shutdown_mode, SHUTDOWNEX_MODE[shutdownmode]]);
            blr.addByteInt32(SHUTDOWNEX_KIND[shutdown], shutdowndelay);
        } else {
            // Old shutdown
            blr.addByteInt32(SHUTDOWN_KIND[shutdown], shutdowndelay);
        }
    }
    if (forcewrite) blr.addBytes([Const.isc_spb_prp_write_mode, Const.isc_spb_prp_wm_sync]);
    if (forcewrite === false) blr.addBytes([Const.isc_spb_prp_write_mode, Const.isc_spb_prp_wm_async]);
    if (accessmode === 1) blr.addBytes([Const.isc_spb_prp_access_mode, Const.isc_spb_prp_am_readwrite]);
    if (accessmode === 0) blr.addBytes([Const.isc_spb_prp_access_mode, Const.isc_spb_prp_am_readonly]);
    if (reservespace) blr.addBytes([Const.isc_spb_prp_reserve_space, Const.isc_spb_prp_res]);
    if (reservespace != null && !reservespace) blr.addBytes([Const.isc_spb_prp_reserve_space, Const.isc_spb_prp_res_use_full]);
    var opts = 0;
    if (shadow) opts = opts | Const.isc_spb_prp_activate;
    if (online) opts = opts | Const.isc_spb_prp_db_online;
    if (opts)
        blr.addByteInt32(Const.isc_spb_options, opts);
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
    this._fixpropertie({ database: db, dialect: dialect }, callback);
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

const SHUTDOWN_KIND = {
    0: Const.isc_spb_prp_shutdown_db,
    1: Const.isc_spb_prp_deny_new_transactions,
    2: Const.isc_spb_prp_deny_new_attachments
};
const SHUTDOWNEX_KIND = {
    0: Const.isc_spb_prp_force_shutdown,
    1: Const.isc_spb_prp_transactions_shutdown,
    2: Const.isc_spb_prp_attachments_shutdown
};
const SHUTDOWNEX_MODE = {
    //0: isc_spb_prp_sm_normal,
    1: Const.isc_spb_prp_sm_multi,
    2: Const.isc_spb_prp_sm_single,
    3: Const.isc_spb_prp_sm_full
};
const ShutdownMode = { NORMAL: 0, MULTI: 1, SINGLE: 2, FULL: 3 };
const ShutdownKind = { FORCED: 0, DENY_TRANSACTION: 1, DENY_ATTACHMENT: 2 };
exports.ShutdownMode = ShutdownMode;
exports.ShutdownKind = ShutdownKind;

ServiceManager.prototype.Shutdown = function (db, kind, delay, mode, callback) {
    // mode parameter is for server version >= 2.0
    if (mode instanceof Function) {
        callback = mode;
        mode = undefined;
    }

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

    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_repair);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    var opts = 0;
    if (checkdb) opts = opts | Const.isc_spb_rpr_check_db;
    if (ignorechecksums) opts = opts | Const.isc_spb_rpr_ignore_checksum;
    if (killshadows) opts = opts | Const.isc_spb_rpr_kill_shadows;
    if (mend) opts = opts | Const.isc_spb_rpr_mend_db;
    if (validate) opts = opts | Const.isc_spb_rpr_validate_db;
    if (full) opts = opts | Const.isc_spb_rpr_full;
    if (sweep) opts = opts | Const.isc_spb_rpr_sweep_db;
    if (listlimbo) opts = opts | Const.isc_spb_rpr_list_limbo_trans;
    if (icu) opts = opts | Const.isc_spb_rpr_icu;
    blr.addByteInt32(Const.isc_spb_options, opts);
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
    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_repair);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    blr.addByteInt32(Const.isc_spb_rpr_commit_trans, transactid);
    var self = this;
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(null, null, callback);
    });
}

ServiceManager.prototype.rollback = function (db, transactid, callback) {
    var dbpath = db || this.connection.options.filename || this.connection.options.database;
    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_repair);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    blr.addByteInt32(Const.isc_spb_rpr_rollback_trans, transactid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(null, null, callback);
    });
}

ServiceManager.prototype.recover = function (db, transactid, callback) {
    var dbpath = db || this.connection.options.filename || this.connection.options.database;
    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_repair);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    blr.addByteInt32(Const.isc_spb_rpr_recover_two_phase, transactid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(null, null, callback);
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
    if (dbpath == null || dbpath.length === 0) {
        doError(new Error('No database specified'), callback);
        return;
    }

    var blr = this.connection._blr;
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_db_stats);
    blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
    var opts = 0;
    if (record) opts = opts | Const.isc_spb_sts_record_versions;
    if (nocreation) opts = opts | Const.isc_spb_sts_nocreation;
    if (tables) opts = opts | Const.isc_spb_sts_table;
    if (pages) opts = opts | Const.isc_spb_sts_data_pages;
    if (header) opts = opts | Const.isc_spb_sts_hdr_pages;
    if (indexes) opts = opts | Const.isc_spb_sts_idx_pages;
    if (tablesystem) opts = opts | Const.isc_spb_sts_sys_relations;
    if (encryption) opts = opts | Const.isc_spb_sts_encryption;
    if (opts)
        blr.addByteInt32(Const.isc_spb_options, opts);
    if (objects) blr.addString2(Const.isc_spb_command_line, objects, Const.DEFAULT_ENCODING);
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
    blr.addByte(Const.isc_action_svc_get_fb_log);
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
    blr.addByte(Const.isc_action_svc_display_user);
    if (username) blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
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
    blr.addByte(Const.isc_action_svc_add_user);
    blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
    blr.addString2(Const.isc_spb_sec_password, password, Const.DEFAULT_ENCODING);
    if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);
    if (groupname) blr.addString2(Const.isc_spb_sec_groupname, groupname, Const.DEFAULT_ENCODING);
    if (firsname) blr.addString2(Const.isc_spb_sec_firstname, firsname, Const.DEFAULT_ENCODING);
    if (middlename) blr.addString2(Const.isc_spb_sec_middlename, middlename, Const.DEFAULT_ENCODING);
    if (lastname) blr.addString2(Const.isc_spb_sec_lastname, lastname, Const.DEFAULT_ENCODING);
    if (userid != null) blr.addByteInt32(Const.isc_spb_sec_userid, userid);
    if (groupid != null) blr.addByteInt32(Const.isc_spb_sec_groupid, groupid);
    if (admin != null) blr.addByteInt32(Const.isc_spb_sec_admin, admin);

    var self = this;
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
    blr.addByte(Const.isc_action_svc_modify_user);
    blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
    if (password) blr.addString2(Const.isc_spb_sec_password, password, Const.DEFAULT_ENCODING);
    if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);
    if (groupname) blr.addString2(Const.isc_spb_sec_groupname, groupname, Const.DEFAULT_ENCODING);
    if (firsname) blr.addString2(Const.isc_spb_sec_firstname, firsname, Const.DEFAULT_ENCODING);
    if (middlename) blr.addString2(Const.isc_spb_sec_middlename, middlename, Const.DEFAULT_ENCODING);
    if (lastname) blr.addString2(Const.isc_spb_sec_lastname, lastname, Const.DEFAULT_ENCODING);
    if (userid != null) blr.addByteInt32(Const.isc_spb_sec_userid, userid);
    if (groupid != null) blr.addByteInt32(Const.isc_spb_sec_groupid, groupid);
    if (admin != null) blr.addByteInt32(Const.isc_spb_sec_admin, admin);

    var self = this;
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
    blr.addByte(Const.isc_action_svc_delete_user);
    blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
    if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);

    var self = this, options = {};
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
        "dbinfo" : Const.isc_info_svc_svr_db_info,
        "fbconfig" : Const.isc_info_svc_get_config,
        "svcversion" : Const.isc_info_svc_version,
        "fbversion" : Const.isc_info_svc_server_version,
        "fbimplementation" : Const.isc_info_svc_implementation,
        "fbcapatibilities" : Const.isc_info_svc_capabilities,
        "pathsecuritydb" : Const.isc_info_svc_user_dbpath,
        "fbenv" : Const.isc_info_svc_get_env,
        "fbenvlock" : Const.isc_info_svc_get_env_lock,
        "fbenvmsg" : Const.isc_info_svc_get_env_msg
    };
    // if infos is empty all options are asked to the service

    var tops = [], empty = isEmpty(infos);
    for (let popts in opts)
        if (empty || infos[popts])
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

function isEmpty(obj){
    for(var p in obj) return false;
    return true;
}

ServiceManager.prototype.startTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var configfile = options.configfile || '';
    var tracename = options.tracename || '';

    if (configfile.length === 0) {
        doError(new Error('No config filename specified'), callback);
        return;
    }
    if (tracename.length === 0) {
        doError(new Error('No tracename specified'), callback);
        return;
    }

    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_trace_start);
    blr.addString2(Const.isc_spb_trc_cfg, configfile, Const.DEFAULT_ENCODING);
    blr.addString2(Const.isc_spb_trc_name, tracename, Const.DEFAULT_ENCODING);
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

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }

    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_trace_suspend);
    blr.addByteInt32(Const.isc_spb_trc_id, traceid);
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

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }

    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_trace_resume);
    blr.addByteInt32(Const.isc_spb_trc_id, traceid);
    this.connection.svcstart(blr, function (err, data) {
        if (err) {
            doError(new Error(err), callback);
            return;
        }
        self._createOutputStream(options.optread, options.buffersize, callback);
    });
}

ServiceManager.prototype.stopTrace = function (options, callback) {
    var self = this;
    var blr = this.connection._blr;
    var traceid = options.traceid || null;

    if (traceid == null) {
        doError(new Error('No traceid specified'), callback);
        return;
    }

    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_trace_stop);
    blr.addByteInt32(Const.isc_spb_trc_id, traceid);
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
    blr.pos = 0;
    blr.addByte(Const.isc_action_svc_trace_list);
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
    this.connection.svcquery([Const.isc_info_svc_line], buffersize, timeout, function (err, data) {
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
    this.connection.svcquery([Const.isc_info_svc_to_eof], buffersize, timeout, function (err, data) {
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
    this.connection.svcquery([Const.isc_info_svc_running], buffersize, timeout, function (err, data) {
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
    this.connection.svcquery([Const.isc_info_svc_get_users], buffersize, timeout, function (err, data) {
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
    this.connection.svcquery([Const.isc_info_svc_limbo_trans], buffersize, timeout, function (err, data) {
        if (err || !data.buffer) {
            doError(new Error(err||'Bad query return'), callback);
            return;
        }
        self._processquery(data.buffer, callback);
    });
}

module.exports = ServiceManager;
