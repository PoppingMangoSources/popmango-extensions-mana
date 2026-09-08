/* SPDX-License-Identifier: GPL-3.0-or-later */

import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  type Chapter,
  type Content,
  type Highlight,
  type Option,
  type Pair,
  type Tag,
} from "@mana-app/types";

import {
  absoluteImage,
  clean,
  decodeEntities,
  hasNextPage,
  parseDate,
  parseStatus,
  relativeTime,
  resolveUrl,
  summaryOf,
  text,
  toBadge,
} from "../common/index.ts";
import {
  BASE_URL,
  DIRECTORY_PATH,
  GENRES_SHOWN,
  LATEST_CHAPTERS_SHOWN,
  LOCK_MARK,
  LOCK_SUFFIX,
  RANKING_RANGE,
  SectionID,
  type Card,
  type CardChapter,
  type ChapterRow,
  type SubtitleStyle,
} from "./model.ts";

/** A path relative to the site root, which is what every id here is. */
export function pathOf(href: string): string {
  const target = clean(href);
  if (!target) return "";
  return resolveUrl(target, BASE_URL)
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
}

/** A title's id is its slug, which is the last segment of its directory path. */
function slugOf(href: string): string {
  const path = pathOf(href);
  return path ? (path.split("/").pop() ?? "") : "";
}

export function contentUrl(contentId: string): string {
  return `${BASE_URL}/${DIRECTORY_PATH}/${contentId}/`;
}

export function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/${chapterPath(chapterId)}/`;
}

function firstText(scope: Cheerio<AnyNode>, ...selectors: string[]): string {
  for (const selector of selectors) {
    const value = text(scope.find(selector).first());
    if (value) return decodeEntities(value);
  }
  return "";
}

/**
 * The score the theme prints in the corner of a card.
 *
 * Not every build of it fills this in, and not every row carries the element at all, so an
 * absent score simply means no pill rather than an empty one.
 */
function cardScore(card: Cheerio<AnyNode>): string {
  const value = firstText(card, "div.numscore", "div.rating div.numscore", "div.rt .numscore");
  return /\d/.test(value) ? `★ ${value}` : "";
}

/** The theme writes a card's title in the link's `title` attribute as often as in its text. */
function cardTitle(card: Cheerio<AnyNode>, link: Cheerio<AnyNode>): string {
  return decodeEntities(clean(link.attr("title") ?? "")) || firstText(card, "div.tt", "a");
}

/**
 * The box whose heading names it.
 *
 * The theme gives every front-page block the same class and tells them apart only by the
 * `h2` on top, and a `:has(:contains(…))` selector against that has to be spelled exactly
 * as the site words its heading. Reading the headings instead survives the site retitling
 * a row.
 */
function boxTitled($: CheerioAPI, keyword: string): Cheerio<AnyNode> {
  const wanted = keyword.toLowerCase();
  const match = $(".bixbox")
    .toArray()
    .find((node) => text($(node).find("h2").first()).toLowerCase().includes(wanted));
  return match ? $(match) : $([]);
}

// ========================= The front page =========================

/** The slider the theme puts at the top of the page. */
function parseFeatured($: CheerioAPI): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  $("div.slider-wrapper div.swiper-slide").each((_, node) => {
    const slide = $(node);
    const link = slide.find("a[href]").first();
    const id = slugOf(link.attr("href") ?? "");
    const title = firstText(slide, "span.name") || decodeEntities(clean(link.attr("title") ?? ""));
    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    // The slide names its newest chapter in one of several places, and on some of them
    // only inside the sentence it prints; the wording is the site's either way.
    const chapter =
      firstText(slide, "span.chapter", "div.chapter", "span.fivchap", "span.epxs", "div.epxs") ||
      (/(?:chapter|ch\.?)\s*[\d.]+/i.exec(text(slide))?.[0] ?? "");

    cards.push({
      id,
      title,
      cover: absoluteImage(slide.find("img").first(), BASE_URL),
      ...(chapter ? { chapter: clean(chapter) } : {}),
      ...(cardScore(slide) ? { score: cardScore(slide) } : {}),
      genres: [],
      chapters: [],
    });
  });

  return cards;
}

/** A plain card row: cover, title, and the chapter the theme prints under it. */
function parseCardRow($: CheerioAPI, scope: Cheerio<AnyNode>, selector: string): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  scope.find(selector).each((_, node) => {
    const card = $(node);
    const link = card.find("a[href]").first();
    const id = slugOf(link.attr("href") ?? "");
    const title = cardTitle(card, link);
    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    const chapter = firstText(card, "div.epxs", "div.adds div.epxs");

    cards.push({
      id,
      title,
      cover: absoluteImage(card.find("img").first(), BASE_URL),
      ...(chapter ? { chapter } : {}),
      ...(cardScore(card) ? { score: cardScore(card) } : {}),
      genres: [],
      chapters: [],
    });
  });

  return cards;
}

/**
 * The updates grid, whose cards each list their newest chapters against how long ago they
 * landed. A card the theme has just refreshed says `NEW` in place of the age.
 */
function parseLatest($: CheerioAPI): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  boxTitled($, "latest")
    .find("div.bsx")
    .each((_, node) => {
      const card = $(node);
      const link = card.find(`a[href*='/${DIRECTORY_PATH}/']`).first();
      const id = slugOf(link.attr("href") ?? "");
      const title = cardTitle(card, link);
      if (!id || !title || seen.has(id)) return;
      seen.add(id);

      const chapters: CardChapter[] = [];
      card.find("ul.chfiv li a").each((_, row) => {
        const entry = $(row);
        const label = firstText(entry, "span.fivchap") || text(entry);
        if (!label) return;

        const time = entry.find("span.fivtime").first();
        // The theme flags a chapter posted in the last few hours with a class rather than
        // a time, so that one is stamped now.
        const fresh = time.hasClass("new-chapter");
        const uploaded = fresh ? new Date() : parseDate(text(time));

        chapters.push({ label, ...(uploaded ? { uploaded } : {}) });
      });

      cards.push({
        id,
        title,
        cover: absoluteImage(card.find("img").first(), BASE_URL),
        ...(chapters[0] ? { chapter: chapters[0].label } : {}),
        ...(cardScore(card) ? { score: cardScore(card) } : {}),
        genres: [],
        chapters: chapters.slice(0, LATEST_CHAPTERS_SHOWN),
      });
    });

  return cards;
}

/** One tab of the theme's Popular widget, already in the order the site ranked it. */
function parseRanking($: CheerioAPI, range: string): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  $(`div.serieslist.pop.wpop-${range} li`).each((position, node) => {
    const row = $(node);
    const link = row.find("a.series").first();
    const id = slugOf(link.attr("href") ?? "");
    // The ranked row prints its title in the heading beside the cover; the link's own
    // `title` attribute is the tooltip and only stands in when that heading is missing.
    const title =
      firstText(row, "div.leftseries h2 a") || decodeEntities(clean(link.attr("title") ?? ""));
    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    const genres = firstText(row, "div.leftseries span")
      .replace(/^\s*genres?\s*:\s*/i, "")
      .split(/\s*,\s*/)
      .filter(Boolean);

    cards.push({
      id,
      title,
      cover: absoluteImage(row.find("img").first(), BASE_URL),
      ...(cardScore(row) ? { score: cardScore(row) } : {}),
      genres,
      rank: position + 1,
      chapters: [],
    });
  });

  return cards;
}

/** Every row on the front page, cut from the one document that carries them all. */
export function parseHome(html: string): Record<string, Card[]> {
  const $ = load(html);

  const sections: Record<string, Card[]> = {
    [SectionID.Featured]: parseFeatured($),
    [SectionID.Latest]: parseLatest($),
    [SectionID.PopularToday]: parseCardRow($, $("div.popularslider"), "div.bsx"),
    [SectionID.Recommendation]: parseCardRow($, $("div.series-gen"), "div.listupd div.bsx"),
    [SectionID.PopularWeekly]: parseRanking($, RANKING_RANGE[SectionID.PopularWeekly] ?? ""),
    [SectionID.PopularMonthly]: parseRanking($, RANKING_RANGE[SectionID.PopularMonthly] ?? ""),
    [SectionID.PopularAllTime]: parseRanking($, RANKING_RANGE[SectionID.PopularAllTime] ?? ""),
  };

  fillRankedChapters(sections);
  return sections;
}

/**
 * The chapter a ranked row does not print.
 *
 * The theme's Popular widget gives each entry a rank, a cover and its genres, and nothing
 * else — no chapter. The rest of the same page does print one, though, and a title in the
 * chart is usually somewhere in the grid as well, so the label is taken from there. It is
 * a lookup across a document already parsed, not a second request: a chart row that must
 * fetch each of its titles is the pattern this repository has rewritten most often.
 */
function fillRankedChapters(sections: Record<string, Card[]>): void {
  const known = new Map<string, string>();
  for (const id of [SectionID.Latest, SectionID.PopularToday, SectionID.Recommendation]) {
    for (const card of sections[id] ?? []) {
      if (card.chapter && !known.has(card.id)) known.set(card.id, card.chapter);
    }
  }
  if (known.size === 0) return;

  for (const id of [SectionID.PopularWeekly, SectionID.PopularMonthly, SectionID.PopularAllTime]) {
    for (const card of sections[id] ?? []) {
      const chapter = known.get(card.id);
      if (chapter && !card.chapter) card.chapter = chapter;
    }
  }
}

// ========================= Browsing =========================

export function parseBrowse(html: string): { results: Card[]; isLastPage: boolean } {
  const $ = load(html);
  const results = parseCardRow($, $("div.listupd"), "div.bs");

  return {
    results,
    isLastPage: !hasNextPage($, "div.hpage a.r", "div.pagination .next", "a.next.page-numbers"),
  };
}

/**
 * The theme's own filter lists, off the directory page.
 *
 * Every facet is a dropdown of checkboxes, and the `name` on each input is what the site
 * would post — so the lists are grouped by that rather than by the order the dropdowns
 * happen to appear in, which is what a site adding a fourth facet would shift.
 */
export function parseFilters(html: string): Record<string, Option[]> {
  const $ = load(html);
  const groups: Record<string, Option[]> = { genres: [], status: [], type: [] };
  const seen = new Set<string>();

  const names: Record<string, string> = {
    "genre[]": "genres",
    genre: "genres",
    status: "status",
    type: "type",
  };

  $("ul.dropdown-menu li").each((_, node) => {
    const row = $(node);
    const input = row.find("input").first();
    const group = groups[names[clean(input.attr("name") ?? "")] ?? ""];
    const id = clean(input.attr("value") ?? "");
    const title = firstText(row, "label") || text(row);

    if (!group || !id || !title) return;
    const key = `${input.attr("name")}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);

    group.push({ id, title });
  });

  return groups;
}

// ========================= A title =========================

/**
 * A labelled value out of the details block.
 *
 * The theme prints these three different ways depending on which version of it the site is
 * on — a table row, a `.fmed` pair, or an `.imptdt` line — so all three are tried against
 * the label the site wrote.
 */
function detail($: CheerioAPI, label: string): string {
  const wanted = label.toLowerCase();

  for (const node of $(".imptdt, .fmed, tr").toArray()) {
    const row = $(node);
    const heading = text(row.find("b, h1, td").first()) || text(row);
    if (!heading.toLowerCase().includes(wanted)) continue;

    const value = firstText(row, "i", "span", "td + td");
    if (value && value.toLowerCase() !== wanted) return value;
  }

  return "";
}

/** The theme writes "Unknown" where a site has left a credit blank. */
function creator(value: string): string | undefined {
  const cleaned = clean(value);
  if (!cleaned || /^(?:unknown|n\/a|-|tba|updating)$/i.test(cleaned)) return undefined;
  return cleaned;
}

export function parseContent(html: string, contentId: string): Content {
  const $ = load(html);

  const title = firstText($.root(), "h1.entry-title") || decodeEntities(contentId);
  const cover = absoluteImage($("div[itemprop='image'] img, div.thumb img").first(), BASE_URL);

  const tags: Tag[] = [];
  const seen = new Set<string>();
  $("span.mgen a").each((_, node) => {
    const link = $(node);
    const name = decodeEntities(text(link));
    // The id stays the site's own slug, which is what the genre filter matches on.
    const id = slugOf(link.attr("href") ?? "");
    if (!name || !id || seen.has(id)) return;
    seen.add(id);
    tags.push({ id, title: name });
  });

  const alternates = detail($, "alternative")
    .split(/\s*[,|]\s*/)
    .map((name) => decodeEntities(clean(name)))
    .filter((name) => name && name.toLowerCase() !== title.toLowerCase());

  const creators = [creator(detail($, "author")), creator(detail($, "artist"))].filter(
    (name): name is string => name !== undefined,
  );

  const state = detail($, "status");
  const kind = detail($, "type");
  const score = firstText(
    $.root(),
    "div.rating strong",
    "div.rating div.num",
    "span[itemprop='ratingValue']",
  )
    .replace(/^\s*rating\s*/i, "")
    .trim();

  // The stat line the theme prints beside the cover, in its own order.
  const info: Pair[] = [];
  if (score) info.push({ key: "Rating", value: `★ ${score}` });
  if (kind) info.push({ key: "Type", value: `♤ ${kind}` });
  if (state) info.push({ key: "Status", value: `◌ ${state}` });

  const status = parseStatus(state);

  return {
    title,
    cover,
    summary: summaryOf($("div[itemprop='description'], div.entry-content-single").first()),
    additionalTitles: [...new Set(alternates)],
    tags,
    ...(status === undefined ? {} : { status }),
    contentType: ContentType.COMIC,
    // The site publishes nothing it grades as adult, and its own catalogue carries no
    // rating of its own to read one off.
    contentRating: ContentRating.SAFE,
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: contentUrl(contentId),
  };
}

// ========================= Chapters =========================

export function chapterIsLocked(chapterId: string): boolean {
  return chapterId.endsWith(LOCK_SUFFIX);
}

export function chapterPath(chapterId: string): string {
  return chapterId.endsWith(LOCK_SUFFIX) ? chapterId.slice(0, -LOCK_SUFFIX.length) : chapterId;
}

export function parseChapterRows(html: string): ChapterRow[] {
  const $ = load(html);
  const rows: ChapterRow[] = [];

  $("div#chapterlist li").each((_, node) => {
    const row = $(node);
    const link = row.find("a[href]").first();
    // The chapter is an ordinary post at the site root, so its own path is its id — which
    // means opening one costs a single request rather than a lookup through this page.
    const id = pathOf(link.attr("href") ?? "");
    if (!id) return;

    const name = firstText(row, "span.chapternum") || decodeEntities(text(link));
    const date = parseDate(firstText(row, "span.chapterdate"));
    // The theme gilds a chapter it is holding back.
    const locked = row.find(".text-gold").length > 0;

    rows.push({
      id: locked ? `${id}${LOCK_SUFFIX}` : id,
      // The list row carries the site's own number, which survives a name that does not
      // state it. It is kept beside the name rather than folded into it.
      name: name || clean(row.attr("data-num") ?? ""),
      ...(date ? { date } : {}),
      locked,
    });
  });

  return rows;
}

/**
 * `undefined` when the row states no number at all, which is not the same as stating zero:
 * a prologue numbered 0 opens the run, while an extra with no number must not become the
 * chapter an unread title starts at.
 */
function chapterNumberOf(name: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)/.exec(name);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!);
  return Number.isFinite(value) ? value : undefined;
}

export function toChapters(rows: readonly ChapterRow[], hideLocked: boolean): Chapter[] {
  const seen = new Set<string>();

  const parsed = rows.flatMap((row) => {
    if (hideLocked && row.locked) return [];
    if (seen.has(row.id)) return [];
    seen.add(row.id);

    const stated = chapterNumberOf(row.name);
    const label = row.name || (stated === undefined ? "Chapter" : `Chapter ${stated}`);

    return [
      {
        chapterId: row.id,
        number: stated ?? 0,
        index: 0,
        // The app prints this verbatim, so the site's own wording is passed through with
        // its numbering intact. A padlock in front says the row is held back, which reads
        // at a glance down a long list where a trailing word does not.
        title: `${row.locked ? `${LOCK_MARK} ` : ""}${label}`,
        date: row.date ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        webUrl: chapterUrl(row.id),
        numbered: stated !== undefined,
      },
    ];
  });

  const highest = parsed.reduce((max, chapter) => Math.max(max, chapter.number), 0);
  const extras = parsed.filter((chapter) => !chapter.numbered);
  extras.forEach((chapter, position) => {
    chapter.number = highest + (extras.length - position);
  });

  // index 0 must be the earliest chapter, or the app resumes partway through.
  return parsed
    .sort((left, right) => left.number - right.number)
    .map(({ numbered: _numbered, ...chapter }, index) => ({ ...chapter, index }))
    .reverse();
}

/**
 * The reader's page list, out of the call the theme's own script makes.
 *
 * The images are not in the markup: the page ships them as the argument to `ts_reader.run`
 * and the script builds the reader from it, so the argument is sliced back out and read as
 * the JSON it is.
 */
export function parsePages(html: string): string[] {
  const $ = load(html);

  for (const node of $("script").toArray()) {
    const source = $(node).html() ?? "";
    if (!source.includes("ts_reader.run")) continue;

    const start = source.indexOf("ts_reader.run(");
    const raw = sliceBalanced(source, source.indexOf("{", start));
    if (!raw) continue;

    let parsed: { sources?: { images?: string[] }[] };
    try {
      parsed = JSON.parse(raw) as { sources?: { images?: string[] }[] };
    } catch {
      continue;
    }

    const pages = (parsed.sources ?? [])
      .flatMap((entry) => entry.images ?? [])
      .map((url) => resolveUrl(clean(url), BASE_URL))
      .filter(Boolean);

    if (pages.length > 0) return pages;
  }

  return [];
}

/** The one JSON value beginning at `start`, brace-matched to its end. */
function sliceBalanced(source: string, start: number): string | undefined {
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

// ========================= Tiles =========================

/**
 * What a tile writes under its title.
 *
 * Every plain strip of covers names the chapter the theme prints on the card, so the line
 * reads as one thing wherever it is met. The detailed chart says only where the site put
 * it — everything else it knows goes to rows of its own beneath — and a grouped list says
 * nothing at all, its chapters being rows already.
 *
 * The line carries no symbols anywhere: a glyph belongs on a labelled row, where the key
 * says what it stands for.
 */
function buildSubtitle(card: Card, style: SubtitleStyle): string {
  switch (style) {
    case "rank":
      return card.rank ? `#${card.rank}` : "";
    case "hero":
    case "chapter":
      // The Popular widget prints no chapter of its own, so a ranked title the rest of the
      // page never mentions falls back to what it is about rather than to a blank line.
      return card.chapter ?? card.genres.slice(0, GENRES_SHOWN).join(", ");
    default:
      return "";
  }
}

/** The rows a detailed tile draws, which is the only place a symbol is written. */
function buildInfoRows(card: Card, style: SubtitleStyle): Pair[] {
  if (style === "chapters") {
    return card.chapters.map((chapter) => ({
      key: chapter.label,
      value: chapter.uploaded ? relativeTime(chapter.uploaded) : "",
    }));
  }

  if (style !== "rank") return [];

  const rows: Pair[] = [];
  // No pill is drawn over the thumbnail a ranked row uses, so the score the theme prints in
  // the card's corner leads the rows — otherwise it is only ever on a pill nobody sees here.
  if (card.score) rows.push({ key: "Rating", value: card.score });
  // Two genres: a third wraps and pushes the tile out of its row.
  const genres = card.genres.slice(0, GENRES_SHOWN).join(", ");
  if (genres) rows.push({ key: "Genres", value: genres });
  if (card.chapter) rows.push({ key: "Chapter", value: card.chapter });
  return rows;
}

export function toHighlight(card: Card, style: SubtitleStyle): Highlight {
  const subtitle = buildSubtitle(card, style);
  const info = buildInfoRows(card, style);
  // The pill takes the score the theme prints in a card's corner. The cards here carry no
  // count, no type and no status, so a card without a score simply wears no pill.
  const badge = toBadge(card.score);

  return {
    id: card.id,
    title: card.title,
    cover: card.cover,
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    ...(info.length === 0 ? {} : { info }),
    contentRating: ContentRating.SAFE,
    webUrl: contentUrl(card.id),
  };
}
