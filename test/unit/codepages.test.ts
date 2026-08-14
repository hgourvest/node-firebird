import { afterEach, describe, expect, it, vi } from 'vitest';
import { charsetWidthById, getCodec } from '../../src/wire/codepages';
import { resolveTextState } from '../../src/wire/xsqlvar';

describe('codepage codecs', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('encodes and decodes the complete printable WIN1252 extension range', () => {
        const c = getCodec('WIN1252')!;
        const text = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
        const bytes = Buffer.from('8082838485868788898a8b8c8e9192939495969798999a9b9c9e9f', 'hex');

        expect(c).toBeTruthy();
        expect(c.encode(text)).toEqual(bytes);
        expect(c.decode(bytes)).toBe(text);
        expect(getCodec('win1252')).toBe(c);
    });

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
        expect(getCodec('WIN1252')!.encode('a日b').toString('latin1')).toBe('a?b');
    });

    it('returns null for unknown charsets and caches results', () => {
        expect(getCodec('NO_SUCH_CHARSET')).toBeNull();
        expect(getCodec('WIN1253')).toBe(getCodec('win1253')); // case-insensitive, cached
    });

    it('fails explicitly when a requested codepage codec is unavailable and does not cache the failure', () => {
        const NativeTextDecoder = TextDecoder;
        vi.stubGlobal('TextDecoder', class {
            constructor(label: string) {
                throw new RangeError(`Unsupported encoding: ${label}`);
            }
        });

        expect(() => resolveTextState({ encoding: 'WIN1258' })).toThrow(
            /Firebird encoding WIN1258 requires the windows-1258 ICU codec/
        );

        vi.stubGlobal('TextDecoder', NativeTextDecoder);
        expect(resolveTextState({ encoding: 'WIN1258' }).codec).toBeTruthy();
    });

    it('knows multi-byte charset widths by id', () => {
        expect(charsetWidthById(4)).toBe(4);  // UTF8
        expect(charsetWidthById(3)).toBe(3);  // UNICODE_FSS
        expect(charsetWidthById(0)).toBe(1);  // NONE
        expect(charsetWidthById(54)).toBe(1); // WIN1253
        expect(charsetWidthById(undefined)).toBe(1);
    });
});
