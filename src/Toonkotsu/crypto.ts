/* SPDX-License-Identifier: GPL-3.0-or-later */

import "./webcrypto-environment.ts";
import { crypto as webCrypto } from "webcrypto-liner/build/index.es.js";

// This browser-compatible WebCrypto implementation is bundled only into Toonkotsu.
// It supplies subtle operations without a Node crypto bridge; the reader needs no key generation.
type Subtle = {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(
    format: string,
    data: Uint8Array,
    algorithm: string | { name: string; hash: string },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(
    algorithm: { name: string; counter: Uint8Array; length: number },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
};

function subtle(): Subtle {
  const native = (globalThis as unknown as { crypto?: { subtle?: Subtle } }).crypto?.subtle;
  return native ?? (webCrypto.subtle as Subtle);
}

export async function digest(data: Uint8Array): Promise<Uint8Array> {
  const native = subtle();
  return new Uint8Array(await native.digest("SHA-256", data));
}

export async function sign(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const native = subtle();
  const imported = await native.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await native.sign("HMAC", imported, data));
}

export async function decryptPage(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  if (![16, 24, 32].includes(key.length)) throw new Error("Toonkotsu sent an invalid AES key.");
  if (nonce.length < 8) throw new Error("Toonkotsu sent a page nonce shorter than eight bytes.");
  const native = subtle();
  const counter = new Uint8Array(16);
  counter.set(nonce.subarray(0, 8));
  const imported = await native.importKey("raw", key, "AES-CTR", false, ["decrypt"]);
  return new Uint8Array(
    await native.decrypt({ name: "AES-CTR", counter, length: 64 }, imported, data),
  );
}
