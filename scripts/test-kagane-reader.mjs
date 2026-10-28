#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later */

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ManaStore } from "./harness/runtime.mjs";

const bundle = fs.readFileSync(new URL("../dist/sources/Kagane.mana", import.meta.url), "utf8");
const chapterId = "019c2c36-6664-78c4-b6e9-8f2b24559819";
const repeatedId = "4f078eb5-d8b5-5bb8-9163-f2cec710edff";
// The reported manifest reuses one image at three distinct reading positions.
const pages = Array.from({ length: 235 }, (_, index) => ({
  page_no: index + 1,
  page_id: [130, 145, 205].includes(index + 1) ? repeatedId : `image-${index + 1}`,
  ext: "jxl",
}));

function load(manifest, { clock, onImage } = {}) {
  const bodies = new Map();
  let next = 0;
  const bridge = {
    requiresOperation: false,
    now: () => clock ? clock.now : Date.now(),
    async send(message) {
      if (message.operation === 0) {
        const { url } = message;
        let value;
        if (url.includes("/api/v2/books/page/") || url.includes("/api/v2/image/")) {
          onImage?.(message);
          return { bodyID: String(++next), sessionID: "test", status: 200, url,
            headers: { "content-type": "image/jpeg" } };
        }
        if (url === "https://kagane.cx/") value = {};
        else if (url.endsWith("/api/integrity")) {
          value = { token: "test-integrity", exp: Math.floor(Date.now() / 1000) + 300 };
        } else if (url.includes(`/api/v2/books/${chapterId}?`)) {
          assert.equal(message.headers["x-integrity-token"], "test-integrity");
          value = {
            access_token: "test-access",
            cache_url: "https://kstatic.to",
            manifest: { pages: manifest },
          };
        } else throw new Error(`Unexpected request: ${url}`);
        const bodyID = String(++next);
        bodies.set(bodyID, JSON.stringify(value));
        return { bodyID, sessionID: "test", status: 200, url,
          headers: { "content-type": "application/json" } };
      }
      if (message.operation === 1) return { value: bodies.get(message.bodyID) };
      return {};
    },
  };
  const sandbox = {
    __manaHTTPBridge: bridge,
    ObjectStore: new ManaStore(),
    SecureStore: new ManaStore(),
    console, setTimeout, clearTimeout,
    ...(clock ? {
      Date: class extends Date { static now() { return clock.now; } },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    } : {}),
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bundle, context);
  return new context.Target();
}

const target = load([...pages].reverse());
const chapter = await target.getChapterData("test-series", chapterId);
assert.equal(chapter.pages.length, 235);
for (const [index, page] of chapter.pages.entries()) {
  assert.equal(new URL(page.url).pathname,
    `/api/v2/books/page/${chapterId}/${pages[index].page_id}.jxl`);
}
assert.equal(chapter.pages[129].url, chapter.pages[144].url);
assert.equal(chapter.pages[129].url, chapter.pages[204].url);
console.log("PASS all 235 reading positions preserved and sorted, including repeated images");

for (const [label, manifest, error] of [
  ["missing page number", pages.filter((page) => page.page_no !== 100), /incomplete chapter/],
  ["duplicate page number", [...pages, { ...pages[0] }], /incomplete chapter/],
  ["unsafe image ID", [{ ...pages[0], page_id: "../image" }], /invalid page list/],
  ["unsafe extension", [{ ...pages[0], ext: "jxl?other=value" }], /invalid page list/],
  ["noninteger page number", [{ ...pages[0], page_no: 1.5 }], /invalid page list/],
  ["empty manifest", [], /incomplete reader session/],
]) {
  await assert.rejects(() => load(manifest).getChapterData("test-series", chapterId), error);
  console.log(`PASS ${label} rejected`);
}

// Advance SDK queue timers without making the long-chapter check take a minute.
const clock = {
  now: Date.now(),
  next: 0,
  timers: new Map(),
  setTimeout: (callback, delay = 0) => {
    const id = ++clock.next;
    clock.timers.set(id, { at: clock.now + delay, callback });
    return id;
  },
  clearTimeout: (id) => clock.timers.delete(id),
  async run(task) {
    let done = false;
    const result = task.finally(() => { done = true; });
    // Observe a rejection while the scheduler finishes draining the SDK's promises.
    result.catch(() => {});
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      if (done) break;
      const next = [...clock.timers].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, "request stalled without a pending timer");
      const [id, timer] = next;
      clock.timers.delete(id);
      clock.now = timer.at;
      timer.callback();
    }
    return result;
  },
};
const starts = { pages: [], covers: [] };
const paced = load(pages, {
  clock,
  onImage: (request) => {
    assert.equal(request.headers.referer, "https://kagane.cx/");
    const kind = request.url.includes("/books/page/") ? "pages" : "covers";
    starts[kind].push(clock.now);
  },
});
const longChapter = await clock.run(paced.getChapterData("test-series", chapterId));
const startedAt = clock.now;
const dispatch = async (request) => {
  const client = request.origin === 2 ? paced.getPageTransport(request) : paced.getCoverTransport(request);
  const response = await client[Symbol.for("mana.http.image.v1")](request);
  response.releaseNative();
};
await clock.run(Promise.all([
  ...longChapter.pages.map((page) => dispatch({ url: page.url, origin: 2 })),
  ...Array.from({ length: 10 }, (_, index) => dispatch({
    url: `https://kagane.cx/api/v2/image/cover-${index}`, origin: 1,
  })),
]));
assert.equal(starts.pages.length, 235, "queued pages must survive the default 30-second timeout");
assert.equal(starts.pages.filter((at) => at === startedAt).length, 5, "five pages start immediately");
for (const [index, at] of starts.pages.entries()) {
  assert.ok(index + 1 <= 5 + (at - startedAt) * 5 / 1000 + 0.001, "page starts exceed five per second");
}
assert.equal(starts.pages.at(-1) - startedAt, 46_000);
assert.equal(starts.covers.length, 10);
assert.ok(starts.covers.every((at) => at === startedAt), "covers must not wait behind reader pages");
console.log("PASS five-page burst, five starts per second, unpaced covers, and all 235 queued pages");
