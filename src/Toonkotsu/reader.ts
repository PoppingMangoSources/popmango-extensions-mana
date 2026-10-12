/* SPDX-License-Identifier: GPL-3.0-or-later */

import { aesCtrDecrypt, hmacSha256, sha256 } from "../common/aes.ts";
import { base64ToBytes, bytesToBase64, bytesToBase64Url, utf8ToBytes } from "../common/index.ts";
import { READER_SECRET, type ReaderKeyResponse, type ReaderPage } from "./model.ts";

/**
 * The reader's session: the key every chapter request is signed with, and the clock it is
 * signed against.
 *
 * The site serves its signing key masked with a digest of the reader secret, so the key
 * alone is useless to anyone who has not read the bundle. `offset` carries the difference
 * between the site's clock and this device's — a signature is stamped with a time, and a
 * phone a minute out would have every one of them rejected.
 */
export type ReaderSession = { key: Uint8Array; offset: number; build: string };

function xorCycle(data: Uint8Array, mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ mask[i % mask.length]!;
  return out;
}

/** Unmasks the served key, which is the HMAC key that signs reads and unwraps page keys. */
export function deriveSession(response: ReaderKeyResponse, secret = READER_SECRET): ReaderSession {
  const mask = sha256(utf8ToBytes(`sign:${secret}`));
  return {
    key: xorCycle(base64ToBytes(response.key), mask),
    offset: Number(response.now) - Date.now() || 0,
    build: response.build,
  };
}

/**
 * The `x-sig` header a chapter read carries.
 *
 * The nonce only has to be unique per signature, so it is drawn from the clock and
 * `Math.random`: the runtime has no `crypto.getRandomValues`, and nothing here is a secret
 * that an attacker guessing the nonce would learn.
 */
export function signPath(session: ReaderSession, path: string): string {
  const time = String(Date.now() + session.offset);
  const seed = new Uint8Array(12);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.floor(Math.random() * 256);
  const nonce = bytesToBase64Url(seed);
  const signature = bytesToBase64Url(
    hmacSha256(session.key, utf8ToBytes(`${time}.${nonce}.${path}`)),
  );
  return `v1.${time}.${nonce}.${signature.slice(0, 32)}`;
}

/** A `v1`-wrapped chapter masks each page's key with an HMAC of that page's nonce. */
function unwrapPageKey(session: ReaderSession, page: ReaderPage): Uint8Array {
  return xorCycle(
    base64ToBytes(page.k ?? ""),
    hmacSha256(session.key, utf8ToBytes(`page.${page.n ?? ""}`)),
  );
}

/** What a page needs before it can be drawn: nothing, or a key and the counter block. */
export type PageCipher = { key: Uint8Array; counter: Uint8Array };

// A fragment survives page caching without sending the decryption key to the CDN.
export function encryptedPageUrl(url: string, cipher: PageCipher): string {
  return `${url.split("#", 1)[0]}#tk=${bytesToBase64Url(cipher.key)}.${bytesToBase64Url(cipher.counter.subarray(0, 8))}`;
}

export function imageCipher(imageURL: string): { url: string; cipher?: PageCipher } {
  const marker = imageURL.indexOf("#tk=");
  if (marker < 0) return { url: imageURL };

  const parts = imageURL.slice(marker + 4).split(".");
  const [encodedKey = "", encodedNonce = ""] = parts;
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(encodedKey + encodedNonce)) {
    throw new Error("Toonkotsu's page link has invalid encryption metadata. Reopen the chapter.");
  }

  const key = base64ToBytes(encodedKey, true);
  const nonce = base64ToBytes(encodedNonce, true);
  if (
    ![16, 24, 32].includes(key.length) ||
    nonce.length !== 8 ||
    bytesToBase64Url(key) !== encodedKey ||
    bytesToBase64Url(nonce) !== encodedNonce
  ) {
    throw new Error("Toonkotsu's page link has invalid encryption metadata. Reopen the chapter.");
  }

  const counter = new Uint8Array(16);
  counter.set(nonce);
  return { url: imageURL.slice(0, marker), cipher: { key, counter } };
}

export function pageCipher(
  page: ReaderPage,
  wrap: string | null | undefined,
  session: ReaderSession,
): PageCipher | undefined {
  if (page.k == null && page.n == null) return undefined;
  if (typeof page.k !== "string" || typeof page.n !== "string") {
    throw new Error("Toonkotsu sent a page with incomplete encryption metadata");
  }

  const key = wrap === "v1" ? unwrapPageKey(session, page) : base64ToBytes(page.k);
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`Toonkotsu sent an unusable page key (${key.length} bytes)`);
  }

  const nonce = base64ToBytes(page.n);
  if (nonce.length < 8) throw new Error("Toonkotsu sent a page nonce shorter than eight bytes");

  // The counter block is the nonce's first eight bytes and then a 64-bit block counter
  // starting at zero, which the cipher steps from here.
  const counter = new Uint8Array(16);
  counter.set(nonce.subarray(0, 8), 0);
  return { key, counter };
}

/**
 * Decrypts one page's bytes into what the app can draw.
 *
 * The body is read strictly: it is base64 only because the request asked for it to be, so
 * anything else means the host answered text and the bytes are already gone.
 */
export function decryptPage(body: string, cipher: PageCipher): string {
  const bytes = base64ToBytes(body, true);
  if (bytes.length === 0) throw new Error("Toonkotsu served an empty page image");
  return bytesToBase64(aesCtrDecrypt(bytes, cipher.key, cipher.counter));
}

export function parseReaderKey(value: unknown): ReaderKeyResponse {
  const body = (value ?? {}) as Partial<ReaderKeyResponse>;
  if (
    typeof body.key !== "string" ||
    !body.key ||
    typeof body.build !== "string" ||
    !body.build.trim() ||
    typeof body.now !== "number" ||
    !Number.isFinite(body.now) ||
    body.now <= 0
  ) {
    throw new Error(
      "Toonkotsu returned an unusable reader session. The source may need an update.",
    );
  }
  return { key: body.key, build: body.build, now: body.now };
}
