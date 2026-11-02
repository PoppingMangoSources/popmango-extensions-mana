#!/usr/bin/env bun
/* SPDX-License-Identifier: GPL-3.0-or-later */

// XCOMIC's merged chapter list and edition choice, on fixed inputs. Run with Bun, which loads
// the source's TypeScript directly; nothing here touches the network.

import assert from "node:assert/strict";

import { appLanguage } from "../src/XCOMIC/model.ts";
import {
  mergedEditions,
  parseChapters,
  parseTitleHighlight,
  parseTitleHighlights,
  parseTrackers,
  rankEditions,
} from "../src/XCOMIC/parsers.ts";

const chapter = (id, chaNum, extra = {}) => ({ id, chaNum, dateCreate: 1_700_000_000, ...extra });
const edition = (id, extra = {}) => ({
  id,
  name: "A Title",
  translatedLanguage: "en",
  dbStatus: "normal",
  isPublic: true,
  ...extra,
});
const teams = (chapters) => {
  const counts = {};
  for (const { provider } of chapters) counts[provider?.name] = (counts[provider?.name] ?? 0) + 1;
  return counts;
};
const contiguous = (chapters) =>
  chapters
    .map((entry) => entry.index)
    .sort((left, right) => left - right)
    .every((index, position) => index === position);

// One team imported twice: the second import carries no team of its own and falls back to the
// aggregator, spelled differently. It reads as the same scanlator and adds only what is new.
{
  const merged = parseChapters([
    {
      language: "en_US",
      team: "Mpark",
      entries: [chapter("a1", 1), chapter("a2", 2), chapter("a2b", 2), chapter("a-x", null)],
    },
    {
      language: "en_US",
      team: "",
      entries: [
        chapter("b1", 1, { srcName: "mpark" }),
        chapter("b3", 3, { srcName: "mpark" }),
        chapter("b-x", null, { srcName: "mpark" }),
        chapter("b2v", 2, { srcName: "mpark", volNum: 2 }),
      ],
    },
    { language: "en_US", team: "Tapas", entries: [chapter("t1", 1), chapter("t2", 2)] },
  ]);
  const ids = merged.map((entry) => entry.chapterId).sort();

  assert.deepEqual(teams(merged), { Mpark: 7, Tapas: 2 }, "one team, spelled as it led");
  assert.ok(!ids.includes("b1"), "a numbered repeat keeps the leading edition's copy");
  assert.ok(ids.includes("a2b"), "a second upload inside one edition is that edition's own");
  assert.ok(ids.includes("b3") && ids.includes("b-x"), "new and unnumbered chapters stay");
  assert.ok(ids.includes("b2v"), "the same number in another volume is another chapter");
  assert.ok(contiguous(merged), "indices run 0 to n-1");
  assert.deepEqual(
    merged.map((entry) => entry.index),
    [...merged.map((entry) => entry.index)].sort((left, right) => right - left),
    "newest first",
  );
  const unnumbered = merged.filter((entry) => entry.chapterId.endsWith("-x"));
  assert.ok(
    unnumbered.every((entry) => entry.index >= merged.length - unnumbered.length),
    "unnumbered chapters sit past the run",
  );
}

// Editions To Include and Group Chapters By Edition.
{
  const lists = [
    { language: "en_US", team: "Tapas", entries: [chapter("t1", 1), chapter("t2", 2)] },
    { language: "en_US", team: "Comix", entries: [chapter("c1", 1), chapter("c2", 2)] },
    { language: "en_US", team: "Mbato", entries: [chapter("m1", 1)] },
  ];

  const kept = parseChapters(lists, { included: ["tapas", " COMIX "].map((team) => team.trim()) });
  assert.deepEqual(teams(kept), { Tapas: 2, Comix: 2 }, "teams match by name, any case");
  assert.ok(contiguous(kept));

  const grouped = parseChapters(lists, { groupByEdition: true });
  const order = [...grouped]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.chapterId);
  assert.deepEqual(order, ["c1", "c2", "m1", "t1", "t2"], "one team's run, then the next");

  const interleaved = parseChapters(lists);
  const byNumber = [...interleaved]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.number);
  assert.deepEqual(byNumber, [1, 1, 1, 2, 2], "ungrouped, the run follows the numbers");
}

// Withdrawn chapters stay out; each chapter carries its edition's language.
{
  const merged = parseChapters([
    { language: "en_US", team: "Tapas", entries: [chapter("t1", 1, { dbStatus: "deleted" })] },
    { language: "id", team: "Tapas", entries: [chapter("i1", 1)] },
  ]);
  assert.deepEqual(
    merged.map((entry) => [entry.chapterId, entry.language]),
    [["i1", "id"]],
  );
}

// Which editions a merged list reads, and which one a work's link opens.
{
  const comic = edition("own", {
    translatedLanguage: "fr",
    chaps_normal: 3,
    work: {
      comicNodes: [
        { data: edition("own", { translatedLanguage: "fr" }) },
        { data: edition("small", { chaps_normal: 10 }) },
        { data: edition("big", { chaps_normal: 90 }) },
        { data: edition("gone", { chaps_normal: 500, dbStatus: "deleted" }) },
        { data: edition("hidden", { chaps_normal: 400, isPublic: false }) },
        { data: edition("german", { translatedLanguage: "de", chaps_normal: 300 }) },
        { data: edition("unstated", { translatedLanguage: null, chaps_normal: 5 }) },
      ],
    },
  });
  assert.deepEqual(
    mergedEditions(comic, ["en"]).map((entry) => entry.id),
    ["own", "big", "small", "unstated"],
    "the opened edition leads, then live editions in the reader's languages by run length",
  );

  const nodes = comic.work.comicNodes.map((node) => node.data);
  assert.deepEqual(
    rankEditions(nodes, ["en"]).map((entry) => entry.id),
    ["big", "small"],
    "only the reader's languages while it has any",
  );
  assert.equal(rankEditions(nodes, ["ja"])[0]?.id, "german", "another language, never a dead one");
  assert.equal(rankEditions([edition("gone", { dbStatus: "deleted" })], ["en"]).length, 0);
}

assert.equal(appLanguage("en"), "en_US");
assert.equal(appLanguage("pt_br"), "pt_BR");
assert.equal(appLanguage("pt"), "pt_PT");
assert.equal(appLanguage("es_419"), "es_419");
assert.equal(appLanguage("de"), "de");
assert.equal(appLanguage("_t"), "UNIVERSAL");
assert.equal(appLanguage(""), "en_US");

// A ranked tile formats only its selected edition; an edition search still formats them all.
{
  const node = {
    data: {
      id: "work",
      name: "A Title",
      urlCover: "https://images.test/cover.jpg",
      score_val: 8.4,
      genres: ["fantasy"],
    },
    comicNodes: Array.from({ length: 40 }, (_, index) => ({
      data: edition(String(index), { chaps_normal: index + 1 }),
    })),
  };
  for (const options of [{}, { hero: true }, { detailed: true }, { showTeam: false }]) {
    let formatted = 0;
    const tile = parseTitleHighlight(node, ["en"], {
      ...options,
      cleanTitle: (name) => {
        formatted++;
        return name;
      },
    });
    assert.equal(formatted, 1, "unselected editions do not build discarded tiles");
    const all = parseTitleHighlights(node, ["en"], options);
    assert.equal(all.length, 40);
    assert.deepEqual(tile, all[0], "selected tile keeps every field and the same edition");
  }
  assert.equal(parseTitleHighlight({ ...node, comicNodes: [] }, ["en"]), undefined);
}
assert.deepEqual(parseTrackers({ anilist: 122625, kitsu: 58613, myanimelist: null }), {
  anilist: "122625",
  kitsu: "58613",
});

console.log("XCOMIC editions: all checks passed");
