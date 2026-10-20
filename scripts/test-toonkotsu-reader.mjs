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

function load({ nativeCrypto = false, hostCrypto = false, signed = true, refresh = false, gate, invalidNonce = false, sizes = [16, 24, 32] } = {}) {
  const bodies = new Map();
  const stats = { keys: 0, signed: 0, requests: [], decrypted: 0 };
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
    ...(nativeCrypto ? { crypto: [0] } : {}), // CryptoAlgorithm.AesCtr
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
            // The site also lists the groups that uploaded the series, each with a short `src` id.
            sources: ["sfe851abc10", "sa20bb4ff20", "s78d90bf2e2"].map((src, i) => ({ src, name: `Group ${i}` })),
            chapter: { pages: sizes.map((size) => {
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
          assert.equal(headers.referer, "https://toonkotsu.com/", "the CDN serves images only to its own site");
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
      if (message.operation === 9) {
        // A native host: the page is decrypted where it is held and never read by the source.
        assert.ok(nativeCrypto, "a host without native ciphers must not be asked to decrypt");
        const spec = JSON.parse(message.spec);
        assert.equal(spec.algorithm, 0, "CryptoAlgorithm.AesCtr");
        assert.equal(spec.length, 64);
        const key = Buffer.from(spec.key, "base64");
        const decipher = createCipheriv(`aes-${key.length * 8}-ctr`, key, Buffer.from(spec.counter, "base64"));
        const source = bodies.get(message.bodyID);
        const plain = Buffer.concat([decipher.update(source), decipher.final()]);
        stats.decrypted++;
        // The native session names the type from the decrypted bytes.
        const png = plain.subarray(0, 4).equals(Buffer.from("89504e47", "hex"));
        return { ...keep(plain), ...(png ? { contentType: "image/png" } : {}) };
      }
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

for (const [nativeCrypto, hostCrypto] of [[false, false], [false, true], [true, false]]) {
  for (const signed of [false, true]) {
    const { target, stats } = load({ nativeCrypto, hostCrypto, signed, refresh: signed });
    const chapter = await target.getChapterData("ktm04", "1487335");
    assert.equal(chapter.pages.length, 3);
    const clients = new Set();
    for (const page of chapter.pages) {
      const request = { url: page.url, origin: 2 };
      const client = target.getPageTransport(request);
      clients.add(client);
      const response = await client[Symbol.for("mana.http.image.v1")](request);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await response.bytes()), plain);
    }
    assert.equal(clients.size, 1, "every page, whatever its keys, goes through one shared client");
    await target.getChapterData("ktm04", "1487336");
    assert.equal(stats.keys, signed ? 2 : 0, "cache the refreshed signer between chapters");
    assert.equal(stats.decrypted, nativeCrypto ? 3 : 0, "every page decrypted natively when the host can");
    const mode = nativeCrypto ? "native host decrypt" : hostCrypto ? "without accessing host crypto" : "bare runtime";
    console.log(`PASS ${mode}: ${signed ? "signed, wrapped, key refresh" : "unsigned"}; AES-128/192/256 page transports`);
  }
}
// A chapter with fewer pages than the series has groups: its pages, not the group list.
for (const sizes of [[32], [16, 24, 32]]) {
  const { target } = load({ signed: false, sizes });
  const chapter = await target.getChapterData("ktm04", "1487335");
  assert.equal(chapter.pages.length, sizes.length, "the chapter's own pages, not its groups");
  for (const page of chapter.pages) {
    assert.ok(page.url.startsWith("https://images.test/"), `a page, not a group id: ${page.url}`);
  }
}
console.log("PASS short chapters read their pages, not the series' group list");
const concurrent = load();
await Promise.all([1487335, 1487336, 1487337].map((id) => concurrent.target.getChapterData("ktm04", String(id))));
assert.equal(concurrent.stats.keys, 1, "parallel chapter reads share the signing key request");
const limited = load({ gate: "wait" });
await assert.rejects(() => limited.target.getChapterData("ktm04", "1487335"), /rate limiting/);
assert.equal(limited.stats.keys, 0, "do not bypass a wait gate by asking for another key");
const malformed = load({ signed: false, invalidNonce: true });
await assert.rejects(() => malformed.target.getChapterData("ktm04", "1487335"), /invalid page encryption/);
console.log("PASS parallel key sharing, wait gates, and malformed nonce rejection");

// Chapter progress must retain the API number even when the list also contains volumes.
async function chapterList(entries, preferences = {}) {
  const { target } = load({ signed: false });
  for (const [key, value] of Object.entries(preferences)) {
    await target.preferences.set(key, value);
  }
  target.api.json = async (url) => {
    assert.equal(url, "https://toonkotsu.com/cdn/v1/series/jq4hs");
    return {
      series: { id: 26930, hid: "jq4hs", title: "Now That We Draw" },
      chapters: entries,
    };
  };
  return Array.from(await target.getChapters("jq4hs"));
}

const chapter65 = {
  id: 4736992, label: "Plot 65", n: 65, vol: null, mb: 6.7,
  group: { name: "WeebCentral" },
  alts: [
    { id: 4736661, label: "Chapter 65: Accident", mb: 30.6, group: { name: "Idk Either" } },
    { id: 4736854, label: "Chapter 65", mb: 14.1, group: { name: "Idk Either" } },
  ],
};
const inventory = [
  chapter65,
  { id: 3092917, label: "Plot 64", n: 64, vol: null },
  { id: 700, label: "Volume 7", n: null, vol: "7" },
];
const versions = new Set(["4736992", "4736661", "4736854"]);
const progressChapters = await chapterList(inventory, { "best-upload-per-group": false });
const releases65 = progressChapters.filter((chapter) => versions.has(chapter.chapterId));
assert.equal(releases65.length, 3);
assert.deepEqual(releases65.map((chapter) => chapter.number), [65, 65, 65]);
assert.ok(releases65.every((chapter) => chapter.volume === undefined));
assert.equal(progressChapters.find((chapter) => chapter.chapterId === "3092917").number, 64);
assert.ok(releases65.every((chapter) => chapter.number > 64), "progress 64 must not include chapter 65");
assert.deepEqual(
  progressChapters.map((chapter) => chapter.index).sort((a, b) => a - b),
  [0, 1, 2, 3, 4],
);
console.log("PASS chapter 65 and every alternate retain real tracker numbers alongside volumes");

for (const [preferences, expected] of [
  [{ "deduplicate-chapters": true }, ["4736992"]],
  [{ "hidden-groups": "WeebCentral" }, ["4736661", "4736854"]],
  [{ "hidden-groups": "WeebCentral", "deduplicate-chapters": true }, ["4736661"]],
  [{ "show-upload-size": false }, ["4736992", "4736661", "4736854"]],
  [{ "hidden-groups": "WeebCentral, Idk Either" }, []],
]) {
  const chapters = await chapterList(inventory, { "best-upload-per-group": false, ...preferences });
  const visible = chapters.filter((chapter) => versions.has(chapter.chapterId));
  assert.deepEqual(visible.map((chapter) => chapter.chapterId), expected);
  assert.ok(visible.every((chapter) => chapter.number === 65));
  assert.deepEqual(
    chapters.map((chapter) => chapter.index).sort((a, b) => a - b),
    Array.from({ length: chapters.length }, (_, index) => index),
  );
}
console.log("PASS deduplication, hidden groups, and size settings preserve numbers and contiguous indices");

const orderedChapters = await chapterList([
  { id: 1, label: "Chapter 0", n: 0, vol: "1" },
  { id: 2, label: "Chapter 19.1", n: 19.1, vol: "1" },
  { id: 3, label: "Chapter 1", n: 1, vol: "2" },
  { id: 4, label: "Chapter 65", n: 65, vol: null },
  { id: 5, label: "Volume 2", n: null, vol: "2" },
]);
assert.deepEqual(orderedChapters.map((chapter) => chapter.chapterId), ["4", "5", "3", "2", "1"]);
assert.deepEqual(orderedChapters.map((chapter) => chapter.index), [4, 3, 2, 1, 0]);
assert.deepEqual(orderedChapters.map((chapter) => chapter.number), [65, 2, 1, 19.1, 0]);
assert.deepEqual(orderedChapters.map((chapter) => chapter.volume), [undefined, 2, 2, 1, 1]);
assert.deepEqual(await chapterList([]), []);
console.log("PASS source volume order, decimal chapters, chapter zero, and unnumbered fallback");

const defaults = await chapterList(inventory);
const defaultVersions = defaults.filter((chapter) => versions.has(chapter.chapterId));
assert.deepEqual(defaultVersions.map((chapter) => chapter.chapterId), ["4736992", "4736661"]);
assert.deepEqual(defaultVersions.map((chapter) => chapter.number), [65, 65]);
assert.ok(defaultVersions[0].title.endsWith("(6.7 MB)"));
assert.ok(defaultVersions[1].title.endsWith("(30.6 MB)"));
const hiddenBest = await chapterList(inventory, { "hidden-groups": "WeebCentral" });
assert.deepEqual(
  hiddenBest.filter((chapter) => versions.has(chapter.chapterId)).map((chapter) => chapter.chapterId),
  ["4736661"],
);
const allUploads = await chapterList(inventory, { "best-upload-per-group": false });
assert.equal(allUploads.filter((chapter) => versions.has(chapter.chapterId)).length, 3);
assert.ok(allUploads.find((chapter) => chapter.chapterId === "4736854").title.endsWith("(14.1 MB)"));
const withoutSizes = await chapterList(inventory, { "show-upload-size": false });
assert.deepEqual(
  withoutSizes.filter((chapter) => versions.has(chapter.chapterId)).map((chapter) => chapter.chapterId),
  ["4736992", "4736661"],
);
assert.ok(withoutSizes.every((chapter) => !chapter.title.includes(" MB)")));
console.log("PASS default best upload per group retains MB labels, and both toggles remain independent");

const preferredUploads = await chapterList([
  {
    id: 10, n: 1, vol: "1", label: "Chapter 1", w: 800, mb: 40,
    group: { name: "Team" },
    alts: [
      { id: 11, label: "Chapter 1: Wider", w: 1200, mb: 10, group: { name: "team" } },
      { id: 12, label: "Chapter 1: Partial", w: 2000, mb: 80, partial: true, group: { name: "Team" } },
      { id: 13, label: "Chapter 1: Another team", w: 600, mb: 5, group: { name: "Other" } },
    ],
  },
  { id: 14, n: 1, vol: "1", label: "Chapter 1: Larger", w: 1200, mb: 20, group: { name: "Team" } },
  { id: 15, n: 1, vol: "1", label: "Chapter 1: Tie", w: 1200, mb: 20, group: { name: "Team" } },
  { id: 16, n: 1, vol: "2", label: "Chapter 1", w: 1200, mb: 20, group: { name: "Team" } },
  { id: 17, n: 2, vol: "1", label: "Chapter 2", w: 1200, mb: 20, group: { name: "Team" } },
]);
assert.deepEqual(preferredUploads.map((chapter) => chapter.chapterId), ["16", "17", "14", "13"]);
assert.deepEqual(preferredUploads.map((chapter) => chapter.number), [1, 2, 1, 1]);
assert.deepEqual(preferredUploads.map((chapter) => chapter.volume), [2, 1, 1, 1]);
assert.deepEqual(
  preferredUploads.map((chapter) => chapter.index).sort((a, b) => a - b),
  [0, 1, 2, 3],
);
assert.ok(preferredUploads.find((chapter) => chapter.chapterId === "14").title.endsWith("(20 MB)"));
const firstOnly = await chapterList([{
  id: 20, n: 3, label: "Chapter 3", w: 800, mb: 10, group: { name: "Team" },
  alts: [{ id: 21, label: "Chapter 3", w: 1200, mb: 20, group: { name: "Team" } }],
}], { "deduplicate-chapters": true });
assert.equal(firstOnly[0].chapterId, "20", "one overall upload preserves the site's first choice");
console.log("PASS complete, wider, then larger uploads win per group without merging chapters or volumes");

const selectionEntries = [
  {
    id: 30, n: 4, vol: "1", label: "Chapter 4", w: 800, mb: 10, group: { name: "Team" },
    alts: [
      { id: 30, label: "Chapter 4", w: 800, mb: 10, group: { name: "Team" } },
      { id: 31, label: "Chapter 4", w: 1200, mb: 20, group: { name: "Team" } },
      { id: 32, label: "Chapter 4", w: 800, mb: 8, group: { name: "Other" } },
    ],
  },
  { id: 33, n: 4, vol: "1", label: "Chapter 4", w: 1600, mb: 30, group: { name: "Team" } },
  { id: 34, n: 4, vol: "1", label: "Chapter 4", w: 1800, mb: 40, group: { name: "Other" } },
  { id: 35, n: 4, vol: "2", label: "Chapter 4", w: 1200, mb: 20, group: { name: "Team" } },
  { id: 36, n: 5, vol: "1", label: "Chapter 5", w: 1200, mb: 20, group: { name: "Team" } },
];
for (const mainOnly of [false, true]) {
  for (const bestPerGroup of [false, true]) {
    for (const showSize of [false, true]) {
      const chapters = await chapterList(selectionEntries, {
        "deduplicate-chapters": mainOnly,
        "best-upload-per-group": bestPerGroup,
        "show-upload-size": showSize,
      });
      const selected = mainOnly ? ["30"] : bestPerGroup ? ["33", "34"] : ["30", "31", "32", "33", "34"];
      assert.deepEqual(chapters.map((chapter) => chapter.chapterId), ["35", "36", ...selected]);
      assert.deepEqual(chapters.map((chapter) => chapter.number), [4, 5, ...selected.map(() => 4)]);
      assert.deepEqual(chapters.map((chapter) => chapter.volume), [2, 1, ...selected.map(() => 1)]);
      assert.ok(chapters.every((chapter) => chapter.title.includes(" MB)") === showSize));
      assert.deepEqual(
        chapters.map((chapter) => chapter.index).sort((a, b) => a - b),
        Array.from({ length: chapters.length }, (_, index) => index),
      );
    }
  }
}
const firstVisible = await chapterList(selectionEntries, {
  "deduplicate-chapters": true,
  "hidden-groups": "Team",
});
assert.deepEqual(firstVisible.map((chapter) => chapter.chapterId), ["32"]);
const laterVisible = await chapterList([
  { id: 40, n: 6, label: "Chapter 6", group: { name: "Hidden" } },
  { id: 41, n: 6, label: "Chapter 6", group: { name: "Visible" } },
], { "deduplicate-chapters": true, "hidden-groups": "Hidden" });
assert.deepEqual(laterVisible.map((chapter) => chapter.chapterId), ["41"]);
for (const mainOnly of [false, true]) {
  const extras = await chapterList([
    { id: 50, n: null, vol: "1", label: "Extra A", group: { name: "Team" } },
    { id: 51, n: null, vol: "1", label: "Extra B", group: { name: "Team" } },
    { id: 52, n: 0, vol: "1", label: "Chapter 0", group: { name: "Team" } },
    { id: 53, n: 0, vol: "1", label: "Chapter 0", group: { name: "Other" } },
  ], { "deduplicate-chapters": mainOnly });
  assert.deepEqual(extras.map((chapter) => chapter.chapterId), mainOnly ? ["50", "51", "52"] : ["50", "51", "52", "53"]);
}
const unnamed = await chapterList([{
  id: 60, n: 7, label: "Chapter 7",
  alts: [{ id: 61, label: "Chapter 7" }, { id: 60, label: "Chapter 7" }],
}], { "show-upload-size": false });
assert.deepEqual(unnamed.map((chapter) => chapter.chapterId), ["60", "61"]);
console.log("PASS all chapter-selection toggle combinations, hidden fallbacks, extras, and upload identities");
