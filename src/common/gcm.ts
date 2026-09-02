/* SPDX-License-Identifier: GPL-3.0-or-later */

import { aesEncryptBlock, expandAesKey } from "./aes.ts";

const BLOCK = 16;

/**
 * Multiplies two 128-bit values in GF(2^128) under GCM's bit ordering, which numbers bits
 * from the most significant end — hence the reversed shift direction and the 0xe1 constant.
 */
function multiplyGf(x: Uint32Array, y: Uint32Array): Uint32Array {
  const z = new Uint32Array(4);
  const v = y.slice();

  for (let word = 0; word < 4; word++) {
    for (let bit = 0; bit < 32; bit++) {
      if ((x[word]! >>> (31 - bit)) & 1) {
        for (let i = 0; i < 4; i++) z[i] = (z[i]! ^ v[i]!) >>> 0;
      }

      const carry = v[3]! & 1;
      for (let i = 3; i > 0; i--) v[i] = ((v[i]! >>> 1) | (v[i - 1]! << 31)) >>> 0;
      v[0] = v[0]! >>> 1;
      if (carry) v[0] = (v[0]! ^ 0xe1000000) >>> 0;
    }
  }

  return z;
}

function toWords(bytes: Uint8Array, offset: number): Uint32Array {
  const words = new Uint32Array(4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) words[i] = view.getUint32(offset + i * 4);
  return words;
}

/** GHASH over `data`, zero-padded to whole blocks, keyed by the hash subkey `h`. */
function ghash(h: Uint32Array, data: Uint8Array, state: Uint32Array): Uint32Array {
  let y = state;

  for (let offset = 0; offset < data.length; offset += BLOCK) {
    const block = new Uint8Array(BLOCK);
    block.set(data.subarray(offset, Math.min(offset + BLOCK, data.length)));
    const chunk = toWords(block, 0);
    const xored = new Uint32Array(4);
    for (let i = 0; i < 4; i++) xored[i] = (y[i]! ^ chunk[i]!) >>> 0;
    y = multiplyGf(xored, h);
  }

  return y;
}

type Cipher = { schedule: Uint8Array; rounds: number };

/**
 * XORs `input` with the keystream from J0. Counting starts at `inc32(J0)`, never J0
 * itself — that block is reserved for masking the tag.
 */
function keystreamXor(cipher: Cipher, j0: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  const base = j0.slice();
  const view = new DataView(base.buffer);
  const start = view.getUint32(12);

  for (let offset = 0; offset < input.length; offset += BLOCK) {
    view.setUint32(12, (start + 1 + offset / BLOCK) >>> 0);
    const stream = aesEncryptBlock(base, cipher.schedule, cipher.rounds);
    const size = Math.min(BLOCK, input.length - offset);
    for (let i = 0; i < size; i++) out[offset + i] = input[offset + i]! ^ stream[i]!;
  }

  return out;
}

function lengthBlock(aadBits: number, textBits: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const view = new DataView(block.buffer);
  view.setUint32(0, Math.floor(aadBits / 0x100000000));
  view.setUint32(4, aadBits >>> 0);
  view.setUint32(8, Math.floor(textBits / 0x100000000));
  view.setUint32(12, textBits >>> 0);
  return block;
}

function prepare(
  key: Uint8Array,
  iv: Uint8Array,
): { cipher: Cipher; h: Uint32Array; j0: Uint8Array } {
  const { schedule, rounds } = expandAesKey(key);
  const cipher = { schedule, rounds };
  const h = toWords(aesEncryptBlock(new Uint8Array(BLOCK), schedule, rounds), 0);

  // A 96-bit IV is used directly with a counter of 1; any other length is GHASHed first.
  let j0: Uint8Array;
  if (iv.length === 12) {
    j0 = new Uint8Array(BLOCK);
    j0.set(iv);
    j0[15] = 1;
  } else {
    const withLength = ghash(h, lengthBlock(0, iv.length * 8), ghash(h, iv, new Uint32Array(4)));
    j0 = new Uint8Array(BLOCK);
    const view = new DataView(j0.buffer);
    for (let i = 0; i < 4; i++) view.setUint32(i * 4, withLength[i]!);
  }

  return { cipher, h, j0 };
}

function tagFor(
  cipher: Cipher,
  h: Uint32Array,
  j0: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  let y = ghash(h, aad, new Uint32Array(4));
  y = ghash(h, ciphertext, y);
  y = ghash(h, lengthBlock(aad.length * 8, ciphertext.length * 8), y);

  const digest = new Uint8Array(BLOCK);
  const view = new DataView(digest.buffer);
  for (let i = 0; i < 4; i++) view.setUint32(i * 4, y[i]!);

  const mask = aesEncryptBlock(j0, cipher.schedule, cipher.rounds);
  const tag = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) tag[i] = digest[i]! ^ mask[i]!;
  return tag;
}

/** Returns the ciphertext with its 16-byte tag appended, as WebCrypto does. */
export function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const { cipher, h, j0 } = prepare(key, iv);
  const ciphertext = keystreamXor(cipher, j0, plaintext);
  const tag = tagFor(cipher, h, j0, aad, ciphertext);

  const out = new Uint8Array(ciphertext.length + BLOCK);
  out.set(ciphertext);
  out.set(tag, ciphertext.length);
  return out;
}

/** Takes the ciphertext with its tag appended and throws if the tag does not match. */
export function aesGcmDecrypt(
  payload: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.length < BLOCK) throw new Error("AES-GCM payload is too short to hold a tag");

  const ciphertext = payload.subarray(0, payload.length - BLOCK);
  const expected = payload.subarray(payload.length - BLOCK);

  const { cipher, h, j0 } = prepare(key, iv);
  const tag = tagFor(cipher, h, j0, aad, ciphertext);

  let mismatch = 0;
  for (let i = 0; i < BLOCK; i++) mismatch |= tag[i]! ^ expected[i]!;
  if (mismatch !== 0) throw new Error("AES-GCM tag mismatch");

  return keystreamXor(cipher, j0, ciphertext);
}
