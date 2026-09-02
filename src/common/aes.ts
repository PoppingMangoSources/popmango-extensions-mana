/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A self-contained AES-CBC decryptor.
 *
 * Mana's source runtime exposes no `crypto.subtle`, so sources that have to
 * undo a site's own AES encryption bring their own. This is the plain FIPS-197
 * inverse cipher — small enough to read, and with no host dependency to break
 * when the runtime changes underneath it.
 */

/**
 * The S-box is derived rather than transcribed: 256 hand-copied hex bytes are
 * the kind of table that is wrong in exactly one place and impossible to spot.
 */
function buildSBox(): { sbox: Uint8Array; inv: Uint8Array } {
  const sbox = new Uint8Array(256);
  const inv = new Uint8Array(256);

  const rotl8 = (value: number, shift: number): number =>
    ((value << shift) | (value >>> (8 - shift))) & 0xff;

  let p = 1;
  let q = 1;
  do {
    // p *= 3 in GF(2^8)
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0)) & 0xff;

    // q /= 3 in GF(2^8)
    q ^= (q << 1) & 0xff;
    q ^= (q << 2) & 0xff;
    q ^= (q << 4) & 0xff;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;

    const value = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
    sbox[p] = value;
  } while (p !== 1);

  sbox[0] = 0x63;
  for (let i = 0; i < 256; i++) inv[sbox[i]!] = i;

  return { sbox, inv };
}

const { sbox: SBOX, inv: INV_SBOX } = buildSBox();

/** Multiplication in GF(2^8) with the AES reduction polynomial. */
function mul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    const high = x & 0x80;
    x = (x << 1) & 0xff;
    if (high) x ^= 0x1b;
    y >>>= 1;
  }
  return result & 0xff;
}

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

/** Expands the key into `4 * (rounds + 1)` words, held flat as bytes. */
function expandAesKey(key: Uint8Array): { schedule: Uint8Array; rounds: number } {
  const nk = key.length / 4;
  if (nk !== 4 && nk !== 6 && nk !== 8) {
    throw new Error(`Unsupported AES key length: ${key.length} bytes`);
  }

  const rounds = nk + 6;
  const total = 4 * (rounds + 1);
  const schedule = new Uint8Array(total * 4);
  schedule.set(key, 0);

  for (let i = nk; i < total; i++) {
    let t0 = schedule[(i - 1) * 4]!;
    let t1 = schedule[(i - 1) * 4 + 1]!;
    let t2 = schedule[(i - 1) * 4 + 2]!;
    let t3 = schedule[(i - 1) * 4 + 3]!;

    if (i % nk === 0) {
      // RotWord, then SubWord, then XOR the round constant.
      const rotated = [t1, t2, t3, t0];
      t0 = SBOX[rotated[0]!]! ^ RCON[i / nk - 1]!;
      t1 = SBOX[rotated[1]!]!;
      t2 = SBOX[rotated[2]!]!;
      t3 = SBOX[rotated[3]!]!;
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0]!;
      t1 = SBOX[t1]!;
      t2 = SBOX[t2]!;
      t3 = SBOX[t3]!;
    }

    schedule[i * 4] = schedule[(i - nk) * 4]! ^ t0;
    schedule[i * 4 + 1] = schedule[(i - nk) * 4 + 1]! ^ t1;
    schedule[i * 4 + 2] = schedule[(i - nk) * 4 + 2]! ^ t2;
    schedule[i * 4 + 3] = schedule[(i - nk) * 4 + 3]! ^ t3;
  }

  return { schedule, rounds };
}

function addRoundKey(state: Uint8Array, schedule: Uint8Array, round: number): void {
  const offset = round * 16;
  for (let i = 0; i < 16; i++) state[i] = state[i]! ^ schedule[offset + i]!;
}

/** Row `r` rotates right by `r`. State bytes are column-major: `r + 4c`. */
function invShiftRows(state: Uint8Array): void {
  const copy = state.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      state[r + 4 * ((c + r) % 4)] = copy[r + 4 * c]!;
    }
  }
}

function invSubBytes(state: Uint8Array): void {
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]!]!;
}

function invMixColumns(state: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const base = 4 * c;
    const a0 = state[base]!;
    const a1 = state[base + 1]!;
    const a2 = state[base + 2]!;
    const a3 = state[base + 3]!;

    state[base] = mul(a0, 0x0e) ^ mul(a1, 0x0b) ^ mul(a2, 0x0d) ^ mul(a3, 0x09);
    state[base + 1] = mul(a0, 0x09) ^ mul(a1, 0x0e) ^ mul(a2, 0x0b) ^ mul(a3, 0x0d);
    state[base + 2] = mul(a0, 0x0d) ^ mul(a1, 0x09) ^ mul(a2, 0x0e) ^ mul(a3, 0x0b);
    state[base + 3] = mul(a0, 0x0b) ^ mul(a1, 0x0d) ^ mul(a2, 0x09) ^ mul(a3, 0x0e);
  }
}

function decryptBlock(block: Uint8Array, schedule: Uint8Array, rounds: number): Uint8Array {
  const state = block.slice();

  addRoundKey(state, schedule, rounds);
  for (let round = rounds - 1; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, schedule, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, schedule, 0);

  return state;
}

type AesPadding = "none" | "pkcs7" | "zero";

/**
 * Decrypts an AES-CBC ciphertext.
 *
 * `padding` defaults to `"zero"` because that is what the sites doing this
 * tend to use — PKCS#7 stripping is available for the ones that do it properly.
 */
export function aesCbcDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  padding: AesPadding = "zero",
): Uint8Array {
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error(`Invalid ciphertext length ${ciphertext.length} (not a multiple of 16)`);
  }
  if (iv.length !== 16) throw new Error(`Invalid IV length ${iv.length} (expected 16)`);

  const { schedule, rounds } = expandAesKey(key);
  const output = new Uint8Array(ciphertext.length);

  let previous = iv;
  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const block = ciphertext.subarray(offset, offset + 16);
    const plain = decryptBlock(block, schedule, rounds);
    for (let i = 0; i < 16; i++) plain[i] = plain[i]! ^ previous[i]!;
    output.set(plain, offset);
    previous = block;
  }

  if (padding === "pkcs7") {
    const pad = output[output.length - 1] ?? 0;
    if (pad >= 1 && pad <= 16 && pad <= output.length)
      return output.subarray(0, output.length - pad);
    return output;
  }

  if (padding === "zero") {
    let end = output.length;
    while (end > 0 && output[end - 1] === 0) end--;
    return output.subarray(0, end);
  }

  return output;
}

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
