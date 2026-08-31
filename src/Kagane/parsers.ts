/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Turns the API's JSON into the shapes the app renders.
 *
 * Nothing here touches the network, so every display preference the reader can
 * set arrives as an argument rather than being read from the store in place.
 */

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

import { decodeEntities, parseDate } from "../common/index.ts";
import {
  BASE_URL,
  CHAPTER_GROUP_REGEX,
  CHAPTER_METADATA_REGEX,
  CHAPTER_NUMBER_PREFIX_REGEX,
  CHAPTER_TRAILING_GROUP_REGEX,
  CHAPTER_VOLUME_SUFFIX_REGEX,
  SOURCE_CHAPTER_NUMBER_FORMATS,
  TITLE_BRACKET_REGEX,
  type ChapterBookDto,
  type DetailsDto,
  type SeriesSummaryDto,
} from "./model.ts";

export type TitleOptions = {
  cleanTitle: boolean;
  showSource: boolean;
  showEdition: boolean;
  /** source_id → display name */
  sources: Record<string, string>;
};

/** Strips a trailing bracketed qualifier, when the reader asked for that. */
function cleaned(title: string, cleanTitle: boolean): string {
  const trimmed = title.trim();
  return cleanTitle ? trimmed.replace(TITLE_BRACKET_REGEX, "").trim() || trimmed : trimmed;
}

/**
 * Builds a display title.
 *
 * "Clean title" is deliberately exclusive with the two annotations: it exists
 * to collapse duplicate library entries, which appending a source name undoes.
 */
export function displayTitle(
  title: string,
  options: TitleOptions,
  sourceId?: string | null,
  editionInfo?: string | null,
): string {
  if (options.cleanTitle) return cleaned(title, true);

  let result = title.trim();
  if (options.showEdition && editionInfo) result = `${result} (${editionInfo})`;

  if (options.showSource && sourceId) {
    const sourceName = options.sources[sourceId];
    if (sourceName) result = `${result} [${sourceName}]`;
  }

  return result;
}

export function seriesUrl(seriesId: string): string {
  return `${BASE_URL}/series/${seriesId}`;
}

export function chapterUrl(seriesId: string, chapterId: string): string {
  return `${BASE_URL}/series/${seriesId}/reader/${chapterId}`;
}

function statusOf(raw: string | undefined): PublicationStatus | undefined {
  switch ((raw ?? "").toUpperCase()) {
    case "ONGOING":
      return PublicationStatus.ONGOING;
    case "COMPLETED":
      return PublicationStatus.COMPLETED;
    case "HIATUS":
      return PublicationStatus.HIATUS;
    case "ABANDONED":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

function contentTypeOf(format: string | null | undefined): ContentType | undefined {
  switch ((format ?? "").toLowerCase()) {
    case "manga":
      return ContentType.MANGA;
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "comic":
      return ContentType.COMIC;
    default:
      return undefined;
  }
}

/** The listing states each title's rating, so a tile never has to guess. */
export function ratingOf(value: string | null | undefined): ContentRating {
  switch ((value ?? "").toLowerCase()) {
    case "safe":
      return ContentRating.SAFE;
    case "suggestive":
      return ContentRating.SUGGESTIVE;
    case "pornographic":
      return ContentRating.EXPLICIT;
    default:
      return ContentRating.MATURE;
  }
}

function statusLabel(book: SeriesSummaryDto): string | undefined {
  switch ((book.publication_status ?? "").toUpperCase()) {
    case "ONGOING":
      return "Ongoing";
    case "COMPLETED":
      return "Completed";
    case "HIATUS":
      return "Hiatus";
    case "ABANDONED":
      return "Cancelled";
    default:
      return undefined;
  }
}

/** "MANHWA · Completed" — the line beneath a title on a detailed row. */
export function descriptorOf(book: SeriesSummaryDto): string | undefined {
  const format = book.format?.trim();
  const parts = [
    format && format.toLowerCase() !== "other" ? format.toUpperCase() : undefined,
    statusLabel(book),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** "Vol.1 Ch.3" / "Ch. 27" for the newest chapter a listing advertises. */
export function latestChapterLabel(book: SeriesSummaryDto): string | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;

  const chapter = latest.chapter_no?.trim();
  const volume = latest.volume_no?.trim();

  if (chapter) return volume ? `Vol.${volume} Ch.${chapter}` : `Ch. ${chapter}`;
  if (volume) return `Volume ${volume}`;
  return latest.title?.trim() || undefined;
}

export function latestChapterDate(book: SeriesSummaryDto): Date | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;
  return parseDate(latest.available_at ?? latest.created_at);
}

/**
 * The key/value rows a detailed listing shows under the descriptor — the same
 * shape as a "Rating / Chapters / Volumes" block.
 */
export function infoRowsOf(book: SeriesSummaryDto, genreNames: Record<string, string>): Pair[] {
  const rows: Pair[] = [];

  const books = book.current_books;
  if (typeof books === "number" && books > 0) rows.push({ key: "Chapters", value: String(books) });

  if (book.start_year) rows.push({ key: "Year", value: String(book.start_year) });

  const genres = (book.genres ?? [])
    .map((id) => genreNames[id])
    .filter((name): name is string => Boolean(name))
    .slice(0, 2);
  if (genres.length > 0) rows.push({ key: "Genres", value: genres.join(", ") });

  return rows;
}

export function toHighlight(
  book: SeriesSummaryDto,
  options: TitleOptions,
  coverFor: (imageId: string) => string,
  extra?: { subtitle?: string; info?: Pair[] },
): Highlight {
  return {
    id: book.series_id,
    title: displayTitle(book.title, options, book.source_id),
    cover: book.cover_image_id ? coverFor(book.cover_image_id) : "",
    ...(extra?.subtitle ? { subtitle: extra.subtitle } : {}),
    ...(extra?.info && extra.info.length > 0 ? { info: extra.info } : {}),
    contentRating: ratingOf(book.content_rating),
    webUrl: seriesUrl(book.series_id),
  };
}

export function toContent(
  seriesId: string,
  details: DetailsDto,
  options: TitleOptions & { showSpoilerTags: boolean },
  coverFor: (imageId: string) => string,
): Content {
  const sourceName = details.source_id ? options.sources[details.source_id] : undefined;

  const authors = (details.series_staff ?? [])
    .filter((staff) => /author|story/i.test(staff.role))
    .map((staff) => staff.name);
  const artists = (details.series_staff ?? [])
    .filter((staff) => /artist|art/i.test(staff.role))
    .map((staff) => staff.name);

  const alternateTitles = (details.series_alternate_titles ?? [])
    .map((entry) => entry.title.trim())
    .filter(Boolean);

  const tags: Tag[] = [
    ...(details.genres ?? []).map((genre) => ({
      id: genre.genre_name,
      title: genre.genre_name,
    })),
    // The site marks some tags as spoilers and hides them unless asked.
    ...(details.tags ?? [])
      .filter((tag) => options.showSpoilerTags || tag.spoiler !== true)
      .map((tag) => ({ id: tag.tag_name, title: tag.tag_name })),
  ];

  const summary = buildSummary(details, sourceName);
  const status = statusOf(details.upload_status);
  const contentType = contentTypeOf(details.format);

  return {
    title: displayTitle(details.title, options, details.source_id, details.edition_info),
    cover: details.series_covers?.[0]?.image_id ? coverFor(details.series_covers[0]!.image_id) : "",
    summary,
    additionalTitles: alternateTitles,
    tags,
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: ratingOf(details.content_rating),
    ...(status === undefined ? {} : { status }),
    webUrl: seriesUrl(seriesId),
    ...(authors.length > 0 || artists.length > 0
      ? {
          additionalInfo: [
            {
              type: 1 as const,
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: [
                ...unique(authors).map((name) => ({
                  type: 1 as const,
                  id: `author:${name}`,
                  title: name,
                  subtitle: "Author",
                })),
                ...unique(artists)
                  .filter((name) => !authors.includes(name))
                  .map((name) => ({
                    type: 1 as const,
                    id: `artist:${name}`,
                    title: name,
                    subtitle: "Artist",
                  })),
              ],
            },
          ],
        }
      : {}),
  };
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

/** The API rates out of 100; the site shows that as a score out of ten. */
function starRating(details: DetailsDto): string | undefined {
  const percent =
    typeof details.average_rating === "number" && details.average_rating > 0
      ? details.average_rating
      : typeof details.bayesian_rating === "number" && details.bayesian_rating > 0
        ? details.bayesian_rating
        : undefined;

  return percent === undefined ? undefined : `★ ${(percent / 10).toFixed(1)}`;
}

function formatViews(views: number | null | undefined): string | undefined {
  if (typeof views !== "number" || views <= 0) return undefined;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
  return `${views} views`;
}

/** The description, plus the associated names the site lists separately. */
function buildSummary(details: DetailsDto, sourceName: string | undefined): string {
  const parts: string[] = [];

  // The site states a score and a view count for every series, but Mana's
  // `Content` has no field for either, so they lead the summary instead.
  const stats = [starRating(details), formatViews(details.total_views)].filter(Boolean);
  if (stats.length > 0) parts.push(stats.join("  ·  "));

  const description = (details.description ?? "").trim();
  if (description) {
    parts.push(
      decodeEntities(description.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim(),
    );
  }

  if (sourceName) parts.push(`Source: ${sourceName}`);

  const alternates = (details.series_alternate_titles ?? [])
    .map((entry) => entry.title.trim())
    .filter(Boolean);
  if (alternates.length > 0) {
    parts.push(["Associated Name(s):", ...alternates.map((name) => `• ${name}`)].join("\n"));
  }

  return parts.join("\n\n").trim();
}

/**
 * What the chapter is actually called, once the site's own numbering is out.
 *
 * A title arrives as "Episode 8", as "Chapter 44 - Volume 9 (Ushi)", or as a
 * real name. The first two only restate what the composed label already says —
 * and the group is rendered beside the row in its own right — so both reduce to
 * nothing, leaving the label free of "Ch.44 Chapter 44 - Volume 9 (Ushi)".
 */
function chapterOwnName(title: string): string {
  let name = title.trim().replace(CHAPTER_METADATA_REGEX, "");
  name = name.replace(CHAPTER_TRAILING_GROUP_REGEX, "");
  name = name.replace(CHAPTER_VOLUME_SUFFIX_REGEX, "");
  name = name.replace(CHAPTER_NUMBER_PREFIX_REGEX, "");
  // Whatever joined the number to the name — "Episode 8: The Duel".
  return name.replace(/^[\s:.\-–—]+/, "").trim();
}

/** The number the site states in the title, for chapters that carry no field. */
function chapterNumberInTitle(title: string): string {
  return CHAPTER_NUMBER_PREFIX_REGEX.exec(title.trim())?.[1] ?? "";
}

/**
 * Composes a chapter's display name.
 *
 * The site's own titles are inconsistent — some carry a number, some only a
 * name, some neither — so the reader picks which of the four shapes they want.
 */
function chapterName(book: ChapterBookDto, mode: string): string {
  const title = book.title.trim();
  const name = chapterOwnName(title);
  const chapterNo = (book.chapter_no ?? "").trim() || chapterNumberInTitle(title);
  const volumeNo = (book.volume_no ?? "").trim();

  const chapter = chapterNo ? `Ch.${chapterNo}` : "";
  const volume = volumeNo ? `Vol.${volumeNo}` : "";
  const join = (...parts: string[]): string => parts.filter(Boolean).join(" ");

  switch (mode) {
    case "always":
      return join(chapter, name) || title;

    case "vol_local":
      return join(volume, chapter) || name || title;

    case "vol_chapter":
      return join(volume, chapter, name) || title;

    default:
      // The site says "Episode 8" as often as "Chapter 8"; one wording for both.
      return name || (chapterNo ? `Chapter ${chapterNo}` : title);
  }
}

/** The uploading group, including one named inside the chapter title. */
function scanlatorOf(book: ChapterBookDto): string | undefined {
  const groups = (book.groups ?? []).map((group) => group.title).filter(Boolean);
  let name = groups.join(", ");

  const stripped = book.title.trim().replace(CHAPTER_METADATA_REGEX, "");
  const match = CHAPTER_GROUP_REGEX.exec(stripped);
  const tag = match?.[1] ?? match?.[2];
  if (tag) name = name ? `${name} (${tag})` : tag;

  return name || undefined;
}

export function toChapters(
  seriesId: string,
  details: DetailsDto,
  options: { chapterTitleMode: string; language: string },
): Chapter[] {
  const books = details.series_books ?? [];
  // `sort_no` is a position within the series for most formats; only a few
  // publish a number that means anything as a chapter number.
  const useSourceNumber = SOURCE_CHAPTER_NUMBER_FORMATS.has(details.format ?? "");

  // The API lists newest first; index 0 must be the first published chapter.
  const ordered = [...books].reverse();

  return ordered.map((book, index) => {
    const scanlator = scanlatorOf(book);
    const parsedNumber = Number.parseFloat((book.chapter_no ?? "").replace(/[^\d.]/g, ""));

    const number = useSourceNumber
      ? (book.sort_no ?? index + 1)
      : Number.isFinite(parsedNumber)
        ? parsedNumber
        : index + 1;

    return {
      chapterId: book.book_id,
      number,
      index,
      title: chapterName(book, options.chapterTitleMode),
      date: parseDate(book.created_at) ?? new Date(0),
      language: options.language || DefinedLanguages.ENGLISH,
      webUrl: chapterUrl(seriesId, book.book_id),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });
}
