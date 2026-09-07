/* SPDX-License-Identifier: GPL-3.0-or-later */

import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
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
  parseDate,
  relativeTime,
  resolveUrl,
  summaryFromHtml,
  text,
} from "../common/index.ts";
import {
  BASE_URL,
  CHAPTER_SELECTOR,
  LATEST_CHAPTERS_SHOWN,
  LOAD_MORE_SELECTOR,
  LOCK_MARK,
  LOCK_SUFFIX,
  SectionID,
  VIEWS_MARK,
  type Card,
  type ChapterRow,
} from "./model.ts";

/** A content id is the site's own path, which is what every link on the page carries. */
export function pathOf(href: string): string {
  const target = clean(href);
  if (!target) return "";
  const absolute = resolveUrl(target, BASE_URL);
  return absolute
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
}

export function contentUrl(contentId: string): string {
  return `${BASE_URL}/${contentId.replace(/^\/+/, "")}`;
}

function firstText(scope: Cheerio<AnyNode>, ...selectors: string[]): string {
  for (const selector of selectors) {
    const value = text(scope.find(selector).first());
    if (value) return decodeEntities(value);
  }
  return "";
}

/** Every card variant marks its genres differently, so all four shapes are tried. */
function cardGenres($: CheerioAPI, card: Cheerio<AnyNode>): string[] {
  const seen = new Set<string>();
  const genres: string[] = [];

  card
    .find(".comic-genres .genre, .comic-genres-popular span, .novel-genres .genre-tag, .genre")
    .each((_, node) => {
      const value = decodeEntities(text($(node)));
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return;
      seen.add(key);
      genres.push(value);
    });

  return genres;
}

type CardSelectors = {
  card: string;
  /** Omitted when the card element is itself the link. */
  link?: string;
  title: string;
  cover: string;
};

function parseCards(
  $: CheerioAPI,
  selectors: CardSelectors,
  enrich?: (card: Cheerio<AnyNode>, into: Card) => void,
): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();

  $(selectors.card).each((_, node) => {
    const card = $(node);
    const link = selectors.link ? card.find(selectors.link).first() : card;
    const id = pathOf(link.attr("href") ?? "");
    const title =
      firstText(card, selectors.title) || decodeEntities(clean(link.attr("title") ?? ""));

    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    const entry: Card = {
      id,
      title,
      cover: absoluteImage(card.find(selectors.cover).first(), BASE_URL),
      genres: cardGenres($, card),
      chapters: [],
    };
    enrich?.(card, entry);
    cards.push(entry);
  });

  return cards;
}

/**
 * The recent chapters a "latest" card lists, locked ones included.
 *
 * The site prints several per card and they are what the row is for, so all of them are
 * kept rather than just the newest readable one — a locked chapter still says what has
 * landed and when the free run will reach it.
 */
function latestChapters($: CheerioAPI, card: Cheerio<AnyNode>, into: Card): void {
  const badge = firstText(card, ".chapter-badge");
  if (badge) into.chapterCount = badge;

  for (const node of card.find("a.chapter-item").toArray()) {
    if (into.chapters.length >= LATEST_CHAPTERS_SHOWN) break;

    const row = $(node);
    const href = row.attr("href") ?? "";
    const locked = isLockedRow($, row, href);
    // The site drops the link on a chapter it has held back, so requiring one would leave
    // the newest release — the one the padlock is for — out of the row entirely.
    if (!locked && !href.includes("/chapter/")) continue;

    const label = firstText(row, "label") || decodeEntities(text(row));
    if (!label) continue;

    // The stamp is written as a bare span beside the label, in the site's relative wording.
    const stamp = firstText(row, ".chapter-date, time, span");
    const uploaded = stamp ? parseDate(stamp) : undefined;

    into.chapters.push({ label, ...(uploaded ? { uploaded } : {}), locked });
  }
}

/**
 * Every row on the front page, from one parse of it.
 *
 * The document is a whole rendered page and cheerio is the expensive part of reading it, so
 * it is walked once for all three rows rather than once per row.
 */
export function parseHome(html: string): Record<string, Card[]> {
  const $ = load(html);
  return {
    [SectionID.Hot]: sectionCards($, SectionID.Hot),
    [SectionID.Pinned]: sectionCards($, SectionID.Pinned),
    [SectionID.Latest]: sectionCards($, SectionID.Latest),
  };
}

function sectionCards($: CheerioAPI, sectionId: string): Card[] {
  switch (sectionId) {
    case SectionID.Hot:
      return parseCards(
        $,
        {
          card: ".popular-comics .comic-card-popular",
          link: "a.read-btn",
          title: ".comic-title-popular",
          cover: ".comic-cover img",
        },
        (card, into) => {
          const rank = firstText(card, ".comic-rank");
          if (rank) into.rank = rank.replace(/^#/, "");
          // The site prints two stats in one row: what has been read, and how much there is.
          const stats = card
            .find(".comic-stats .stat")
            .toArray()
            .map((node) => decodeEntities(text($(node))))
            .filter(Boolean);
          if (stats[0]) into.views = stats[0];
          // The site writes this stat as "180 Ch"; the subtitle supplies its own "Ch.",
          // so only the count is kept.
          const count = /(\d[\d.,]*[KMkm]?)/.exec(stats[1] ?? "")?.[1];
          if (count) into.chapterCount = count;
        },
      );

    case SectionID.Pinned:
      return parseCards(
        $,
        {
          card: "a.pinned-comic-card",
          title: ".pinned-comic-title",
          cover: ".comic-thumbnail img",
        },
        (card, into) => {
          const badge = firstText(card, ".chapter-badge");
          if (badge) into.chapterCount = badge;
        },
      );

    case SectionID.Latest:
      return parseCards(
        $,
        {
          card: ".latest-releases .comic-card",
          link: "a.comic-card__cover",
          title: ".comic-card__title",
          cover: ".comic-card__cover img",
        },
        (card, into) => latestChapters($, card, into),
      );

    default:
      return [];
  }
}

export function parseBrowse(html: string): { results: Card[]; isLastPage: boolean } {
  const $ = load(html);

  const results = parseCards($, {
    card: "article.ac-card",
    link: ".ac-title a",
    title: ".ac-title a",
    cover: ".ac-thumb img",
  });

  return { results, isLastPage: $(".ac-pagination a.next").length === 0 };
}

/** The theme puts its genre checkboxes on the browse page rather than in a form. */
export function parseGenres(html: string): Option[] {
  const $ = load(html);
  const options: Option[] = [];
  const seen = new Set<string>();

  $(".ac-filter-group.ac-genre input[name='genres[]']").each((_, node) => {
    const input = $(node);
    const id = clean(input.attr("value") ?? "");
    const title = decodeEntities(text(input.parent().find(".ac-option-text").first()));
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    options.push({ id, title });
  });

  return options;
}

/**
 * What a tile writes under its title.
 *
 * A hero card draws no rows of its own, so the two numbers the site prints on a ranked card
 * — what has been read, and how much there is — have nowhere else to go and are written
 * here behind the house mark for views.
 *
 * Latest Releases says nothing on this line: its chapters are rows of their own beneath it,
 * and repeating the newest one here would print it twice.
 */
function buildSubtitle(card: Card, sectionId: string): string {
  if (sectionId === SectionID.Latest) return "";

  if (sectionId === SectionID.Hot) {
    const views = card.views ? `${VIEWS_MARK} ${card.views}` : "";
    const chapters = card.chapterCount ? `Ch. ${card.chapterCount}` : "";
    const stats = [views, chapters].filter(Boolean).join(" • ");
    if (stats) return stats;
  }

  return card.genres.slice(0, 3).join(", ");
}

/**
 * The chapter rows a vertical list draws beneath a title — the site's own recent releases,
 * each against the time it landed, with a padlock on the ones it has held back.
 */
function buildInfoRows(card: Card): Pair[] {
  return card.chapters.map((chapter) => ({
    key: chapter.locked ? `${LOCK_MARK} ${chapter.label}` : chapter.label,
    value: chapter.uploaded ? relativeTime(chapter.uploaded) : "",
  }));
}

export function toHighlight(card: Card, sectionId: string): Highlight {
  const subtitle = buildSubtitle(card, sectionId);
  const info = sectionId === SectionID.Latest ? buildInfoRows(card) : [];

  return {
    id: card.id,
    title: card.title,
    cover: card.cover,
    ...(subtitle ? { subtitle } : {}),
    ...(info.length === 0 ? {} : { info }),
    // The catalogue is all-ages; the site publishes nothing it grades otherwise.
    contentRating: ContentRating.SAFE,
    webUrl: contentUrl(card.id),
  };
}

function parseStatus(raw: string): PublicationStatus | undefined {
  const value = raw.toLowerCase();
  if (value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("completed")) return PublicationStatus.COMPLETED;
  if (value.includes("hiatus")) return PublicationStatus.HIATUS;
  if (value.includes("cancel") || value.includes("drop")) return PublicationStatus.CANCELLED;
  return undefined;
}

export function parseContent(html: string, contentId: string): Content {
  const $ = load(html);
  const page = $.root();

  const title =
    firstText(page, ".comic-info-upper h1", "h1.novel-title", "h1") ||
    decodeEntities(contentId.split("/").pop() ?? contentId);

  const cover = resolveUrl(
    clean($("meta[property='og:image']").first().attr("content") ?? ""),
    BASE_URL,
  );

  // The site prints the creators as a row of spans with a separator between them.
  const creators: string[] = [];
  $(".comic-graph > span").each((_, node) => {
    const name = decodeEntities(text($(node)));
    if (!name || name === "•" || creators.includes(name)) return;
    creators.push(name);
  });

  const tags: Tag[] = [];
  const seenTag = new Set<string>();
  $(".comic-genres .genres .genre").each((_, node) => {
    const name = decodeEntities(text($(node)));
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (seenTag.has(id)) return;
    seenTag.add(id);
    tags.push({ id, title: name });
  });

  const synopsis =
    firstText(page, ".comic-synopsis", ".novel-synopsis") ||
    decodeEntities(clean($("meta[property='og:description']").first().attr("content") ?? ""));

  const status = parseStatus(firstText(page, ".comic-status span:last-child", ".comic-status"));

  const info: Pair[] = [];
  const state = firstText(page, ".comic-status span:last-child");
  if (state) info.push({ key: "Status", value: `◌ ${state}` });

  return {
    title,
    cover,
    summary: summaryFromHtml(synopsis),
    additionalTitles: [],
    tags,
    ...(status === undefined ? {} : { status }),
    // The site files novels separately and they are not offered here, so a title reached
    // this way is a comic.
    contentType: ContentType.COMIC,
    contentRating: ContentRating.SAFE,
    ...(creators.length > 0 ? { creators } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: contentUrl(contentId),
  };
}

function isLockedRow($: CheerioAPI, row: Cheerio<AnyNode>, href: string): boolean {
  const reason = clean(row.attr("data-reason") ?? "").toLowerCase();
  if (reason && reason !== "free") return true;

  const classes = clean(row.attr("class") ?? "").split(/\s+/);
  if (classes.includes("locked-chapter") || classes.includes("is-locked")) return true;

  // A row the site has locked drops its link entirely, or prices itself in a badge.
  if (!href || href === "#") return true;
  return row.find(".chapter_price").length > 0;
}

/** Reads the nonce out of the theme's inline ajax config. */
export function parseNonce(html: string): string | undefined {
  return /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/.exec(html)?.[1];
}

export function parseLoadMore(html: string): { comicId?: string; offset?: number } {
  const control = load(html)(LOAD_MORE_SELECTOR).first();
  const comicId = clean(control.attr("data-comic-id") ?? "");
  const offset = Number.parseInt(clean(control.attr("data-offset") ?? ""), 10);

  return {
    ...(comicId ? { comicId } : {}),
    ...(Number.isFinite(offset) ? { offset } : {}),
  };
}

/** One batch of chapter rows, from the details page or from an ajax fragment. */
export function parseChapterRows(html: string): ChapterRow[] {
  const $ = load(html);
  const rows: ChapterRow[] = [];

  $(CHAPTER_SELECTOR).each((_, node) => {
    const row = $(node);
    const href =
      clean(row.attr("data-permalink") ?? "") ||
      clean(row.attr("href") ?? "") ||
      clean(row.find("a").first().attr("href") ?? "");
    const postId = clean(row.attr("data-post-id") ?? "");
    if (!href && !postId) return;

    const locked = isLockedRow($, row, href);
    const path = href && href !== "#" ? pathOf(href) : "";
    // A locked row carries no link of its own, so its post id is the only handle it has.
    const id = path || `locked-${postId}`;
    if (!id) return;

    const name =
      firstText(row, ".chapter-number", ".ch-name", ".chapter-side-title", "label") ||
      decodeEntities(clean(row.attr("data-title") ?? ""));

    const stamp = firstText(row, ".chapter-date");
    const date = stamp ? parseDate(stamp) : undefined;

    rows.push({
      id: locked ? `${id}${LOCK_SUFFIX}` : id,
      name,
      ...(date ? { date } : {}),
      locked,
    });
  });

  return rows;
}

export function chapterIsLocked(chapterId: string): boolean {
  return chapterId.endsWith(LOCK_SUFFIX);
}

export function chapterPath(chapterId: string): string {
  return chapterId.endsWith(LOCK_SUFFIX) ? chapterId.slice(0, -LOCK_SUFFIX.length) : chapterId;
}

/**
 * `undefined` when the row states no number at all, which is not the same as stating zero:
 * a prologue numbered 0 opens the run, while a notice with no number must not become the
 * chapter an unread title starts at.
 */
function chapterNumberOf(name: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)/.exec(name);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!);
  return Number.isFinite(value) ? value : undefined;
}

export function toChapters(rows: readonly ChapterRow[], showLocked: boolean): Chapter[] {
  const seen = new Set<string>();
  const parsed = rows
    .filter((row) => {
      if (!showLocked && row.locked) return false;
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => {
      const stated = chapterNumberOf(row.name);
      const label = row.name || (stated === undefined ? "Chapter" : `Chapter ${stated}`);

      return {
        chapterId: row.id,
        number: stated ?? 0,
        index: 0,
        // The app prints this verbatim, so the site's own wording is passed through with
        // its numbering intact. A padlock in front says the row is held back, which reads
        // at a glance down a long list where a trailing word does not.
        title: `${row.locked ? `${LOCK_MARK} ` : ""}${label}`,
        date: row.date ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        webUrl: contentUrl(chapterPath(row.id)),
        numbered: stated !== undefined,
      };
    });

  // A row the site left unnumbered would otherwise sit at 0 and become what an unread title
  // opens at, so those are numbered above the run in listed order. A row numbered 0 is
  // chapter zero and is left exactly where it is.
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

export function parsePages(html: string): string[] {
  const $ = load(html);
  const pages: string[] = [];

  $("img.chapter-image").each((_, node) => {
    const url = absoluteImage($(node), BASE_URL);
    if (url) pages.push(url);
  });

  return pages;
}

/** A novel chapter serves prose where a comic serves images, and Mana reads only images. */
export function isProseChapter(html: string): boolean {
  const $ = load(html);
  return $("#textContent").length > 0 || $(".novel-content").length > 0;
}
