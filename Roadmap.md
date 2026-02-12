# Node-Firebird Roadmap

This document outlines the future development direction for the `node-firebird` library. Our primary goals are to modernize the codebase, implement support for the latest Firebird features, and improve the overall developer experience.

## Protocol Implementation Status

The following table summarizes the current and planned implementation status of the Firebird wire protocol for each major version.

| Firebird Version | Protocol Versions | Status |
| :--- | :--- | :--- |
| 2.5 | 10, 11, 12, 13 | ✅ Implemented |
| 3.0 | 14, 15 | ❌ Not Implemented |
| 4.0 | 16, 17 | ❌ Not Implemented |
| 5.0 | N/A | ❌ Not Implemented |
| 6.0 | N/A | ❌ Not Implemented |

## Firebird 3 Support

Firebird 3 introduced Protocol 13, which brought significant changes focusing on security and performance. While the base protocol is implemented, several key features are still missing. To fully support Firebird 3, we need to implement the following:

- **Protocol Versions 14 and 15:** Implement the newer wire protocol versions.
- **Enhanced Authentication:** Fully support the new authentication mechanisms and plugin architecture.
- **Wire Protocol Encryption:** Implement support for encrypting all network traffic.
- **Wire Protocol Compression:** Add support for data compression.
- **Database Encryption Callback:** Support the new callback mechanism for handling database encryption keys.
- **Packed (NULL-aware) Row Data:** Implement support for the optimized row format.
- **Performance Optimizations:**
  - Implement support for the denser data stream and improved prefetch logic.
  - Utilize the new bitmap for transmitting NULL flags to reduce network traffic.
- **UTF-8 User Identification:** Ensure all user identification is properly handled with UTF-8 encoding.

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
