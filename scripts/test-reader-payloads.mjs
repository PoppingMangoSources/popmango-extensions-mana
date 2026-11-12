#!/usr/bin/env bun
/* SPDX-License-Identifier: GPL-3.0-or-later */

import assert from "node:assert/strict";
import { parsePages } from "../src/RinkoComics/parsers.ts";
import { parseReader } from "../src/ValirScans/parsers.ts";

const mask = Buffer.from("0123456789abcdef");
const encode = (value) => {
  const json = Buffer.from(JSON.stringify(value));
  return Buffer.concat([mask, json.map((byte, index) => byte ^ mask[index % 16])]).toString(
    "base64",
  );
};
const pages = ["https://cdn.example/01.webp", "https://cdn.example/02.webp"];
assert.deepEqual(
  parsePages(
    `<canvas class="chapter-image" data-page="1"></canvas><script id="cwPages">${encode(pages)}</script>`,
  ),
  pages,
);
assert.deepEqual(
  parsePages('<img class="chapter-image" data-src="https://cdn.example/01.webp">'),
  pages.slice(0, 1),
);
for (const value of [[], { pages }, ["javascript:alert(1)"]]) {
  assert.throws(() => parsePages(`<script id="cwPages">${encode(value)}</script>`));
}
assert.throws(() => parsePages('<script id="cwPages">YQ==</script>'));

for (const kind of [undefined, "comic"]) {
  const reader = {
    ...(kind ? { kind } : {}),
    chapter: {
      pages: [
        { pageNumber: 2, imageUrl: pages[1] },
        { pageNumber: 1, imageUrl: pages[0] },
      ],
    },
    isUnlocked: true,
    isLocked: true,
  };
  const payload = `1:{"chapter":{"id":"audio-only"}}\n2:${JSON.stringify(reader)}`;
  for (const html of [
    payload,
    `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`,
  ]) {
    assert.deepEqual(parseReader(html), { kind: "pages", pages });
  }
  assert.deepEqual(parseReader(JSON.stringify({ ...reader, isUnlocked: false })), {
    kind: "locked",
  });
}
console.log("Reader payload regression checks passed.");
