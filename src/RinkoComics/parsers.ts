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
  base64ToBytes,
  bytesToUtf8,
  clean,
  decodeEntities,
  escapeHtml,
  parseDate,
  relativeTime,
  resolveUrl,
  panelMode,
  Mark,
  statusPill,
  summaryFromHtml,
  text,
  titleCase,
  toBadge,
} from "../common/index.ts";
import {
  BASE_URL,
  CHAPTER_SELECTOR,
  LATEST_CHAPTERS_SHOWN,
  LOAD_MORE_SELECTOR,
  LOCK_MARK,
  LOCK_SUFFIX,
  NOVEL_TEXT_SELECTOR,
  SectionID,
  TypeID,
  type Card,
  type ChapterRow,
  type TitleKind,
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

/** Novels live under `/novel/`, comics under `/comic/`; the path says which a title is. */
export function kindOf(contentId: string): TitleKind {
  return /^novel(?:_chapter)?\//i.test(contentId) ? TypeID.Novel : TypeID.Comic;
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
    .find(
      ".chip, .comic-genres .genre, .comic-genres-popular span, .novel-genres .genre-tag, .genre",
    )
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
    const cover = absoluteImage(card.find(selectors.cover).first(), BASE_URL);
    if (!cover) return;
    seen.add(id);

    const entry: Card = {
      id,
      title,
      cover,
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
    // Comics link `/chapter/`, novels `/novel_chapter/`.
    if (!locked && !/\/(?:novel_)?chapter\//.test(href)) continue;

    const label = decodeEntities(text(row.children("span").first()));
    if (!label) continue;

    // The stamp is written as a bare span beside the label, in the site's relative wording.
    const stamp = text(row.children("span").last());
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
    [SectionID.Novels]: sectionCards($, SectionID.Novels),
    [SectionID.Latest]: sectionCards($, SectionID.Latest),
  };
}

/** The novels' releases: the front page's release block with its Novels tab chosen. */
export function parseNovelHome(html: string): Card[] {
  return sectionCards(load(html), SectionID.Latest);
}

/** The genre chips a hero slide or a ranked card prints, in the site's order. */
function chipGenres($: CheerioAPI, nodes: Cheerio<AnyNode>): string[] {
  const genres: string[] = [];
  nodes.each((_, node) => {
    for (const part of decodeEntities(text($(node))).split("·")) {
      const value = part.trim();
      if (value && !genres.includes(value)) genres.push(value);
    }
  });
  return genres;
}

function sectionCards($: CheerioAPI, sectionId: string): Card[] {
  switch (sectionId) {
    case SectionID.Hot:
      return parseCards(
        $,
        {
          card: "[data-cw-slider] [data-slide]",
          link: "a.btn-primary",
          title: "h2",
          cover: "img",
        },
        (card, into) => {
          into.summary = firstText(card, "p");
          into.genres = chipGenres(
            $,
            card.find("div.flex-wrap > span").first().parent().children("span"),
          );
          const count = /^(\d+) chapters$/.exec(text(card.find("span.text-subtle").last()));
          if (count) into.chapterCount = count[1];
        },
      );
    case SectionID.Pinned:
      return parseCards(
        $,
        {
          card: "section[aria-labelledby='cw-week-m'] a",
          title: ".line-clamp-2",
          cover: "img",
        },
        (card, into) => {
          const rank = text(card.children("span").first());
          if (/^\d+$/.test(rank)) into.rank = rank;
          into.genres = chipGenres($, card.find("span.truncate"));
        },
      );
    case SectionID.Novels:
      return parseCards($, {
        card: "section[aria-labelledby='cw-novels'] a[href*='/novel/']",
        title: ".line-clamp-2",
        cover: "img",
      });
    case SectionID.Latest:
      return parseCards(
        $,
        {
          card: "#cw-latest article",
          link: "a.line-clamp-2",
          title: "a.line-clamp-2",
          cover: "img",
        },
        (card, into) => latestChapters($, card, into),
      );
    default:
      return [];
  }
}

export function parseBrowse(html: string): { results: Card[]; isLastPage: boolean } {
  const $ = load(html);

  const results = parseCards(
    $,
    {
      card: "#cwBrowse ul > li",
      link: "a",
      title: ".line-clamp-2",
      cover: "img",
    },
    (card, into) => {
      const status = text(card.find("span.text-subtle").last());
      if (status) into.status = status;
    },
  );

  return { results, isLastPage: $("#cwBrowse a.next, #cwBrowse a[rel=next]").length === 0 };
}

/** The theme puts its genre checkboxes on the browse page rather than in a form. */
export function parseGenres(html: string): Option[] {
  const $ = load(html);
  const options: Option[] = [];
  const seen = new Set<string>();

  $("#cwBrowse input[name='genres[]']").each((_, node) => {
    const input = $(node);
    const id = clean(input.attr("value") ?? "");
    const title = decodeEntities(text(input.parent().find("span").first()));
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    options.push({ id, title });
  });

  return options;
}

/**
 * The pill over a tile's cover: the site's own rank where it ranks a row, else where the
 * title has got to. A card the site prints neither on wears no pill.
 */
function buildBadge(card: Card): string {
  if (card.rank) return `#${card.rank}`;
  return statusPill(titleCase(card.status));
}

/**
 * What a tile writes under its title.
 *
 * Editor's Choice is the one card the site writes a blurb for, so that blurb is what its
 * hero carries; elsewhere the genres the card prints say what kind of story it is.
 *
 * The release rows say nothing on this line: their chapters are rows of their own beneath
 * it, and repeating the newest one here would print it twice.
 */
function buildSubtitle(card: Card, sectionId: string): string {
  if (sectionId === SectionID.Latest || sectionId === SectionID.NovelLatest) return "";
  if (sectionId === SectionID.Hot) return card.summary ?? card.genres.slice(0, 3).join(", ");
  return card.genres.slice(0, 3).join(", ");
}

/**
 * The rows a vertical list draws beneath a title — the site's own recent releases, each
 * against the time it landed, with a padlock on the ones it has held back.
 */
function buildInfoRows(card: Card): Pair[] {
  return card.chapters.map((chapter) => ({
    key: chapter.locked ? `${LOCK_MARK} ${chapter.label}` : chapter.label,
    value: chapter.uploaded ? relativeTime(chapter.uploaded) : "",
  }));
}

export function toHighlight(card: Card, sectionId: string): Highlight {
  const releases = sectionId === SectionID.Latest || sectionId === SectionID.NovelLatest;
  const subtitle = buildSubtitle(card, sectionId);
  const info = releases ? buildInfoRows(card) : [];
  // The hero draws its artwork full-bleed under the blurb; a pill there covers the art.
  const badge = releases || sectionId === SectionID.Hot ? undefined : toBadge(buildBadge(card));

  return {
    id: card.id,
    title: card.title,
    cover: card.cover,
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
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
  $("#main a[href*='/comics_genres/']").each((_, node) => {
    const name = decodeEntities(text($(node)));
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (seenTag.has(id)) return;
    seenTag.add(id);
    tags.push({ id, title: name });
  });

  const synopsis =
    firstText(page, "#cwSynopsis", ".comic-synopsis", ".novel-synopsis") ||
    decodeEntities(clean($("meta[property='og:description']").first().attr("content") ?? ""));

  // The facts panel prints each fact twice, once per layout, so the first of each counts.
  const facts = new Map<string, string>();
  $("#main dt").each((_, node) => {
    const key = text($(node));
    const value = decodeEntities(text($(node).next("dd")));
    if (key && value && !facts.has(key)) facts.set(key, value);
  });

  const state = facts.get("Status") ?? "";
  const status = parseStatus(state);
  const kind = kindOf(contentId);

  const info: Pair[] = [];
  const statusLabel = titleCase(state);
  if (statusLabel) info.push({ key: "Status", value: `${Mark.Status} ${statusLabel}` });
  const typeLabel = titleCase(facts.get("Type"));
  if (typeLabel) info.push({ key: "Type", value: `${Mark.Type} ${typeLabel}` });
  const count = facts.get(kind === TypeID.Novel ? "Episodes" : "Chapters");
  if (count) info.push({ key: kind === TypeID.Novel ? "Episodes" : "Chapters", value: count });
  const views = facts.get("Views");
  if (views) info.push({ key: "Views", value: `${Mark.Views} ${views}` });

  // Only a comic has panels to lay out, and the only thing that separates a strip from a
  // paged release here is a genre naming it one.
  const panel =
    kind === TypeID.Comic ? panelMode({ tags: tags.map((tag) => tag.title) }) : undefined;

  return {
    title,
    cover,
    summary: summaryFromHtml(synopsis),
    additionalTitles: [],
    tags,
    ...(status === undefined ? {} : { status }),
    // A novel is what opens the book reader, which reads its episodes as documents.
    contentType: kind === TypeID.Novel ? ContentType.NOVEL : ContentType.COMIC,
    ...(panel === undefined ? {} : { recommendedPanelMode: panel }),
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

    // A novel's episode row prints its number as `#12` beside the episode's own title; the
    // whole label is passed on, since the app prints a chapter title as it is given.
    const episode = /^#(\d+(?:\.\d+)?)$/.exec(firstText(row, "span.font-semibold"));
    const name = episode
      ? [`Episode ${episode[1]}`, firstText(row, "span.truncate")].filter(Boolean).join(": ")
      : firstText(
          row,
          ".chapter-number",
          ".ch-name",
          ".chapter-side-title",
          "label",
          "span > span:first-child",
        ) || decodeEntities(clean(row.attr("data-title") ?? ""));

    const stamp = (
      firstText(row, ".chapter-date") ||
      (episode
        ? text(row.children("span").last())
        : text(row.children("span").first().children("span").last()))
    )
      .split("·")[0]
      ?.trim();
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

export function toChapters(rows: readonly ChapterRow[], hideLocked: boolean): Chapter[] {
  const seen = new Set<string>();
  const parsed = rows
    .filter((row) => {
      if (hideLocked && row.locked) return false;
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
  const encoded = $("#cwPages").text().trim();
  if (encoded) {
    const bytes = base64ToBytes(encoded, true);
    if (bytes.length <= 16) throw new Error("RinkoComics returned an empty encoded page list.");
    // The canvas reader prefixes the page-list JSON with its 16-byte XOR mask.
    const decoded = new Uint8Array(bytes.length - 16);
    for (let index = 0; index < decoded.length; index++) {
      decoded[index] = bytes[index + 16]! ^ bytes[index % 16]!;
    }
    const pages: unknown = JSON.parse(bytesToUtf8(decoded));
    if (
      !Array.isArray(pages) ||
      !pages.length ||
      pages.some((page: unknown) => typeof page !== "string" || !/^https?:\/\//i.test(page))
    ) {
      throw new Error("RinkoComics returned an invalid page list.");
    }
    return pages as string[];
  }
  const pages: string[] = [];

  $("img.chapter-image").each((_, node) => {
    const url = absoluteImage($(node), BASE_URL);
    if (url) pages.push(url);
  });

  return pages;
}

export type ProseChapter = { title: string; body: string };

/**
 * An episode's prose, ready for the book reader, or `undefined` for a comic chapter.
 *
 * Only the paragraphs and the plain inline markup inside them are kept; the theme's reader
 * controls, scripts and styling are not the book's.
 */
export function parseProse(html: string): ProseChapter | undefined {
  const $ = load(html);
  const root = $(NOVEL_TEXT_SELECTOR).first();
  if (root.length === 0) return undefined;

  root.find("script, style, noscript, iframe, form, button, ins, .adsbygoogle").remove();
  const paragraphs: string[] = [];
  root.find("p, h2, h3, h4, blockquote, hr").each((_, node) => {
    const element = $(node);
    const tag = (node as { tagName?: string }).tagName?.toLowerCase() ?? "p";
    if (tag === "hr") {
      paragraphs.push("<hr/>");
      return;
    }
    const value = text(element);
    if (value) paragraphs.push(`<${tag}>${escapeHtml(value)}</${tag}>`);
  });
  if (paragraphs.length === 0) {
    const plain = text(root);
    if (plain) paragraphs.push(`<p>${escapeHtml(plain)}</p>`);
  }

  const heading = decodeEntities(text($("h1.cw-novel-title, h1").first()));
  const episode = decodeEntities(text($("header span").first()));
  const title = [episode, heading].filter(Boolean).join(": ") || "Episode";
  return { title, body: `<h1>${escapeHtml(title)}</h1>${paragraphs.join("")}` };
}
