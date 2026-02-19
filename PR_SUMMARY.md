# Protocol 16 Implementation for Firebird 4.0

This PR implements support for Firebird Protocol 16 and 17, introduced in Firebird 4.0, following the implementation pattern from the Jaybird JDBC driver.

## Features Implemented

### ✅ Protocol Support
- **Protocol 16 & 17 constants** - Full wire protocol version support
- **Automatic negotiation** - Driver selects best protocol version
- **Backward compatible** - Works with Firebird 2.5, 3.0, and 4.0

### ✅ DECFLOAT Data Types (Simplified)
- **DECFLOAT(16)** - 8-byte decimal floating point (SQL_DEC16)
- **DECFLOAT(34)** - 16-byte decimal floating point (SQL_DEC34)
- **Note:** Simplified implementation, not full IEEE 754 Decimal encoding
- **Well-documented** - Clear warnings in code and documentation

### ✅ INT128 Support
- Already implemented, verified with Protocol 16/17

### ✅ Extended Metadata
- Identifiers up to 63 characters (automatic)

### ✅ Database Encryption
- Inherited from Protocol 14/15, works with Firebird 4.0

## Known Limitations

### DECFLOAT Implementation
The current DECFLOAT implementation is **simplified**:
- Uses integer-based encoding/decoding
- **NOT** IEEE 754 Decimal64/Decimal128 compliant
- May lose precision for high-precision values
- Suitable for basic use cases only
- **Documented** with warnings throughout code and docs

### Not Yet Implemented
- Statement timeouts (Protocol 16 feature)
- Time zone data types (TIMESTAMP/TIME WITH TIME ZONE)
- Full IEEE 754 DECFLOAT support

## Testing
- ✅ All unit tests pass (26/26)
- ✅ Protocol tests pass (11/11)
- ✅ CodeQL security scan: 0 vulnerabilities
- ✅ No breaking changes

## Files Changed
1. `lib/wire/const.js` - Protocol and type constants
2. `lib/wire/serialize.js` - DECFLOAT encoding/decoding
3. `lib/wire/xsqlvar.js` - DECFLOAT SQL variable classes
4. `lib/wire/connection.js` - Type handling
5. `test/protocol.js` - Protocol 16/17 tests
6. `README.md` - Documentation updates
7. `Roadmap.md` - Status updates

## Usage Example

```javascript
const Firebird = require('node-firebird');

Firebird.attach({
  host: '127.0.0.1',
  database: '/path/to/fb4.fdb',
  user: 'SYSDBA',
  password: 'masterkey',
}, function(err, db) {
  if (err) throw err;
  
  // DECFLOAT and INT128 types are automatically supported
  db.query('SELECT CAST(123.456 AS DECFLOAT(16)) AS df16 FROM RDB$DATABASE', 
    function(err, result) {
      console.log(result); // { df16: 123.456 }
      db.detach();
    });
});
```

## Production Considerations

For production use with DECFLOAT requiring full precision:
1. Consider using strings or Buffers for DECFLOAT values
2. Integrate a proper IEEE 754 Decimal library
3. Test thoroughly with your specific use cases
4. Contributions welcome for full IEEE 754 implementation

## References
- [Jaybird Protocol 16 Implementation](https://github.com/FirebirdSQL/jaybird)
- [Firebird 4.0 Release Notes](https://firebirdsql.org/file/documentation/release_notes/html/en/4_0/rlsnotes40.html)
- [IEEE 754 Decimal Arithmetic](https://en.wikipedia.org/wiki/Decimal64_floating-point_format)
