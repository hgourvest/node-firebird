# Node-Firebird Roadmap

This document outlines the future development direction for the `node-firebird` library. Our primary goals are to modernize the codebase, implement support for the latest Firebird features, and improve the overall developer experience.

## Protocol Implementation Status

The following table summarizes the current and planned implementation status of the Firebird wire protocol for each major version.

| Firebird Version | Protocol Versions | Status |
| :--- | :--- | :--- |
| 2.5 | 10, 11, 12, 13 | ✅ Implemented |
| 3.0 | 14, 15 | ✅ Implemented |
| 4.0 | 16, 17 | ❌ Not Implemented |
| 5.0 | N/A | ❌ Not Implemented |
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

The following features are planned for future implementation:

## Firebird 4 Support

Firebird 4 introduced Protocol versions 16 and 17, continuing to build upon the foundation of Firebird 3. Key features to implement include:

- **Protocol Versions 16 and 17:** Implement the latest protocol versions to support Firebird 4 features.

## Firebird 5 Support

Firebird 5 introduces a host of new SQL features and performance improvements that will require significant client-side implementation:

- **Bidirectional Cursors:** Implement support for scrollable cursors for remote database access.
- **`RETURNING` Multiple Rows:** Enhance DML operations to support returning multiple rows.
- **`SKIP LOCKED`:** Add support for the `SKIP LOCKED` clause in `SELECT WITH LOCK`, `UPDATE`, and `DELETE` statements.
- **New Data Types and Functions:** Add support for new built-in functions and packages.

## Firebird 6 and Beyond

As Firebird 6 and future versions are released, we will continue to monitor new features and plan for their implementation. Key areas of interest include:

- **JSON Support:** Implement client-side support for the new SQL-compliant JSON functions.
- **Tablespaces:** Add support for tablespaces.
- **SQL Schemas:** Implement support for SQL schemas.

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
