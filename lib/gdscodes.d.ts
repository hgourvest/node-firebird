/**
 * GDS Error codes
 * Extracted from https://www.firebirdsql.org/pdfrefdocs/Firebird-2.1-ErrorCodes.pdf
 */
declare module 'node-firebird/lib/gdscodes' {
    export enum GDSCode {
        /** Arithmetic exception, numeric overflow, or string */
        ARITH_EXCEPT = 335544321,
        /** Invalid database key */
        BAD_DBKEY = 335544322,
        /** File @1 is not a valid */
        BAD_DB_FORMAT = 335544323,
        /** Invalid database handle (no active connection) */
        BAD_DB_HANDLE = 335544324,
        /** Bad parameters on attach or create */
        BAD_DPB_CONTENT = 335544325,
        /** Unrecognized database parameter block */
        BAD_DPB_FORM = 335544326,
        /** Invalid request handle */
        BAD_REQ_HANDLE = 335544327,
        /** Invalid BLOB handle */
        BAD_SEGSTR_HANDLE = 335544328,
        /** Invalid BLOB ID */
        BAD_SEGSTR_ID = 335544329,
        /** Invalid parameter in transaction parameter block */
        BAD_TPB_CONTENT = 335544330,
        /** Invalid format for transaction parameter block */
        BAD_TPB_FORM = 335544331,
        /** Invalid transaction handle (expecting explicit */
        BAD_TRANS_HANDLE = 335544332,
        /** Internal gds software consistency check (@1) */
        BUG_CHECK = 335544333,
        /** Conversion error from string "@1" */
        CONVERT_ERROR = 335544334,
        /** Database file appears corrupt (@1) */
        DB_CORRUPT = 335544335,
        /** Deadlock */
        DEADLOCK = 335544336,
        /** Attempt to start more than @1 */
        EXCESS_TRANS = 335544337,
        /** No match for first value expression */
        FROM_NO_MATCH = 335544338,
        /** Information type inappropriate for object */
        INFINAP = 335544339,
        /** No information of this type available */
        INFONA = 335544340,
        /** Unknown information item */
        INFUNK = 335544341,
        /** Action cancelled by trigger (@1) to */
        INTEG_FAIL = 335544342,
        /** Invalid request BLR at offset @1 */
        INVALID_BLR = 335544343,
        /** I/O error for file "@2" */
        IO_ERROR = 335544344,
        /** Lock conflict on no wait transaction */
        LOCK_CONFLICT = 335544345,
        /** Corrupt system table */
        METADATA_CORRUPT = 335544346,
        /** Validation error for column @1, value */
        NOT_VALID = 335544347,
        /** No current record for fetch operation */
        NO_CUR_REC = 335544348,
        /** Attempt to store duplicate value (visible */
        NO_DUP = 335544349,
        /** Program attempted to exit without finishing */
        NO_FINISH = 335544350,
        /** Unsuccessful metadata update */
        NO_META_UPDATE = 335544351,
        /** No permission for @1 access to */
        NO_PRIV = 335544352,
        /** Transaction is not in limbo */
        NO_RECON = 335544353,
        /** Invalid database key */
        NO_RECORD = 335544354,
        /** BLOB was not closed */
        NO_SEGSTR_CLOSE = 335544355,
        /** Metadata is obsolete */
        OBSOLETE_METADATA = 335544356,
        /** Cannot disconnect database with open */
        OPEN_TRANS = 335544357,
        /** Message length error (encountered @1, expected */
        PORT_LEN = 335544358,
        /** Attempted update of read-only column */
        READ_ONLY_FIELD = 335544359,
        /** Attempted update of read-only table */
        READ_ONLY_REL = 335544360,
        /** Attempted update during read-only transaction */
        READ_ONLY_TRANS = 335544361,
        /** Cannot update read-only view @1 */
        READ_ONLY_VIEW = 335544362,
        /** No transaction for request */
        REQ_NO_TRANS = 335544363,
        /** Request synchronization error */
        REQ_SYNC = 335544364,
        /** Request referenced an unavailable database */
        REQ_WRONG_DB = 335544365,
        /** Segment buffer length shorter than expected */
        SEGMENT = 335544366,
        /** Attempted retrieval of more segments than */
        SEGSTR_EOF = 335544367,
        /** Attempted invalid operation on a BLOB */
        SEGSTR_NO_OP = 335544368,
        /** Attempted read of a new, open */
        SEGSTR_NO_READ = 335544369,
        /** Attempted action on blob outside transaction */
        SEGSTR_NO_TRANS = 335544370,
        /** Attempted write to read-only BLOB */
        SEGSTR_NO_WRITE = 335544371,
        /** Attempted reference to BLOB in unavailable */
        SEGSTR_WRONG_DB = 335544372,
        /** Operating system directive @1 failed */
        SYS_REQUEST = 335544373,
        /** Attempt to fetch past the last */
        STREAM_EOF = 335544374,
        /** Unavailable database */
        UNAVAILABLE = 335544375,
        /** Table @1 was omitted from the */
        UNRES_REL = 335544376,
        /** Request includes a DSRI extension not */
        UNS_EXT = 335544377,
        /** Feature is not supported */
        WISH_LIST = 335544378,
        /** Unsupported on-disk structure for file @1; */
        WRONG_ODS = 335544379,
        /** Wrong number of arguments on call */
        WRONUMARG = 335544380,
        /** Implementation limit exceeded */
        IMP_EXC = 335544381,
        /** @1 */
        RANDOM = 335544382,
        /** Unrecoverable conflict with limbo transaction @1 */
        FATAL_CONFLICT = 335544383,
        /** Internal error */
        BADBLK = 335544384,
        /** Internal error */
        INVPOOLCL = 335544385,
        /** Too many requests */
        NOPOOLIDS = 335544386,
        /** Internal error */
        RELBADBLK = 335544387,
        /** Block size exceeds implementation restriction */
        BLKTOOBIG = 335544388,
        /** Buffer exhausted */
        BUFEXH = 335544389,
        /** BLR syntax error= expected @1 at */
        SYNTAXERR = 335544390,
        /** Buffer in use */
        BUFINUSE = 335544391,
        /** Internal error */
        BDBINCON = 335544392,
        /** Request in use */
        REQINUSE = 335544393,
        /** Incompatible version of on-disk structure */
        BADODSVER = 335544394,
        /** Table @1 is not defined */
        RELNOTDEF = 335544395,
        /** Column @1 is not defined in */
        FLDNOTDEF = 335544396,
        /** Internal error */
        DIRTYPAGE = 335544397,
        /** Internal error */
        WAIFORTRA = 335544398,
        /** Internal error */
        DOUBLELOC = 335544399,
        /** Internal error */
        NODNOTFND = 335544400,
        /** Internal error */
        DUPNODFND = 335544401,
        /** Internal error */
        LOCNOTMAR = 335544402,
        /** Page @1 is of wrong type */
        BADPAGTYP = 335544403,
        /** Database corrupted */
        CORRUPT = 335544404,
        /** Checksum error on database page @1 */
        BADPAGE = 335544405,
        /** Index is broken */
        BADINDEX = 335544406,
        /** Database handle not zero */
        DBBNOTZER = 335544407,
        /** Transaction handle not zero */
        TRANOTZER = 335544408,
        /** Transaction--request mismatch (synchronization */
        TRAREQMIS = 335544409,
        /** Bad handle count */
        BADHNDCNT = 335544410,
        /** Wrong version of transaction parameter block */
        WROTPBVER = 335544411,
        /** Unsupported BLR version (expected @1, */
        WROBLRVER = 335544412,
        /** Wrong version of database parameter block */
        WRODPBVER = 335544413,
        /** BLOB and array data types are */
        BLOBNOTSUP = 335544414,
        /** Database corrupted */
        BADRELATION = 335544415,
        /** Internal error */
        NODETACH = 335544416,
        /** Internal error */
        NOTREMOTE = 335544417,
        /** Transaction in limbo */
        TRAINLIM = 335544418,
        /** Transaction not in limbo */
        NOTINLIM = 335544419,
        /** Transaction outstanding */
        TRAOUTSTA = 335544420,
        /** Connection rejected by remote interface */
        CONNECT_REJECT = 335544421,
        /** Internal error */
        DBFILE = 335544422,
        /** Internal error */
        ORPHAN = 335544423,
        /** No lock manager available */
        NO_LOCK_MGR = 335544424,
        /** Context already in use (BLR error) */
        CTXINUSE = 335544425,
        /** Context not defined (BLR error) */
        CTXNOTDEF = 335544426,
        /** Data operation not supported */
        DATNOTSUP = 335544427,
        /** Undefined message number */
        BADMSGNUM = 335544428,
        /** Bad parameter number */
        BADPARNUM = 335544429,
        /** Unable to allocate memory from operating */
        VIRMEMEXH = 335544430,
        /** Blocking signal has been received */
        BLOCKING_SIGNAL = 335544431,
        /** Lock manager error */
        LOCKMANERR = 335544432,
        /** Key size exceeds implementation restriction for */
        KEYTOOBIG = 335544434,
        /** Null segment of UNIQUE KEY */
        NULLSEGKEY = 335544435,
        /** SQL error code = @1 */
        SQLERR = 335544436,
        /** Wrong DYN version */
        WRODYNVER = 335544437,
        /** Function @1 is not defined */
        FUNNOTDEF = 335544438,
        /** Function @1 could not be matched */
        FUNMISMAT = 335544439,
        /**  */
        BAD_MSG_VEC = 335544440,
        /** Database detach completed with errors */
        BAD_DETACH = 335544441,
        /** Database system cannot read argument @1 */
        NOARGACC_READ = 335544442,
        /** Database system cannot write argument @1 */
        NOARGACC_WRITE = 335544443,
        /** Operation not supported */
        READ_ONLY = 335544444,
        /** @1 extension error */
        EXT_ERR = 335544445,
        /** Not updatable */
        NON_UPDATABLE = 335544446,
        /** No rollback performed */
        NO_ROLLBACK = 335544447,
        /**  */
        BAD_SEC_INFO = 335544448,
        /**  */
        INVALID_SEC_INFO = 335544449,
        /** @1 */
        MISC_INTERPRETED = 335544450,
        /** Update conflicts with concurrent update */
        UPDATE_CONFLICT = 335544451,
        /** Object @1 is in use */
        OBJ_IN_USE = 335544453,
        /** Filter not found to convert type */
        NOFILTER = 335544454,
        /** Cannot attach active shadow file */
        SHADOW_ACCESSED = 335544455,
        /** Invalid slice description language at offset */
        INVALID_SDL = 335544456,
        /** Subscript out of bounds */
        OUT_OF_BOUNDS = 335544457,
        /** Column not array or invalid dimensions */
        INVALID_DIMENSION = 335544458,
        /** Record from transaction @1 is stuck */
        REC_IN_LIMBO = 335544459,
        /** A file in manual shadow @1 */
        SHADOW_MISSING = 335544460,
        /** Secondary server attachments cannot validate */
        CANT_VALIDATE = 335544461,
        /** Generator @1 is not defined */
        GENNOTDEF = 335544463,
        /** Secondary server attachments cannot start logging */
        CANT_START_LOGGING = 335544464,
        /** Invalid BLOB type for operation */
        BAD_SEGSTR_TYPE = 335544465,
        /** Violation of FOREIGN KEY constraint "@1" */
        FOREIGN_KEY = 335544466,
        /** Minor version too high found @1 */
        HIGH_MINOR = 335544467,
        /** Transaction @1 is @2 */
        TRA_STATE = 335544468,
        /** Transaction marked invalid by I/O error */
        TRANS_INVALID = 335544469,
        /** Cache buffer for page @1 invalid */
        BUF_INVALID = 335544470,
        /** There is no index in table */
        INDEXNOTDEFINED = 335544471,
        /** Your user name and password are */
        LOGIN = 335544472,
        /** Invalid bookmark handle */
        INVALID_BOOKMARK = 335544473,
        /** Invalid lock level @1 */
        BAD_LOCK_LEVEL = 335544474,
        /** Lock on table @1 conflicts with */
        RELATION_LOCK = 335544475,
        /** Requested record lock conflicts with existing */
        RECORD_LOCK = 335544476,
        /** Maximum indexes per table (@1) exceeded */
        MAX_IDX = 335544477,
        /** Invalid statement handle */
        BAD_STMT_HANDLE = 335544485,
        /** WAL Writer error */
        WALW_ERR = 335544487,
        /** Log file header of @1 too */
        LOGH_SMALL = 335544488,
        /** Invalid version of log file @1 */
        LOGH_INV_VERSION = 335544489,
        /** Log file @1 not latest in */
        LOGH_OPEN_FLAG = 335544490,
        /** Log file @1 not closed properly; */
        LOGH_OPEN_FLAG2 = 335544491,
        /** Database name in the log file */
        LOGH_DIFF_DBNAME = 335544492,
        /** Unexpected end of log file @1 */
        LOGF_UNEXPECTED_EOF = 335544493,
        /** Incomplete log record at offset @1 */
        LOGR_INCOMPLETE = 335544494,
        /** Log record header too small at */
        LOGR_HEADER_SMALL = 335544495,
        /** Log block too small at offset */
        LOGB_SMALL = 335544496,
        /** Database does not use Write-ahead Log */
        NO_WAL = 335544500,
        /** Reference to invalid stream number */
        STREAM_NOT_DEFINED = 335544502,
        /** Database @1 shutdown in progress */
        SHUTINPROG = 335544506,
        /** Refresh range number @1 already in */
        RANGE_IN_USE = 335544507,
        /** Refresh range number @1 not found */
        RANGE_NOT_FOUND = 335544508,
        /** CHARACTER SET @1 is not defined */
        CHARSET_NOT_FOUND = 335544509,
        /** Lock time-out on wait transaction */
        LOCK_TIMEOUT = 335544510,
        /** Procedure @1 is not defined */
        PRCNOTDEF = 335544511,
        /** Input parameter mismatch for procedure @1 */
        PRCMISMAT = 335544512,
        /** Status code @1 unknown */
        CODNOTDEF = 335544515,
        /** Exception @1 not defined */
        XCPNOTDEF = 335544516,
        /** Exception @1 */
        EXCEPT = 335544517,
        /** Restart shared cache manager */
        CACHE_RESTART = 335544518,
        /** Invalid lock handle */
        BAD_LOCK_HANDLE = 335544519,
        /** Database @1 shutdown */
        SHUTDOWN = 335544528,
        /** Cannot modify an existing user privilege */
        EXISTING_PRIV_MOD = 335544529,
        /** Cannot delete PRIMARY KEY being used */
        PRIMARY_KEY_REF = 335544530,
        /** Column used in a PRIMARY constraint */
        PRIMARY_KEY_NOTNULL = 335544531,
        /** Name of Referential Constraint not defined */
        REF_CNSTRNT_NOTFOUND = 335544532,
        /** Non-existent PRIMARY or UNIQUE KEY */
        FOREIGN_KEY_NOTFOUND = 335544533,
        /** Cannot update constraints */
        REF_CNSTRNT_UPDATE = 335544534,
        /** Cannot update constraints */
        CHECK_CNSTRNT_UPDATE = 335544535,
        /** Cannot delete CHECK constraint entry */
        CHECK_CNSTRNT_DEL = 335544536,
        /** Cannot delete index segment used by */
        INTEG_INDEX_SEG_DEL = 335544537,
        /** Cannot update index segment used by */
        INTEG_INDEX_SEG_MOD = 335544538,
        /** Cannot delete index used by an */
        INTEG_INDEX_DEL = 335544539,
        /** Cannot modify index used by an */
        INTEG_INDEX_MOD = 335544540,
        /** Cannot delete trigger used by a */
        CHECK_TRIG_DEL = 335544541,
        /** Cannot update trigger used by a */
        CHECK_TRIG_UPDATE = 335544542,
        /** Cannot delete column being used in */
        CNSTRNT_FLD_DEL = 335544543,
        /** Cannot rename column being used in */
        CNSTRNT_FLD_RENAME = 335544544,
        /** Cannot update constraints */
        REL_CNSTRNT_UPDATE = 335544545,
        /** Cannot define constraints on views */
        CONSTAINT_ON_VIEW = 335544546,
        /** Internal gds software consistency check (invalid */
        INVLD_CNSTRNT_TYPE = 335544547,
        /** Attempt to define a second PRIMARY */
        PRIMARY_KEY_EXISTS = 335544548,
        /** Cannot modify or erase a system */
        SYSTRIG_UPDATE = 335544549,
        /** Only the owner of a table */
        NOT_REL_OWNER = 335544550,
        /** Could not find table/procedure for GRANT */
        GRANT_OBJ_NOTFOUND = 335544551,
        /** Could not find column for GRANT */
        GRANT_FLD_NOTFOUND = 335544552,
        /** User does not have GRANT privileges */
        GRANT_NOPRIV = 335544553,
        /** Table/procedure has non-SQL security class */
        NONSQL_SECURITY_REL = 335544554,
        /** Column has non-SQL security class defined */
        NONSQL_SECURITY_FLD = 335544555,
        /** Database shutdown unsuccessful */
        SHUTFAIL = 335544557,
        /** Operation violates CHECK constraint @1 on */
        CHECK_CONSTRAINT = 335544558,
        /** Invalid service handle */
        BAD_SVC_HANDLE = 335544559,
        /** Database @1 shutdown in @2 seconds */
        SHUTWARN = 335544560,
        /** Wrong version of service parameter block */
        WROSPBVER = 335544561,
        /** Unrecognized service parameter block */
        BAD_SPB_FORM = 335544562,
        /** Service @1 is not defined */
        SVCNOTDEF = 335544563,
        /** Cannot transliterate character between character */
        TRANSLITERATION_FAILED = 335544565,
        /** WAL defined; Cache Manager must be */
        START_CM_FOR_WAL = 335544566,
        /** Implementation of text subtype @1 not */
        TEXT_SUBTYPE = 335544568,
        /** Dynamic SQL Error */
        DSQL_ERROR = 335544569,
        /** Invalid command */
        DSQL_COMMAND_ERR = 335544570,
        /** Data type for constant unknown */
        DSQL_CONSTANT_ERR = 335544571,
        /** Invalid cursor reference */
        DSQL_CURSOR_ERR = 335544572,
        /** Data type unknown */
        DSQL_DATATYPE_ERR = 335544573,
        /** Invalid cursor declaration */
        DSQL_DECL_ERR = 335544574,
        /** Cursor @1 is not updatable */
        DSQL_CURSOR_UPDATE_ERR = 335544575,
        /** Attempt to reopen an open cursor */
        DSQL_CURSOR_OPEN_ERR = 335544576,
        /** Attempt to reclose a closed cursor */
        DSQL_CURSOR_CLOSE_ERR = 335544577,
        /** Column unknown */
        DSQL_FIELD_ERR = 335544578,
        /** Internal error */
        DSQL_INTERNAL_ERR = 335544579,
        /** Table unknown */
        DSQL_RELATION_ERR = 335544580,
        /** Procedure unknown */
        DSQL_PROCEDURE_ERR = 335544581,
        /** Request unknown */
        DSQL_REQUEST_ERR = 335544582,
        /** SQLDA missing or incorrect version, or */
        DSQL_SQLDA_ERR = 335544583,
        /** Count of read-write columns does not */
        DSQL_VAR_COUNT_ERR = 335544584,
        /** Invalid statement handle */
        DSQL_STMT_HANDLE = 335544585,
        /** Function unknown */
        DSQL_FUNCTION_ERR = 335544586,
        /** Column is not a BLOB */
        DSQL_BLOB_ERR = 335544587,
        /** COLLATION @1 for CHARACTER SET @2 */
        COLLATION_NOT_FOUND = 335544588,
        /** COLLATION @1 is not valid for */
        COLLATION_NOT_FOR_CHARSET = 335544589,
        /** Option specified more than once */
        DSQL_DUP_OPTION = 335544590,
        /** Unknown transaction option */
        DSQL_TRAN_ERR = 335544591,
        /** Invalid array reference */
        DSQL_INVALID_ARRAY = 335544592,
        /** Array declared with too many dimensions */
        DSQL_MAX_ARR_DIM_EXCEEDED = 335544593,
        /** Illegal array dimension range */
        DSQL_ARR_RANGE_ERROR = 335544594,
        /** Trigger unknown */
        DSQL_TRIGGER_ERR = 335544595,
        /** Subselect illegal in this context */
        DSQL_SUBSELECT_ERR = 335544596,
        /** Cannot prepare a CREATE */
        DSQL_CRDB_PREPARE_ERR = 335544597,
        /** Must specify column name for view */
        SPECIFY_FIELD_ERR = 335544598,
        /** Number of columns does not match */
        NUM_FIELD_ERR = 335544599,
        /** Only simple column names permitted for */
        COL_NAME_ERR = 335544600,
        /** No WHERE clause for VIEW WITH */
        WHERE_ERR = 335544601,
        /** Only one table allowed for VIEW */
        TABLE_VIEW_ERR = 335544602,
        /** DISTINCT, GROUP or HAVING not permitted */
        DISTINCT_ERR = 335544603,
        /** FOREIGN KEY column count does not */
        KEY_FIELD_COUNT_ERR = 335544604,
        /** No subqueries permitted for VIEW WITH */
        SUBQUERY_ERR = 335544605,
        /** Expression evaluation not supported */
        EXPRESSION_EVAL_ERR = 335544606,
        /** Gen.c= node not supported */
        NODE_ERR = 335544607,
        /** Unexpected end of command */
        COMMAND_END_ERR = 335544608,
        /** INDEX @1 */
        INDEX_NAME = 335544609,
        /** EXCEPTION @1 */
        EXCEPTION_NAME = 335544610,
        /** COLUMN @1 */
        FIELD_NAME = 335544611,
        /** Token unknown */
        TOKEN_ERR = 335544612,
        /** Union not supported */
        UNION_ERR = 335544613,
        /** Unsupported DSQL construct */
        DSQL_CONSTRUCT_ERR = 335544614,
        /** Column used with aggregate */
        FIELD_AGGREGATE_ERR = 335544615,
        /** Invalid column reference */
        FIELD_REF_ERR = 335544616,
        /** Invalid ORDER BY clause */
        ORDER_BY_ERR = 335544617,
        /** Return mode by value not allowed */
        RETURN_MODE_ERR = 335544618,
        /** External functions cannot have more than */
        EXTERN_FUNC_ERR = 335544619,
        /** Alias @1 conflicts with an alias */
        ALIAS_CONFLICT_ERR = 335544620,
        /** Alias @1 conflicts with a procedure */
        PROCEDURE_CONFLICT_ERROR = 335544621,
        /** Alias @1 conflicts with a table */
        RELATION_CONFLICT_ERR = 335544622,
        /** Illegal use of keyword VALUE */
        DSQL_DOMAIN_ERR = 335544623,
        /** Segment count of 0 defined for */
        IDX_SEG_ERR = 335544624,
        /** A node name is not permitted */
        NODE_NAME_ERR = 335544625,
        /** TABLE @1 */
        TABLE_NAME = 335544626,
        /** PROCEDURE @1 */
        PROC_NAME = 335544627,
        /** Cannot create index @1 */
        IDX_CREATE_ERR = 335544628,
        /** There are @1 dependencies */
        DEPENDENCY = 335544630,
        /** Too many keys defined for index */
        IDX_KEY_ERR = 335544631,
        /** Preceding file did not specify length, */
        DSQL_FILE_LENGTH_ERR = 335544632,
        /** Shadow number must be a positive */
        DSQL_SHADOW_NUMBER_ERR = 335544633,
        /** Token unknown- line @1, column @2 */
        DSQL_TOKEN_UNK_ERR = 335544634,
        /** There is no alias or table */
        DSQL_NO_RELATION_ALIAS = 335544635,
        /** There is no index @1 for */
        INDEXNAME = 335544636,
        /** Table @1 is not referenced in */
        NO_STREAM_PLAN = 335544637,
        /** Table @1 is referenced more than */
        STREAM_TWICE = 335544638,
        /** Table @1 is referenced in the */
        STREAM_NOT_FOUND = 335544639,
        /** Invalid use of CHARACTER SET or */
        COLLATION_REQUIRES_TEXT = 335544640,
        /** Specified domain or source column @1 */
        DSQL_DOMAIN_NOT_FOUND = 335544641,
        /** Index @1 cannot be used in */
        INDEX_UNUSED = 335544642,
        /** The table @1 is referenced twice; */
        DSQL_SELF_JOIN = 335544643,
        /** Illegal operation when at beginning of */
        STREAM_BOF = 335544644,
        /** The current position is on a */
        STREAM_CRACK = 335544645,
        /** Database or file exists */
        DB_OR_FILE_EXISTS = 335544646,
        /** Invalid comparison operator for find operation */
        INVALID_OPERATOR = 335544647,
        /** Connection lost to pipe server */
        CONN_LOST = 335544648,
        /** Bad checksum */
        BAD_CHECKSUM = 335544649,
        /** Wrong page type */
        PAGE_TYPE_ERR = 335544650,
        /** Cannot insert because the file is */
        EXT_READONLY_ERR = 335544651,
        /** Multiple rows in singleton select */
        SING_SELECT_ERR = 335544652,
        /** Cannot attach to password database */
        PSW_ATTACH = 335544653,
        /** Cannot start transaction for password database */
        PSW_START_TRANS = 335544654,
        /** Invalid direction for find operation */
        INVALID_DIRECTION = 335544655,
        /** Variable @1 conflicts with parameter in */
        DSQL_VAR_CONFLICT = 335544656,
        /** Array/BLOB/DATE data types not allowed in */
        DSQL_NO_BLOB_ARRAY = 335544657,
        /** @1 is not a valid base */
        DSQL_BASE_TABLE = 335544658,
        /** Table @1 is referenced twice in */
        DUPLICATE_BASE_TABLE = 335544659,
        /** View @1 has more than one */
        VIEW_ALIAS = 335544660,
        /** Cannot add index, index root page */
        INDEX_ROOT_PAGE_FULL = 335544661,
        /** BLOB SUB_TYPE @1 is not defined */
        DSQL_BLOB_TYPE_UNKNOWN = 335544662,
        /** Too many concurrent executions of the */
        REQ_MAX_CLONES_EXCEEDED = 335544663,
        /** Duplicate specification of @1- not supported */
        DSQL_DUPLICATE_SPEC = 335544664,
        /** Violation of PRIMARY or UNIQUE KEY */
        UNIQUE_KEY_VIOLATION = 335544665,
        /** Server version too old to support */
        SRVR_VERSION_TOO_OLD = 335544666,
        /** Drop database completed with errors */
        DRDB_COMPLETED_WITH_ERRS = 335544667,
        /** Procedure @1 does not return any */
        DSQL_PROCEDURE_USE_ERR = 335544668,
        /** Count of column list and variable */
        DSQL_COUNT_MISMATCH = 335544669,
        /** Attempt to index BLOB column in */
        BLOB_IDX_ERR = 335544670,
        /** Attempt to index array column in */
        ARRAY_IDX_ERR = 335544671,
        /** Too few key columns found for */
        KEY_FIELD_ERR = 335544672,
        /** Cannot delete */
        NO_DELETE = 335544673,
        /** Last column in a table cannot */
        DEL_LAST_FIELD = 335544674,
        /** Sort error */
        SORT_ERR = 335544675,
        /** Sort error= not enough memory */
        SORT_MEM_ERR = 335544676,
        /** Too many versions */
        VERSION_ERR = 335544677,
        /** Invalid key position */
        INVAL_KEY_POSN = 335544678,
        /** Segments not allowed in expression index */
        NO_SEGMENTS_ERR = 335544679,
        /** Sort error= corruption in data structure */
        CRRP_DATA_ERR = 335544680,
        /** New record size of @1 bytes */
        REC_SIZE_ERR = 335544681,
        /** Inappropriate self-reference of column */
        DSQL_FIELD_REF = 335544682,
        /** Request depth exceeded. (Recursive definition?) */
        REQ_DEPTH_EXCEEDED = 335544683,
        /** Cannot access column @1 in view */
        NO_FIELD_ACCESS = 335544684,
        /** Dbkey not available for multi-table views */
        NO_DBKEY = 335544685,
        /** The prepare statement identifies a prepare */
        DSQL_OPEN_CURSOR_REQUEST = 335544688,
        /** Firebird error */
        IB_ERROR = 335544689,
        /** Cache redefined */
        CACHE_REDEF = 335544690,
        /** Insufficient memory to allocate page buffer */
        CACHE_TOO_SMALL = 335544691,
        /** Log redefined */
        LOG_REDEF = 335544692,
        /** Log size too small */
        LOG_TOO_SMALL = 335544693,
        /** Log partition size too small */
        PARTITION_TOO_SMALL = 335544694,
        /** Partitions not supported in series of */
        PARTITION_NOT_SUPP = 335544695,
        /** Total length of a partitioned log */
        LOG_LENGTH_SPEC = 335544696,
        /** Precision must be from 1 to */
        PRECISION_ERR = 335544697,
        /** Scale must be between zero and */
        SCALE_NOGT = 335544698,
        /** Short integer expected */
        EXPEC_SHORT = 335544699,
        /** Long integer expected */
        EXPEC_LONG = 335544700,
        /** Unsigned short integer expected */
        EXPEC_USHORT = 335544701,
        /** Invalid ESCAPE sequence */
        LIKE_ESCAPE_INVALID = 335544702,
        /** Service @1 does not have an */
        SVCNOEXE = 335544703,
        /** Failed to locate host machine. */
        NET_LOOKUP_ERR = 335544704,
        /** Undefined service @1/@2. */
        SERVICE_UNKNOWN = 335544705,
        /** The specified name was not found */
        HOST_UNKNOWN = 335544706,
        /** User does not have GRANT privileges */
        GRANT_NOPRIV_ON_BASE = 335544707,
        /** Ambiguous column reference. */
        DYN_FLD_AMBIGUOUS = 335544708,
        /** Invalid aggregate reference */
        DSQL_AGG_REF_ERR = 335544709,
        /** Navigational stream @1 references a view */
        COMPLEX_VIEW = 335544710,
        /** Attempt to execute an unprepared dynamic */
        UNPREPARED_STMT = 335544711,
        /** Positive value expected */
        EXPEC_POSITIVE = 335544712,
        /** Incorrect values within SQLDA structure */
        DSQL_SQLDA_VALUE_ERR = 335544713,
        /** Invalid blob id */
        INVALID_ARRAY_ID = 335544714,
        /** Operation not supported for EXTERNAL FILE */
        EXTFILE_UNS_OP = 335544715,
        /** Service is currently busy= @1 */
        SVC_IN_USE = 335544716,
        /** Stack size insufficent to execute current */
        ERR_STACK_LIMIT = 335544717,
        /** Invalid key for find operation */
        INVALID_KEY = 335544718,
        /** Unable to complete network request to */
        NETWORK_ERROR = 335544721,
        /** Failed to establish a connection. */
        NET_CONNECT_ERR = 335544722,
        /** Error while listening for an incoming */
        NET_CONNECT_LISTEN_ERR = 335544723,
        /** Failed to establish a secondary connection */
        NET_EVENT_CONNECT_ERR = 335544724,
        /** Error while listening for an incoming */
        NET_EVENT_LISTEN_ERR = 335544725,
        /** Error reading data from the connection. */
        NET_READ_ERR = 335544726,
        /** Error writing data to the connection. */
        NET_WRITE_ERR = 335544727,
        /** Cannot deactivate index used by an */
        INTEG_INDEX_DEACTIVATE = 335544728,
        /** Cannot deactivate index used by a */
        INTEG_DEACTIVATE_PRIMARY = 335544729,
        /** Client/Server Express not supported in this */
        CSE_NOT_SUPPORTED = 335544730,
        /**  */
        TRA_MUST_SWEEP = 335544731,
        /** Access to databases on file servers */
        UNSUPPORTED_NETWORK_DRIVE = 335544732,
        /** Error while trying to create file */
        IO_CREATE_ERR = 335544733,
        /** Error while trying to open file */
        IO_OPEN_ERR = 335544734,
        /** Error while trying to close file */
        IO_CLOSE_ERR = 335544735,
        /** Error while trying to read from */
        IO_READ_ERR = 335544736,
        /** Error while trying to write to */
        IO_WRITE_ERR = 335544737,
        /** Error while trying to delete file */
        IO_DELETE_ERR = 335544738,
        /** Error while trying to access file */
        IO_ACCESS_ERR = 335544739,
        /** A fatal exception occurred during the */
        UDF_EXCEPTION = 335544740,
        /** Connection lost to database */
        LOST_DB_CONNECTION = 335544741,
        /** User cannot write to RDB$USER_PRIVILEGES */
        NO_WRITE_USER_PRIV = 335544742,
        /** Token size exceeds limit */
        TOKEN_TOO_LONG = 335544743,
        /** Maximum user count exceeded.Contact your */
        MAX_ATT_EXCEEDED = 335544744,
        /** Your login @1 is same as */
        LOGIN_SAME_AS_ROLE_NAME = 335544745,
        /** "REFERENCES table" without "(column)" */
        REFTABLE_REQUIRES_PK = 335544746,
        /** The username entered is too long.Maximum */
        USRNAME_TOO_LONG = 335544747,
        /** The password specified is too long.Maximum */
        PASSWORD_TOO_LONG = 335544748,
        /** A username is required for this */
        USRNAME_REQUIRED = 335544749,
        /** A password is required for this */
        PASSWORD_REQUIRED = 335544750,
        /** The network protocol specified is invalid */
        BAD_PROTOCOL = 335544751,
        /** A duplicate user name was found */
        DUP_USRNAME_FOUND = 335544752,
        /** The user name specified was not */
        USRNAME_NOT_FOUND = 335544753,
        /** An error occurred while attempting to */
        ERROR_ADDING_SEC_RECORD = 335544754,
        /** An error occurred while attempting to */
        ERROR_MODIFYING_SEC_RECORD = 335544755,
        /** An error occurred while attempting to */
        ERROR_DELETING_SEC_RECORD = 335544756,
        /** An error occurred while updating the */
        ERROR_UPDATING_SEC_DB = 335544757,
        /** Sort record size of @1 bytes */
        SORT_REC_SIZE_ERR = 335544758,
        /** Can not define a not null */
        BAD_DEFAULT_VALUE = 335544759,
        /** Invalid clause--- '@1' */
        INVALID_CLAUSE = 335544760,
        /** Too many open handles to database */
        TOO_MANY_HANDLES = 335544761,
        /** A string constant is delimited by */
        INVALID_STRING_CONSTANT = 335544763,
        /** DATE must be changed to TIMESTAMP */
        TRANSITIONAL_DATE = 335544764,
        /** Attempted update on read-only database */
        READ_ONLY_DATABASE = 335544765,
        /** SQL dialect @1 is not supported */
        MUST_BE_DIALECT_2_AND_UP = 335544766,
        /** A fatal exception occurred during the */
        BLOB_FILTER_EXCEPTION = 335544767,
        /** Access violation.The code attempted to access */
        EXCEPTION_ACCESS_VIOLATION = 335544768,
        /** Datatype misalignment.The attempted to read or */
        EXCEPTION_DATATYPE_MISSALIGNMENT = 335544769,
        /** Array bounds exceeded.The code attempted to */
        EXCEPTION_ARRAY_BOUNDS_EXCEEDED = 335544770,
        /**  */
        EXCEPTION_FLOAT_DENORMAL_OPERAN = 335544771,
        /** Floating-point divide by zero.The code attempted */
        EXCEPTION_FLOAT_DIVIDE_BY_ZERO = 335544772,
        /** Floating-point inexact result.The result of a */
        EXCEPTION_FLOAT_INEXACT_RESULT = 335544773,
        /** Floating-point invalid operand.An indeterminant */
        EXCEPTION_FLOAT_INVALID_OPERAND = 335544774,
        /** Floating-point overflow.The exponent of a */
        EXCEPTION_FLOAT_OVERFLOW = 335544775,
        /** Floating-point stack check.The stack overflowed */
        EXCEPTION_FLOAT_STACK_CHECK = 335544776,
        /** Floating-point underflow.The exponent of a */
        EXCEPTION_FLOAT_UNDERFLOW = 335544777,
        /** Integer divide by zero.The code attempted */
        EXCEPTION_INTEGER_DIVIDE_BY_ZERO = 335544778,
        /** Integer overflow.The result of an integer */
        EXCEPTION_INTEGER_OVERFLOW = 335544779,
        /** An exception occurred that does not */
        EXCEPTION_UNKNOWN = 335544780,
        /** Stack overflow.The resource requirements of the */
        EXCEPTION_STACK_OVERFLOW = 335544781,
        /** Segmentation Fault. The code attempted to */
        EXCEPTION_SIGSEGV = 335544782,
        /** Illegal Instruction. The Code attempted to */
        EXCEPTION_SIGILL = 335544783,
        /** Bus Error. The Code caused a */
        EXCEPTION_SIGBUS = 335544784,
        /** Floating Point Error. The Code caused */
        EXCEPTION_SIGFPE = 335544785,
        /** Cannot delete rows from external files. */
        EXT_FILE_DELETE = 335544786,
        /** Cannot update rows in external files. */
        EXT_FILE_MODIFY = 335544787,
        /** Unable to perform operation.You must be */
        ADM_TASK_DENIED = 335544788,
        /** Specified EXTRACT part does not exist */
        EXTRACT_INPUT_MISMATCH = 335544789,
        /** Service @1 requires SYSDBA */
        INSUFFICIENT_SVC_PRIVILEGES = 335544790,
        /** The file @1 is currently in */
        FILE_IN_USE = 335544791,
        /** Cannot attach to services manager */
        SERVICE_ATT_ERR = 335544792,
        /** Metadata update statement is not allowed */
        DDL_NOT_ALLOWED_BY_DB_SQL_DIAL = 335544793,
        /** Operation was cancelled */
        CANCELLED = 335544794,
        /** Unexpected item in service parameter block, */
        UNEXP_SPB_FORM = 335544795,
        /** Client SQL dialect @1 does not */
        SQL_DIALECT_DATATYPE_UNSUPPORT = 335544796,
        /** User name and password are required */
        SVCNOUSER = 335544797,
        /** You created an indirect dependency on */
        DEPEND_ON_UNCOMMITTED_REL = 335544798,
        /** The service name was not specified. */
        SVC_NAME_MISSING = 335544799,
        /** Too many Contexts of Relation/Procedure/Views. */
        TOO_MANY_CONTEXTS = 335544800,
        /** Data type not supported for arithmetic */
        DATYPE_NOTSUP = 335544801,
        /** Database dialect not changed. */
        DIALECT_NOT_CHANGED = 335544803,
        /** Unable to create database @1 */
        DATABASE_CREATE_FAILED = 335544804,
        /** Database dialect @1 is not a */
        INV_DIALECT_SPECIFIED = 335544805,
        /** Valid database dialects are @1. */
        VALID_DB_DIALECTS = 335544806,
        /** Function @1 is in @2, which */
        EXTERN_FUNC_DIR_ERROR = 335544809,
        /** Value exceeds the range for valid */
        DATE_RANGE_EXCEEDED = 335544810,
        /** Passed client dialect @1 is not */
        INV_CLIENT_DIALECT_SPECIFIED = 335544811,
        /** Valid client dialects are @1. */
        VALID_CLIENT_DIALECTS = 335544812,
        /** Unsupported field type specified in BETWEEN */
        OPTIMIZER_BETWEEN_ERR = 335544813,
        /** Services functionality will be supported in */
        SERVICE_NOT_SUPPORTED = 335544814,
        /** GENERATOR @1 */
        GENERATOR_NAME = 335544815,
        /** UDF @1 */
        UDF_NAME = 335544816,
        /** Invalid parameter to FIRST.Only integers >= */
        BAD_LIMIT_PARAM = 335544817,
        /** Invalid parameter to SKIP.Only integers >= */
        BAD_SKIP_PARAM = 335544818,
        /** File exceeded maximum size of 2GB.Add */
        IO_32BIT_EXCEEDED_ERR = 335544819,
        /** Unable to find savepoint with name */
        INVALID_SAVEPOINT = 335544820,
        /** Invalid column position used in the */
        DSQL_COLUMN_POS_ERR = 335544821,
        /** Cannot use an aggregate function in */
        DSQL_AGG_WHERE_ERR = 335544822,
        /** Cannot use an aggregate function in */
        DSQL_AGG_GROUP_ERR = 335544823,
        /** Invalid expression in the @1 (not */
        DSQL_AGG_COLUMN_ERR = 335544824,
        /** Invalid expression in the @1 (neither */
        DSQL_AGG_HAVING_ERR = 335544825,
        /** Nested aggregate functions are not allowed */
        DSQL_AGG_NESTED_ERR = 335544826,
        /** Invalid argument in EXECUTE STATEMENTcannot conver */
        EXEC_SQL_INVALID_ARG = 335544827,
        /** Wrong request type in EXECUTE STATEMENT */
        EXEC_SQL_INVALID_REQ = 335544828,
        /** Variable type (position @1) in EXECUTE */
        EXEC_SQL_INVALID_VAR = 335544829,
        /** Too many recursion levels of EXECUTE */
        EXEC_SQL_MAX_CALL_EXCEEDED = 335544830,
        /** Access to @1 "@2" is denied */
        CONF_ACCESS_DENIED = 335544831,
        /** Cannot change difference file name while */
        WRONG_BACKUP_STATE = 335544832,
        /** Cursor is not open */
        CURSOR_NOT_OPEN = 335544834,
        /** Target shutdown mode is invalid for */
        BAD_SHUTDOWN_MODE = 335544835,
        /** Concatenation overflow. Resulting string cannot */
        CONCAT_OVERFLOW = 335544836,
        /** Invalid offset parameter @1 to SUBSTRING. */
        BAD_SUBSTRING_OFFSET = 335544837,
        /** Foreign key reference target does not */
        FOREIGN_KEY_TARGET_DOESNT_EXIST = 335544838,
        /** Foreign key references are present for */
        FOREIGN_KEY_REFERENCES_PRESENT = 335544839,
        /** Cannot update */
        NO_UPDATE = 335544840,
        /** Cursor is already open */
        CURSOR_ALREADY_OPEN = 335544841,
        /** @1 */
        STACK_TRACE = 335544842,
        /** Context variable @1 is not found */
        CTX_VAR_NOT_FOUND = 335544843,
        /** Invalid namespace name @1 passed to */
        CTX_NAMESPACE_INVALID = 335544844,
        /** Too many context variables */
        CTX_TOO_BIG = 335544845,
        /** Invalid argument passed to @1 */
        CTX_BAD_ARGUMENT = 335544846,
        /** BLR syntax error. Identifier @1... is */
        IDENTIFIER_TOO_LONG = 335544847,
        /** Exception @1 */
        EXCEPT2 = 335544848,
        /** Malformed string */
        MALFORMED_STRING = 335544849,
        /** Output parameter mismatch for procedure @1 */
        PRC_OUT_PARAM_MISMATCH = 335544850,
        /** Unexpected end of command- line @1, */
        COMMAND_END_ERR2 = 335544851,
        /** Partner index segment no @1 has */
        PARTNER_IDX_INCOMPAT_TYPE = 335544852,
        /** Invalid length parameter @1 to SUBSTRING. */
        BAD_SUBSTRING_LENGTH = 335544853,
        /** CHARACTER SET @1 is not installed */
        CHARSET_NOT_INSTALLED = 335544854,
        /** COLLATION @1 for CHARACTER SET @2 */
        COLLATION_NOT_INSTALLED = 335544855,
        /** Connection shutdown */
        ATT_SHUTDOWN = 335544856,
        /** Maximum BLOB size exceeded */
        BLOBTOOBIG = 335544857,
        /** Can't have relation with only computed */
        MUST_HAVE_PHYS_FIELD = 335544858,
        /** Time precision exceeds allowed range (0-@1) */
        INVALID_TIME_PRECISION = 335544859,
        /** Unsupported conversion to target type BLOB */
        BLOB_CONVERT_ERROR = 335544860,
        /** Unsupported conversion to target type ARRAY */
        ARRAY_CONVERT_ERROR = 335544861,
        /** Stream does not support record locking */
        RECORD_LOCK_NOT_SUPP = 335544862,
        /** Cannot create foreign key constraint @1. */
        PARTNER_IDX_NOT_FOUND = 335544863,
        /** Transactions count exceeded. Perform backup and */
        TRA_NUM_EXC = 335544864,
        /** Column has been unexpectedly deleted */
        FIELD_DISAPPEARED = 335544865,
        /** @1 cannot depend on @2 */
        MET_WRONG_GTT_SCOPE = 335544866,
        /** Blob sub_types bigger than 1 (text) */
        SUBTYPE_FOR_INTERNAL_USE = 335544867,
        /** Procedure @1 is not selectable (it */
        ILLEGAL_PRC_TYPE = 335544868,
        /** Datatype @1 is not supported for */
        INVALID_SORT_DATATYPE = 335544869,
        /** COLLATION @1 */
        COLLATION_NAME = 335544870,
        /** DOMAIN @1 */
        DOMAIN_NAME = 335544871,
        /** Domain @1 is not defined */
        DOMNOTDEF = 335544872,
        /** Array data type can use up */
        ARRAY_MAX_DIMENSIONS = 335544873,
        /** A multi database transaction cannot span */
        MAX_DB_PER_TRANS_ALLOWED = 335544874,
        /** Bad debug info format */
        BAD_DEBUG_FORMAT = 335544875,
        /** Error while parsing procedure @1's BLR */
        BAD_PROC_BLR = 335544876,
        /** Index key too big */
        KEY_TOO_BIG = 335544877,
        /** Concurrent transaction number is @1 */
        CONCURRENT_TRANSACTION = 335544878,
        /** Validation error for variable @1, value */
        NOT_VALID_FOR_VAR = 335544879,
        /** Validation error for @1, value "@2" */
        NOT_VALID_FOR = 335544880,
        /** Difference file name should be set */
        NEED_DIFFERENCE = 335544881,
        /** Login name too long (@1 characters, */
        LONG_LOGIN = 335544882,
        /** Column @1 is not defined in */
        FLDNOTDEF2 = 335544883,
        /** Data base file name (@1) already */
        GFIX_DB_NAME = 335740929,
        /** Invalid switch @1 */
        GFIX_INVALID_SW = 335740930,
        /** Incompatible switch combination */
        GFIX_INCMP_SW = 335740932,
        /** Replay log pathname required */
        GFIX_REPLAY_REQ = 335740933,
        /** Number of page buffers for cache */
        GFIX_PGBUF_REQ = 335740934,
        /** Numeric value required */
        GFIX_VAL_REQ = 335740935,
        /** Positive numeric value required */
        GFIX_PVAL_REQ = 335740936,
        /** Number of transactions per sweep required */
        GFIX_TRN_REQ = 335740937,
        /** "full" or "reserve" required */
        GFIX_FULL_REQ = 335740940,
        /** User name required */
        GFIX_USRNAME_REQ = 335740941,
        /** Password required */
        GFIX_PASS_REQ = 335740942,
        /** Subsystem name */
        GFIX_SUBS_NAME = 335740943,
        /** Number of seconds required */
        GFIX_SEC_REQ = 335740945,
        /** Numeric value between 0 and 32767 */
        GFIX_NVAL_REQ = 335740946,
        /** Must specify type of shutdown */
        GFIX_TYPE_SHUT = 335740947,
        /** Please retry, specifying an option */
        GFIX_RETRY = 335740948,
        /** Please retry, giving a database name */
        GFIX_RETRY_DB = 335740951,
        /** Internal block exceeds maximum size */
        GFIX_EXCEED_MAX = 335740991,
        /** Corrupt pool */
        GFIX_CORRUPT_POOL = 335740992,
        /** Virtual memory exhausted */
        GFIX_MEM_EXHAUSTED = 335740993,
        /** Bad pool id */
        GFIX_BAD_POOL = 335740994,
        /** Transaction state @1 not in valid */
        GFIX_TRN_NOT_VALID = 335740995,
        /** Unexpected end of input */
        GFIX_UNEXP_EOI = 335741012,
        /** Failed to reconnect to a transaction */
        GFIX_RECON_FAIL = 335741018,
        /** Transaction description item unknown */
        GFIX_TRN_UNKNOWN = 335741036,
        /** "read_only" or "read_write" required */
        GFIX_MODE_REQ = 335741038,
        /** -sql_dialect set database dialect n */
        GFIX_OPT_SQL_DIALECT = 335741039,
        /** Positive or zero numeric value required */
        GFIX_PZVAL_REQ = 335741042,
        /** Cannot SELECT RDB$DB_KEY from a stored */
        DSQL_DBKEY_FROM_NON_TABLE = 336003074,
        /** Precision 10 to 18 changed from */
        DSQL_TRANSITIONAL_NUMERIC = 336003075,
        /** Database SQL dialect @1 does not */
        SQL_DB_DIALECT_DTYPE_UNSUPPORT = 336003077,
        /** DB dialect @1 and client dialect */
        ISC_SQL_DIALECT_CONFLICT_NUM = 336003079,
        /** Ambiguous field name between @1 and */
        DSQL_AMBIGUOUS_FIELD_NAME = 336003085,
        /** External function should have return position */
        DSQL_UDF_RETURN_POS_ERR = 336003086,
        /** Label @1 @2 in the current */
        DSQL_INVALID_LABEL = 336003087,
        /** Datatypes @1are not comparable in expression */
        DSQL_DATATYPES_NOT_COMPARABLE = 336003088,
        /** Empty cursor name is not allowed */
        DSQL_CURSOR_INVALID = 336003089,
        /** Statement already has a cursor @1 */
        DSQL_CURSOR_REDEFINED = 336003090,
        /** Cursor @1 is not found in */
        DSQL_CURSOR_NOT_FOUND = 336003091,
        /** Cursor @1 already exists in the */
        DSQL_CURSOR_EXISTS = 336003092,
        /** Relation @1 is ambiguous in cursor */
        DSQL_CURSOR_REL_AMBIGUOUS = 336003093,
        /** Relation @1 is not found in */
        DSQL_CURSOR_REL_NOT_FOUND = 336003094,
        /** Cursor is not open */
        DSQL_CURSOR_NOT_OPEN = 336003095,
        /** Data type @1 is not supported */
        DSQL_TYPE_NOT_SUPP_EXT_TAB = 336003096,
        /** Feature not supported on ODS version */
        DSQL_FEATURE_NOT_SUPPORTED_ODS = 336003097,
        /** Primary key required on table @1 */
        PRIMARY_KEY_REQUIRED = 336003098,
        /** UPDATE OR INSERT field list does */
        UPD_INS_DOESNT_MATCH_PK = 336003099,
        /** UPDATE OR INSERT field list does */
        UPD_INS_DOESNT_MATCH_MATCHING = 336003100,
        /** UPDATE OR INSERT without MATCHING */
        UPD_INS_WITH_COMPLEX_VIEW = 336003101,
        /** Incompatible trigger type */
        DSQL_INCOMPATIBLE_TRIGGER_TYPE = 336003102,
        /** Database trigger type can't be changed */
        DSQL_DB_TRIGGER_TYPE_CANT_CHANGE = 336003103,
        /** SQL role @1 does not exist */
        DYN_ROLE_DOES_NOT_EXIST = 336068796,
        /** User @1 has no grant admin */
        DYN_NO_GRANT_ADMIN_OPT = 336068797,
        /** User @1 is not a member */
        DYN_USER_NOT_ROLE_MEMBER = 336068798,
        /** @1 is not the owner of */
        DYN_DELETE_ROLE_FAILED = 336068799,
        /** @1 is a SQL role and */
        DYN_GRANT_ROLE_TO_USER = 336068800,
        /** User name @1 could not be */
        DYN_INV_SQL_ROLE_NAME = 336068801,
        /** SQL role @1 already exists */
        DYN_DUP_SQL_ROLE = 336068802,
        /** Keyword @1 can not be used */
        DYN_KYWD_SPEC_FOR_ROLE = 336068803,
        /** SQL roles are not supported in */
        DYN_ROLES_NOT_SUPPORTED = 336068804,
        /** Cannot rename domain @1 to @2.A */
        DYN_DOMAIN_NAME_EXISTS = 336068812,
        /** Cannot rename column @1 to @2.A */
        DYN_FIELD_NAME_EXISTS = 336068813,
        /** Column @1 from table @2 is */
        DYN_DEPENDENCY_EXISTS = 336068814,
        /** Cannot change datatype for column @1.Changing */
        DYN_DTYPE_INVALID = 336068815,
        /** New size specified for column @1 */
        DYN_CHAR_FLD_TOO_SMALL = 336068816,
        /** Cannot change datatype for @1.Conversion from */
        DYN_INVALID_DTYPE_CONVERSION = 336068817,
        /** Cannot change datatype for column @1 */
        DYN_DTYPE_CONV_INVALID = 336068818,
        /** Zero length identifiers are not allowed */
        DYN_ZERO_LEN_ID = 336068820,
        /** Maximum number of collations per character */
        MAX_COLL_PER_CHARSET = 336068829,
        /** Invalid collation attributes */
        INVALID_COLL_ATTR = 336068830,
        /** @1 cannot reference @2 */
        DYN_WRONG_GTT_SCOPE = 336068840,
        /** New scale specified for column @1 */
        DYN_SCALE_TOO_BIG = 336068852,
        /** New precision specified for column @1 */
        DYN_PRECISION_TOO_SMALL = 336068853,
        /** Feature '@1' is not supported in */
        DYN_ODS_NOT_SUPP_FEATURE = 336068856,
        /** Found unknown switch */
        GBAK_UNKNOWN_SWITCH = 336330753,
        /** Page size parameter missing */
        GBAK_PAGE_SIZE_MISSING = 336330754,
        /** Page size specified (@1) greater than */
        GBAK_PAGE_SIZE_TOOBIG = 336330755,
        /** Redirect location for output is not */
        GBAK_REDIR_OUPUT_MISSING = 336330756,
        /** Conflicting switches for backup/restore */
        GBAK_SWITCHES_CONFLICT = 336330757,
        /** Device type @1 not known */
        GBAK_UNKNOWN_DEVICE = 336330758,
        /** Protection is not there yet */
        GBAK_NO_PROTECTION = 336330759,
        /** Page size is allowed only on */
        GBAK_PAGE_SIZE_NOT_ALLOWED = 336330760,
        /** Multiple sources or destinations specified */
        GBAK_MULTI_SOURCE_DEST = 336330761,
        /** Requires both input and output filenames */
        GBAK_FILENAME_MISSING = 336330762,
        /** Input and output have the same */
        GBAK_DUP_INOUT_NAMES = 336330763,
        /** Expected page size, encountered "@1" */
        GBAK_INV_PAGE_SIZE = 336330764,
        /** REPLACE specified, but the first file */
        GBAK_DB_SPECIFIED = 336330765,
        /** Database @1 already exists.To replace it, */
        GBAK_DB_EXISTS = 336330766,
        /** Device type not specified */
        GBAK_UNK_DEVICE = 336330767,
        /** Gds_$blob_info failed */
        GBAK_BLOB_INFO_FAILED = 336330772,
        /** Do not understand BLOB INFO item */
        GBAK_UNK_BLOB_ITEM = 336330773,
        /** Gds_$get_segment failed */
        GBAK_GET_SEG_FAILED = 336330774,
        /** Gds_$close_blob failed */
        GBAK_CLOSE_BLOB_FAILED = 336330775,
        /** Gds_$open_blob failed */
        GBAK_OPEN_BLOB_FAILED = 336330776,
        /** Failed in put_blr_gen_id */
        GBAK_PUT_BLR_GEN_ID_FAILED = 336330777,
        /** Data type @1 not understood */
        GBAK_UNK_TYPE = 336330778,
        /** Gds_$compile_request failed */
        GBAK_COMP_REQ_FAILED = 336330779,
        /** Gds_$start_request failed */
        GBAK_START_REQ_FAILED = 336330780,
        /** gds_$receive failed */
        GBAK_REC_FAILED = 336330781,
        /** Gds_$release_request failed */
        GBAK_REL_REQ_FAILED = 336330782,
        /** gds_$database_info failed */
        GBAK_DB_INFO_FAILED = 336330783,
        /** Expected database description record */
        GBAK_NO_DB_DESC = 336330784,
        /** Failed to create database @1 */
        GBAK_DB_CREATE_FAILED = 336330785,
        /** RESTORE= decompression length error */
        GBAK_DECOMP_LEN_ERROR = 336330786,
        /** Cannot find table @1 */
        GBAK_TBL_MISSING = 336330787,
        /** Cannot find column for BLOB */
        GBAK_BLOB_COL_MISSING = 336330788,
        /** Gds_$create_blob failed */
        GBAK_CREATE_BLOB_FAILED = 336330789,
        /** Gds_$put_segment failed */
        GBAK_PUT_SEG_FAILED = 336330790,
        /** Expected record length */
        GBAK_REC_LEN_EXP = 336330791,
        /** Wrong length record, expected @1 encountered */
        GBAK_INV_REC_LEN = 336330792,
        /** Expected data attribute */
        GBAK_EXP_DATA_TYPE = 336330793,
        /** Failed in store_blr_gen_id */
        GBAK_GEN_ID_FAILED = 336330794,
        /** Do not recognize record type @1 */
        GBAK_UNK_REC_TYPE = 336330795,
        /** Expected backup version 1..8.Found @1 */
        GBAK_INV_BKUP_VER = 336330796,
        /** Expected backup description record */
        GBAK_MISSING_BKUP_DESC = 336330797,
        /** String truncated */
        GBAK_STRING_TRUNC = 336330798,
        /** warning-- record could not be restored */
        GBAK_CANT_REST_RECORD = 336330799,
        /** Gds_$send failed */
        GBAK_SEND_FAILED = 336330800,
        /** No table name for data */
        GBAK_NO_TBL_NAME = 336330801,
        /** Unexpected end of file on backup */
        GBAK_UNEXP_EOF = 336330802,
        /** Database format @1 is too old */
        GBAK_DB_FORMAT_TOO_OLD = 336330803,
        /** Array dimension for column @1 is */
        GBAK_INV_ARRAY_DIM = 336330804,
        /** Expected XDR record length */
        GBAK_XDR_LEN_EXPECTED = 336330807,
        /** Cannot open backup file @1 */
        GBAK_OPEN_BKUP_ERROR = 336330817,
        /** Cannot open status and error output */
        GBAK_OPEN_ERROR = 336330818,
        /** Blocking factor parameter missing */
        GBAK_MISSING_BLOCK_FAC = 336330934,
        /** Expected blocking factor, encountered "@1" */
        GBAK_INV_BLOCK_FAC = 336330935,
        /** A blocking factor may not be */
        GBAK_BLOCK_FAC_SPECIFIED = 336330936,
        /** User name parameter missing */
        GBAK_MISSING_USERNAME = 336330940,
        /** Password parameter missing */
        GBAK_MISSING_PASSWORD = 336330941,
        /** missing parameter for the number of */
        GBAK_MISSING_SKIPPED_BYTES = 336330952,
        /** Expected number of bytes to be */
        GBAK_INV_SKIPPED_BYTES = 336330953,
        /** Character set */
        GBAK_ERR_RESTORE_CHARSET = 336330965,
        /** Collation */
        GBAK_ERR_RESTORE_COLLATION = 336330967,
        /** Unexpected I/O error while reading from */
        GBAK_READ_ERROR = 336330972,
        /** Unexpected I/O error while writing to */
        GBAK_WRITE_ERROR = 336330973,
        /** Could not drop database @1 (database */
        GBAK_DB_IN_USE = 336330985,
        /** System memory exhausted */
        GBAK_SYSMEMEX = 336330990,
        /** SQL role */
        GBAK_RESTORE_ROLE_FAILED = 336331002,
        /** SQL role parameter missing */
        GBAK_ROLE_OP_MISSING = 336331005,
        /** Page buffers parameter missing */
        GBAK_PAGE_BUFFERS_MISSING = 336331010,
        /** Expected page buffers, encountered "@1" */
        GBAK_PAGE_BUFFERS_WRONG_PARAM = 336331011,
        /** Page buffers is allowed only on */
        GBAK_PAGE_BUFFERS_RESTORE = 336331012,
        /** Size specification either missing or incorrect */
        GBAK_INV_SIZE = 336331014,
        /** File @1 out of sequence */
        GBAK_FILE_OUTOF_SEQUENCE = 336331015,
        /** Can't join-- one of the files */
        GBAK_JOIN_FILE_MISSING = 336331016,
        /** standard input is not supported when */
        GBAK_STDIN_NOT_SUPPTD = 336331017,
        /** Standard output is not supported when */
        GBAK_STDOUT_NOT_SUPPTD = 336331018,
        /** Backup file @1 might be corrupt */
        GBAK_BKUP_CORRUPT = 336331019,
        /** Database file specification missing */
        GBAK_UNK_DB_FILE_SPEC = 336331020,
        /** Can't write a header record to */
        GBAK_HDR_WRITE_FAILED = 336331021,
        /** Free disk space exhausted */
        GBAK_DISK_SPACE_EX = 336331022,
        /** File size given (@1) is less */
        GBAK_SIZE_LT_MIN = 336331023,
        /** Service name parameter missing */
        GBAK_SVC_NAME_MISSING = 336331025,
        /** Cannot restore over current database, must */
        GBAK_NOT_OWNR = 336331026,
        /** "read_only" or "read_write" required */
        GBAK_MODE_REQ = 336331031,
        /** Just data ignore all constraints etc. */
        GBAK_JUST_DATA = 336331033,
        /** Restoring data only ignoring foreign key, */
        GBAK_DATA_ONLY = 336331034,
        /** ODS versions before ODS@1 are not */
        DSQL_TOO_OLD_ODS = 336397205,
        /** Table @1 does not exist */
        DSQL_TABLE_NOT_FOUND = 336397206,
        /** View @1 does not exist */
        DSQL_VIEW_NOT_FOUND = 336397207,
        /** At line @1, column @2 */
        DSQL_LINE_COL_ERROR = 336397208,
        /** At unknown line and column */
        DSQL_UNKNOWN_POS = 336397209,
        /** Column @1 cannot be repeated in */
        DSQL_NO_DUP_NAME = 336397210,
        /** Too many values (more than @1) */
        DSQL_TOO_MANY_VALUES = 336397211,
        /** Array and BLOB data types not */
        DSQL_NO_ARRAY_COMPUTED = 336397212,
        /** Implicit domain name @1 not allowed */
        DSQL_IMPLICIT_DOMAIN_NAME = 336397213,
        /** Scalar operator used on field @1 */
        DSQL_ONLY_CAN_SUBSCRIPT_ARRAY = 336397214,
        /** Cannot sort on more than 255 */
        DSQL_MAX_SORT_ITEMS = 336397215,
        /** Cannot group on more than 255 */
        DSQL_MAX_GROUP_ITEMS = 336397216,
        /** Cannot include the same field (@1.@2) */
        DSQL_CONFLICTING_SORT_FIELD = 336397217,
        /** Column list from derived table @1 */
        DSQL_DERIVED_TABLE_MORE_COLUMNS = 336397218,
        /** Column list from derived table @1 */
        DSQL_DERIVED_TABLE_LESS_COLUMNS = 336397219,
        /** No column name specified for column */
        DSQL_DERIVED_FIELD_UNNAMED = 336397220,
        /** Column @1 was specified multiple times */
        DSQL_DERIVED_FIELD_DUP_NAME = 336397221,
        /** Internal dsql error= alias type expected */
        DSQL_DERIVED_ALIAS_SELECT = 336397222,
        /** Internal dsql error= alias type expected */
        DSQL_DERIVED_ALIAS_FIELD = 336397223,
        /** Internal dsql error= column position out */
        DSQL_AUTO_FIELD_BAD_POS = 336397224,
        /** Recursive CTE member (@1) can refer */
        DSQL_CTE_WRONG_REFERENCE = 336397225,
        /** CTE '@1' has cyclic dependencies */
        DSQL_CTE_CYCLE = 336397226,
        /** Recursive member of CTE can't be */
        DSQL_CTE_OUTER_JOIN = 336397227,
        /** Recursive member of CTE can't reference */
        DSQL_CTE_MULT_REFERENCES = 336397228,
        /** Recursive CTE (@1) must be an */
        DSQL_CTE_NOT_A_UNION = 336397229,
        /** CTE '@1' defined non-recursive member after */
        DSQL_CTE_NONRECURS_AFTER_RECURS = 336397230,
        /** Recursive member of CTE '@1' has */
        DSQL_CTE_WRONG_CLAUSE = 336397231,
        /** Recursive members of CTE (@1) must */
        DSQL_CTE_UNION_ALL = 336397232,
        /** Non-recursive member is missing in CTE */
        DSQL_CTE_MISS_NONRECURSIVE = 336397233,
        /** WITH clause can't be nested */
        DSQL_CTE_NESTED_WITH = 336397234,
        /** Column @1 appears more than once */
        DSQL_COL_MORE_THAN_ONCE_USING = 336397235,
        /** Feature is not supported in dialect */
        DSQL_UNSUPP_FEATURE_DIALECT = 336397236,
        /** CTE "@1" is not used in */
        DSQL_CTE_NOT_USED = 336397237,
        /** Unable to open database */
        GSEC_CANT_OPEN_DB = 336723983,
        /** Error in switch specifications */
        GSEC_SWITCHES_ERROR = 336723984,
        /** No operation specified */
        GSEC_NO_OP_SPEC = 336723985,
        /** No user name specified */
        GSEC_NO_USR_NAME = 336723986,
        /** Add record error */
        GSEC_ERR_ADD = 336723987,
        /** Modify record error */
        GSEC_ERR_MODIFY = 336723988,
        /** Find/modify record error */
        GSEC_ERR_FIND_MOD = 336723989,
        /** Record not found for user= @1 */
        GSEC_ERR_REC_NOT_FOUND = 336723990,
        /** Delete record error */
        GSEC_ERR_DELETE = 336723991,
        /** Find/delete record error */
        GSEC_ERR_FIND_DEL = 336723992,
        /** Find/display record error */
        GSEC_ERR_FIND_DISP = 336723996,
        /** Invalid parameter, no switch defined */
        GSEC_INV_PARAM = 336723997,
        /** Operation already specified */
        GSEC_OP_SPECIFIED = 336723998,
        /** Password already specified */
        GSEC_PW_SPECIFIED = 336723999,
        /** Uid already specified */
        GSEC_UID_SPECIFIED = 336724000,
        /** Gid already specified */
        GSEC_GID_SPECIFIED = 336724001,
        /** Project already specified */
        GSEC_PROJ_SPECIFIED = 336724002,
        /** Organization already specified */
        GSEC_ORG_SPECIFIED = 336724003,
        /** First name already specified */
        GSEC_FNAME_SPECIFIED = 336724004,
        /** Middle name already specified */
        GSEC_MNAME_SPECIFIED = 336724005,
        /** Last name already specified */
        GSEC_LNAME_SPECIFIED = 336724006,
        /** Invalid switch specified */
        GSEC_INV_SWITCH = 336724008,
        /** Ambiguous switch specified */
        GSEC_AMB_SWITCH = 336724009,
        /** No operation specified for parameters */
        GSEC_NO_OP_SPECIFIED = 336724010,
        /** No parameters allowed for this operation */
        GSEC_PARAMS_NOT_ALLOWED = 336724011,
        /** Incompatible switches specified */
        GSEC_INCOMPAT_SWITCH = 336724012,
        /** Invalid user name (maximum 31 bytes */
        GSEC_INV_USERNAME = 336724044,
        /** Warning- maximum 8 significant bytes of */
        GSEC_INV_PW_LENGTH = 336724045,
        /** Database already specified */
        GSEC_DB_SPECIFIED = 336724046,
        /** Database administrator name already specified */
        GSEC_DB_ADMIN_SPECIFIED = 336724047,
        /** Database administrator password already */
        GSEC_DB_ADMIN_PW_SPECIFIED = 336724048,
        /** SQL role name already specified */
        GSEC_SQL_ROLE_SPECIFIED = 336724049,
        /** Found unknown switch */
        GSTAT_UNKNOWN_SWITCH = 336920577,
        /** Please retry, giving a database name */
        GSTAT_RETRY = 336920578,
        /** Wrong ODS version, expected @1, encountered */
        GSTAT_WRONG_ODS = 336920579,
        /** Unexpected end of database file. */
        GSTAT_UNEXPECTED_EOF = 336920580,
        /** Can't open database file @1 */
        GSTAT_OPEN_ERR = 336920605,
        /** Can't read a database page */
        GSTAT_READ_ERR = 336920606,
        /** System memory exhausted */
        GSTAT_SYSMEMEX = 336920607,
        /** Wrong value for access mode */
        FBSVCMGR_BAD_AM = 336986113,
        /** Wrong value for write mode */
        FBSVCMGR_BAD_WM = 336986114,
        /** Wrong value for reserve space */
        FBSVCMGR_BAD_RS = 336986115,
        /** Unknown tag (@1) in info_svr_db_info block */
        FBSVCMGR_INFO_ERR = 336986116,
        /** Unknown tag (@1) in isc_svc_query() results */
        FBSVCMGR_QUERY_ERR = 336986117,
        /** Unknown switch "@1" */
        FBSVCMGR_SWITCH_UNKNOWN = 336986118
    }
}