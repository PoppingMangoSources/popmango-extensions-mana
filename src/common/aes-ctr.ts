/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * AES-CTR, written out in full.
 *
 * Kept apart from `aes.ts` because that file imports `crypto-js`, which cannot be
 * tree-shaken: a source that only needs this cipher would otherwise pay for both.
 */

/**
 * The AES tables, built once on first use.
 *
 * `mana-dev build` evaluates a bundle to read its intents, so a table computed at module
 * scope runs before the helper that fills it — which fails the build quietly.
 */
let tables:
  | {
      sbox: Uint8Array;
      t0: Uint32Array;
      t1: Uint32Array;
      t2: Uint32Array;
      t3: Uint32Array;
    }
  | undefined;

function aesTables(): NonNullable<typeof tables> {
  if (tables) return tables;

  const sbox = new Uint8Array(256);
  const t0 = new Uint32Array(256);
  const t1 = new Uint32Array(256);
  const t2 = new Uint32Array(256);
  const t3 = new Uint32Array(256);
  const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));

  let x = 0;
  let inverse = 0;
  for (let i = 0; i < 256; i++) {
    let sx = inverse ^ (inverse << 1) ^ (inverse << 2) ^ (inverse << 3) ^ (inverse << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    sbox[x] = sx;

    const mixed = (double[sx]! * 0x101) ^ (sx * 0x1010100);
    t0[x] = (mixed << 24) | (mixed >>> 8);
    t1[x] = (mixed << 16) | (mixed >>> 16);
    t2[x] = (mixed << 8) | (mixed >>> 24);
    t3[x] = mixed;

    if (x === 0) {
      x = inverse = 1;
    } else {
      const x2 = double[x]!;
      const x8 = double[double[x2]!]!;
      x = x2 ^ double[double[double[x8 ^ x2]!]!]!;
      inverse ^= double[double[inverse]!]!;
    }
  }

  tables = { sbox, t0, t1, t2, t3 };
  return tables;
}

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandKey(key: Uint8Array): Uint32Array {
  const { sbox } = aesTables();
  const substitute = (word: number): number =>
    (sbox[word >>> 24]! << 24) |
    (sbox[(word >>> 16) & 0xff]! << 16) |
    (sbox[(word >>> 8) & 0xff]! << 8) |
    sbox[word & 0xff]!;

  const words = key.length / 4;
  const schedule = new Uint32Array((words + 7) * 4);

  for (let i = 0; i < schedule.length; i++) {
    if (i < words) {
      schedule[i] =
        (key[i * 4]! << 24) | (key[i * 4 + 1]! << 16) | (key[i * 4 + 2]! << 8) | key[i * 4 + 3]!;
      continue;
    }

    let word = schedule[i - 1]!;
    if (i % words === 0) word = substitute((word << 8) | (word >>> 24)) ^ (RCON[i / words]! << 24);
    else if (words > 6 && i % words === 4) word = substitute(word);
    schedule[i] = schedule[i - words]! ^ word;
  }

  return schedule;
}

/**
 * AES-CTR decryption.
 *
 * CTR is its own inverse, so this both encrypts and decrypts, and the ciphertext needs no
 * block alignment. `counter` is the whole first counter block: a site that keeps a nonce in
 * its leading bytes leaves the rest zero, and the low 32 bits step from there, which is the
 * convention those sites are written against.
 *
 * Written out rather than handed to `crypto-js` like the CBC above, because this one runs
 * over whole images. `crypto-js` speaks in arrays of numbers, so a megabyte and a half of
 * page becomes four hundred thousand boxed words on the way in and again on the way out,
 * and that conversion costs more than the cipher: measured against Node's own AES, this is
 * about three times faster than the same call through `crypto-js`, which is most of a
 * second over a sixteen page chapter.
 */
export function aesCtrDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  counter: Uint8Array,
): Uint8Array {
  if (counter.length !== 16) {
    throw new Error(`Invalid counter length ${counter.length} (expected 16)`);
  }
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`Invalid key length ${key.length} (expected 16, 24 or 32)`);
  }

  const { sbox, t0, t1, t2, t3 } = aesTables();
  const schedule = expandKey(key);
  const rounds = schedule.length / 4 - 1;
  const out = new Uint8Array(ciphertext.length);

  const nonceHigh = (counter[0]! << 24) | (counter[1]! << 16) | (counter[2]! << 8) | counter[3]!;
  const nonceLow = (counter[4]! << 24) | (counter[5]! << 16) | (counter[6]! << 8) | counter[7]!;

  const lastRound = (a: number, b: number, c: number, d: number): number =>
    (sbox[a >>> 24]! << 24) |
    (sbox[(b >>> 16) & 0xff]! << 16) |
    (sbox[(c >>> 8) & 0xff]! << 8) |
    sbox[d & 0xff]!;

  for (let offset = 0, block = 0; offset < ciphertext.length; offset += 16, block++) {
    let s0 = nonceHigh ^ schedule[0]!;
    let s1 = nonceLow ^ schedule[1]!;
    let s2 = Math.floor(block / 0x100000000) ^ schedule[2]!;
    let s3 = block ^ schedule[3]!;

    let at = 4;
    for (let round = 1; round < rounds; round++) {
      const n0 =
        t0[s0 >>> 24]! ^
        t1[(s1 >>> 16) & 0xff]! ^
        t2[(s2 >>> 8) & 0xff]! ^
        t3[s3 & 0xff]! ^
        schedule[at++]!;
      const n1 =
        t0[s1 >>> 24]! ^
        t1[(s2 >>> 16) & 0xff]! ^
        t2[(s3 >>> 8) & 0xff]! ^
        t3[s0 & 0xff]! ^
        schedule[at++]!;
      const n2 =
        t0[s2 >>> 24]! ^
        t1[(s3 >>> 16) & 0xff]! ^
        t2[(s0 >>> 8) & 0xff]! ^
        t3[s1 & 0xff]! ^
        schedule[at++]!;
      const n3 =
        t0[s3 >>> 24]! ^
        t1[(s0 >>> 16) & 0xff]! ^
        t2[(s1 >>> 8) & 0xff]! ^
        t3[s2 & 0xff]! ^
        schedule[at++]!;
      s0 = n0;
      s1 = n1;
      s2 = n2;
      s3 = n3;
    }

    const k0 = lastRound(s0, s1, s2, s3) ^ schedule[at++]!;
    const k1 = lastRound(s1, s2, s3, s0) ^ schedule[at++]!;
    const k2 = lastRound(s2, s3, s0, s1) ^ schedule[at++]!;
    const k3 = lastRound(s3, s0, s1, s2) ^ schedule[at]!;

    const end = Math.min(16, ciphertext.length - offset);
    for (let i = 0; i < end; i++) {
      const word = i < 4 ? k0 : i < 8 ? k1 : i < 12 ? k2 : k3;
      out[offset + i] = ciphertext[offset + i]! ^ ((word >>> (24 - (i & 3) * 8)) & 0xff);
    }
  }

  return out;
}
