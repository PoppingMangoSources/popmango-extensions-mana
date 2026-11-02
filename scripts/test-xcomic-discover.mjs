import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ManaStore } from "./harness/runtime.mjs";

const bundle = fs.readFileSync(
  fileURLToPath(new URL("../dist/sources/XCOMIC.mana", import.meta.url)),
  "utf8",
);
function load(settings = {}, failFirst = false) {
  const bodies = new Map();
  let id = 0,
    active = 0,
    maximum = 0;
  const requests = [];
  const edition = {
    id: "edition",
    name: "Title",
    translatedLanguage: "en",
    chaps_normal: 20,
    dbStatus: "normal",
    isPublic: true,
  };
  const comic = {
    ...edition,
    titleId: "work",
    urlCover: "https://images.test/cover.jpg",
    contentRating: "safe",
    genres: [],
  };
  const title = { data: comic, comicNodes: [{ data: edition }] };
  const sandbox = {
    ObjectStore: new ManaStore(settings),
    SecureStore: new ManaStore(),
    console,
    setTimeout,
    clearTimeout,
    __manaHTTPBridge: {
      requiresOperation: false,
      now: () => Date.now(),
      async send(message) {
        if (message.operation === 0) {
          const request = JSON.parse(message.body);
          requests.push({
            ...request,
            url: message.url,
            headers: message.headers,
            started: Date.now(),
          });
          maximum = Math.max(maximum, ++active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          active--;
          const data = {
            get_title_browse_items: [title],
            get_title_randomList: [title],
            get_title_latestUploads: {
              items: [
                {
                  chapters: [
                    {
                      data: {
                        id: "chapter",
                        chaNum: 1,
                        dbStatus: "normal",
                        datePublic: 1700000000,
                        comicNode: { data: comic },
                      },
                    },
                  ],
                },
              ],
            },
            get_comic_recentlyAdded: { items: [{ data: comic }] },
            get_comicNode: { data: comic },
            get_title_titleNode: { data: { trackingSites: {} } },
          };
          const bodyID = String(++id);
          bodies.set(bodyID, JSON.stringify({ data }));
          const status = failFirst && requests.length === 1 ? 400 : 200;
          return {
            bodyID,
            sessionID: "test",
            status,
            url: message.url,
            headers: { "content-type": "application/json" },
          };
        }
        if (message.operation === 1) {
          const text = bodies.get(message.bodyID);
          return { value: message.reader === 1 ? Buffer.from(text).toString("base64") : text };
        }
        if (message.operation === 2) bodies.delete(message.bodyID);
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;
  vm.runInContext(bundle, vm.createContext(sandbox));
  return { target: new sandbox.Target(), requests, maximum: () => maximum };
}

test("Discover starts three requests together, costs one request per row, and preserves full View More pages", async () => {
  for (const merged of [false, true]) {
    const { target, requests, maximum } = load({ "xcomic.merge-editions": merged });
    const sections = await target.getSectionsForPage({ id: "home" });
    assert.equal(requests.length, 0, "section configuration must not wait on remote feeds");
    const rows = await Promise.all(
      sections.map((section) => target.resolvePageSection({ id: "home" }, section.id)),
    );
    assert.equal(
      requests.length,
      sections.length,
      "no per-title enrichment or edition chapter requests",
    );
    assert.ok(rows.every((row) => row.items.length > 0));
    assert.equal(maximum(), 3, "three shared slots, including the initial burst");
    assert.ok(
      requests[2].started - requests[0].started < 250,
      "no spaced limiter delaying the first rows",
    );
    assert.equal(
      requests.find((request) => request.variables?.select?.sortby === "field_score").variables
        .select.size,
      36,
    );
    await target.search({ listId: "top_rated", page: 2 });
    assert.equal(
      requests.at(-1).variables.select.size,
      36,
      "performance changes must preserve the full preview and listing sizes",
    );
    assert.equal(requests.at(-1).variables.select.page, 2);
  }
});

test("hidden rows cost no requests and failed calls release their slot for a refresh", async () => {
  const hidden = load({ "xcomic.section-random": false });
  const sections = await hidden.target.getSectionsForPage({ id: "home" });
  assert.ok(!sections.some((section) => section.id === "random"));
  await Promise.all(sections.map((section) => hidden.target.resolvePageSection({}, section.id)));
  assert.equal(hidden.requests.length, sections.length);
  assert.ok(!hidden.requests.some((request) => request.query.includes("get_title_randomList")));
  const { target } = load({}, true);
  await assert.rejects(target.resolvePageSection({ id: "home" }, "top_rated"), /HTTP 400/);
  const result = await target.resolvePageSection({ id: "home" }, "top_rated");
  assert.ok(result.items.length > 0);
});

test("home requests honour a selected mirror and language before building URLs", async () => {
  const { target, requests } = load({
    "xcomic.mirror": "https://yona.to",
    "xcomic.languages": ["fr"],
  });
  await target.resolvePageSection({}, "top_rated");
  assert.equal(requests[0].url, "https://yona.to/query/");
  assert.equal(requests[0].headers["accept-language"], "fr");
  assert.deepEqual(Array.from(requests[0].variables.select.incTLangs), ["fr"]);
});

test("overlapping identical row requests share one fetch and migration skips tracker enrichment", async () => {
  const { target, requests } = load();
  await Promise.all([
    target.resolvePageSection({}, "top_rated"),
    target.resolvePageSection({}, "top_rated"),
  ]);
  assert.equal(requests.length, 1);
  // SourceContextOrigin.MIGRATION is the host's zero-valued migration origin.
  await target.getContent("edition", { origin: 0 });
  assert.equal(requests.length, 2, "migration uses just the title details");
});
