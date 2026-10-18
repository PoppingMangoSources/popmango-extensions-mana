/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Bytes to and from the shapes a site hands them in.
 *
 * The runtime has no `TextDecoder` and no `Buffer`, so these are written out. They are
 * deliberately not `crypto-js`'s equivalents, and not only because this file must stay free
 * of it — a source that reads base64 does not necessarily do any AES, and pulling the cipher
 * in behind a base64 decoder cost two sources ninety kilobytes each for nothing.
 *
 * They are also more forgiving than a library's: base64 here ignores stray characters and
 * missing padding, and the UTF-8 decoder answers a malformed sequence with a replacement
 * character. Both of those arrive from real sites, and throwing loses a chapter that would
 * have read fine.
 */

/** Decodes a hex string into bytes. */
export function decodeHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const value = Number.parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(value)) throw new Error("Invalid hex digit");
    bytes[i / 2] = value;
  }
  return bytes;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Where each base64 character stands in the alphabet, by its codepoint.
 *
 * Both alphabets are folded in, so base64url needs no rewriting pass, and `-1` marks every
 * character that is not part of either — whitespace and line breaks included, which real
 * sites do wrap their payloads in.
 */
const BASE64_VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/**
 * Decodes base64 to bytes, in either alphabet.
 *
 * `atob` is polyfilled in the runtime but yields a binary string; decoding
 * directly avoids the extra copy, and keeps this working if it ever is not.
 *
 * base64url's `-` and `_` decode as themselves rather than being dropped: a signing scheme
 * hands its keys over in that alphabet, and discarding those two characters decoded to the
 * wrong bytes and the wrong length — quietly, since what came back was still base64.
 *
 * Read through a table by codepoint rather than by searching the alphabet for each
 * character, because a decrypted page is megabytes and the search was sixty-four
 * comparisons per character of it.
 *
 * `strict` is for a value that must be base64 from end to end, such as a token's claims.
 * Skipping what it cannot read is right for a blob scraped out of a page, and wrong there:
 * quietly dropping the characters that do not belong turns an unreadable value into a
 * plausible-looking one.
 */
export function base64ToBytes(value: string, strict = false): Uint8Array {
  const output = new Uint8Array(Math.floor((value.length * 3) / 4) + 2);

  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const index = code < 128 ? BASE64_VALUES[code]! : -1;
    if (index < 0) {
      // `=` and the whitespace a server wraps a payload in are not the body being wrong.
      if (
        strict &&
        code !== 0x3d &&
        code !== 0x0a &&
        code !== 0x0d &&
        code !== 0x20 &&
        code !== 0x09
      ) {
        throw new Error("The value is not base64, so its bytes cannot be recovered.");
      }
      continue;
    }

    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return output.subarray(0, outIndex);
}

/** Decodes UTF-8 bytes into a string, without relying on `TextDecoder`. */
export function bytesToUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i]!;
    let codePoint: number;
    let size: number;

    if (byte < 0x80) {
      codePoint = byte;
      size = 1;
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f;
      size = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f;
      size = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07;
      size = 4;
    } else {
      // Not a valid lead byte — emit a replacement and resynchronise.
      result += "�";
      i += 1;
      continue;
    }

    if (i + size > bytes.length) {
      result += "�";
      break;
    }

    for (let k = 1; k < size; k++) {
      const continuation = bytes[i + k]!;
      if ((continuation & 0xc0) !== 0x80) {
        codePoint = -1;
        break;
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (codePoint < 0) {
      result += "�";
      i += 1;
      continue;
    }

    result += String.fromCodePoint(codePoint);
    i += size;
  }

  return result;
}

/** Encodes a string as UTF-8 bytes, without relying on `TextEncoder`. */
export function utf8ToBytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encodes bytes as unpadded base64url — the alphabet a query string can carry
 * without escaping, which is what request-signing schemes ask for.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let result = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i]!;
    const second = bytes[i + 1];
    const third = bytes[i + 2];

    result += BASE64URL_ALPHABET[first >> 2];
    result += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;

    result += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;

    result += BASE64URL_ALPHABET[third & 0x3f];
  }

  return result;
}

/**
 * Each pair of base64 characters a 12-bit run of input encodes to, as two bytes in memory
 * order, so one lookup writes both through a `Uint16Array` view.
 */
let base64Pairs: Uint16Array | undefined;

/** Codepoints rather than characters, so a code goes straight into a byte array. */
const BASE64_CODES = Uint8Array.from(BASE64_ALPHABET, (character) => character.charCodeAt(0));

function base64PairTable(): Uint16Array {
  if (base64Pairs) return base64Pairs;
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const table = new Uint16Array(4096);
  for (let i = 0; i < 4096; i++) {
    const high = BASE64_CODES[i >> 6]!;
    const low = BASE64_CODES[i & 63]!;
    table[i] = littleEndian ? high | (low << 8) : (high << 8) | low;
  }
  base64Pairs = table;
  return table;
}

/**
 * How many characters become one string at a time. `String.fromCharCode` is applied to a
 * slice, so the chunk stays far inside the argument limit any engine accepts.
 */
const BASE64_CHUNK = 8192;

/**
 * Encodes bytes as padded base64.
 *
 * Written for a decrypted page, which is close to a megabyte and handed back to the app as
 * base64. An app's own JavaScript on iOS runs without a JIT, so the characters are written
 * into a byte array two at a time and turned into strings a chunk at a time; appending to one
 * string per character took almost half a second a page there.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const pairs = base64PairTable();
  const length = bytes.length;
  const whole = length - (length % 3);
  const codes = new Uint8Array(Math.ceil(length / 3) * 4);
  const view = new Uint16Array(codes.buffer);

  let w = 0;
  for (let i = 0; i < whole; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    view[w++] = pairs[n >> 12]!;
    view[w++] = pairs[n & 4095]!;
  }

  if (whole < length) {
    const second = whole + 1 < length;
    const n = (bytes[whole]! << 16) | (second ? bytes[whole + 1]! << 8 : 0);
    let at = w * 2;
    codes[at++] = BASE64_CODES[n >> 18]!;
    codes[at++] = BASE64_CODES[(n >> 12) & 63]!;
    codes[at++] = second ? BASE64_CODES[(n >> 6) & 63]! : 0x3d;
    codes[at] = 0x3d;
  }

  // `apply` rather than a spread: without a JIT, spreading each chunk into arguments costs ten
  // times what the rest of this function does.
  const parts: string[] = [];
  for (let i = 0; i < codes.length; i += BASE64_CHUNK) {
    parts.push(
      String.fromCharCode.apply(null, codes.subarray(i, i + BASE64_CHUNK) as unknown as number[]),
    );
  }
  return parts.join("");
}

/**
 * Where each base64 character stands, for every code unit a string can hold, so a lookup
 * never needs a range check first: anything outside the alphabet is `-1`.
 */
let base64Body: Int8Array | undefined;

function base64BodyTable(): Int8Array {
  if (base64Body) return base64Body;
  const table = new Int8Array(65536).fill(-1);
  table.set(BASE64_VALUES);
  base64Body = table;
  return table;
}

/**
 * Decodes a base64 body the host handed over: one unbroken run of characters, padded or not,
 * in either alphabet.
 *
 * `base64ToBytes` forgives whitespace and stray characters a character at a time, which a
 * blob scraped out of a page needs; a megabyte of image does not, and reading it four
 * characters to an iteration is what keeps it to a few tens of milliseconds without a JIT.
 */
export function base64BodyToBytes(value: string): Uint8Array {
  let length = value.length;
  while (length > 0 && value.charCodeAt(length - 1) === 0x3d) length--;

  const out = new Uint8Array((length * 3) >> 2);
  const whole = length - (length & 3);
  const table = base64BodyTable();
  const at = (i: number): number => table[value.charCodeAt(i)]!;

  // The lookups are written out in the loop rather than through `at`: a call per character
  // is most of the cost without a JIT.
  let o = 0;
  for (let i = 0; i < whole; i += 4) {
    const n =
      (table[value.charCodeAt(i)]! << 18) |
      (table[value.charCodeAt(i + 1)]! << 12) |
      (table[value.charCodeAt(i + 2)]! << 6) |
      table[value.charCodeAt(i + 3)]!;
    if (n < 0) throw new Error("The body is not base64, so its bytes cannot be recovered.");
    out[o] = n >> 16;
    out[o + 1] = n >> 8;
    out[o + 2] = n;
    o += 3;
  }

  const rest = length & 3;
  if (rest === 1) throw new Error("The body is not base64, so its bytes cannot be recovered.");
  if (rest > 1) {
    const n = (at(whole) << 18) | (at(whole + 1) << 12) | (rest === 3 ? at(whole + 2) << 6 : 0);
    if (n < 0) throw new Error("The body is not base64, so its bytes cannot be recovered.");
    out[o++] = n >> 16;
    if (rest === 3) out[o] = n >> 8;
  }
  return out;
}
