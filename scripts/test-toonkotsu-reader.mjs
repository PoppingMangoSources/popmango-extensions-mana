#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later */

import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { ManaStore } from "./harness/runtime.mjs";

const bundle = fs.readFileSync(new URL("../dist/sources/Toonkotsu.mana", import.meta.url), "utf8");
const secret = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const xor = (bytes, mask) => Buffer.from(bytes.map((byte, i) => byte ^ mask[i % mask.length]));
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const mask = createHash("sha256").update(`sign:${secret}`).digest();
const signingKey = Buffer.alloc(32, 0x73);
const nonce = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const plain = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(800_001, 0x5a)]);

function load({ hostCrypto = false, signed = true, refresh = false, gate, invalidNonce = false } = {}) {
  const bodies = new Map();
  const stats = { keys: 0, signed: 0, requests: [] };
  let next = 0;
  const keep = (bytes) => {
    const bodyID = String(++next);
    bodies.set(bodyID, Buffer.from(bytes));
    return { bodyID, sessionID: "test" };
  };
  const json = (status, value, url) => ({
    ...keep(Buffer.from(JSON.stringify(value))), status, url,
    headers: { "content-type": "application/json" },
  });
  const bridge = {
    requiresOperation: false,
    now: () => Date.now(),
    async send(message) {
      if (message.operation === 0) {
        const { url, headers } = message;
        stats.requests.push(url);
        if (url.endsWith("/api/manga/key")) {
          stats.keys++;
          return json(200, { key: b64(xor(signingKey, mask)), now: Date.now() + 9000 }, url);
        }
        if (url.includes("/api/manga/chapter/")) {
          if (gate) return json(429, { code: "manga-limit", reason: gate, retryAfterSec: 120 }, url);
          const signature = headers["x-sig"];
          if (signed && !signature) return json(429, { code: "manga-limit", resign: true }, url);
          if (signature) {
            stats.signed++;
            const [version, time, token, mac] = signature.split(".");
            assert.equal(version, "v1");
            const path = new URL(url).pathname;
            assert.equal(mac, b64(hmac(signingKey, `${time}.${token}.${path}`)).slice(0, 32));
            assert.ok(Math.abs(Number(time) - Date.now() - 9000) < 2000, "server clock offset");
            if (refresh && stats.signed === 1) {
              return json(429, { code: "manga-limit", resign: true }, url);
            }
          }
          return json(200, {
            ...(signed ? { wrap: "v1" } : {}),
            chapter: { pages: [16, 24, 32].map((size) => {
              const key = Buffer.alloc(size, size);
              const n = b64(invalidNonce ? Buffer.alloc(7) : nonce);
              return {
                src: `https://images.test/${size}.bin`, n,
                k: b64(signed ? xor(key, hmac(signingKey, `page.${n}`)) : key),
              };
            }) },
          }, url);
        }
        if (url.startsWith("https://images.test/")) {
          assert.ok(!url.includes("#"), "keys must not reach the image server");
          const size = Number(new URL(url).pathname.match(/\d+/)[0]);
          const counter = Buffer.alloc(16);
          nonce.copy(counter, 0, 0, 8);
          const cipher = createCipheriv(`aes-${size * 8}-ctr`, Buffer.alloc(size, size), counter);
          return { ...keep(Buffer.concat([cipher.update(plain), cipher.final()])), status: 200, url,
            headers: { "content-type": "application/octet-stream" } };
        }
        throw new Error(`Unexpected request: ${url}`);
      }
      if (message.operation === 1) {
        return { value: bodies.get(message.bodyID).toString(message.reader === 1 ? "base64" : "utf8") };
      }
      if (message.operation === 4) return keep(Buffer.from(message.value, "base64"));
      return {};
    },
  };
  const sandbox = {
    __manaHTTPBridge: bridge, ObjectStore: new ManaStore(), SecureStore: new ManaStore(),
    console, setTimeout, clearTimeout,
    WebViewPage: { create() { throw new Error("Direct reads must not open a WebView"); } },
    ...(hostCrypto ? { crypto: { get subtle() {
      throw new Error("Reader must not require WebCrypto");
    } } } : {}),
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundle, context);
  return { target: new context.Target(), stats };
}

for (const hostCrypto of [false, true]) {
  for (const signed of [false, true]) {
    const { target, stats } = load({ hostCrypto, signed, refresh: signed });
    const chapter = await target.getChapterData("ktm04", "1487335");
    assert.equal(chapter.pages.length, 3);
    for (const page of chapter.pages) {
      const request = { url: page.url, origin: 2 };
      const client = target.getPageTransport(request);
      const response = await client[Symbol.for("mana.http.image.v1")](request);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.bytes()), plain);
    }
    await target.getChapterData("ktm04", "1487336");
    assert.equal(stats.keys, signed ? 2 : 0, "cache the refreshed signer between chapters");
    console.log(`PASS ${hostCrypto ? "without accessing host crypto" : "bare runtime"}: ${signed ? "signed, wrapped, key refresh" : "unsigned"}; AES-128/192/256 page transports`);
  }
}
const concurrent = load();
await Promise.all([1487335, 1487336, 1487337].map((id) => concurrent.target.getChapterData("ktm04", String(id))));
assert.equal(concurrent.stats.keys, 1, "parallel chapter reads share the signing key request");
const limited = load({ gate: "wait" });
await assert.rejects(() => limited.target.getChapterData("ktm04", "1487335"), /rate limiting/);
assert.equal(limited.stats.keys, 0, "do not bypass a wait gate by asking for another key");
const malformed = load({ signed: false, invalidNonce: true });
await assert.rejects(() => malformed.target.getChapterData("ktm04", "1487335"), /invalid page encryption/);
console.log("PASS parallel key sharing, wait gates, and malformed nonce rejection");
