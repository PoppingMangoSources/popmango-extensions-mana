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

/** Codepoints rather than characters: `String.fromCharCode` takes them a chunk at a time. */
const BASE64_CODES = Uint8Array.from(BASE64_ALPHABET, (character) => character.charCodeAt(0));

/**
 * How many characters are built before they are turned into a string.
 *
 * `String.fromCharCode` is applied to a slice, so the chunk has to stay well inside the
 * argument limit a runtime will accept — eight thousand is far below every engine's.
 */
const BASE64_CHUNK = 8192;

/**
 * Encodes bytes as padded base64 — what a page handed to the app as `raw` has to be,
 * where `bytesToBase64Url` answers the shape a signature travels in.
 *
 * Built a chunk at a time rather than a character at a time: a decrypted page is megabytes,
 * and appending to one string four times per three bytes spent half a second on a two
 * megabyte image, which is most of what a reader waits for.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = new Uint8Array(BASE64_CHUNK);
  let at = 0;

  const flush = (): void => {
    parts.push(String.fromCharCode(...chunk.subarray(0, at)));
    at = 0;
  };

  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i]!;
    const second = bytes[i + 1];
    const third = bytes[i + 2];

    chunk[at++] = BASE64_CODES[first >> 2]!;
    chunk[at++] = BASE64_CODES[((first & 0x03) << 4) | ((second ?? 0) >> 4)]!;
    chunk[at++] =
      second === undefined ? 0x3d : BASE64_CODES[((second & 0x0f) << 2) | ((third ?? 0) >> 6)]!;
    chunk[at++] = third === undefined ? 0x3d : BASE64_CODES[third & 0x3f]!;

    if (at >= BASE64_CHUNK) flush();
  }
  if (at > 0) flush();

  return parts.join("");
}
