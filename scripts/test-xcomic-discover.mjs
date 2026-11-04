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
function load(settings = {}, options = {}) {
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
    work: {
      data: { trackingSites: { anilist: 122625, myanimelist: "42" } },
      comicNodes: [
        { data: edition },
        { data: { ...edition, id: "other", subName: "Other Team" } },
        { data: { ...edition, id: "third", subName: "Third Team" } },
      ],
    },
  };
  const title = { data: comic, comicNodes: [{ data: edition }] };
  const stateReads = [];
  const objectStore = new ManaStore(settings);
  const get = objectStore.get.bind(objectStore);
  objectStore.get = (key) => { stateReads.push(key); return get(key); };
  const sandbox = {
    ObjectStore: objectStore,
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
          const position = requests.length;
          await options.beforeReply?.(request);
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
            get_chapterNode: { data: { imageUrls: ["https://images.test/page.jpg"] } },
            get_comic_chapterList_uniqList: {
              paging: { total: 1, next: 0 },
              items: [{ data: { id: request.variables?.select?.comic_id, chaNum: 1 } }],
            },
          };
          const bodyID = String(++id);
          bodies.set(bodyID, JSON.stringify({ data: options.response?.(request, data) ?? data }));
          const status = options.failFirst && position === 1 ? 400 : 200;
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
  return { target: new sandbox.Target(), requests, stateReads, maximum: () => maximum };
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
  const { target } = load({}, { failFirst: true });
  await assert.rejects(target.resolvePageSection({ id: "home" }, "top_rated"), /HTTP 400/);
  const result = await target.resolvePageSection({ id: "home" }, "top_rated");
  assert.ok(result.items.length > 0);
});

test("search, details and reading fill available slots without fixed delays", async () => {
  const { target, requests, maximum } = load();
  const results = await Promise.all([
    target.search({ query: "title", page: 1 }),
    target.getContent("edition"),
    target.getChapterData("edition", "chapter"),
  ]);
  assert.equal(requests.length, 3);
  assert.equal(maximum(), 3);
  assert.ok(requests[2].started - requests[0].started < 250);
  assert.equal(results[2].pages.length, 1);
});

test("details retain inline numeric tracker ids without a second request or edition lists", async () => {
  const { target, requests } = load();
  const content = await target.getContent("edition");
  assert.equal(requests.length, 1);
  assert.deepEqual({ ...content.trackerInfo }, { anilist: "122625", mal: "42" });
  assert.ok(!requests[0].query.includes("comicNodes"));
});

test("redirected tracker ids still resolve, and migration skips that extra request", async () => {
  const response = (request, data) => {
    if (request.variables.id === "edition")
      data.get_comicNode.data.work.data = { isMerged: true, mergedTo: "surviving" };
    if (request.variables.id === "surviving")
      data.get_title_titleNode.data = { trackingSites: { anilist: 123 } };
    return data;
  };
  const normal = load({}, { response });
  assert.equal((await normal.target.getContent("edition")).trackerInfo.anilist, "123");
  assert.equal(normal.requests.length, 2);
  const migration = load({}, { response });
  await migration.target.getContent("edition", { origin: 0 });
  assert.equal(migration.requests.length, 1);
});

test("merged chapters start other editions while the opened edition is still loading", async () => {
  let release;
  const opened = new Promise((resolve) => {
    release = resolve;
  });
  const { target, requests, maximum } = load(
    {},
    {
      beforeReply: (request) =>
        request.variables?.select?.comic_id === "edition" ? opened : undefined,
    },
  );
  const result = target.getChapters("edition");
  try {
    for (let tries = 0; tries < 50 && requests.length < 4; tries++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(requests.filter((request) => request.variables?.select?.comic_id).length, 3);
  } finally {
    release();
  }
  const chapters = await result;
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.chapterId).sort(), [
    "edition",
    "other",
    "third",
  ]);
  assert.equal(maximum(), 3);
  const metadata = requests.find((request) => request.variables.id === "edition");
  assert.equal(metadata.variables.merge, true);
  assert.ok(
    !metadata.query.includes("summary"),
    "chapter metadata does not fetch the full profile",
  );
});

test("unmerged full chapter lists keep pagination, language and chapter ordering", async () => {
  const { target, requests } = load(
    {
      "xcomic.merge-editions": false,
      "xcomic.deduplicate-chapter-list": false,
    },
    {
      response: (request, data) => {
        const select = request.variables.select;
        if (select?.comic_id) {
          const start = (select.page - 1) * 600;
          data.get_comic_chapterList_fullList = {
            paging: { total: 1202, next: select.page < 3 ? select.page + 1 : 0 },
            items: Array.from({ length: Math.min(600, 1202 - start) }, (_, i) => ({
              data: { id: `chapter-${start + i}`, chaNum: 1202 - start - i },
            })),
          };
        }
        return data;
      },
    },
  );
  const chapters = await target.getChapters("edition");
  assert.equal(chapters.length, 1202);
  assert.ok(chapters.every((chapter) => chapter.language === "en_US"));
  assert.equal(chapters[0].number, 1202);
  assert.equal(chapters.at(-1).number, 1);
  const lists = requests.filter((request) => request.variables.select?.comic_id);
  assert.deepEqual(lists.map((request) => request.variables.select.page).sort(), [1, 2, 3]);
  assert.ok(lists.every((request) => request.variables.select.size === 600));
  assert.equal(requests.find((request) => request.variables.id)?.variables.merge, false);
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

function feedResponse(comics, before) {
  return (_request, data) => {
    data.get_title_latestUploads = {
      before,
      items: comics.map((comic, index) => ({
        chapters: [
          {
            data: {
              id: `chapter-${index}`,
              chaNum: 1,
              dbStatus: "normal",
              datePublic: 1700000100 - index,
              comicNode: { data: comic },
            },
          },
        ],
      })),
    };
    data.get_comic_recentlyAdded = { before, items: comics.map((comic) => ({ data: comic })) };
    data.get_title_randomList = comics.map((comic) => ({
      data: comic,
      comicNodes: [{ data: comic }],
    }));
    return data;
  };
}

const feedComic = (id, overrides = {}) => ({
  id,
  titleId: id,
  name: id,
  translatedLanguage: "en",
  type: "manga",
  contentRating: "safe",
  genres: ["fantasy"],
  urlCover: "https://images.test/cover.jpg",
  ...overrides,
});

test("every unfiltered feed excludes every blocked genre before merged-title deduplication", async () => {
  const comics = [
    feedComic("blocked-first", { titleId: "shared", genres: [" HENTAI "] }),
    feedComic("blocked-other-genre", { genres: ["gore"] }),
    feedComic("keep", { titleId: "shared" }),
  ];
  for (const merged of [false, true])
    for (const section of ["latest_uploads", "recently_added", "random"]) {
      const { target, requests } = load(
        {
          "xcomic.merge-editions": merged,
          "xcomic.excluded-genres": ["hentai", "gore"],
          "xcomic.ignore-genre-blocklist": true,
        },
        { response: feedResponse(comics) },
      );
      const result = await target.resolvePageSection({}, section);
      assert.deepEqual(
        Array.from(result.items, (item) => item.id),
        ["keep"],
        `${section}, merged=${merged}`,
      );
      assert.equal(
        requests.length,
        1,
        "filtering never fetches per-title details or replacement pages",
      );
    }
});

test("unfiltered feeds honour rating, type and language settings, including inferred explicit ratings", async () => {
  const comics = [
    feedComic("keep"),
    feedComic("wrong-language", { translatedLanguage: "fr" }),
    feedComic("wrong-type", { type: "novel" }),
    feedComic("explicit", { contentRating: "pornographic" }),
    feedComic("inferred-explicit", { contentRating: "safe", genres: ["hentai"] }),
    feedComic("erotica", { contentRating: "erotica" }),
    feedComic("unstated-type", { type: null }),
  ];
  for (const section of ["latest_uploads", "recently_added", "random"]) {
    const { target } = load(
      {
        "xcomic.languages": ["en"],
        "xcomic.content-types": ["manga"],
        "xcomic.content-ratings": ["safe"],
      },
      { response: feedResponse(comics) },
    );
    const result = await target.resolvePageSection({}, section);
    assert.deepEqual(
      Array.from(result.items, (item) => item.id),
      ["keep", "unstated-type"],
      section,
    );
  }
});

test("filtered-out feed pages advance their server cursor without ending View More early", async () => {
  for (const section of ["latest_uploads", "recently_added"]) {
    const { target, requests } = load(
      { "xcomic.excluded-genres": ["hentai"] },
      {
        response: (request, data) =>
          feedResponse(
            [
              feedComic(request.variables.select.before ? "keep" : "blocked", {
                genres: request.variables.select.before ? [] : ["hentai"],
              }),
            ],
            request.variables.select.before ? null : 100,
          )(request, data),
      },
    );
    const first = await target.search({ listId: section, page: 1 });
    assert.equal(first.results.length, 0);
    assert.equal(first.isLastPage, false, section);
    const second = await target.search({ listId: section, page: 2 });
    assert.deepEqual(
      Array.from(second.results, (item) => item.id),
      ["keep"],
    );
    assert.equal(second.isLastPage, true);
    assert.equal(requests[1].variables.select.before, 100);
  }
});

test("ranked sections and normal search keep sending blocked genres to server-side browse", async () => {
  const { target, requests } = load({ "xcomic.excluded-genres": ["hentai", "gore"] });
  await target.resolvePageSection({}, "top_rated");
  await target.search({ query: "title", page: 1 });
  for (const request of requests)
    assert.deepEqual(request.variables.select.excGenres, ["hentai", "gore"]);
});

test("feed content remains selectable, while the host's explicit-content restriction is honoured", async () => {
  const comics = [feedComic("keep"), feedComic("explicit", { genres: ["hentai"] })];
  for (const section of ["latest_uploads", "recently_added", "random"]) {
    const { target } = load({}, { response: feedResponse(comics) });
    const unrestricted = await target.resolvePageSection({}, section);
    assert.deepEqual(
      Array.from(unrestricted.items, (item) => item.id),
      ["keep", "explicit"],
    );
    const restricted = await target.resolvePageSection(
      { context: { allowedContentRatings: [0, 1, 2] } },
      section,
    );
    assert.deepEqual(
      Array.from(restricted.items, (item) => item.id),
      ["keep"],
    );
  }
});

test("a repeated feed cursor ends pagination even when every item is blocked", async () => {
  for (const section of ["latest_uploads", "recently_added"]) {
    const { target } = load(
      { "xcomic.excluded-genres": ["hentai"] },
      {
        response: feedResponse([feedComic("blocked", { genres: ["hentai"] })], 100),
      },
    );
    assert.equal((await target.search({ listId: section, page: 1 })).isLastPage, false);
    assert.equal((await target.search({ listId: section, page: 2 })).isLastPage, true);
  }
});

test("a feed reads each display/filter setting once for the whole row", async () => {
  for (const section of ["latest_uploads", "recently_added", "top_rated", "random"]) {
    const { target, stateReads, requests } = load();
    await target.resolvePageSection({ id: "home" }, section);
    assert.equal(requests.length, 1);
    for (const key of ["merge-editions", "languages", "show-source-in-title", "remove-title-version", "custom-title-regex"]) {
      assert.equal(stateReads.filter((read) => read === `xcomic.${key}`).length, 1, `${section}: ${key}`);
    }
  }
});

test("details resolve tag names without displaying raw tag references", async () => {
  const { target, requests } = load({}, { response: (_request, data) => {
    data.get_comicNode.data.genres = ["comedy"];
    data.get_comicNode.data.tags = ["n5pwg", "26yr3"];
    data.get_comicNode.data.tagNodes = [{ data: { name: "European Ambience" } }];
    return data;
  } });
  const content = await target.getContent("edition");
  assert.deepEqual(Array.from(content.tags, (tag) => tag.title), ["Comedy", "European Ambience"]);
  assert.equal(requests.length, 1);
});
