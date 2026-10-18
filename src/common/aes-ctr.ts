/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * AES-CTR, written out in full.
 *
 * Kept apart from `aes.ts` because that file imports `crypto-js`, which cannot be
 * tree-shaken: a source that only needs this cipher would otherwise pay for both.
 *
 * Shaped for the runtime that actually runs it. An app's own JavaScript on iOS gets no JIT,
 * so every operation in the inner loop is paid for in full, a page at a time: the stream is
 * XORed four bytes at a time in place rather than a byte at a time into a copy, and the parts
 * of the first two rounds that only the counter's low byte can change are worked out once per
 * 256 blocks. Measured without a JIT, that took an 800 KB page from 480 ms to under 200.
 */

type Tables = { sbox: Uint8Array; mix: Int32Array[]; final: Int32Array[] };

/**
 * The AES tables, built once on first use.
 *
 * `mana-dev build` evaluates a bundle to read its intents, so a table computed at module
 * scope runs before the helper that fills it — which fails the build quietly.
 *
 * The final-round tables hold each S-box byte where it sits in memory, so the keystream can
 * be XORed through an `Int32Array` view on whichever byte order the device has.
 */
let tables: Tables | undefined;

function aesTables(): Tables {
  if (tables) return tables;

  const sbox = new Uint8Array(256);
  const mix = [0, 1, 2, 3].map(() => new Int32Array(256));
  const final = [0, 1, 2, 3].map(() => new Int32Array(256));
  const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  let x = 0;
  let xi = 0;
  for (let i = 0; i < 256; i++) {
    let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    sbox[x] = sx;
    for (let n = 0; n < 4; n++) final[n]![x] = sx << (littleEndian ? n * 8 : 24 - n * 8);

    const x2 = double[x]!;
    const x8 = double[double[x2]!]!;
    const t = (double[sx]! * 0x101) ^ (sx * 0x1010100);
    mix[0]![x] = (t << 24) | (t >>> 8);
    mix[1]![x] = (t << 16) | (t >>> 16);
    mix[2]![x] = (t << 8) | (t >>> 24);
    mix[3]![x] = t;

    if (x === 0) {
      x = xi = 1;
    } else {
      x = x2 ^ double[double[double[x8 ^ x2]!]!]!;
      xi ^= double[double[xi]!]!;
    }
  }

  tables = { sbox, mix, final };
  return tables;
}

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandKey(key: Uint8Array, sbox: Uint8Array): Int32Array {
  const words = key.length / 4;
  if (words !== 4 && words !== 6 && words !== 8) {
    throw new Error(`Invalid key length ${key.length} (expected 16, 24 or 32)`);
  }

  const sub = (t: number): number =>
    (sbox[t >>> 24]! << 24) |
    (sbox[(t >>> 16) & 0xff]! << 16) |
    (sbox[(t >>> 8) & 0xff]! << 8) |
    sbox[t & 0xff]!;

  const schedule = new Int32Array((words + 7) * 4);
  for (let i = 0; i < schedule.length; i++) {
    if (i < words) {
      schedule[i] =
        (key[i * 4]! << 24) | (key[i * 4 + 1]! << 16) | (key[i * 4 + 2]! << 8) | key[i * 4 + 3]!;
      continue;
    }
    let t = schedule[i - 1]!;
    if (i % words === 0) t = sub((t << 8) | (t >>> 24)) ^ (RCON[i / words]! << 24);
    else if (words > 6 && i % words === 4) t = sub(t);
    schedule[i] = schedule[i - words]! ^ t;
  }
  return schedule;
}

/**
 * Decrypts an AES-CTR stream in place and hands the same array back.
 *
 * CTR is its own inverse, so this encrypts as well. The counter block is the first eight
 * bytes of `nonce` followed by a 64-bit block count starting at zero, which is the layout the
 * sites doing this use.
 *
 * `firstBlock` is where `data` starts in the stream, in 16-byte blocks, so a long stream can
 * be decrypted a slice at a time — each slice handed in as a `subarray` of the whole.
 */
export function aesCtrDecryptInPlace(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  firstBlock = 0,
): Uint8Array {
  if (nonce.length < 8) throw new Error(`Invalid nonce length ${nonce.length} (expected 8+)`);

  const { sbox, mix, final } = aesTables();
  const rk = expandKey(key, sbox);
  const end = rk.length - 4;
  const m0 = mix[0]!;
  const m1 = mix[1]!;
  const m2 = mix[2]!;
  const m3 = mix[3]!;
  const f0 = final[0]!;
  const f1 = final[1]!;
  const f2 = final[2]!;
  const f3 = final[3]!;

  // The last round key, in memory order like the final-round tables.
  const last = new Int32Array(4);
  const lastView = new DataView(last.buffer);
  for (let i = 0; i < 4; i++) lastView.setInt32(i * 4, rk[end + i]!, false);
  const l0 = last[0]!;
  const l1 = last[1]!;
  const l2 = last[2]!;
  const l3 = last[3]!;

  const length = data.length;
  const aligned = (data.byteOffset & 3) === 0;
  const wordCount = aligned ? length >>> 2 : 0;
  const words = aligned
    ? new Int32Array(data.buffer, data.byteOffset, wordCount)
    : new Int32Array(0);
  const tail = new Int32Array(4);
  const tailBytes = new Uint8Array(tail.buffer);

  const c0 = ((nonce[0]! << 24) | (nonce[1]! << 16) | (nonce[2]! << 8) | nonce[3]!) ^ rk[0]!;
  const c1 = ((nonce[4]! << 24) | (nonce[5]! << 16) | (nonce[6]! << 8) | nonce[7]!) ^ rk[1]!;
  const blocks = Math.ceil(length / 16);

  // First-round terms that depend only on the nonce.
  const a0 = m0[c0 >>> 24]! ^ m1[(c1 >>> 16) & 0xff]! ^ rk[4]!;
  const a1 = m0[c1 >>> 24]! ^ m3[c0 & 0xff]! ^ rk[5]!;
  const a2 = m2[(c0 >>> 8) & 0xff]! ^ m3[c1 & 0xff]! ^ rk[6]!;
  const a3 = m1[(c0 >>> 16) & 0xff]! ^ m2[(c1 >>> 8) & 0xff]! ^ rk[7]!;

  let r0 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  for (let i = 0, w = 0; i < blocks; i++, w += 4) {
    const block = firstBlock + i;
    const c3 = block ^ rk[3]!;
    if (i === 0 || (block & 0xff) === 0) {
      // Everything but the counter's low byte holds for the next 256 blocks.
      const c2 = Math.floor(block / 0x100000000) ^ rk[2]!;
      r0 = a0 ^ m2[(c2 >>> 8) & 0xff]!;
      const t1 = a1 ^ m1[(c2 >>> 16) & 0xff]! ^ m2[(c3 >>> 8) & 0xff]!;
      const t2 = a2 ^ m0[c2 >>> 24]! ^ m1[(c3 >>> 16) & 0xff]!;
      const t3 = a3 ^ m0[c3 >>> 24]! ^ m3[c2 & 0xff]!;
      b0 = m1[(t1 >>> 16) & 0xff]! ^ m2[(t2 >>> 8) & 0xff]! ^ m3[t3 & 0xff]! ^ rk[8]!;
      b1 = m0[t1 >>> 24]! ^ m1[(t2 >>> 16) & 0xff]! ^ m2[(t3 >>> 8) & 0xff]! ^ rk[9]!;
      b2 = m0[t2 >>> 24]! ^ m1[(t3 >>> 16) & 0xff]! ^ m3[t1 & 0xff]! ^ rk[10]!;
      b3 = m0[t3 >>> 24]! ^ m2[(t1 >>> 8) & 0xff]! ^ m3[t2 & 0xff]! ^ rk[11]!;
    }

    const t0 = r0 ^ m3[c3 & 0xff]!;
    let s0 = b0 ^ m0[t0 >>> 24]!;
    let s1 = b1 ^ m3[t0 & 0xff]!;
    let s2 = b2 ^ m2[(t0 >>> 8) & 0xff]!;
    let s3 = b3 ^ m1[(t0 >>> 16) & 0xff]!;
    for (let k = 12; k < end;) {
      const n0 =
        m0[s0 >>> 24]! ^
        m1[(s1 >>> 16) & 0xff]! ^
        m2[(s2 >>> 8) & 0xff]! ^
        m3[s3 & 0xff]! ^
        rk[k++]!;
      const n1 =
        m0[s1 >>> 24]! ^
        m1[(s2 >>> 16) & 0xff]! ^
        m2[(s3 >>> 8) & 0xff]! ^
        m3[s0 & 0xff]! ^
        rk[k++]!;
      const n2 =
        m0[s2 >>> 24]! ^
        m1[(s3 >>> 16) & 0xff]! ^
        m2[(s0 >>> 8) & 0xff]! ^
        m3[s1 & 0xff]! ^
        rk[k++]!;
      s3 =
        m0[s3 >>> 24]! ^
        m1[(s0 >>> 16) & 0xff]! ^
        m2[(s1 >>> 8) & 0xff]! ^
        m3[s2 & 0xff]! ^
        rk[k++]!;
      s0 = n0;
      s1 = n1;
      s2 = n2;
    }

    const o0 =
      f0[s0 >>> 24]! ^ f1[(s1 >>> 16) & 0xff]! ^ f2[(s2 >>> 8) & 0xff]! ^ f3[s3 & 0xff]! ^ l0;
    const o1 =
      f0[s1 >>> 24]! ^ f1[(s2 >>> 16) & 0xff]! ^ f2[(s3 >>> 8) & 0xff]! ^ f3[s0 & 0xff]! ^ l1;
    const o2 =
      f0[s2 >>> 24]! ^ f1[(s3 >>> 16) & 0xff]! ^ f2[(s0 >>> 8) & 0xff]! ^ f3[s1 & 0xff]! ^ l2;
    const o3 =
      f0[s3 >>> 24]! ^ f1[(s0 >>> 16) & 0xff]! ^ f2[(s1 >>> 8) & 0xff]! ^ f3[s2 & 0xff]! ^ l3;

    if (w + 4 <= wordCount) {
      words[w]! ^= o0;
      words[w + 1]! ^= o1;
      words[w + 2]! ^= o2;
      words[w + 3]! ^= o3;
    } else {
      tail[0] = o0;
      tail[1] = o1;
      tail[2] = o2;
      tail[3] = o3;
      const at = i * 16;
      for (let b = 0; b < 16 && at + b < length; b++) data[at + b]! ^= tailBytes[b]!;
    }
  }

  return data;
}

/** The same, into a copy, for a caller that still needs the ciphertext. */
export function aesCtrDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return aesCtrDecryptInPlace(ciphertext.slice(), key, nonce);
}
