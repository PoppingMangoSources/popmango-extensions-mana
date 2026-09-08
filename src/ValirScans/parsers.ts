/* SPDX-License-Identifier: GPL-3.0-or-later */

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
  clean,
  decodeEntities,
  relativeTime,
  resolveUrl,
  summaryFromHtml,
  toBadge,
} from "../common/index.ts";
import {
  BASE_URL,
  LATEST_CHAPTERS_SHOWN,
  LOCK_MARK,
  LOCK_SUFFIX,
  NOVEL_TYPE,
  VIEWS_MARK,
  type AccountStatus,
  type BrowsePage,
  type FilterTaxonomy,
  type HomeSections,
  type SubtitleStyle,
  type ValirChapterItem,
  type ValirGenre,
  type ValirReaderData,
  type ValirSeries,
  type ValirSeriesPage,
} from "./model.ts";

// ========================= Reading the site's payloads =========================

/**
 * The site is a Next.js app and ships its page data as a React flight stream, embedded in
 * the HTML as escaped JavaScript string literals. Undoing that escaping first is what lets
 * the JSON values below be sliced out by the keys they are stored under.
 */
function decodeFlightPayload(html: string): string {
  return html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * The one JSON value beginning at `start`, brace-matched to its end.
 *
 * The payload is a stream rather than a document, so there is no outer object to parse —
 * a value has to be measured out of the middle of it, and a brace inside a string must not
 * be counted as structure.
 */
function sliceBalanced(payload: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < payload.length; index++) {
    const char = payload[index];
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
      if (depth === 0) return payload.slice(start, index + 1);
    }
  }

  return undefined;
}

/** Every value in the payload stored under `marker`, in the order the stream carries them. */
function extractByMarker<T>(payload: string, marker: string, keepMarker = false): T[] {
  const values: T[] = [];
  let index = payload.indexOf(marker);

  while (index !== -1) {
    const start = keepMarker ? index : index + marker.length;
    if (payload[start] === "{" || payload[start] === "[") {
      const raw = sliceBalanced(payload, start);
      if (raw !== undefined) {
        try {
          values.push(JSON.parse(raw) as T);
        } catch {
          // The same marker occurs in ordinary markup as well; those hits are skipped.
        }
      }
    }
    index = payload.indexOf(marker, index + marker.length);
  }

  return values;
}

// ========================= Shapes =========================

export function isNovel(series: ValirSeries): boolean {
  return (series.type ?? "").toUpperCase().includes(NOVEL_TYPE.toUpperCase());
}

/**
 * A title's own path, which is what every link on the site carries and what each endpoint
 * rebuilds its URL from — `comic/some-slug`, the two halves the route is built of.
 */
export function contentIdOf(series: ValirSeries): string {
  return `${isNovel(series) ? "novel" : "comic"}/${series.urlSlug ?? series.slug}`;
}

export function contentUrl(contentId: string): string {
  return `${BASE_URL}/series/${contentId.replace(/^\/+/, "")}`;
}

function absolute(path: string | null | undefined): string {
  return path ? resolveUrl(path, BASE_URL) : "";
}

function cleanText(value: string | null | undefined): string {
  return decodeEntities(clean(value ?? ""));
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** The site's own word for the format, with its underscores read as spaces. */
function kindLabel(series: ValirSeries): string {
  const kind = cleanText(series.type).replace(/_/g, " ");
  return kind ? titleCase(kind) : "";
}

function statusLabel(series: ValirSeries): string {
  const status = cleanText(series.status);
  return status ? titleCase(status) : "";
}

function parseStatus(series: ValirSeries): PublicationStatus | undefined {
  const value = (series.status ?? "").toLowerCase();
  if (value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("complete")) return PublicationStatus.COMPLETED;
  if (value.includes("hiatus")) return PublicationStatus.HIATUS;
  if (value.includes("cancel") || value.includes("drop")) return PublicationStatus.CANCELLED;
  return undefined;
}

export function ratingOf(series: ValirSeries): ContentRating {
  return series.isMature ? ContentRating.MATURE : ContentRating.SAFE;
}

function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatScore(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "";
  return `★ ${rating.toFixed(1)}`;
}

function parseTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `12` reads better than `12.0`, and `12.5` has to survive. */
function formatChapterNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Number(value));
}

// ========================= The pages =========================

export function parseHome(html: string): HomeSections {
  const payload = decodeFlightPayload(html);

  const seriesLists = extractByMarker<ValirSeries[]>(payload, '"series":').filter(
    (list) => Array.isArray(list) && list.length > 0,
  );

  return {
    featured: extractByMarker<ValirSeries[]>(payload, '"initialSlides":')[0] ?? [],
    // The shelf, the updates row and the new-series strip all pass their contents as a
    // `series` prop, so they are told apart by the fields only one of them carries.
    editorsPicks:
      seriesLists.find((list) => "viewCount" in list[0]! && !("createdAt" in list[0]!)) ?? [],
    latestUpdates: seriesLists.find((list) => "lastChapterAt" in list[0]!) ?? [],
    popularToday: extractByMarker<ValirSeries[]>(payload, '"novels":')[0] ?? [],
    // The ranked cards are emitted one at a time, in rank order, each under its own key.
    mostPopular: extractByMarker<ValirSeries>(payload, '"novel":').filter(
      (series) => !!series.slug && !!series.title,
    ),
  };
}

export function parseBrowse(html: string): BrowsePage {
  const payload = decodeFlightPayload(html);
  const series = extractByMarker<ValirSeries[]>(payload, '"initialSeries":')[0];
  if (!series) {
    throw new Error(
      "ValirScans returned no series for that page — the site layout may have changed.",
    );
  }
  return { series, hasMore: payload.includes('"initialHasMore":true') };
}

/**
 * The browse page holds the whole genre and tag lists as flat `{ name, slug }` records for
 * its own filter panel. Several shorter lists share those keys, so the longest is the one
 * the panel was built from.
 */
export function parseTaxonomy(html: string): FilterTaxonomy {
  const payload = decodeFlightPayload(html);

  const pick = (key: string): Option[] =>
    (
      extractByMarker<{ name?: string; slug?: string }[]>(payload, `"${key}":`)
        .filter((list) => Array.isArray(list) && !!list[0]?.name && !!list[0]?.slug)
        .sort((left, right) => right.length - left.length)[0] ?? []
    ).flatMap((entry) =>
      entry.name && entry.slug ? [{ id: entry.slug, title: cleanText(entry.name) }] : [],
    );

  return { genres: pick("genres"), tags: pick("tags") };
}

export function parseSeriesPage(html: string): ValirSeriesPage {
  const payload = decodeFlightPayload(html);
  const page = extractByMarker<ValirSeriesPage>(payload, '{"series":', true).find(
    (candidate) => !!candidate.series?.title && Array.isArray(candidate.chapters),
  );
  if (!page) {
    throw new Error("ValirScans returned no series data — the site layout may have changed.");
  }
  return page;
}

export function parseAccount(body: string): AccountStatus {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    // A signed-out session answers with an empty body rather than an error, and so does a
    // challenge page; neither is an account, and neither is worth failing over.
    return { authenticated: false };
  }

  const user = (value as { user?: unknown } | null)?.user;
  if (!user || typeof user !== "object") return { authenticated: false };

  const { id, name, email, image } = user as Record<string, unknown>;
  const displayName = typeof name === "string" && name.trim() ? name.trim() : undefined;
  const address = typeof email === "string" && email.trim() ? email.trim() : undefined;
  const avatar = typeof image === "string" && image.trim() ? image.trim() : undefined;

  const identified =
    (typeof id === "string" && id.trim().length > 0) ||
    (typeof id === "number" && Number.isFinite(id)) ||
    Boolean(displayName ?? address);

  if (!identified) return { authenticated: false };

  return {
    authenticated: true,
    ...(displayName === undefined ? {} : { displayName }),
    ...(address === undefined ? {} : { email: address }),
    ...(avatar === undefined ? {} : { avatar }),
  };
}

export function parseContent(page: ValirSeriesPage, contentId: string): Content {
  const series = page.series;
  const title = cleanText(series.title);

  const alternates = [series.altTitle, series.originalTitle, ...(series.aliases ?? [])]
    .map((name) => cleanText(name))
    .filter((name) => name && name.toLowerCase() !== title.toLowerCase());

  const tags: Tag[] = [
    ...(series.genres ?? []).flatMap((entry: ValirGenre) => {
      const genre = entry.genre ?? entry;
      const name = cleanText(genre.name) || (genre.slug ? titleCase(genre.slug) : "");
      // The id stays the site's own slug, which is what the genre filter matches on.
      return name && genre.slug ? [{ id: genre.slug, title: name }] : [];
    }),
    ...(series.tags ?? []).flatMap((tag) => {
      const name = cleanText(tag.name);
      return name && tag.slug ? [{ id: tag.slug, title: name }] : [];
    }),
  ];

  const creators = [cleanText(series.author), cleanText(series.artist)].filter(Boolean);
  const status = parseStatus(series);

  // The stat line the site prints beside the cover, in its own order.
  const info: Pair[] = [];
  const score = formatScore(series.rating);
  if (score) info.push({ key: "Rating", value: score });
  const kind = kindLabel(series);
  if (kind) info.push({ key: "Type", value: `♤ ${kind}` });
  const state = statusLabel(series);
  if (state) info.push({ key: "Status", value: `◌ ${state}` });
  const views = compactCount(series.viewCount);
  if (views) info.push({ key: "Views", value: `${VIEWS_MARK} ${views}` });

  return {
    title,
    cover: absolute(series.coverImage),
    summary: summaryFromHtml(series.description ?? ""),
    additionalTitles: [...new Set(alternates)],
    tags,
    ...(status === undefined ? {} : { status }),
    // Novels are not offered here, so a title reached this way is a comic.
    contentType: ContentType.COMIC,
    contentRating: ratingOf(series),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: contentUrl(contentId),
  };
}

// ========================= Chapters =========================

/**
 * Whether the account reading this may open the chapter.
 *
 * `hasAccess` is the site's own answer for the signed-in reader and outranks the lock,
 * which describes the chapter rather than the account. A payload that states neither is
 * an ordinary free chapter.
 */
function chapterIsAccessible(chapter: ValirChapterItem): boolean {
  return (
    chapter.hasAccess === true || (chapter.hasAccess === undefined && chapter.isLocked !== true)
  );
}

export function chapterIsLocked(chapterId: string): boolean {
  return chapterId.endsWith(LOCK_SUFFIX);
}

export function chapterPath(chapterId: string): string {
  return chapterId.endsWith(LOCK_SUFFIX) ? chapterId.slice(0, -LOCK_SUFFIX.length) : chapterId;
}

/** What a chapter row reads as, with the site's own name for it kept after the number. */
function chapterLabel(chapter: ValirChapterItem, numbered: boolean): string {
  const number = formatChapterNumber(chapter.number);
  const base = numbered && number ? `Chapter ${number}` : "Chapter";
  // The site writes its own "Chapter N" into some titles and not others, so the one it
  // supplies is dropped rather than printed twice.
  const name = cleanText(chapter.title)
    .replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "")
    .trim();
  return name ? `${base} - ${name}` : base;
}

export function toChapters(
  items: readonly ValirChapterItem[],
  contentId: string,
  hideLocked: boolean,
): Chapter[] {
  const seen = new Set<string>();

  const parsed = items.flatMap((chapter) => {
    const locked = !chapterIsAccessible(chapter);
    if (hideLocked && locked) return [];

    // "No number" and "the number zero" are different questions: a prologue numbered 0
    // opens the run, while a chapter the site left unnumbered must not become what an
    // unread title starts at.
    const numbered = Number.isFinite(chapter.number);
    // The route is built from the number, so that is the id — which also means two rows
    // sharing a number are the same chapter however their records differ, and the site's
    // own pagination does hand the same one back on two pages.
    const id = formatChapterNumber(chapter.number) || String(chapter.id);
    if (seen.has(id)) return [];
    seen.add(id);

    return [
      {
        chapterId: locked ? `${id}${LOCK_SUFFIX}` : id,
        number: numbered ? chapter.number : 0,
        index: 0,
        // The app prints this verbatim, so the whole label is built here. A padlock in
        // front says the row is held back, which reads at a glance down a long list where
        // a trailing word does not.
        title: `${locked ? `${LOCK_MARK} ` : ""}${chapterLabel(chapter, numbered)}`,
        date: parseTimestamp(chapter.publishedAt) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        webUrl: `${contentUrl(contentId)}/chapter/${id}`,
        numbered,
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

export type ReaderContent =
  | { kind: "pages"; pages: string[] }
  | { kind: "prose" }
  | { kind: "locked" };

/**
 * What the reader route holds for a chapter.
 *
 * Prose is reported rather than returned: a novel chapter is text where a Mana chapter is
 * a list of images, and saying so beats a blank reader nobody can act on.
 */
export function parseReader(html: string): ReaderContent {
  const payload = decodeFlightPayload(html);
  const reader = extractByMarker<ValirReaderData>(payload, '{"chapter":', true).find(
    (candidate) =>
      Array.isArray(candidate.chapter?.pages) || typeof candidate.chapter?.content === "string",
  );
  if (!reader?.chapter) {
    throw new Error("ValirScans returned no data for that chapter — it may have been taken down.");
  }

  // `isUnlocked` is what the site says about this reader's access and settles it either
  // way; the two lock flags only matter when it has said nothing.
  if (
    reader.isUnlocked !== true &&
    (reader.isUnlocked === false || reader.isLocked === true || reader.chapter.isLocked === true)
  ) {
    return { kind: "locked" };
  }

  const pages = (reader.chapter.pages ?? [])
    .slice()
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => absolute(page.imageUrl))
    .filter(Boolean);

  if (pages.length > 0) return { kind: "pages", pages };
  return typeof reader.chapter.content === "string" && reader.chapter.content.trim()
    ? { kind: "prose" }
    : { kind: "pages", pages: [] };
}

// ========================= Tiles =========================

/**
 * What a tile writes under its title.
 *
 * Every plain strip of covers says the same two numbers the site grades a title by, in the
 * same order, so the line reads as one thing wherever it is met rather than as a different
 * measure per row. The hero says them too, leading with what it was read.
 *
 * The two rows that are not strips say something else: a chart leads with where the site
 * put it, and a grouped list says nothing at all, because its chapters are rows of their
 * own beneath the title and repeating the newest here would print it twice.
 *
 * The rating is not on this line at all any more: it is the pill the app draws over the
 * cover, which it draws on every shape of tile — so it is said once, and in the same place
 * whether the tile is a hero, a chart or a strip.
 */
function buildSubtitle(series: ValirSeries, style: SubtitleStyle, rank: number): string {
  const kind = kindLabel(series);
  const views = compactCount(series.viewCount);
  const viewLabel = views ? `${VIEWS_MARK} ${views}` : "";

  switch (style) {
    case "rank":
      return [rank > 0 ? `#${rank}` : "", kind].filter(Boolean).join(" • ");
    // A title the site has counted no reading for falls back to what it is, rather than
    // leaving the line empty.
    case "hero":
    case "stats":
      return viewLabel || kind;
    default:
      return "";
  }
}

/** The rows a detailed tile draws, which is the only place a symbol is written. */
function buildInfoRows(series: ValirSeries, style: SubtitleStyle): Pair[] {
  if (style === "chapters") {
    return (series.chapters ?? []).slice(0, LATEST_CHAPTERS_SHOWN).map((chapter) => {
      const locked = !chapterIsAccessible(chapter);
      const label = `Chapter ${formatChapterNumber(chapter.number) || "?"}`;
      const uploaded = parseTimestamp(chapter.publishedAt) ?? parseTimestamp(series.lastChapterAt);
      return {
        key: locked ? `${LOCK_MARK} ${label}` : label,
        value: uploaded ? relativeTime(uploaded) : "",
      };
    });
  }

  if (style !== "rank") return [];

  const rows: Pair[] = [];
  const views = compactCount(series.viewCount);
  if (views) rows.push({ key: "Views", value: `${VIEWS_MARK} ${views}` });
  const state = statusLabel(series);
  if (state) rows.push({ key: "Status", value: `◌ ${state}` });
  return rows;
}

export function toHighlight(series: ValirSeries, style: SubtitleStyle, rank = 0): Highlight {
  const subtitle = buildSubtitle(series, style, rank);
  const info = buildInfoRows(series, style);
  const badge = toBadge(formatScore(series.rating));
  const contentId = contentIdOf(series);

  return {
    id: contentId,
    title: cleanText(series.title),
    cover: absolute(series.coverImage),
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    ...(info.length === 0 ? {} : { info }),
    contentRating: ratingOf(series),
    webUrl: contentUrl(contentId),
  };
}

/**
 * The comics among a list, with anything the host's rating policy disallows left out.
 *
 * The site publishes prose alongside comics and offers no rating facet of its own, so both
 * are settled here for the rows that come off the front page. Browsing pushes the same two
 * into the site's own filter instead, which keeps a page of results the length it says.
 */
export function permitted(
  list: readonly ValirSeries[],
  allowed: readonly ContentRating[] | undefined,
): ValirSeries[] {
  return list.filter((series) => {
    if (!series.slug || !series.title || isNovel(series)) return false;
    return !allowed || allowed.includes(ratingOf(series));
  });
}
