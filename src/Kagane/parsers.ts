/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  additionalInfo,
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
  type ChapterBook,
  type DetailsResponse,
  type SeriesSummary,
} from "./model.ts";

export type TitleOptions = {
  cleanTitle: boolean;
  showSource: boolean;
  showEdition: boolean;
  sources: Record<string, string>;
};

export function formatTitle(
  title: string,
  options: TitleOptions,
  sourceId?: string | null,
  editionInfo?: string | null,
): string {
  const trimmed = title.trim();
  if (options.cleanTitle) return trimmed.replace(TITLE_BRACKET_REGEX, "").trim() || trimmed;

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

function parseStatus(raw: string | undefined): PublicationStatus | undefined {
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

function parseContentType(format: string | null | undefined): ContentType | undefined {
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

export function parseContentRating(value: string | null | undefined): ContentRating {
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

function formatStatus(book: SeriesSummary): string | undefined {
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

export function formatDescriptor(book: SeriesSummary): string | undefined {
  const format = book.format?.trim();
  const parts = [
    format && format.toLowerCase() !== "other" ? format.toUpperCase() : undefined,
    formatStatus(book),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function formatLatestChapter(book: SeriesSummary): string | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;

  const chapter = latest.chapter_no?.trim();
  const volume = latest.volume_no?.trim();

  if (chapter) return volume ? `Vol.${volume} Ch.${chapter}` : `Ch. ${chapter}`;
  if (volume) return `Volume ${volume}`;
  return latest.title?.trim() || undefined;
}

export function parseLatestChapterDate(book: SeriesSummary): Date | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;
  return parseDate(latest.available_at ?? latest.created_at);
}

export function buildInfoRows(book: SeriesSummary, genreNames: Record<string, string>): Pair[] {
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

export function parseHighlight(
  book: SeriesSummary,
  options: TitleOptions,
  coverFor: (imageId: string) => string,
  extra?: { subtitle?: string; info?: Pair[] },
): Highlight {
  return {
    id: book.series_id,
    title: formatTitle(book.title, options, book.source_id),
    cover: book.cover_image_id ? coverFor(book.cover_image_id) : "",
    ...(extra?.subtitle ? { subtitle: extra.subtitle } : {}),
    ...(extra?.info && extra.info.length > 0 ? { info: extra.info } : {}),
    contentRating: parseContentRating(book.content_rating),
    webUrl: seriesUrl(book.series_id),
  };
}

export function parseContent(
  seriesId: string,
  details: DetailsResponse,
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
    ...(details.tags ?? [])
      .filter((tag) => options.showSpoilerTags || tag.spoiler !== true)
      .map((tag) => ({ id: tag.tag_name, title: tag.tag_name })),
  ];

  const summary = buildSummary(details, sourceName);
  const status = parseStatus(details.upload_status);
  const contentType = parseContentType(details.format);

  return {
    title: formatTitle(details.title, options, details.source_id, details.edition_info),
    cover: details.series_covers?.[0]?.image_id ? coverFor(details.series_covers[0]!.image_id) : "",
    summary,
    additionalTitles: alternateTitles,
    tags,
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: parseContentRating(details.content_rating),
    ...(status === undefined ? {} : { status }),
    webUrl: seriesUrl(seriesId),
    ...(authors.length > 0 || artists.length > 0
      ? {
          additionalInfo: [
            additionalInfo.staff.section({
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: [
                ...unique(authors).map((name) =>
                  additionalInfo.staff.item({
                    id: `author:${name}`,
                    title: name,
                    subtitle: "Author",
                  }),
                ),
                ...unique(artists)
                  .filter((name) => !authors.includes(name))
                  .map((name) =>
                    additionalInfo.staff.item({
                      id: `artist:${name}`,
                      title: name,
                      subtitle: "Artist",
                    }),
                  ),
              ],
            }),
          ],
        }
      : {}),
  };
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function formatRating(details: DetailsResponse): string | undefined {
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

function buildSummary(details: DetailsResponse, sourceName: string | undefined): string {
  const parts: string[] = [];

  const stats = [formatRating(details), formatViews(details.total_views)].filter(Boolean);
  // Mana's `Content` has no rating or views field, so they lead the summary.
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
 * The chapter's own name, with the numbering the site repeats inside the title
 * removed. The label below puts the number back once, so a title of
 * "Chapter 44 - Volume 9 (Ushi)" would otherwise say it twice.
 */
function parseChapterName(title: string): string {
  return title
    .replace(CHAPTER_METADATA_REGEX, "")
    .replace(CHAPTER_TRAILING_GROUP_REGEX, "")
    .replace(CHAPTER_VOLUME_SUFFIX_REGEX, "")
    .replace(CHAPTER_NUMBER_PREFIX_REGEX, "")
    .replace(/^[\s:.\-–—]+/, "")
    .trim();
}

/**
 * Who published the chapter: the series' upload source — an official publisher
 * or a scanlation group — with the group some titles name inline appended.
 */
function parseScanlator(
  book: ChapterBook,
  sourceName: string | undefined,
  official: boolean,
): string | undefined {
  // The tick marks an official upload, the way other clients for this site do.
  const base = sourceName
    ? official
      ? `${sourceName} ✓`
      : sourceName
    : (book.groups ?? []).map((group) => group.title).join(", ");

  const stripped = book.title.trim().replace(CHAPTER_METADATA_REGEX, "");
  const match = CHAPTER_GROUP_REGEX.exec(stripped);
  const tag = match?.[1] ?? match?.[2];

  if (base && tag) return `${base} (${tag})`;
  return base || tag || undefined;
}

/** "Vol.1 Ch.11 - Oleg: Apology" — the app prints this verbatim. */
function formatChapterLabel(number: number, volume: number | undefined, name: string): string {
  const label = [volume === undefined ? "" : `Vol.${volume}`, `Ch.${number}`]
    .filter(Boolean)
    .join(" ");
  return name ? `${label} - ${name}` : label;
}

export function parseChapters(
  seriesId: string,
  details: DetailsResponse,
  options: { language: string; sourceName?: string; official?: boolean },
): Chapter[] {
  const books = details.series_books ?? [];
  const useSourceNumber = SOURCE_CHAPTER_NUMBER_FORMATS.has(details.format ?? "");

  // The API lists newest first, but only roughly: a late upload of an early chapter sits
  // out of place. Numbering comes from the reversed array, and `index` from the sort below.
  const ordered = [...books].reverse();

  const chapters = ordered.map((book, index) => {
    const scanlator = parseScanlator(book, options.sourceName, options.official === true);
    const title = book.title.trim();
    const parsedNumber = Number.parseFloat(
      (
        (book.chapter_no ?? "").trim() ||
        (CHAPTER_NUMBER_PREFIX_REGEX.exec(title)?.[1] ?? "")
      ).replace(/[^\d.]/g, ""),
    );
    const name = parseChapterName(title);
    const volume = Number.parseFloat((book.volume_no ?? "").replace(/[^\d.]/g, ""));

    // sort_no is a position in the series for most formats, not a chapter number.
    const number = useSourceNumber
      ? (book.sort_no ?? index + 1)
      : Number.isFinite(parsedNumber)
        ? parsedNumber
        : index + 1;

    return {
      chapterId: book.book_id,
      number,
      index,
      title: formatChapterLabel(number, Number.isFinite(volume) ? volume : undefined, name),
      ...(Number.isFinite(volume) ? { volume } : {}),
      date: parseDate(book.created_at) ?? new Date(0),
      language: options.language || DefinedLanguages.ENGLISH,
      webUrl: chapterUrl(seriesId, book.book_id),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });

  // `index` decides where the app resumes and index 0 must be the earliest chapter. Taken
  // from the array it followed upload order, so a late re-upload of an early chapter left
  // an unread series opening partway through.
  return chapters
    .sort((left, right) => {
      if (left.number !== right.number) return left.number - right.number;
      return left.date.getTime() - right.date.getTime();
    })
    .map((chapter, index) => ({ ...chapter, index }))
    .reverse();
}
