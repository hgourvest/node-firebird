const Xsql = require('../lib/wire/xsqlvar');
const { XdrReader, XdrWriter } = require('../lib/wire/serialize');

describe('Result text decoding respects connection encoding', () => {
    it('should decode SQLVarString using WIN1252 connection encoding', () => {
        const sqlVar = new Xsql.SQLVarString();
        sqlVar.subType = 2;

        const writer = new XdrWriter(64);
        writer.addString('TESTE NCM COM Ç Ã É Ú', 'latin1');
        writer.addInt(0);

        const reader = new XdrReader(writer.getData());
        const result = sqlVar.decode(reader, true, { encoding: 'WIN1252' });

        expect(result).toBe('TESTE NCM COM Ç Ã É Ú');
    });

    it('should decode SQLVarText using WIN1252 connection encoding', () => {
        const sqlVar = new Xsql.SQLVarText();
        sqlVar.subType = 2;

        const text = 'TESTE NCM COM Ç Ã É Ú';
        sqlVar.length = Buffer.byteLength(text, 'latin1');

        const writer = new XdrWriter(64);
        writer.addText(text, 'latin1');
        writer.addInt(0);

        const reader = new XdrReader(writer.getData());
        const result = sqlVar.decode(reader, true, { encoding: 'WIN1252' });

        expect(result).toBe(text);
    });
});
