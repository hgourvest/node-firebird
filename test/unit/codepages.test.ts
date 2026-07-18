import { describe, expect, it } from 'vitest';
import { charsetWidthById, getCodec } from '../../src/wire/codepages';

describe('codepage codecs', () => {
    it('round-trips greek through WIN1253', () => {
        const c = getCodec('WIN1253')!;
        expect(c).toBeTruthy();
        const bytes = c.encode('Αθήνα');
        expect(bytes.toString('hex')).toBe('c1e8deede1');
        expect(c.decode(bytes)).toBe('Αθήνα');
    });

    it('round-trips cyrillic through WIN1251 and KOI8R (different byte layouts)', () => {
        const win = getCodec('WIN1251')!;
        const koi = getCodec('KOI8R')!;
        const s = 'Привет';
        expect(win.decode(win.encode(s))).toBe(s);
        expect(koi.decode(koi.encode(s))).toBe(s);
        expect(win.encode(s).equals(koi.encode(s))).toBe(false);
    });

    it('replaces unmappable characters with ? on encode', () => {
        const c = getCodec('WIN1253')!;
        expect(c.encode('a日b').toString('latin1')).toBe('a?b');
    });

    it('returns null for unknown charsets and caches results', () => {
        expect(getCodec('NO_SUCH_CHARSET')).toBeNull();
        expect(getCodec('WIN1253')).toBe(getCodec('win1253')); // case-insensitive, cached
    });

    it('knows multi-byte charset widths by id', () => {
        expect(charsetWidthById(4)).toBe(4);  // UTF8
        expect(charsetWidthById(3)).toBe(3);  // UNICODE_FSS
        expect(charsetWidthById(0)).toBe(1);  // NONE
        expect(charsetWidthById(54)).toBe(1); // WIN1253
        expect(charsetWidthById(undefined)).toBe(1);
    });
});
