# Node-Firebird Roadmap

This document outlines the future development direction for the `node-firebird` library. Our primary goals are to modernize the codebase, implement support for the latest Firebird features, and improve the overall developer experience.

## Protocol Implementation Status

The following table summarizes the current and planned implementation status of the Firebird wire protocol for each major version.

| Firebird Version | Protocol Versions | Status |
| :--- | :--- | :--- |
| 2.5 | 10, 11, 12, 13 | ✅ Implemented |
| 3.0 | 14, 15 | ✅ Implemented |
| 4.0 | 16, 17 | ✅ Protocol 16 Implemented / 🚧 Protocol 17 Missing |
| 5.0 | 18 | ❌ Not Implemented |
| 6.0 | N/A | ❌ Not Implemented |

## Firebird 3 Support

Firebird 3 introduced Protocol 13, which brought significant changes focusing on security and performance. The following features have been implemented:

- **Protocol Versions 14 and 15:** ✅ Implemented - newer wire protocol versions are now supported.
- **Enhanced Authentication:** ✅ Implemented - Srp256 (SHA-256) authentication plugin is now supported alongside Srp (SHA-1) and Legacy_Auth.
- **Wire Protocol Encryption:** ✅ Implemented - Arc4 (RC4) stream cipher encryption for all network traffic using SRP session keys.
- **Wire Protocol Compression:** ✅ Implemented - zlib compression support for protocol version 13+.
- **Packed (NULL-aware) Row Data:** ✅ Implemented - null bitmap support for protocol version 13+.
- **op_cond_accept Handling:** ✅ Implemented - proper handling of conditional accept with authentication continuation.
- **UTF-8 User Identification:** ✅ Implemented - all user identification is properly handled with UTF-8 encoding via `isc_dpb_utf8_filename` flag for Firebird 3+.
- **Database Encryption Callback:** ✅ Implemented - support for database encryption key callback (`op_crypt_key_callback`) during the connect phase, allowing connections to encrypted databases. The `dbCryptConfig` connection option supports both plain text and base64-encoded encryption keys.

## Firebird 4 Support

Firebird 4 introduced Protocol versions 16 and 17, continuing to build upon the foundation of Firebird 3. Key features to implement include:

- **Protocol Versions 16 and 17:** ✅ Protocol 16 Implemented - support for statement timeout, INT128, and timezones. 🚧 Protocol 17 Missing.
- **Statement Timeout:** ✅ Implemented - support for `op_execute` with statement timeout (Protocol 16+).
- **`INT128` Data Type:** ✅ Implemented - support for 128-bit integer data type.
- **Time Zone Support:** ✅ Implemented - support for `TIME WITH TIME ZONE`, `TIMESTAMP WITH TIME ZONE`, and `sessionTimeZone` connection option (Protocol 16+).
- **`DECFLOAT` Data Type:** ✅ Implemented - support for `DECFLOAT(16)` and `DECFLOAT(34)` (as Buffers).

## Firebird 5 Support

Firebird 5 introduces Protocol version 18 and a host of new SQL features and performance improvements:

- **Protocol Version 18:** ❌ TODO - implement the latest protocol version.
- **Bidirectional Cursors:** ❌ TODO - implement support for scrollable cursors for remote database access.
- **`RETURNING` Multiple Rows:** ❌ TODO - enhance DML operations to support returning multiple rows.
- **`SKIP LOCKED`:** ❌ TODO - add support for the `SKIP LOCKED` clause in `SELECT WITH LOCK`, `UPDATE`, and `DELETE` statements.
- **Parallel Workers Information:** ❌ TODO - support for parallel workers information in SQL information items.


## Firebird 6 and Beyond

As Firebird 6 and future versions are released, we will continue to monitor new features and plan for their implementation. Key areas of interest include:

- **Native `JSON` Data Type:** Implement support for the new native `JSON` type (often handled as optimized binary storage).
- **SQL-Standard `ROW` Type:** Support for structured data types (records) as columns or variables.
- **SQL-Compliant JSON Functions:** Implement client-side support for `JSON_VALUE`, `JSON_QUERY`, `JSON_EXISTS`, and `JSON_OBJECT`.
- **Tablespaces:** Add support for tablespaces to control physical storage locations.
- **SQL Schemas:** Implement support for SQL-standard schemas for better namespace organization.
- **Enhanced Collation Support:** Support for collations defined directly as part of the data type declaration.

## Codebase Refactoring

The current codebase is functional but could be significantly improved by adopting modern JavaScript and TypeScript features.

### Modern JavaScript Classes

The existing codebase is written in a prototype-based style. We plan to refactor the entire library to use modern JavaScript classes (`class` syntax). This will improve readability, maintainability, and make the code easier to understand for new contributors.

**Benefits:**

- Improved code structure and organization.
- Easier to reason about inheritance and object-oriented patterns.
- Better alignment with modern JavaScript best practices.

### TypeScript Rewrite

A full rewrite of the library in TypeScript is a long-term goal. This would bring the benefits of static typing, improved developer tooling, and a more robust codebase.

**Benefits:**

- **Type Safety:** Catch errors at compile-time instead of runtime.
- **Improved Autocomplete:** Better editor support and developer experience.
- **Self-documenting Code:** Types make the code easier to understand and use.
- **Easier Refactoring:** Static analysis makes it easier to refactor code with confidence.

We believe these changes will make `node-firebird` a more robust, modern, and developer-friendly library for accessing Firebird databases.
