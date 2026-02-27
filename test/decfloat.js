const Xsql = require('../lib/wire/xsqlvar');
const { XdrReader } = require('../lib/wire/serialize');

describe('DECFLOAT Support (Firebird 4.0)', () => {
    describe('SQLVarDec16', () => {
        it('should decode DECFLOAT(16) as 8-byte buffer', () => {
            const sqlVar = new Xsql.SQLVarDec16();
            const buffer = Buffer.alloc(12); // 8 (data) + 4 (null indicator)
            const decData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
            decData.copy(buffer, 0);
            buffer.writeInt32BE(0, 8); // Not null

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeInstanceOf(Buffer);
            expect(result.length).toBe(8);
            expect(result.equals(decData)).toBe(true);
        });

        it('should return null for DECFLOAT(16) when null indicator is set', () => {
            const sqlVar = new Xsql.SQLVarDec16();
            const buffer = Buffer.alloc(12);
            buffer.writeInt32BE(1, 8); // Null indicator = 1

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeNull();
        });
    });

    describe('SQLVarDec34', () => {
        it('should decode DECFLOAT(34) as 16-byte buffer', () => {
            const sqlVar = new Xsql.SQLVarDec34();
            const buffer = Buffer.alloc(20); // 16 (data) + 4 (null indicator)
            const decData = Buffer.alloc(16, 0xAA);
            decData.copy(buffer, 0);
            buffer.writeInt32BE(0, 16); // Not null

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeInstanceOf(Buffer);
            expect(result.length).toBe(16);
            expect(result.equals(decData)).toBe(true);
        });

        it('should return null for DECFLOAT(34) when null indicator is set', () => {
            const sqlVar = new Xsql.SQLVarDec34();
            const buffer = Buffer.alloc(20);
            buffer.writeInt32BE(1, 16); // Null indicator = 1

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeNull();
        });
    });
});
