/* SPDX-License-Identifier: GPL-3.0-or-later */

import CryptoJS from "crypto-js";

/**
 * AES-CBC decryption, and the byte helpers a site's own encryption needs around it.
 *
 * The runtime exposes no `crypto.subtle`, so a source undoing a site's AES brings its own.
 * The cipher itself is `crypto-js`, which bundles into the source and has been run in a bare
 * V8 context to prove it needs no host: this file used to carry a hand-written FIPS-197
 * inverse cipher instead, which was correct — 180 random vectors against Node agreed — and
 * still 145 lines of S-box and key schedule to own.
 *
 * The padding is stripped here rather than by `crypto-js`, because the tolerance below is
 * the point: sites that pad badly are exactly the sites that need this file.
 *
 * The byte helpers this used to carry live in `bytes.ts`, so a source that only decodes
 * base64 does not bundle a cipher it never calls.
 */

/** `crypto-js` speaks in 32-bit words; the runtime and every caller here speak in bytes. */
function toWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (bytes[i]! << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function toBytes(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(wordArray.sigBytes);
  for (let i = 0; i < wordArray.sigBytes; i++) {
    out[i] = (wordArray.words[i >>> 2]! >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
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

  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`Invalid key length ${key.length} (expected 16, 24 or 32)`);
  }

  // Unpadded, so the block below decides what to strip. Handing `crypto-js` a padding mode
  // would let it throw on a site that padded badly, where the whole point here is not to.
  const output = toBytes(
    CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: toWordArray(ciphertext) }),
      toWordArray(key),
      { iv: toWordArray(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding },
    ),
  );

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
