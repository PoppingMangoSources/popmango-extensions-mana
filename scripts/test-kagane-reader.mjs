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

function load(manifest) {
  const bodies = new Map();
  let next = 0;
  const bridge = {
    requiresOperation: false,
    now: () => Date.now(),
    async send(message) {
      if (message.operation === 0) {
        const { url } = message;
        let value;
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
