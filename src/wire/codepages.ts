/***************************************
 *
 *   Single-byte codepage codecs (WIN125x, ISO8859_x, KOI8, DOS866)
 *
 *   Node's Buffer only decodes utf8/latin1/ascii natively. These
 *   codepages are decoded through the WHATWG TextDecoder (backed by
 *   ICU — present in every official Node build) and encoded through
 *   reverse tables built from the same decoder at first use, so the
 *   two directions can never disagree. Issues #319/#301/#422.
 *
 ***************************************/

export interface TextCodec {
    /** Firebird charset name (upper case). */
    name: string;
    decode(buffer: Buffer): string;
    encode(value: string): Buffer;
}

/** Firebird charset name → WHATWG encoding label (single-byte only). */
const ICU_LABELS: Readonly<Record<string, string>> = Object.freeze({
    WIN1250: 'windows-1250',
    WIN1251: 'windows-1251',
    WIN1253: 'windows-1253',
    WIN1254: 'windows-1254',
    WIN1255: 'windows-1255',
    WIN1256: 'windows-1256',
    WIN1257: 'windows-1257',
    WIN1258: 'windows-1258',
    ISO8859_2: 'iso-8859-2',
    ISO8859_3: 'iso-8859-3',
    ISO8859_4: 'iso-8859-4',
    ISO8859_5: 'iso-8859-5',
    ISO8859_6: 'iso-8859-6',
    ISO8859_7: 'iso-8859-7',
    ISO8859_8: 'iso-8859-8',
    ISO8859_9: 'iso-8859-9',
    ISO8859_13: 'iso-8859-13',
    KOI8R: 'koi8-r',
    KOI8U: 'koi8-u',
    DOS866: 'ibm866',
});

/**
 * Bytes-per-character by Firebird charset id (RDB$CHARACTER_SETS —
 * verified against a live server). Everything not listed (NONE, ASCII,
 * ISO8859_x, WIN125x, DOS*, KOI8*, CYRL, TIS620, …) is single-byte.
 */
const CHARSET_WIDTH_BY_ID: Readonly<Record<number, number>> = Object.freeze({
    3: 3,  // UNICODE_FSS
    4: 4,  // UTF8
    5: 2,  // SJIS_0208
    6: 2,  // EUCJ_0208
    44: 2, // KSC_5601
    56: 2, // BIG_5
    57: 2, // GB_2312
    67: 2, // GBK
    68: 2, // CP943C
    69: 4, // GB18030
});

export function charsetWidthById(id: number | undefined): number {
    if (id === undefined) {
        return 1;
    }
    return CHARSET_WIDTH_BY_ID[id] || 1;
}

const cache = new Map<string, TextCodec | null>();

function buildCodec(name: string): TextCodec | null {
    const label = ICU_LABELS[name];
    if (!label) {
        return null;
    }
    let decoder: TextDecoder;
    try {
        decoder = new TextDecoder(label);
    } catch {
        // Node built with small-icu: legacy encodings unavailable
        return null;
    }

    // Build both directions from the decoder, one byte at a time — every
    // byte of a single-byte codepage maps to exactly one BMP character
    // (undefined bytes decode to U+FFFD, which is kept for decoding but
    // never used for the reverse map).
    const toCode = new Uint16Array(256);
    const toByte = new Map<string, number>();
    const one = Buffer.alloc(1);
    for (let i = 0; i < 256; i++) {
        one[0] = i;
        const ch = decoder.decode(one);
        toCode[i] = ch.charCodeAt(0);
        if (ch !== '�' && !toByte.has(ch)) {
            toByte.set(ch, i);
        }
    }

    return {
        name,
        decode(buffer: Buffer): string {
            // batch through fromCharCode instead of per-byte string concat —
            // wide CHAR columns and text blobs decode in O(chunks) allocations
            const codes = new Array<number>(buffer.length);
            for (let i = 0; i < buffer.length; i++) {
                codes[i] = toCode[buffer[i]];
            }
            const CHUNK = 4096;
            if (codes.length <= CHUNK) {
                return String.fromCharCode(...codes);
            }
            let out = '';
            for (let i = 0; i < codes.length; i += CHUNK) {
                out += String.fromCharCode(...codes.slice(i, i + CHUNK));
            }
            return out;
        },
        encode(value: string): Buffer {
            const out = Buffer.alloc(value.length);
            for (let i = 0; i < value.length; i++) {
                const b = toByte.get(value[i]);
                // unmappable characters become '?' — the convention every
                // codepage transcoder (incl. iconv) uses by default
                out[i] = b === undefined ? 0x3f : b;
            }
            return out;
        },
    };
}

/**
 * Codec for a Firebird charset name, or null when the charset is unknown,
 * natively handled by Buffer, or the ICU tables are unavailable. Cached.
 */
export function getCodec(charsetName: string | undefined): TextCodec | null {
    if (!charsetName) {
        return null;
    }
    const name = String(charsetName).toUpperCase();
    let codec = cache.get(name);
    if (codec === undefined) {
        codec = buildCodec(name);
        cache.set(name, codec);
    }
    return codec;
}
