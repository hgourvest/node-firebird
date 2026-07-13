# Database Encryption Key Callback Implementation

This document describes the implementation of Firebird protocol 14 and 15 database encryption key callback support in node-firebird.

## Overview

Firebird 3.0.1 introduced protocol version 14 to fix a bug in database encryption key callback, and version 15 (3.0.2) extended this to support database encryption key callback during the connect phase. This allows connections to encrypted databases that serve as their own security database.

## Implementation Details

### 1. Protocol Support

The implementation adds support for:
- **Protocol 14**: Database encryption key callback (Firebird 3.0.1+)
- **Protocol 15**: Database encryption key callback in connect phase (Firebird 3.0.2+)

Both protocols were already defined in the constants but the actual callback mechanism (`op_crypt_key_callback`, opcode 97) was not implemented.

### 2. Connection Option

A new connection option `dbCryptConfig` has been added:

```javascript
{
  dbCryptConfig: 'base64:bXlTZWNyZXRLZXk=' // Base64-encoded key
  // or
  dbCryptConfig: 'myPlainTextKey'  // Plain text key (UTF-8 encoded)
  // or
  dbCryptConfig: undefined  // Empty response (default)
}
```

### 3. Message Flow

When connecting to an encrypted database:

1. Client sends `op_connect` with supported protocol versions
2. Server responds with `op_accept`, `op_cond_accept`, or `op_accept_data`
3. If database is encrypted, server sends `op_crypt_key_callback` (opcode 97)
4. Client reads server plugin data (currently unused)
5. Client responds with encryption key from `dbCryptConfig` option
6. Server validates the key and continues with connection or returns error
7. Connection proceeds normally if key is valid

### 4. Code Changes

#### lib/wire/connection.js

- **sendOpCryptKeyCallback()**: New method to send the encryption key callback response
- **parseDbCryptConfig()**: Helper function to parse base64 or plain text keys
- **decodeResponse()**: Added case for `Const.op_crypt_key_callback` to handle the callback

#### lib/index.d.ts

- Added `dbCryptConfig?: string` to the `Options` interface

#### Tests

- **test/protocol.js**: Added test for `op_crypt_key_callback` opcode definition
- **test/db-crypt-config.js**: New test file with 6 tests for option handling and encoding

#### Documentation

- **README.md**: Added documentation and examples for database encryption
- **Roadmap.md**: Updated to mark database encryption callback as implemented

## Security Considerations

1. **Key Storage**: The encryption key is passed as a connection option. Applications should:
   - Store keys securely (environment variables, key management systems)
   - Never hardcode keys in source code
   - Never commit keys to version control

2. **Wire Encryption**: Database encryption keys can be transmitted unencrypted if:
   - `wireCrypt` is disabled (`WIRE_CRYPT_DISABLE`)
   - Legacy authentication is used
   - Server doesn't support wire encryption
   
   **Recommendation**: Always use `wireCrypt: Firebird.WIRE_CRYPT_ENABLE` (default)

3. **Empty Keys**: If `dbCryptConfig` is not provided or is empty, an empty response is sent. Depending on the database encryption plugin, this may:
   - Work (if the plugin doesn't require a key)
   - Fail with an error
   - Silently fail (security risk)

## Testing

All tests pass including:
- Protocol constant definitions
- Option parsing and validation
- Base64 encoding/decoding
- UTF-8 plain text encoding

## Reference Implementation

This implementation is based on the Jaybird JDBC driver:
- Issue: https://github.com/FirebirdSQL/jaybird/issues/561
- Commit: https://github.com/FirebirdSQL/jaybird/commit/df6d50bb07589ef554e6f5fe67c5a561ace979e8

## Limitations

1. **No Plugin System**: Unlike Jaybird's future-ready plugin architecture, this implementation uses a fixed response mechanism. A plugin system could be added in the future.

2. **Protocol 14/15 Only**: Database encryption callback is only available for protocol versions 14 and 15 (Firebird 3.0.1+).

3. **No Native Support**: This implementation is for pure JavaScript client only. Native and embedded connections are not supported.

## Example Usage

### Connecting to an Encrypted Database

```javascript
const Firebird = require('node-firebird');

// Using base64-encoded key
Firebird.attach({
  host: 'localhost',
  port: 3050,
  database: '/path/to/encrypted.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
  dbCryptConfig: 'base64:bXlTZWNyZXRLZXkxMjM0NTY=',
  wireCrypt: Firebird.WIRE_CRYPT_ENABLE // Recommended
}, function(err, db) {
  if (err) throw err;
  
  console.log('Connected to encrypted database');
  db.query('SELECT * FROM MY_TABLE', function(err, result) {
    console.log(result);
    db.detach();
  });
});

// Using plain text key
Firebird.attach({
  host: 'localhost',
  database: '/path/to/encrypted.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
  dbCryptConfig: 'mySecretKey123'
}, function(err, db) {
  if (err) throw err;
  // ...
});
```

## Future Enhancements

1. **Plugin Architecture**: Similar to Jaybird, implement a plugin system for more complex encryption callbacks
2. **Multiple Callbacks**: Handle cases where the server requests multiple callbacks
3. **Key Derivation**: Support for key derivation functions (PBKDF2, scrypt, etc.)
4. **Protocol 16/17**: Add support for Firebird 4.0 protocol versions
