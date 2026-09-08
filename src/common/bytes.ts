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
 * Decodes base64 to bytes.
 *
 * `atob` is polyfilled in the runtime but yields a binary string; decoding
 * directly avoids the extra copy, and keeps this working if it ever is not.
 */
export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, "").replace(/=+$/, "");
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (const character of clean) {
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) continue;
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
