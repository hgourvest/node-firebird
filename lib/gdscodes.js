/**
 * GDS Error codes
 * Extracted from https://www.firebirdsql.org/pdfrefdocs/Firebird-2.1-ErrorCodes.pdf
 */

const GDSCode = {
    ARITH_EXCEPT                    : 335544321, // Arithmetic exception, numeric overflow, or string
    BAD_DBKEY                       : 335544322, // Invalid database key
    BAD_DB_FORMAT                   : 335544323, // File @1 is not a valid
    BAD_DB_HANDLE                   : 335544324, // Invalid database handle (no active connection)
    BAD_DPB_CONTENT                 : 335544325, // Bad parameters on attach or create
    BAD_DPB_FORM                    : 335544326, // Unrecognized database parameter block
    BAD_REQ_HANDLE                  : 335544327, // Invalid request handle
    BAD_SEGSTR_HANDLE               : 335544328, // Invalid BLOB handle
    BAD_SEGSTR_ID                   : 335544329, // Invalid BLOB ID
    BAD_TPB_CONTENT                 : 335544330, // Invalid parameter in transaction parameter block
    BAD_TPB_FORM                    : 335544331, // Invalid format for transaction parameter block
    BAD_TRANS_HANDLE                : 335544332, // Invalid transaction handle (expecting explicit
    BUG_CHECK                       : 335544333, // Internal gds software consistency check (@1)
    CONVERT_ERROR                   : 335544334, // Conversion error from string "@1"
    DB_CORRUPT                      : 335544335, // Database file appears corrupt (@1)
    DEADLOCK                        : 335544336, // Deadlock
    EXCESS_TRANS                    : 335544337, // Attempt to start more than @1
    FROM_NO_MATCH                   : 335544338, // No match for first value expression
    INFINAP                         : 335544339, // Information type inappropriate for object
    INFONA                          : 335544340, // No information of this type available
    INFUNK                          : 335544341, // Unknown information item
    INTEG_FAIL                      : 335544342, // Action cancelled by trigger (@1) to
    INVALID_BLR                     : 335544343, // Invalid request BLR at offset @1
    IO_ERROR                        : 335544344, // I/O error for file "@2"
    LOCK_CONFLICT                   : 335544345, // Lock conflict on no wait transaction
    METADATA_CORRUPT                : 335544346, // Corrupt system table
    NOT_VALID                       : 335544347, // Validation error for column @1, value
    NO_CUR_REC                      : 335544348, // No current record for fetch operation
    NO_DUP                          : 335544349, // Attempt to store duplicate value (visible
    NO_FINISH                       : 335544350, // Program attempted to exit without finishing
    NO_META_UPDATE                  : 335544351, // Unsuccessful metadata update
    NO_PRIV                         : 335544352, // No permission for @1 access to
    NO_RECON                        : 335544353, // Transaction is not in limbo
    NO_RECORD                       : 335544354, // Invalid database key
    NO_SEGSTR_CLOSE                 : 335544355, // BLOB was not closed
    OBSOLETE_METADATA               : 335544356, // Metadata is obsolete
    OPEN_TRANS                      : 335544357, // Cannot disconnect database with open
    PORT_LEN                        : 335544358, // Message length error (encountered @1, expected
    READ_ONLY_FIELD                 : 335544359, // Attempted update of read-only column
    READ_ONLY_REL                   : 335544360, // Attempted update of read-only table
    READ_ONLY_TRANS                 : 335544361, // Attempted update during read-only transaction
    READ_ONLY_VIEW                  : 335544362, // Cannot update read-only view @1
    REQ_NO_TRANS                    : 335544363, // No transaction for request
    REQ_SYNC                        : 335544364, // Request synchronization error
    REQ_WRONG_DB                    : 335544365, // Request referenced an unavailable database
    SEGMENT                         : 335544366, // Segment buffer length shorter than expected
    SEGSTR_EOF                      : 335544367, // Attempted retrieval of more segments than
    SEGSTR_NO_OP                    : 335544368, // Attempted invalid operation on a BLOB
    SEGSTR_NO_READ                  : 335544369, // Attempted read of a new, open
    SEGSTR_NO_TRANS                 : 335544370, // Attempted action on blob outside transaction
    SEGSTR_NO_WRITE                 : 335544371, // Attempted write to read-only BLOB
    SEGSTR_WRONG_DB                 : 335544372, // Attempted reference to BLOB in unavailable
    SYS_REQUEST                     : 335544373, // Operating system directive @1 failed
    STREAM_EOF                      : 335544374, // Attempt to fetch past the last
    UNAVAILABLE                     : 335544375, // Unavailable database
    UNRES_REL                       : 335544376, // Table @1 was omitted from the
    UNS_EXT                         : 335544377, // Request includes a DSRI extension not
    WISH_LIST                       : 335544378, // Feature is not supported
    WRONG_ODS                       : 335544379, // Unsupported on-disk structure for file @1;
    WRONUMARG                       : 335544380, // Wrong number of arguments on call
    IMP_EXC                         : 335544381, // Implementation limit exceeded
    RANDOM                          : 335544382, // @1
    FATAL_CONFLICT                  : 335544383, // Unrecoverable conflict with limbo transaction @1
    BADBLK                          : 335544384, // Internal error
    INVPOOLCL                       : 335544385, // Internal error
    NOPOOLIDS                       : 335544386, // Too many requests
    RELBADBLK                       : 335544387, // Internal error
    BLKTOOBIG                       : 335544388, // Block size exceeds implementation restriction
    BUFEXH                          : 335544389, // Buffer exhausted
    SYNTAXERR                       : 335544390, // BLR syntax error: expected @1 at
    BUFINUSE                        : 335544391, // Buffer in use
    BDBINCON                        : 335544392, // Internal error
    REQINUSE                        : 335544393, // Request in use
    BADODSVER                       : 335544394, // Incompatible version of on-disk structure
    RELNOTDEF                       : 335544395, // Table @1 is not defined
    FLDNOTDEF                       : 335544396, // Column @1 is not defined in
    DIRTYPAGE                       : 335544397, // Internal error
    WAIFORTRA                       : 335544398, // Internal error
    DOUBLELOC                       : 335544399, // Internal error
    NODNOTFND                       : 335544400, // Internal error
    DUPNODFND                       : 335544401, // Internal error
    LOCNOTMAR                       : 335544402, // Internal error
    BADPAGTYP                       : 335544403, // Page @1 is of wrong type
    CORRUPT                         : 335544404, // Database corrupted
    BADPAGE                         : 335544405, // Checksum error on database page @1
    BADINDEX                        : 335544406, // Index is broken
    DBBNOTZER                       : 335544407, // Database handle not zero
    TRANOTZER                       : 335544408, // Transaction handle not zero
    TRAREQMIS                       : 335544409, // Transaction--request mismatch (synchronization
    BADHNDCNT                       : 335544410, // Bad handle count
    WROTPBVER                       : 335544411, // Wrong version of transaction parameter block
    WROBLRVER                       : 335544412, // Unsupported BLR version (expected @1,
    WRODPBVER                       : 335544413, // Wrong version of database parameter block
    BLOBNOTSUP                      : 335544414, // BLOB and array data types are
    BADRELATION                     : 335544415, // Database corrupted
    NODETACH                        : 335544416, // Internal error
    NOTREMOTE                       : 335544417, // Internal error
    TRAINLIM                        : 335544418, // Transaction in limbo
    NOTINLIM                        : 335544419, // Transaction not in limbo
    TRAOUTSTA                       : 335544420, // Transaction outstanding
    CONNECT_REJECT                  : 335544421, // Connection rejected by remote interface
    DBFILE                          : 335544422, // Internal error
    ORPHAN                          : 335544423, // Internal error
    NO_LOCK_MGR                     : 335544424, // No lock manager available
    CTXINUSE                        : 335544425, // Context already in use (BLR error)
    CTXNOTDEF                       : 335544426, // Context not defined (BLR error)
    DATNOTSUP                       : 335544427, // Data operation not supported
    BADMSGNUM                       : 335544428, // Undefined message number
    BADPARNUM                       : 335544429, // Bad parameter number
    VIRMEMEXH                       : 335544430, // Unable to allocate memory from operating
    BLOCKING_SIGNAL                 : 335544431, // Blocking signal has been received
    LOCKMANERR                      : 335544432, // Lock manager error
    KEYTOOBIG                       : 335544434, // Key size exceeds implementation restriction for
    NULLSEGKEY                      : 335544435, // Null segment of UNIQUE KEY
    SQLERR                          : 335544436, // SQL error code = @1
    WRODYNVER                       : 335544437, // Wrong DYN version
    FUNNOTDEF                       : 335544438, // Function @1 is not defined
    FUNMISMAT                       : 335544439, // Function @1 could not be matched
    BAD_MSG_VEC                     : 335544440, // 
    BAD_DETACH                      : 335544441, // Database detach completed with errors
    NOARGACC_READ                   : 335544442, // Database system cannot read argument @1
    NOARGACC_WRITE                  : 335544443, // Database system cannot write argument @1
    READ_ONLY                       : 335544444, // Operation not supported
    EXT_ERR                         : 335544445, // @1 extension error
    NON_UPDATABLE                   : 335544446, // Not updatable
    NO_ROLLBACK                     : 335544447, // No rollback performed
    BAD_SEC_INFO                    : 335544448, // 
    INVALID_SEC_INFO                : 335544449, // 
    MISC_INTERPRETED                : 335544450, // @1
    UPDATE_CONFLICT                 : 335544451, // Update conflicts with concurrent update
    OBJ_IN_USE                      : 335544453, // Object @1 is in use
    NOFILTER                        : 335544454, // Filter not found to convert type
    SHADOW_ACCESSED                 : 335544455, // Cannot attach active shadow file
    INVALID_SDL                     : 335544456, // Invalid slice description language at offset
    OUT_OF_BOUNDS                   : 335544457, // Subscript out of bounds
    INVALID_DIMENSION               : 335544458, // Column not array or invalid dimensions
    REC_IN_LIMBO                    : 335544459, // Record from transaction @1 is stuck
    SHADOW_MISSING                  : 335544460, // A file in manual shadow @1
    CANT_VALIDATE                   : 335544461, // Secondary server attachments cannot validate
    GENNOTDEF                       : 335544463, // Generator @1 is not defined
    CANT_START_LOGGING              : 335544464, // Secondary server attachments cannot start logging
    BAD_SEGSTR_TYPE                 : 335544465, // Invalid BLOB type for operation
    FOREIGN_KEY                     : 335544466, // Violation of FOREIGN KEY constraint "@1"
    HIGH_MINOR                      : 335544467, // Minor version too high found @1
    TRA_STATE                       : 335544468, // Transaction @1 is @2
    TRANS_INVALID                   : 335544469, // Transaction marked invalid by I/O error
    BUF_INVALID                     : 335544470, // Cache buffer for page @1 invalid
    INDEXNOTDEFINED                 : 335544471, // There is no index in table
    LOGIN                           : 335544472, // Your user name and password are
    INVALID_BOOKMARK                : 335544473, // Invalid bookmark handle
    BAD_LOCK_LEVEL                  : 335544474, // Invalid lock level @1
    RELATION_LOCK                   : 335544475, // Lock on table @1 conflicts with
    RECORD_LOCK                     : 335544476, // Requested record lock conflicts with existing
    MAX_IDX                         : 335544477, // Maximum indexes per table (@1) exceeded
    BAD_STMT_HANDLE                 : 335544485, // Invalid statement handle
    WALW_ERR                        : 335544487, // WAL Writer error
    LOGH_SMALL                      : 335544488, // Log file header of @1 too
    LOGH_INV_VERSION                : 335544489, // Invalid version of log file @1
    LOGH_OPEN_FLAG                  : 335544490, // Log file @1 not latest in
    LOGH_OPEN_FLAG2                 : 335544491, // Log file @1 not closed properly;
    LOGH_DIFF_DBNAME                : 335544492, // Database name in the log file
    LOGF_UNEXPECTED_EOF             : 335544493, // Unexpected end of log file @1
    LOGR_INCOMPLETE                 : 335544494, // Incomplete log record at offset @1
    LOGR_HEADER_SMALL               : 335544495, // Log record header too small at
    LOGB_SMALL                      : 335544496, // Log block too small at offset
    NO_WAL                          : 335544500, // Database does not use Write-ahead Log
    STREAM_NOT_DEFINED              : 335544502, // Reference to invalid stream number
    SHUTINPROG                      : 335544506, // Database @1 shutdown in progress
    RANGE_IN_USE                    : 335544507, // Refresh range number @1 already in
    RANGE_NOT_FOUND                 : 335544508, // Refresh range number @1 not found
    CHARSET_NOT_FOUND               : 335544509, // CHARACTER SET @1 is not defined
    LOCK_TIMEOUT                    : 335544510, // Lock time-out on wait transaction
    PRCNOTDEF                       : 335544511, // Procedure @1 is not defined
    PRCMISMAT                       : 335544512, // Input parameter mismatch for procedure @1
    CODNOTDEF                       : 335544515, // Status code @1 unknown
    XCPNOTDEF                       : 335544516, // Exception @1 not defined
    EXCEPT                          : 335544517, // Exception @1
    CACHE_RESTART                   : 335544518, // Restart shared cache manager
    BAD_LOCK_HANDLE                 : 335544519, // Invalid lock handle
    SHUTDOWN                        : 335544528, // Database @1 shutdown
    EXISTING_PRIV_MOD               : 335544529, // Cannot modify an existing user privilege
    PRIMARY_KEY_REF                 : 335544530, // Cannot delete PRIMARY KEY being used
    PRIMARY_KEY_NOTNULL             : 335544531, // Column used in a PRIMARY constraint
    REF_CNSTRNT_NOTFOUND            : 335544532, // Name of Referential Constraint not defined
    FOREIGN_KEY_NOTFOUND            : 335544533, // Non-existent PRIMARY or UNIQUE KEY
    REF_CNSTRNT_UPDATE              : 335544534, // Cannot update constraints
    CHECK_CNSTRNT_UPDATE            : 335544535, // Cannot update constraints
    CHECK_CNSTRNT_DEL               : 335544536, // Cannot delete CHECK constraint entry
    INTEG_INDEX_SEG_DEL             : 335544537, // Cannot delete index segment used by
    INTEG_INDEX_SEG_MOD             : 335544538, // Cannot update index segment used by
    INTEG_INDEX_DEL                 : 335544539, // Cannot delete index used by an
    INTEG_INDEX_MOD                 : 335544540, // Cannot modify index used by an
    CHECK_TRIG_DEL                  : 335544541, // Cannot delete trigger used by a
    CHECK_TRIG_UPDATE               : 335544542, // Cannot update trigger used by a
    CNSTRNT_FLD_DEL                 : 335544543, // Cannot delete column being used in
    CNSTRNT_FLD_RENAME              : 335544544, // Cannot rename column being used in
    REL_CNSTRNT_UPDATE              : 335544545, // Cannot update constraints
    CONSTAINT_ON_VIEW               : 335544546, // Cannot define constraints on views
    INVLD_CNSTRNT_TYPE              : 335544547, // Internal gds software consistency check (invalid
    PRIMARY_KEY_EXISTS              : 335544548, // Attempt to define a second PRIMARY
    SYSTRIG_UPDATE                  : 335544549, // Cannot modify or erase a system
    NOT_REL_OWNER                   : 335544550, // Only the owner of a table
    GRANT_OBJ_NOTFOUND              : 335544551, // Could not find table/procedure for GRANT
    GRANT_FLD_NOTFOUND              : 335544552, // Could not find column for GRANT
    GRANT_NOPRIV                    : 335544553, // User does not have GRANT privileges
    NONSQL_SECURITY_REL             : 335544554, // Table/procedure has non-SQL security class
    NONSQL_SECURITY_FLD             : 335544555, // Column has non-SQL security class defined
    SHUTFAIL                        : 335544557, // Database shutdown unsuccessful
    CHECK_CONSTRAINT                : 335544558, // Operation violates CHECK constraint @1 on
    BAD_SVC_HANDLE                  : 335544559, // Invalid service handle
    SHUTWARN                        : 335544560, // Database @1 shutdown in @2 seconds
    WROSPBVER                       : 335544561, // Wrong version of service parameter block
    BAD_SPB_FORM                    : 335544562, // Unrecognized service parameter block
    SVCNOTDEF                       : 335544563, // Service @1 is not defined
    TRANSLITERATION_FAILED          : 335544565, // Cannot transliterate character between character
    START_CM_FOR_WAL                : 335544566, // WAL defined; Cache Manager must be
    TEXT_SUBTYPE                    : 335544568, // Implementation of text subtype @1 not
    DSQL_ERROR                      : 335544569, // Dynamic SQL Error
    DSQL_COMMAND_ERR                : 335544570, // Invalid command
    DSQL_CONSTANT_ERR               : 335544571, // Data type for constant unknown
    DSQL_CURSOR_ERR                 : 335544572, // Invalid cursor reference
    DSQL_DATATYPE_ERR               : 335544573, // Data type unknown
    DSQL_DECL_ERR                   : 335544574, // Invalid cursor declaration
    DSQL_CURSOR_UPDATE_ERR          : 335544575, // Cursor @1 is not updatable
    DSQL_CURSOR_OPEN_ERR            : 335544576, // Attempt to reopen an open cursor
    DSQL_CURSOR_CLOSE_ERR           : 335544577, // Attempt to reclose a closed cursor
    DSQL_FIELD_ERR                  : 335544578, // Column unknown
    DSQL_INTERNAL_ERR               : 335544579, // Internal error
    DSQL_RELATION_ERR               : 335544580, // Table unknown
    DSQL_PROCEDURE_ERR              : 335544581, // Procedure unknown
    DSQL_REQUEST_ERR                : 335544582, // Request unknown
    DSQL_SQLDA_ERR                  : 335544583, // SQLDA missing or incorrect version, or
    DSQL_VAR_COUNT_ERR              : 335544584, // Count of read-write columns does not
    DSQL_STMT_HANDLE                : 335544585, // Invalid statement handle
    DSQL_FUNCTION_ERR               : 335544586, // Function unknown
    DSQL_BLOB_ERR                   : 335544587, // Column is not a BLOB
    COLLATION_NOT_FOUND             : 335544588, // COLLATION @1 for CHARACTER SET @2
    COLLATION_NOT_FOR_CHARSET       : 335544589, // COLLATION @1 is not valid for
    DSQL_DUP_OPTION                 : 335544590, // Option specified more than once
    DSQL_TRAN_ERR                   : 335544591, // Unknown transaction option
    DSQL_INVALID_ARRAY              : 335544592, // Invalid array reference
    DSQL_MAX_ARR_DIM_EXCEEDED       : 335544593, // Array declared with too many dimensions
    DSQL_ARR_RANGE_ERROR            : 335544594, // Illegal array dimension range
    DSQL_TRIGGER_ERR                : 335544595, // Trigger unknown
    DSQL_SUBSELECT_ERR              : 335544596, // Subselect illegal in this context
    DSQL_CRDB_PREPARE_ERR           : 335544597, // Cannot prepare a CREATE
    SPECIFY_FIELD_ERR               : 335544598, // Must specify column name for view
    NUM_FIELD_ERR                   : 335544599, // Number of columns does not match
    COL_NAME_ERR                    : 335544600, // Only simple column names permitted for
    WHERE_ERR                       : 335544601, // No WHERE clause for VIEW WITH
    TABLE_VIEW_ERR                  : 335544602, // Only one table allowed for VIEW
    DISTINCT_ERR                    : 335544603, // DISTINCT, GROUP or HAVING not permitted
    KEY_FIELD_COUNT_ERR             : 335544604, // FOREIGN KEY column count does not
    SUBQUERY_ERR                    : 335544605, // No subqueries permitted for VIEW WITH
    EXPRESSION_EVAL_ERR             : 335544606, // Expression evaluation not supported
    NODE_ERR                        : 335544607, // Gen.c: node not supported
    COMMAND_END_ERR                 : 335544608, // Unexpected end of command
    INDEX_NAME                      : 335544609, // INDEX @1
    EXCEPTION_NAME                  : 335544610, // EXCEPTION @1
    FIELD_NAME                      : 335544611, // COLUMN @1
    TOKEN_ERR                       : 335544612, // Token unknown
    UNION_ERR                       : 335544613, // Union not supported
    DSQL_CONSTRUCT_ERR              : 335544614, // Unsupported DSQL construct
    FIELD_AGGREGATE_ERR             : 335544615, // Column used with aggregate
    FIELD_REF_ERR                   : 335544616, // Invalid column reference
    ORDER_BY_ERR                    : 335544617, // Invalid ORDER BY clause
    RETURN_MODE_ERR                 : 335544618, // Return mode by value not allowed
    EXTERN_FUNC_ERR                 : 335544619, // External functions cannot have more than
    ALIAS_CONFLICT_ERR              : 335544620, // Alias @1 conflicts with an alias
    PROCEDURE_CONFLICT_ERROR        : 335544621, // Alias @1 conflicts with a procedure
    RELATION_CONFLICT_ERR           : 335544622, // Alias @1 conflicts with a table
    DSQL_DOMAIN_ERR                 : 335544623, // Illegal use of keyword VALUE
    IDX_SEG_ERR                     : 335544624, // Segment count of 0 defined for
    NODE_NAME_ERR                   : 335544625, // A node name is not permitted
    TABLE_NAME                      : 335544626, // TABLE @1
    PROC_NAME                       : 335544627, // PROCEDURE @1
    IDX_CREATE_ERR                  : 335544628, // Cannot create index @1
    DEPENDENCY                      : 335544630, // There are @1 dependencies
    IDX_KEY_ERR                     : 335544631, // Too many keys defined for index
    DSQL_FILE_LENGTH_ERR            : 335544632, // Preceding file did not specify length,
    DSQL_SHADOW_NUMBER_ERR          : 335544633, // Shadow number must be a positive
    DSQL_TOKEN_UNK_ERR              : 335544634, // Token unknown- line @1, column @2
    DSQL_NO_RELATION_ALIAS          : 335544635, // There is no alias or table
    INDEXNAME                       : 335544636, // There is no index @1 for
    NO_STREAM_PLAN                  : 335544637, // Table @1 is not referenced in
    STREAM_TWICE                    : 335544638, // Table @1 is referenced more than
    STREAM_NOT_FOUND                : 335544639, // Table @1 is referenced in the
    COLLATION_REQUIRES_TEXT         : 335544640, // Invalid use of CHARACTER SET or
    DSQL_DOMAIN_NOT_FOUND           : 335544641, // Specified domain or source column @1
    INDEX_UNUSED                    : 335544642, // Index @1 cannot be used in
    DSQL_SELF_JOIN                  : 335544643, // The table @1 is referenced twice;
    STREAM_BOF                      : 335544644, // Illegal operation when at beginning of
    STREAM_CRACK                    : 335544645, // The current position is on a
    DB_OR_FILE_EXISTS               : 335544646, // Database or file exists
    INVALID_OPERATOR                : 335544647, // Invalid comparison operator for find operation
    CONN_LOST                       : 335544648, // Connection lost to pipe server
    BAD_CHECKSUM                    : 335544649, // Bad checksum
    PAGE_TYPE_ERR                   : 335544650, // Wrong page type
    EXT_READONLY_ERR                : 335544651, // Cannot insert because the file is
    SING_SELECT_ERR                 : 335544652, // Multiple rows in singleton select
    PSW_ATTACH                      : 335544653, // Cannot attach to password database
    PSW_START_TRANS                 : 335544654, // Cannot start transaction for password database
    INVALID_DIRECTION               : 335544655, // Invalid direction for find operation
    DSQL_VAR_CONFLICT               : 335544656, // Variable @1 conflicts with parameter in
    DSQL_NO_BLOB_ARRAY              : 335544657, // Array/BLOB/DATE data types not allowed in
    DSQL_BASE_TABLE                 : 335544658, // @1 is not a valid base
    DUPLICATE_BASE_TABLE            : 335544659, // Table @1 is referenced twice in
    VIEW_ALIAS                      : 335544660, // View @1 has more than one
    INDEX_ROOT_PAGE_FULL            : 335544661, // Cannot add index, index root page
    DSQL_BLOB_TYPE_UNKNOWN          : 335544662, // BLOB SUB_TYPE @1 is not defined
    REQ_MAX_CLONES_EXCEEDED         : 335544663, // Too many concurrent executions of the
    DSQL_DUPLICATE_SPEC             : 335544664, // Duplicate specification of @1- not supported
    UNIQUE_KEY_VIOLATION            : 335544665, // Violation of PRIMARY or UNIQUE KEY
    SRVR_VERSION_TOO_OLD            : 335544666, // Server version too old to support
    DRDB_COMPLETED_WITH_ERRS        : 335544667, // Drop database completed with errors
    DSQL_PROCEDURE_USE_ERR          : 335544668, // Procedure @1 does not return any
    DSQL_COUNT_MISMATCH             : 335544669, // Count of column list and variable
    BLOB_IDX_ERR                    : 335544670, // Attempt to index BLOB column in
    ARRAY_IDX_ERR                   : 335544671, // Attempt to index array column in
    KEY_FIELD_ERR                   : 335544672, // Too few key columns found for
    NO_DELETE                       : 335544673, // Cannot delete
    DEL_LAST_FIELD                  : 335544674, // Last column in a table cannot
    SORT_ERR                        : 335544675, // Sort error
    SORT_MEM_ERR                    : 335544676, // Sort error: not enough memory
    VERSION_ERR                     : 335544677, // Too many versions
    INVAL_KEY_POSN                  : 335544678, // Invalid key position
    NO_SEGMENTS_ERR                 : 335544679, // Segments not allowed in expression index
    CRRP_DATA_ERR                   : 335544680, // Sort error: corruption in data structure
    REC_SIZE_ERR                    : 335544681, // New record size of @1 bytes
    DSQL_FIELD_REF                  : 335544682, // Inappropriate self-reference of column
    REQ_DEPTH_EXCEEDED              : 335544683, // Request depth exceeded. (Recursive definition?)
    NO_FIELD_ACCESS                 : 335544684, // Cannot access column @1 in view
    NO_DBKEY                        : 335544685, // Dbkey not available for multi-table views
    DSQL_OPEN_CURSOR_REQUEST        : 335544688, // The prepare statement identifies a prepare
    IB_ERROR                        : 335544689, // Firebird error
    CACHE_REDEF                     : 335544690, // Cache redefined
    CACHE_TOO_SMALL                 : 335544691, // Insufficient memory to allocate page buffer
    LOG_REDEF                       : 335544692, // Log redefined
    LOG_TOO_SMALL                   : 335544693, // Log size too small
    PARTITION_TOO_SMALL             : 335544694, // Log partition size too small
    PARTITION_NOT_SUPP              : 335544695, // Partitions not supported in series of
    LOG_LENGTH_SPEC                 : 335544696, // Total length of a partitioned log
    PRECISION_ERR                   : 335544697, // Precision must be from 1 to
    SCALE_NOGT                      : 335544698, // Scale must be between zero and
    EXPEC_SHORT                     : 335544699, // Short integer expected
    EXPEC_LONG                      : 335544700, // Long integer expected
    EXPEC_USHORT                    : 335544701, // Unsigned short integer expected
    LIKE_ESCAPE_INVALID             : 335544702, // Invalid ESCAPE sequence
    SVCNOEXE                        : 335544703, // Service @1 does not have an
    NET_LOOKUP_ERR                  : 335544704, // Failed to locate host machine.
    SERVICE_UNKNOWN                 : 335544705, // Undefined service @1/@2.
    HOST_UNKNOWN                    : 335544706, // The specified name was not found
    GRANT_NOPRIV_ON_BASE            : 335544707, // User does not have GRANT privileges
    DYN_FLD_AMBIGUOUS               : 335544708, // Ambiguous column reference.
    DSQL_AGG_REF_ERR                : 335544709, // Invalid aggregate reference
    COMPLEX_VIEW                    : 335544710, // Navigational stream @1 references a view
    UNPREPARED_STMT                 : 335544711, // Attempt to execute an unprepared dynamic
    EXPEC_POSITIVE                  : 335544712, // Positive value expected
    DSQL_SQLDA_VALUE_ERR            : 335544713, // Incorrect values within SQLDA structure
    INVALID_ARRAY_ID                : 335544714, // Invalid blob id
    EXTFILE_UNS_OP                  : 335544715, // Operation not supported for EXTERNAL FILE
    SVC_IN_USE                      : 335544716, // Service is currently busy: @1
    ERR_STACK_LIMIT                 : 335544717, // Stack size insufficent to execute current
    INVALID_KEY                     : 335544718, // Invalid key for find operation
    NETWORK_ERROR                   : 335544721, // Unable to complete network request to
    NET_CONNECT_ERR                 : 335544722, // Failed to establish a connection.
    NET_CONNECT_LISTEN_ERR          : 335544723, // Error while listening for an incoming
    NET_EVENT_CONNECT_ERR           : 335544724, // Failed to establish a secondary connection
    NET_EVENT_LISTEN_ERR            : 335544725, // Error while listening for an incoming
    NET_READ_ERR                    : 335544726, // Error reading data from the connection.
    NET_WRITE_ERR                   : 335544727, // Error writing data to the connection.
    INTEG_INDEX_DEACTIVATE          : 335544728, // Cannot deactivate index used by an
    INTEG_DEACTIVATE_PRIMARY        : 335544729, // Cannot deactivate index used by a
    CSE_NOT_SUPPORTED               : 335544730, // Client/Server Express not supported in this
    TRA_MUST_SWEEP                  : 335544731, // 
    UNSUPPORTED_NETWORK_DRIVE       : 335544732, // Access to databases on file servers
    IO_CREATE_ERR                   : 335544733, // Error while trying to create file
    IO_OPEN_ERR                     : 335544734, // Error while trying to open file
    IO_CLOSE_ERR                    : 335544735, // Error while trying to close file
    IO_READ_ERR                     : 335544736, // Error while trying to read from
    IO_WRITE_ERR                    : 335544737, // Error while trying to write to
    IO_DELETE_ERR                   : 335544738, // Error while trying to delete file
    IO_ACCESS_ERR                   : 335544739, // Error while trying to access file
    UDF_EXCEPTION                   : 335544740, // A fatal exception occurred during the
    LOST_DB_CONNECTION              : 335544741, // Connection lost to database
    NO_WRITE_USER_PRIV              : 335544742, // User cannot write to RDB$USER_PRIVILEGES
    TOKEN_TOO_LONG                  : 335544743, // Token size exceeds limit
    MAX_ATT_EXCEEDED                : 335544744, // Maximum user count exceeded.Contact your
    LOGIN_SAME_AS_ROLE_NAME         : 335544745, // Your login @1 is same as
    REFTABLE_REQUIRES_PK            : 335544746, // "REFERENCES table" without "(column)"
    USRNAME_TOO_LONG                : 335544747, // The username entered is too long.Maximum
    PASSWORD_TOO_LONG               : 335544748, // The password specified is too long.Maximum
    USRNAME_REQUIRED                : 335544749, // A username is required for this
    PASSWORD_REQUIRED               : 335544750, // A password is required for this
    BAD_PROTOCOL                    : 335544751, // The network protocol specified is invalid
    DUP_USRNAME_FOUND               : 335544752, // A duplicate user name was found
    USRNAME_NOT_FOUND               : 335544753, // The user name specified was not
    ERROR_ADDING_SEC_RECORD         : 335544754, // An error occurred while attempting to
    ERROR_MODIFYING_SEC_RECORD      : 335544755, // An error occurred while attempting to
    ERROR_DELETING_SEC_RECORD       : 335544756, // An error occurred while attempting to
    ERROR_UPDATING_SEC_DB           : 335544757, // An error occurred while updating the
    SORT_REC_SIZE_ERR               : 335544758, // Sort record size of @1 bytes
    BAD_DEFAULT_VALUE               : 335544759, // Can not define a not null
    INVALID_CLAUSE                  : 335544760, // Invalid clause--- '@1'
    TOO_MANY_HANDLES                : 335544761, // Too many open handles to database
    INVALID_STRING_CONSTANT         : 335544763, // A string constant is delimited by
    TRANSITIONAL_DATE               : 335544764, // DATE must be changed to TIMESTAMP
    READ_ONLY_DATABASE              : 335544765, // Attempted update on read-only database
    MUST_BE_DIALECT_2_AND_UP        : 335544766, // SQL dialect @1 is not supported
    BLOB_FILTER_EXCEPTION           : 335544767, // A fatal exception occurred during the
    EXCEPTION_ACCESS_VIOLATION      : 335544768, // Access violation.The code attempted to access
    EXCEPTION_DATATYPE_MISSALIGNMENT: 335544769, // Datatype misalignment.The attempted to read or
    EXCEPTION_ARRAY_BOUNDS_EXCEEDED : 335544770, // Array bounds exceeded.The code attempted to
    EXCEPTION_FLOAT_DENORMAL_OPERAN : 335544771, // 
    EXCEPTION_FLOAT_DIVIDE_BY_ZERO  : 335544772, // Floating-point divide by zero.The code attempted
    EXCEPTION_FLOAT_INEXACT_RESULT  : 335544773, // Floating-point inexact result.The result of a
    EXCEPTION_FLOAT_INVALID_OPERAND : 335544774, // Floating-point invalid operand.An indeterminant
    EXCEPTION_FLOAT_OVERFLOW        : 335544775, // Floating-point overflow.The exponent of a
    EXCEPTION_FLOAT_STACK_CHECK     : 335544776, // Floating-point stack check.The stack overflowed
    EXCEPTION_FLOAT_UNDERFLOW       : 335544777, // Floating-point underflow.The exponent of a
    EXCEPTION_INTEGER_DIVIDE_BY_ZERO: 335544778, // Integer divide by zero.The code attempted
    EXCEPTION_INTEGER_OVERFLOW      : 335544779, // Integer overflow.The result of an integer
    EXCEPTION_UNKNOWN               : 335544780, // An exception occurred that does not
    EXCEPTION_STACK_OVERFLOW        : 335544781, // Stack overflow.The resource requirements of the
    EXCEPTION_SIGSEGV               : 335544782, // Segmentation Fault. The code attempted to
    EXCEPTION_SIGILL                : 335544783, // Illegal Instruction. The Code attempted to
    EXCEPTION_SIGBUS                : 335544784, // Bus Error. The Code caused a
    EXCEPTION_SIGFPE                : 335544785, // Floating Point Error. The Code caused
    EXT_FILE_DELETE                 : 335544786, // Cannot delete rows from external files.
    EXT_FILE_MODIFY                 : 335544787, // Cannot update rows in external files.
    ADM_TASK_DENIED                 : 335544788, // Unable to perform operation.You must be
    EXTRACT_INPUT_MISMATCH          : 335544789, // Specified EXTRACT part does not exist
    INSUFFICIENT_SVC_PRIVILEGES     : 335544790, // Service @1 requires SYSDBA
    FILE_IN_USE                     : 335544791, // The file @1 is currently in
    SERVICE_ATT_ERR                 : 335544792, // Cannot attach to services manager
    DDL_NOT_ALLOWED_BY_DB_SQL_DIAL  : 335544793, // Metadata update statement is not allowed
    CANCELLED                       : 335544794, // Operation was cancelled
    UNEXP_SPB_FORM                  : 335544795, // Unexpected item in service parameter block,
    SQL_DIALECT_DATATYPE_UNSUPPORT  : 335544796, // Client SQL dialect @1 does not
    SVCNOUSER                       : 335544797, // User name and password are required
    DEPEND_ON_UNCOMMITTED_REL       : 335544798, // You created an indirect dependency on
    SVC_NAME_MISSING                : 335544799, // The service name was not specified.
    TOO_MANY_CONTEXTS               : 335544800, // Too many Contexts of Relation/Procedure/Views.
    DATYPE_NOTSUP                   : 335544801, // Data type not supported for arithmetic
    DIALECT_NOT_CHANGED             : 335544803, // Database dialect not changed.
    DATABASE_CREATE_FAILED          : 335544804, // Unable to create database @1
    INV_DIALECT_SPECIFIED           : 335544805, // Database dialect @1 is not a
    VALID_DB_DIALECTS               : 335544806, // Valid database dialects are @1.
    EXTERN_FUNC_DIR_ERROR           : 335544809, // Function @1 is in @2, which
    DATE_RANGE_EXCEEDED             : 335544810, // Value exceeds the range for valid
    INV_CLIENT_DIALECT_SPECIFIED    : 335544811, // Passed client dialect @1 is not
    VALID_CLIENT_DIALECTS           : 335544812, // Valid client dialects are @1.
    OPTIMIZER_BETWEEN_ERR           : 335544813, // Unsupported field type specified in BETWEEN
    SERVICE_NOT_SUPPORTED           : 335544814, // Services functionality will be supported in
    GENERATOR_NAME                  : 335544815, // GENERATOR @1
    UDF_NAME                        : 335544816, // UDF @1
    BAD_LIMIT_PARAM                 : 335544817, // Invalid parameter to FIRST.Only integers >=
    BAD_SKIP_PARAM                  : 335544818, // Invalid parameter to SKIP.Only integers >=
    IO_32BIT_EXCEEDED_ERR           : 335544819, // File exceeded maximum size of 2GB.Add
    INVALID_SAVEPOINT               : 335544820, // Unable to find savepoint with name
    DSQL_COLUMN_POS_ERR             : 335544821, // Invalid column position used in the
    DSQL_AGG_WHERE_ERR              : 335544822, // Cannot use an aggregate function in
    DSQL_AGG_GROUP_ERR              : 335544823, // Cannot use an aggregate function in
    DSQL_AGG_COLUMN_ERR             : 335544824, // Invalid expression in the @1 (not
    DSQL_AGG_HAVING_ERR             : 335544825, // Invalid expression in the @1 (neither
    DSQL_AGG_NESTED_ERR             : 335544826, // Nested aggregate functions are not allowed
    EXEC_SQL_INVALID_ARG            : 335544827, // Invalid argument in EXECUTE STATEMENTcannot conver
    EXEC_SQL_INVALID_REQ            : 335544828, // Wrong request type in EXECUTE STATEMENT
    EXEC_SQL_INVALID_VAR            : 335544829, // Variable type (position @1) in EXECUTE
    EXEC_SQL_MAX_CALL_EXCEEDED      : 335544830, // Too many recursion levels of EXECUTE
    CONF_ACCESS_DENIED              : 335544831, // Access to @1 "@2" is denied
    WRONG_BACKUP_STATE              : 335544832, // Cannot change difference file name while
    CURSOR_NOT_OPEN                 : 335544834, // Cursor is not open
    BAD_SHUTDOWN_MODE               : 335544835, // Target shutdown mode is invalid for
    CONCAT_OVERFLOW                 : 335544836, // Concatenation overflow. Resulting string cannot
    BAD_SUBSTRING_OFFSET            : 335544837, // Invalid offset parameter @1 to SUBSTRING.
    FOREIGN_KEY_TARGET_DOESNT_EXIST : 335544838, // Foreign key reference target does not
    FOREIGN_KEY_REFERENCES_PRESENT  : 335544839, // Foreign key references are present for
    NO_UPDATE                       : 335544840, // Cannot update
    CURSOR_ALREADY_OPEN             : 335544841, // Cursor is already open
    STACK_TRACE                     : 335544842, // @1
    CTX_VAR_NOT_FOUND               : 335544843, // Context variable @1 is not found
    CTX_NAMESPACE_INVALID           : 335544844, // Invalid namespace name @1 passed to
    CTX_TOO_BIG                     : 335544845, // Too many context variables
    CTX_BAD_ARGUMENT                : 335544846, // Invalid argument passed to @1
    IDENTIFIER_TOO_LONG             : 335544847, // BLR syntax error. Identifier @1... is
    EXCEPT2                         : 335544848, // Exception @1
    MALFORMED_STRING                : 335544849, // Malformed string
    PRC_OUT_PARAM_MISMATCH          : 335544850, // Output parameter mismatch for procedure @1
    COMMAND_END_ERR2                : 335544851, // Unexpected end of command- line @1,
    PARTNER_IDX_INCOMPAT_TYPE       : 335544852, // Partner index segment no @1 has
    BAD_SUBSTRING_LENGTH            : 335544853, // Invalid length parameter @1 to SUBSTRING.
    CHARSET_NOT_INSTALLED           : 335544854, // CHARACTER SET @1 is not installed
    COLLATION_NOT_INSTALLED         : 335544855, // COLLATION @1 for CHARACTER SET @2
    ATT_SHUTDOWN                    : 335544856, // Connection shutdown
    BLOBTOOBIG                      : 335544857, // Maximum BLOB size exceeded
    MUST_HAVE_PHYS_FIELD            : 335544858, // Can't have relation with only computed
    INVALID_TIME_PRECISION          : 335544859, // Time precision exceeds allowed range (0-@1)
    BLOB_CONVERT_ERROR              : 335544860, // Unsupported conversion to target type BLOB
    ARRAY_CONVERT_ERROR             : 335544861, // Unsupported conversion to target type ARRAY
    RECORD_LOCK_NOT_SUPP            : 335544862, // Stream does not support record locking
    PARTNER_IDX_NOT_FOUND           : 335544863, // Cannot create foreign key constraint @1.
    TRA_NUM_EXC                     : 335544864, // Transactions count exceeded. Perform backup and
    FIELD_DISAPPEARED               : 335544865, // Column has been unexpectedly deleted
    MET_WRONG_GTT_SCOPE             : 335544866, // @1 cannot depend on @2
    SUBTYPE_FOR_INTERNAL_USE        : 335544867, // Blob sub_types bigger than 1 (text)
    ILLEGAL_PRC_TYPE                : 335544868, // Procedure @1 is not selectable (it
    INVALID_SORT_DATATYPE           : 335544869, // Datatype @1 is not supported for
    COLLATION_NAME                  : 335544870, // COLLATION @1
    DOMAIN_NAME                     : 335544871, // DOMAIN @1
    DOMNOTDEF                       : 335544872, // Domain @1 is not defined
    ARRAY_MAX_DIMENSIONS            : 335544873, // Array data type can use up
    MAX_DB_PER_TRANS_ALLOWED        : 335544874, // A multi database transaction cannot span
    BAD_DEBUG_FORMAT                : 335544875, // Bad debug info format
    BAD_PROC_BLR                    : 335544876, // Error while parsing procedure @1's BLR
    KEY_TOO_BIG                     : 335544877, // Index key too big
    CONCURRENT_TRANSACTION          : 335544878, // Concurrent transaction number is @1
    NOT_VALID_FOR_VAR               : 335544879, // Validation error for variable @1, value
    NOT_VALID_FOR                   : 335544880, // Validation error for @1, value "@2"
    NEED_DIFFERENCE                 : 335544881, // Difference file name should be set
    LONG_LOGIN                      : 335544882, // Login name too long (@1 characters,
    FLDNOTDEF2                      : 335544883, // Column @1 is not defined in
    GFIX_DB_NAME                    : 335740929, // Data base file name (@1) already
    GFIX_INVALID_SW                 : 335740930, // Invalid switch @1
    GFIX_INCMP_SW                   : 335740932, // Incompatible switch combination
    GFIX_REPLAY_REQ                 : 335740933, // Replay log pathname required
    GFIX_PGBUF_REQ                  : 335740934, // Number of page buffers for cache
    GFIX_VAL_REQ                    : 335740935, // Numeric value required
    GFIX_PVAL_REQ                   : 335740936, // Positive numeric value required
    GFIX_TRN_REQ                    : 335740937, // Number of transactions per sweep required
    GFIX_FULL_REQ                   : 335740940, // "full" or "reserve" required
    GFIX_USRNAME_REQ                : 335740941, // User name required
    GFIX_PASS_REQ                   : 335740942, // Password required
    GFIX_SUBS_NAME                  : 335740943, // Subsystem name
    GFIX_SEC_REQ                    : 335740945, // Number of seconds required
    GFIX_NVAL_REQ                   : 335740946, // Numeric value between 0 and 32767
    GFIX_TYPE_SHUT                  : 335740947, // Must specify type of shutdown
    GFIX_RETRY                      : 335740948, // Please retry, specifying an option
    GFIX_RETRY_DB                   : 335740951, // Please retry, giving a database name
    GFIX_EXCEED_MAX                 : 335740991, // Internal block exceeds maximum size
    GFIX_CORRUPT_POOL               : 335740992, // Corrupt pool
    GFIX_MEM_EXHAUSTED              : 335740993, // Virtual memory exhausted
    GFIX_BAD_POOL                   : 335740994, // Bad pool id
    GFIX_TRN_NOT_VALID              : 335740995, // Transaction state @1 not in valid
    GFIX_UNEXP_EOI                  : 335741012, // Unexpected end of input
    GFIX_RECON_FAIL                 : 335741018, // Failed to reconnect to a transaction
    GFIX_TRN_UNKNOWN                : 335741036, // Transaction description item unknown
    GFIX_MODE_REQ                   : 335741038, // "read_only" or "read_write" required
    GFIX_OPT_SQL_DIALECT            : 335741039, // -sql_dialect set database dialect n
    GFIX_PZVAL_REQ                  : 335741042, // Positive or zero numeric value required
    DSQL_DBKEY_FROM_NON_TABLE       : 336003074, // Cannot SELECT RDB$DB_KEY from a stored
    DSQL_TRANSITIONAL_NUMERIC       : 336003075, // Precision 10 to 18 changed from
    SQL_DB_DIALECT_DTYPE_UNSUPPORT  : 336003077, // Database SQL dialect @1 does not
    ISC_SQL_DIALECT_CONFLICT_NUM    : 336003079, // DB dialect @1 and client dialect
    DSQL_AMBIGUOUS_FIELD_NAME       : 336003085, // Ambiguous field name between @1 and
    DSQL_UDF_RETURN_POS_ERR         : 336003086, // External function should have return position
    DSQL_INVALID_LABEL              : 336003087, // Label @1 @2 in the current
    DSQL_DATATYPES_NOT_COMPARABLE   : 336003088, // Datatypes @1are not comparable in expression
    DSQL_CURSOR_INVALID             : 336003089, // Empty cursor name is not allowed
    DSQL_CURSOR_REDEFINED           : 336003090, // Statement already has a cursor @1
    DSQL_CURSOR_NOT_FOUND           : 336003091, // Cursor @1 is not found in
    DSQL_CURSOR_EXISTS              : 336003092, // Cursor @1 already exists in the
    DSQL_CURSOR_REL_AMBIGUOUS       : 336003093, // Relation @1 is ambiguous in cursor
    DSQL_CURSOR_REL_NOT_FOUND       : 336003094, // Relation @1 is not found in
    DSQL_CURSOR_NOT_OPEN            : 336003095, // Cursor is not open
    DSQL_TYPE_NOT_SUPP_EXT_TAB      : 336003096, // Data type @1 is not supported
    DSQL_FEATURE_NOT_SUPPORTED_ODS  : 336003097, // Feature not supported on ODS version
    PRIMARY_KEY_REQUIRED            : 336003098, // Primary key required on table @1
    UPD_INS_DOESNT_MATCH_PK         : 336003099, // UPDATE OR INSERT field list does
    UPD_INS_DOESNT_MATCH_MATCHING   : 336003100, // UPDATE OR INSERT field list does
    UPD_INS_WITH_COMPLEX_VIEW       : 336003101, // UPDATE OR INSERT without MATCHING
    DSQL_INCOMPATIBLE_TRIGGER_TYPE  : 336003102, // Incompatible trigger type
    DSQL_DB_TRIGGER_TYPE_CANT_CHANGE: 336003103, // Database trigger type can't be changed
    DYN_ROLE_DOES_NOT_EXIST         : 336068796, // SQL role @1 does not exist
    DYN_NO_GRANT_ADMIN_OPT          : 336068797, // User @1 has no grant admin
    DYN_USER_NOT_ROLE_MEMBER        : 336068798, // User @1 is not a member
    DYN_DELETE_ROLE_FAILED          : 336068799, // @1 is not the owner of
    DYN_GRANT_ROLE_TO_USER          : 336068800, // @1 is a SQL role and
    DYN_INV_SQL_ROLE_NAME           : 336068801, // User name @1 could not be
    DYN_DUP_SQL_ROLE                : 336068802, // SQL role @1 already exists
    DYN_KYWD_SPEC_FOR_ROLE          : 336068803, // Keyword @1 can not be used
    DYN_ROLES_NOT_SUPPORTED         : 336068804, // SQL roles are not supported in
    DYN_DOMAIN_NAME_EXISTS          : 336068812, // Cannot rename domain @1 to @2.A
    DYN_FIELD_NAME_EXISTS           : 336068813, // Cannot rename column @1 to @2.A
    DYN_DEPENDENCY_EXISTS           : 336068814, // Column @1 from table @2 is
    DYN_DTYPE_INVALID               : 336068815, // Cannot change datatype for column @1.Changing
    DYN_CHAR_FLD_TOO_SMALL          : 336068816, // New size specified for column @1
    DYN_INVALID_DTYPE_CONVERSION    : 336068817, // Cannot change datatype for @1.Conversion from
    DYN_DTYPE_CONV_INVALID          : 336068818, // Cannot change datatype for column @1
    DYN_ZERO_LEN_ID                 : 336068820, // Zero length identifiers are not allowed
    MAX_COLL_PER_CHARSET            : 336068829, // Maximum number of collations per character
    INVALID_COLL_ATTR               : 336068830, // Invalid collation attributes
    DYN_WRONG_GTT_SCOPE             : 336068840, // @1 cannot reference @2
    DYN_SCALE_TOO_BIG               : 336068852, // New scale specified for column @1
    DYN_PRECISION_TOO_SMALL         : 336068853, // New precision specified for column @1
    DYN_ODS_NOT_SUPP_FEATURE        : 336068856, // Feature '@1' is not supported in
    GBAK_UNKNOWN_SWITCH             : 336330753, // Found unknown switch
    GBAK_PAGE_SIZE_MISSING          : 336330754, // Page size parameter missing
    GBAK_PAGE_SIZE_TOOBIG           : 336330755, // Page size specified (@1) greater than
    GBAK_REDIR_OUPUT_MISSING        : 336330756, // Redirect location for output is not
    GBAK_SWITCHES_CONFLICT          : 336330757, // Conflicting switches for backup/restore
    GBAK_UNKNOWN_DEVICE             : 336330758, // Device type @1 not known
    GBAK_NO_PROTECTION              : 336330759, // Protection is not there yet
    GBAK_PAGE_SIZE_NOT_ALLOWED      : 336330760, // Page size is allowed only on
    GBAK_MULTI_SOURCE_DEST          : 336330761, // Multiple sources or destinations specified
    GBAK_FILENAME_MISSING           : 336330762, // Requires both input and output filenames
    GBAK_DUP_INOUT_NAMES            : 336330763, // Input and output have the same
    GBAK_INV_PAGE_SIZE              : 336330764, // Expected page size, encountered "@1"
    GBAK_DB_SPECIFIED               : 336330765, // REPLACE specified, but the first file
    GBAK_DB_EXISTS                  : 336330766, // Database @1 already exists.To replace it,
    GBAK_UNK_DEVICE                 : 336330767, // Device type not specified
    GBAK_BLOB_INFO_FAILED           : 336330772, // Gds_$blob_info failed
    GBAK_UNK_BLOB_ITEM              : 336330773, // Do not understand BLOB INFO item
    GBAK_GET_SEG_FAILED             : 336330774, // Gds_$get_segment failed
    GBAK_CLOSE_BLOB_FAILED          : 336330775, // Gds_$close_blob failed
    GBAK_OPEN_BLOB_FAILED           : 336330776, // Gds_$open_blob failed
    GBAK_PUT_BLR_GEN_ID_FAILED      : 336330777, // Failed in put_blr_gen_id
    GBAK_UNK_TYPE                   : 336330778, // Data type @1 not understood
    GBAK_COMP_REQ_FAILED            : 336330779, // Gds_$compile_request failed
    GBAK_START_REQ_FAILED           : 336330780, // Gds_$start_request failed
    GBAK_REC_FAILED                 : 336330781, // gds_$receive failed
    GBAK_REL_REQ_FAILED             : 336330782, // Gds_$release_request failed
    GBAK_DB_INFO_FAILED             : 336330783, // gds_$database_info failed
    GBAK_NO_DB_DESC                 : 336330784, // Expected database description record
    GBAK_DB_CREATE_FAILED           : 336330785, // Failed to create database @1
    GBAK_DECOMP_LEN_ERROR           : 336330786, // RESTORE: decompression length error
    GBAK_TBL_MISSING                : 336330787, // Cannot find table @1
    GBAK_BLOB_COL_MISSING           : 336330788, // Cannot find column for BLOB
    GBAK_CREATE_BLOB_FAILED         : 336330789, // Gds_$create_blob failed
    GBAK_PUT_SEG_FAILED             : 336330790, // Gds_$put_segment failed
    GBAK_REC_LEN_EXP                : 336330791, // Expected record length
    GBAK_INV_REC_LEN                : 336330792, // Wrong length record, expected @1 encountered
    GBAK_EXP_DATA_TYPE              : 336330793, // Expected data attribute
    GBAK_GEN_ID_FAILED              : 336330794, // Failed in store_blr_gen_id
    GBAK_UNK_REC_TYPE               : 336330795, // Do not recognize record type @1
    GBAK_INV_BKUP_VER               : 336330796, // Expected backup version 1..8.Found @1
    GBAK_MISSING_BKUP_DESC          : 336330797, // Expected backup description record
    GBAK_STRING_TRUNC               : 336330798, // String truncated
    GBAK_CANT_REST_RECORD           : 336330799, // warning-- record could not be restored
    GBAK_SEND_FAILED                : 336330800, // Gds_$send failed
    GBAK_NO_TBL_NAME                : 336330801, // No table name for data
    GBAK_UNEXP_EOF                  : 336330802, // Unexpected end of file on backup
    GBAK_DB_FORMAT_TOO_OLD          : 336330803, // Database format @1 is too old
    GBAK_INV_ARRAY_DIM              : 336330804, // Array dimension for column @1 is
    GBAK_XDR_LEN_EXPECTED           : 336330807, // Expected XDR record length
    GBAK_OPEN_BKUP_ERROR            : 336330817, // Cannot open backup file @1
    GBAK_OPEN_ERROR                 : 336330818, // Cannot open status and error output
    GBAK_MISSING_BLOCK_FAC          : 336330934, // Blocking factor parameter missing
    GBAK_INV_BLOCK_FAC              : 336330935, // Expected blocking factor, encountered "@1"
    GBAK_BLOCK_FAC_SPECIFIED        : 336330936, // A blocking factor may not be
    GBAK_MISSING_USERNAME           : 336330940, // User name parameter missing
    GBAK_MISSING_PASSWORD           : 336330941, // Password parameter missing
    GBAK_MISSING_SKIPPED_BYTES      : 336330952, // missing parameter for the number of
    GBAK_INV_SKIPPED_BYTES          : 336330953, // Expected number of bytes to be
    GBAK_ERR_RESTORE_CHARSET        : 336330965, // Character set
    GBAK_ERR_RESTORE_COLLATION      : 336330967, // Collation
    GBAK_READ_ERROR                 : 336330972, // Unexpected I/O error while reading from
    GBAK_WRITE_ERROR                : 336330973, // Unexpected I/O error while writing to
    GBAK_DB_IN_USE                  : 336330985, // Could not drop database @1 (database
    GBAK_SYSMEMEX                   : 336330990, // System memory exhausted
    GBAK_RESTORE_ROLE_FAILED        : 336331002, // SQL role
    GBAK_ROLE_OP_MISSING            : 336331005, // SQL role parameter missing
    GBAK_PAGE_BUFFERS_MISSING       : 336331010, // Page buffers parameter missing
    GBAK_PAGE_BUFFERS_WRONG_PARAM   : 336331011, // Expected page buffers, encountered "@1"
    GBAK_PAGE_BUFFERS_RESTORE       : 336331012, // Page buffers is allowed only on
    GBAK_INV_SIZE                   : 336331014, // Size specification either missing or incorrect
    GBAK_FILE_OUTOF_SEQUENCE        : 336331015, // File @1 out of sequence
    GBAK_JOIN_FILE_MISSING          : 336331016, // Can't join-- one of the files
    GBAK_STDIN_NOT_SUPPTD           : 336331017, // standard input is not supported when
    GBAK_STDOUT_NOT_SUPPTD          : 336331018, // Standard output is not supported when
    GBAK_BKUP_CORRUPT               : 336331019, // Backup file @1 might be corrupt
    GBAK_UNK_DB_FILE_SPEC           : 336331020, // Database file specification missing
    GBAK_HDR_WRITE_FAILED           : 336331021, // Can't write a header record to
    GBAK_DISK_SPACE_EX              : 336331022, // Free disk space exhausted
    GBAK_SIZE_LT_MIN                : 336331023, // File size given (@1) is less
    GBAK_SVC_NAME_MISSING           : 336331025, // Service name parameter missing
    GBAK_NOT_OWNR                   : 336331026, // Cannot restore over current database, must
    GBAK_MODE_REQ                   : 336331031, // "read_only" or "read_write" required
    GBAK_JUST_DATA                  : 336331033, // Just data ignore all constraints etc.
    GBAK_DATA_ONLY                  : 336331034, // Restoring data only ignoring foreign key,
    DSQL_TOO_OLD_ODS                : 336397205, // ODS versions before ODS@1 are not
    DSQL_TABLE_NOT_FOUND            : 336397206, // Table @1 does not exist
    DSQL_VIEW_NOT_FOUND             : 336397207, // View @1 does not exist
    DSQL_LINE_COL_ERROR             : 336397208, // At line @1, column @2
    DSQL_UNKNOWN_POS                : 336397209, // At unknown line and column
    DSQL_NO_DUP_NAME                : 336397210, // Column @1 cannot be repeated in
    DSQL_TOO_MANY_VALUES            : 336397211, // Too many values (more than @1)
    DSQL_NO_ARRAY_COMPUTED          : 336397212, // Array and BLOB data types not
    DSQL_IMPLICIT_DOMAIN_NAME       : 336397213, // Implicit domain name @1 not allowed
    DSQL_ONLY_CAN_SUBSCRIPT_ARRAY   : 336397214, // Scalar operator used on field @1
    DSQL_MAX_SORT_ITEMS             : 336397215, // Cannot sort on more than 255
    DSQL_MAX_GROUP_ITEMS            : 336397216, // Cannot group on more than 255
    DSQL_CONFLICTING_SORT_FIELD     : 336397217, // Cannot include the same field (@1.@2)
    DSQL_DERIVED_TABLE_MORE_COLUMNS : 336397218, // Column list from derived table @1
    DSQL_DERIVED_TABLE_LESS_COLUMNS : 336397219, // Column list from derived table @1
    DSQL_DERIVED_FIELD_UNNAMED      : 336397220, // No column name specified for column
    DSQL_DERIVED_FIELD_DUP_NAME     : 336397221, // Column @1 was specified multiple times
    DSQL_DERIVED_ALIAS_SELECT       : 336397222, // Internal dsql error: alias type expected
    DSQL_DERIVED_ALIAS_FIELD        : 336397223, // Internal dsql error: alias type expected
    DSQL_AUTO_FIELD_BAD_POS         : 336397224, // Internal dsql error: column position out
    DSQL_CTE_WRONG_REFERENCE        : 336397225, // Recursive CTE member (@1) can refer
    DSQL_CTE_CYCLE                  : 336397226, // CTE '@1' has cyclic dependencies
    DSQL_CTE_OUTER_JOIN             : 336397227, // Recursive member of CTE can't be
    DSQL_CTE_MULT_REFERENCES        : 336397228, // Recursive member of CTE can't reference
    DSQL_CTE_NOT_A_UNION            : 336397229, // Recursive CTE (@1) must be an
    DSQL_CTE_NONRECURS_AFTER_RECURS : 336397230, // CTE '@1' defined non-recursive member after
    DSQL_CTE_WRONG_CLAUSE           : 336397231, // Recursive member of CTE '@1' has
    DSQL_CTE_UNION_ALL              : 336397232, // Recursive members of CTE (@1) must
    DSQL_CTE_MISS_NONRECURSIVE      : 336397233, // Non-recursive member is missing in CTE
    DSQL_CTE_NESTED_WITH            : 336397234, // WITH clause can't be nested
    DSQL_COL_MORE_THAN_ONCE_USING   : 336397235, // Column @1 appears more than once
    DSQL_UNSUPP_FEATURE_DIALECT     : 336397236, // Feature is not supported in dialect
    DSQL_CTE_NOT_USED               : 336397237, // CTE "@1" is not used in
    GSEC_CANT_OPEN_DB               : 336723983, // Unable to open database
    GSEC_SWITCHES_ERROR             : 336723984, // Error in switch specifications
    GSEC_NO_OP_SPEC                 : 336723985, // No operation specified
    GSEC_NO_USR_NAME                : 336723986, // No user name specified
    GSEC_ERR_ADD                    : 336723987, // Add record error
    GSEC_ERR_MODIFY                 : 336723988, // Modify record error
    GSEC_ERR_FIND_MOD               : 336723989, // Find/modify record error
    GSEC_ERR_REC_NOT_FOUND          : 336723990, // Record not found for user: @1
    GSEC_ERR_DELETE                 : 336723991, // Delete record error
    GSEC_ERR_FIND_DEL               : 336723992, // Find/delete record error
    GSEC_ERR_FIND_DISP              : 336723996, // Find/display record error
    GSEC_INV_PARAM                  : 336723997, // Invalid parameter, no switch defined
    GSEC_OP_SPECIFIED               : 336723998, // Operation already specified
    GSEC_PW_SPECIFIED               : 336723999, // Password already specified
    GSEC_UID_SPECIFIED              : 336724000, // Uid already specified
    GSEC_GID_SPECIFIED              : 336724001, // Gid already specified
    GSEC_PROJ_SPECIFIED             : 336724002, // Project already specified
    GSEC_ORG_SPECIFIED              : 336724003, // Organization already specified
    GSEC_FNAME_SPECIFIED            : 336724004, // First name already specified
    GSEC_MNAME_SPECIFIED            : 336724005, // Middle name already specified
    GSEC_LNAME_SPECIFIED            : 336724006, // Last name already specified
    GSEC_INV_SWITCH                 : 336724008, // Invalid switch specified
    GSEC_AMB_SWITCH                 : 336724009, // Ambiguous switch specified
    GSEC_NO_OP_SPECIFIED            : 336724010, // No operation specified for parameters
    GSEC_PARAMS_NOT_ALLOWED         : 336724011, // No parameters allowed for this operation
    GSEC_INCOMPAT_SWITCH            : 336724012, // Incompatible switches specified
    GSEC_INV_USERNAME               : 336724044, // Invalid user name (maximum 31 bytes
    GSEC_INV_PW_LENGTH              : 336724045, // Warning- maximum 8 significant bytes of
    GSEC_DB_SPECIFIED               : 336724046, // Database already specified
    GSEC_DB_ADMIN_SPECIFIED         : 336724047, // Database administrator name already specified
    GSEC_DB_ADMIN_PW_SPECIFIED      : 336724048, // Database administrator password already
    GSEC_SQL_ROLE_SPECIFIED         : 336724049, // SQL role name already specified
    GSTAT_UNKNOWN_SWITCH            : 336920577, // Found unknown switch
    GSTAT_RETRY                     : 336920578, // Please retry, giving a database name
    GSTAT_WRONG_ODS                 : 336920579, // Wrong ODS version, expected @1, encountered
    GSTAT_UNEXPECTED_EOF            : 336920580, // Unexpected end of database file.
    GSTAT_OPEN_ERR                  : 336920605, // Can't open database file @1
    GSTAT_READ_ERR                  : 336920606, // Can't read a database page
    GSTAT_SYSMEMEX                  : 336920607, // System memory exhausted
    FBSVCMGR_BAD_AM                 : 336986113, // Wrong value for access mode
    FBSVCMGR_BAD_WM                 : 336986114, // Wrong value for write mode
    FBSVCMGR_BAD_RS                 : 336986115, // Wrong value for reserve space
    FBSVCMGR_INFO_ERR               : 336986116, // Unknown tag (@1) in info_svr_db_info block
    FBSVCMGR_QUERY_ERR              : 336986117, // Unknown tag (@1) in isc_svc_query() results
    FBSVCMGR_SWITCH_UNKNOWN         : 336986118  // Unknown switch "@1"
};

Object.freeze(GDSCode);
module.exports = { GDSCode };
