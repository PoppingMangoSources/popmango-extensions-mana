/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  type Chapter,
  type Content,
  type Highlight,
  type Pair,
  type Tag,
} from "@mana-app/types";

import {
  clean,
  decodeEntities,
  relativeTime,
  resolveUrl,
  summaryFromHtml,
  firstFilled,
  toBadge,
} from "../common/index.ts";
import {
  BASE_URL,
  CONTENT_RATING_GENRES,
  type ChapterPagesResponse,
  type Series,
  type SeriesChapterDetails,
} from "./model.ts";

/** Covers, banners and pages all arrive as site-relative paths. */
export function absoluteUrl(target: string | null | undefined): string {
  const value = (target ?? "").trim();
  return value ? resolveUrl(value, BASE_URL) : "";
}

export function seriesUrl(slug: string): string {
  return `${BASE_URL}/series/${slug}`;
}

/**
 * A tile's cover is the series' own cover, on every row including the hero.
 *
 * The banner is a wide crop the site uses at the top of a page. Substituting it anywhere
 * would show a different picture for the same series depending on where the reader met
 * it, so it is never used. The site serves the path relative to its root.
 */
function coverUrl(series: Series): string {
  return absoluteUrl(series.coverUrl);
}

export function parseStatus(status: string | null | undefined): PublicationStatus | undefined {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
      return PublicationStatus.ONGOING;
    case "completed":
      return PublicationStatus.COMPLETED;
    case "hiatus":
      return PublicationStatus.HIATUS;
    case "dropped":
    case "cancelled":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

/** The site states no rating of its own, so its genres are what a rating is read from. */
export function parseRating(genres: readonly string[] | null | undefined): ContentRating {
  const lower = (genres ?? []).map((genre) => genre.trim().toLowerCase());
  const matches = (rating: string): boolean =>
    CONTENT_RATING_GENRES[rating]?.some((genre) => lower.includes(genre)) === true;

  if (matches("explicit")) return ContentRating.EXPLICIT;
  if (matches("mature")) return ContentRating.MATURE;
  return ContentRating.SAFE;
}

/** The catalogue is Korean unless a series says otherwise. */
function parseContentType(series: Series): ContentType {
  switch ((series.countryOfOrigin ?? "").toUpperCase()) {
    case "JP":
      return ContentType.MANGA;
    case "CN":
      return ContentType.MANHUA;
    default:
      return ContentType.MANHWA;
  }
}

function parseTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `"12.00"` reads better as `12`, and `"12.50"` as `12.5`. */
export function formatChapterNumber(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const number = Number.parseFloat(raw);
  return Number.isFinite(number) ? String(number) : raw;
}

/** Six figures of views would push everything else off a tile's row. */
function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function viewCount(series: Series): number | undefined {
  if (series.totalViews == null) return undefined;
  const value = Number.parseInt(String(series.totalViews), 10);
  return Number.isFinite(value) ? value : undefined;
}

/** The site marks its rating with a filled star, so the tiles do too. */
function formatScore(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "";
  return `★ ${rating.toFixed(1)}`;
}

function genreTitle(genre: string): string {
  return clean(genre)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * What a tile puts under its title. A row that draws no info rows has only this line, so
 * each section says the thing its own ranking is about.
 */
export type SubtitleStyle = "chapter" | "kind" | "views" | "hero";

export type HighlightOptions = {
  /** A hero card is cropped wide and shows no info rows. */
  hero?: boolean;
  subtitle?: SubtitleStyle;
};

/** The site files everything by country; its own word for the format follows from that. */
function formatKind(series: Series): string {
  switch ((series.countryOfOrigin ?? "").toUpperCase()) {
    case "JP":
      return "Manga";
    case "CN":
      return "Manhua";
    default:
      return "Manhwa";
  }
}

function formatStatus(series: Series): string {
  const status = (series.publicationStatus ?? "").trim().toLowerCase();
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * The site's word for the state, behind the house symbol.
 *
 * These glyphs are the text-presentation forms on purpose. A `Pair` and a subtitle both
 * take plain text — `systemImage` lives on `UIButtonOptions` and nowhere a tile can reach —
 * so a symbol here is a character, and an emoji one would render in colour beside the
 * filled marks around it. `⏯︎` carries U+FE0E for exactly that reason: without it the
 * base codepoint draws as an emoji.
 */
function statusOf(series: Series): string {
  const status = formatStatus(series);
  return status ? `◌ ${status}` : "";
}

/**
 * Every listing endpoint returns the rating, genres, views and last chapter alongside the
 * cover, so a tile is filled without a second request per row.
 */
export function parseHighlight(series: Series, options: HighlightOptions = {}): Highlight {
  const { hero = false, subtitle: style = hero ? "hero" : "chapter" } = options;

  const chapter = formatChapterNumber(series.latestChapter?.chapterNumber);
  const uploaded = parseTimestamp(
    series.latestChapter?.createdAt ?? series.lastChapterUploadedAt ?? series.updatedAt,
  );
  const score = formatScore(series.averageRating);
  const views = compactCount(viewCount(series));
  // Two genres: the third wraps and pushes the tile out of its row.
  const genres = (series.genres ?? []).slice(0, 2).map(genreTitle).filter(Boolean);

  // The pill takes the score, and what the series has been read when the site has graded
  // it nothing; whatever it takes is then left out of the lines below it.
  const viewLabel = views ? `⏯︎ ${views}` : "";
  const taken = firstFilled(score, viewLabel);

  const info = hero
    ? []
    : buildInfoRows(style, { chapter, uploaded, genres, views, status: statusOf(series), taken });

  const subtitle = buildSubtitle(series, style, { chapter, views, taken });
  const badge = toBadge(taken);

  return {
    id: series.slug,
    title: decodeEntities(clean(series.title)),
    cover: coverUrl(series),
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    ...(info.length === 0 ? {} : { info }),
    contentRating: parseRating(series.genres),
    webUrl: seriesUrl(series.slug),
  };
}

type InfoParts = {
  chapter: string;
  uploaded: Date | undefined;
  genres: readonly string[];
  views: string;
  status: string;
  /** What the pill over the cover already says, which no row may repeat. */
  taken: string;
};

function buildInfoRows(style: SubtitleStyle, parts: InfoParts): Pair[] {
  const rows: Record<string, Pair | undefined> = {
    latest: parts.chapter ? { key: "Latest", value: `Chapter ${parts.chapter}` } : undefined,
    updated: parts.uploaded ? { key: "Updated", value: relativeTime(parts.uploaded) } : undefined,
    genres:
      parts.genres.length > 0
        ? { key: parts.genres.length > 1 ? "Genres" : "Genre", value: parts.genres.join(", ") }
        : undefined,
    views:
      parts.views && `⏯︎ ${parts.views}` !== parts.taken
        ? { key: "Views", value: `⏯︎ ${parts.views}` }
        : undefined,
    status: parts.status ? { key: "Status", value: parts.status } : undefined,
  };

  // A format-led row gives its subtitle over to the format alone, so the count the section
  // was ranked on leads the rows with the state of the series directly beneath it.
  const order =
    style === "kind"
      ? ["views", "status", "latest", "updated"]
      : ["latest", "updated", "genres", "views"];

  return (
    order
      .map((name) => rows[name])
      .filter((row): row is Pair => row !== undefined)
      // A tile stretches its whole row past about four lines, so the rest is dropped.
      .slice(0, 4)
  );
}

function buildSubtitle(
  series: Series,
  style: SubtitleStyle,
  parts: { chapter: string; views: string; taken: string },
): string {
  const chapterLabel = parts.chapter ? `Chapter ${parts.chapter}` : "";
  const counted = parts.views ? `⏯︎ ${parts.views}` : "";
  // The pill above may already be showing the count, in which case this line does not.
  const viewLabel = counted === parts.taken ? "" : counted;

  switch (style) {
    case "hero":
      return [chapterLabel, viewLabel].filter(Boolean).join(" | ");
    // The state of the series moves to a row of its own beneath the views, leaving the
    // line under the title to say what the series is.
    case "kind":
      return `♤ ${formatKind(series)}`;
    // A row ranked by reading says what it was ranked on; a title with none falls back
    // to the chapter rather than showing an empty line.
    case "views":
      return viewLabel || chapterLabel;
    default:
      return chapterLabel;
  }
}

/**
 * A tile for whichever row it lands in.
 *
 * Every row shows the series' cover, the hero included: that is the artwork the site puts
 * on a title, and swapping in the banner for one row would show a different picture for
 * the same series depending on where the reader met it. `hero` changes only the shape of
 * the card and what is written under it.
 */
export function toHighlight(series: Series, hero: boolean, subtitle?: SubtitleStyle): Highlight {
  return parseHighlight(series, {
    hero,
    ...(subtitle === undefined ? {} : { subtitle }),
  });
}

function creator(value: string | null | undefined): string | undefined {
  const cleaned = decodeEntities(clean(value ?? ""));
  if (!cleaned || cleaned === "-" || /^(?:n\/a|unknown|tba)$/i.test(cleaned)) return undefined;
  return cleaned;
}

export function parseContent(series: Series): Content {
  const genres = series.genres ?? [];
  const tags: Tag[] = genres
    .map((genre) => clean(genre))
    .filter(Boolean)
    // The id stays the site's own slug, which is what the genre filter matches on.
    .map((genre) => ({ id: genre.toLowerCase(), title: genreTitle(genre) }));

  const status = parseStatus(series.publicationStatus);
  const title = decodeEntities(clean(series.title));
  const original = decodeEntities(clean(series.originalTitle ?? ""));
  const creators = [creator(series.author), creator(series.artist)].filter(
    (name): name is string => name !== undefined,
  );

  // The stat line the site prints under the title, in its own order.
  const info: Pair[] = [];
  const score = formatScore(series.averageRating);
  if (score) info.push({ key: "Rating", value: score });
  if (series.ratingCount != null) info.push({ key: "Ratings", value: String(series.ratingCount) });
  if (series.chapterCount != null) {
    info.push({ key: "Chapters", value: String(series.chapterCount) });
  }
  if (series.bookmarkCount != null) {
    info.push({ key: "Bookmarks", value: String(series.bookmarkCount) });
  }
  const views = compactCount(viewCount(series));
  if (views) info.push({ key: "Views", value: `⏯︎ ${views}` });

  return {
    title,
    cover: coverUrl(series),
    summary: summaryFromHtml(series.description ?? ""),
    additionalTitles: original && original.toLowerCase() !== title.toLowerCase() ? [original] : [],
    tags,
    ...(status === undefined ? {} : { status }),
    contentType: parseContentType(series),
    contentRating: parseRating(genres),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: seriesUrl(series.slug),
  };
}

/**
 * A paid chapter unlocks on the website, and the API says so per chapter rather than for
 * the series. `isFreeNow` is the site's own timed release, so a priced chapter that has
 * come round is readable like any other.
 */
export function chapterIsLocked(chapter: SeriesChapterDetails): boolean {
  return (chapter.price ?? 0) > 0 && chapter.isFreeNow !== true && chapter.isPurchased !== true;
}

export function parseChapters(
  chapters: readonly SeriesChapterDetails[],
  showLocked: boolean,
): Chapter[] {
  const parsed = chapters
    .filter((chapter) => showLocked || !chapterIsLocked(chapter))
    .map((chapter) => {
      const value = Number.parseFloat(chapter.chapterNumber);
      // Whether the site gave a number at all, which is not the same as whether that
      // number is zero: a prologue is numbered 0 and belongs ahead of chapter 1.
      const numbered = Number.isFinite(value);
      const locked = chapterIsLocked(chapter);
      const name = decodeEntities(clean(chapter.title ?? ""));
      const label = `Chapter ${formatChapterNumber(chapter.chapterNumber)}`;

      return {
        chapterId: chapter.chapterId,
        number: numbered ? value : 0,
        index: 0,
        // The app prints this verbatim and never joins the number onto it, so the label
        // is built here. A locked row says so rather than failing when it is opened.
        title: `${name && name !== label ? `${label} - ${name}` : label}${locked ? " (Locked)" : ""}`,
        date: parseTimestamp(chapter.releaseDate ?? chapter.createdAt) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        webUrl: undefined,
        numbered,
      };
    });

  // A chapter the site left unnumbered — a side story, an extra — would otherwise sit at 0
  // and become what the app opens first, so those are numbered above the main run in listed
  // order. A chapter the site numbered 0 is chapter zero and is left exactly where it is.
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

export function parsePages(response: ChapterPagesResponse): string[] {
  const pages = response.pages?.length ? response.pages : (response.images ?? []);

  return [...pages]
    .sort(
      (left, right) =>
        (left.pageNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.pageNumber ?? Number.MAX_SAFE_INTEGER),
    )
    .map((page) => absoluteUrl(page.url))
    .filter(Boolean);
}

/** A pasted series link is treated as a search for that series. */
export function slugFromUrl(value: string): string | undefined {
  return /^https?:\/\/(?:www\.)?stonescape\.xyz\/series\/([^/?#]+)/i.exec(value.trim())?.[1];
}
