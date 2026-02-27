const Xsql = require('../lib/wire/xsqlvar');
const { XdrReader } = require('../lib/wire/serialize');

describe('Timezone Support (Firebird 4.0)', () => {
    // Mock constants for date calculation matching xsqlvar.js
    const DateOffset = 40587;
    const TimeCoeff = 86400000;

    describe('SQLVarTimeTz', () => {
        it('should decode TIME WITH TIME ZONE', () => {
            const sqlVar = new Xsql.SQLVarTimeTz();
            const buffer = Buffer.alloc(12);
            buffer.writeUInt32BE(432000000, 0); // 12:00:00
            buffer.writeInt32BE(1, 4); 
            buffer.writeInt32BE(0, 8); 

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeInstanceOf(Date);
            // Result should represent 12:00:00 local time
            expect(result.getHours()).toBe(12);
            expect(result.getMinutes()).toBe(0);
        });
    });

    describe('SQLVarTimeStampTz', () => {
        it('should decode TIMESTAMP WITH TIME ZONE', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTz();
            const buffer = Buffer.alloc(16);
            buffer.writeInt32BE(DateOffset, 0); // 1970-01-01
            buffer.writeUInt32BE(432000000, 4); // 12:00:00
            buffer.writeInt32BE(1, 8); 
            buffer.writeInt32BE(0, 12); 

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result.getFullYear()).toBe(1970);
            expect(result.getMonth()).toBe(0);
            expect(result.getDate()).toBe(1);
            expect(result.getHours()).toBe(12);
        });
    });

    describe('SQLVarTimeStampTzEx', () => {
        it('should decode TIMESTAMP WITH TIME ZONE EXTENDED', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTzEx();
            const buffer = Buffer.alloc(20); 
            buffer.writeInt32BE(DateOffset, 0); 
            buffer.writeUInt32BE(432000000, 4); 
            buffer.writeInt32BE(1, 8); 
            buffer.writeInt32BE(120, 12); 
            buffer.writeInt32BE(0, 16); 

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result.getFullYear()).toBe(1970);
            expect(result.getHours()).toBe(12);
            expect(reader.pos).toBe(20);
        });
    });
});
