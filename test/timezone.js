const Xsql = require('../lib/wire/xsqlvar');
const { XdrReader } = require('../lib/wire/serialize');

describe('Timezone Support (Firebird 4.0)', () => {
    // Mock constants for date calculation matching xsqlvar.js
    const DateOffset = 40587;
    const TimeCoeff = 86400000;

    describe('SQLVarTimeTz', () => {
        it('should decode TIME WITH TIME ZONE as a UTC instant', () => {
            const sqlVar = new Xsql.SQLVarTimeTz();
            const buffer = Buffer.alloc(12);
            buffer.writeUInt32BE(432000000, 0); // 12:00:00 UTC
            buffer.writeInt32BE(1, 4);
            buffer.writeInt32BE(0, 8);

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeInstanceOf(Date);
            expect(result.getUTCHours()).toBe(12);
            expect(result.getUTCMinutes()).toBe(0);
        });
    });

    describe('SQLVarTimeStampTz', () => {
        it('should decode TIMESTAMP WITH TIME ZONE as a UTC instant', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTz();
            const buffer = Buffer.alloc(16);
            buffer.writeInt32BE(DateOffset, 0); // 1970-01-01
            buffer.writeUInt32BE(432000000, 4); // 12:00:00 UTC
            buffer.writeInt32BE(1, 8);
            buffer.writeInt32BE(0, 12);

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result.toISOString()).toBe('1970-01-01T12:00:00.000Z');
        });
    });

    describe('SQLVarTimeStampTzEx', () => {
        it('should decode TIMESTAMP WITH TIME ZONE EXTENDED as a UTC instant', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTzEx();
            const buffer = Buffer.alloc(20);
            buffer.writeInt32BE(DateOffset, 0);
            buffer.writeUInt32BE(432000000, 4);
            buffer.writeInt32BE(1, 8);
            buffer.writeInt32BE(120, 12);
            buffer.writeInt32BE(0, 16);

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result.toISOString()).toBe('1970-01-01T12:00:00.000Z');
            expect(reader.pos).toBe(20);
        });
    });

    // Regression for https://github.com/hgourvest/node-firebird/issues/423 —
    // TIMESTAMP WITH TIME ZONE arrives on the wire already in UTC; the decoder
    // must not add the client's local offset on top. A row stored as
    // 10:32 -0300 (13:32 UTC) came back as 16:32 UTC on a -0300 client.
    describe('issue #423: negative client offsets must not shift TZ values', () => {
        const savedTz = process.env.TZ;

        beforeAll(() => {
            process.env.TZ = 'America/Sao_Paulo'; // UTC-3, no DST since 2019
        });

        afterAll(() => {
            if (savedTz === undefined) delete process.env.TZ;
            else process.env.TZ = savedTz;
        });

        // 13:32:00 in 100-microsecond units since midnight
        const wireTime = (13 * 3600 + 32 * 60) * 10000;
        // modified-Julian day number for 2025-06-10
        const wireDate = Date.UTC(2025, 5, 10) / TimeCoeff + DateOffset;

        it('client TZ is applied to the environment', () => {
            expect(new Date(0).getTimezoneOffset()).toBe(180);
        });

        it('TIMESTAMP_TZ: 13:32 UTC stays 13:32 UTC (10:32 local)', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTz();
            const buffer = Buffer.alloc(16);
            buffer.writeInt32BE(wireDate, 0);
            buffer.writeUInt32BE(wireTime, 4);
            buffer.writeInt32BE(65239, 8); // America/Sao_Paulo zone id (skipped)
            buffer.writeInt32BE(0, 12);

            const result = sqlVar.decode(new XdrReader(buffer), true);

            expect(result.toISOString()).toBe('2025-06-10T13:32:00.000Z');
            expect(result.getHours()).toBe(10);
            expect(result.getMinutes()).toBe(32);
        });

        it('TIMESTAMP_TZ_EX: 13:32 UTC stays 13:32 UTC', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTzEx();
            const buffer = Buffer.alloc(20);
            buffer.writeInt32BE(wireDate, 0);
            buffer.writeUInt32BE(wireTime, 4);
            buffer.writeInt32BE(65239, 8);
            buffer.writeInt32BE(-180, 12); // ext_offset in minutes (skipped)
            buffer.writeInt32BE(0, 16);

            const result = sqlVar.decode(new XdrReader(buffer), true);

            expect(result.toISOString()).toBe('2025-06-10T13:32:00.000Z');
        });

        it('TIME_TZ: 13:32 UTC stays 13:32 UTC', () => {
            const sqlVar = new Xsql.SQLVarTimeTz();
            const buffer = Buffer.alloc(12);
            buffer.writeUInt32BE(wireTime, 0);
            buffer.writeInt32BE(65239, 4);
            buffer.writeInt32BE(0, 8);

            const result = sqlVar.decode(new XdrReader(buffer), true);

            expect(result.toISOString()).toBe('1970-01-01T13:32:00.000Z');
        });

        it('TIME_TZ_EX: 13:32 UTC stays 13:32 UTC', () => {
            const sqlVar = new Xsql.SQLVarTimeTzEx();
            const buffer = Buffer.alloc(16);
            buffer.writeUInt32BE(wireTime, 0);
            buffer.writeInt32BE(65239, 4);
            buffer.writeInt32BE(-180, 8);
            buffer.writeInt32BE(0, 12);

            const result = sqlVar.decode(new XdrReader(buffer), true);

            expect(result.toISOString()).toBe('1970-01-01T13:32:00.000Z');
        });
    });

    describe('Null handling', () => {
        it('should return null for SQLVarTimeTz when null indicator is set', () => {
            const sqlVar = new Xsql.SQLVarTimeTz();
            const buffer = Buffer.alloc(12);
            buffer.writeInt32BE(1, 8); // Null indicator = 1

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeNull();
        });

        it('should return null for SQLVarTimeStampTzEx when null indicator is set', () => {
            const sqlVar = new Xsql.SQLVarTimeStampTzEx();
            const buffer = Buffer.alloc(20);
            buffer.writeInt32BE(1, 16); // Null indicator = 1

            const reader = new XdrReader(buffer);
            const result = sqlVar.decode(reader, true);

            expect(result).toBeNull();
        });
    });
});
