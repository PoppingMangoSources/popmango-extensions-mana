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
} from "../common/index.ts";
import {
  BASE_URL,
  CONTENT_RATING_GENRES,
  TYPE_OPTIONS,
  type ChapterData,
  type ComicData,
  type NamedNode,
} from "./model.ts";

function absoluteUrl(target: string | null | undefined): string {
  const value = (target ?? "").trim();
  return value ? resolveUrl(value, BASE_URL) : "";
}

function seriesUrl(comic: ComicData): string {
  return absoluteUrl(comic.urlPath || `/comic/${comic.id}`);
}

function names(nodes: NamedNode[] | null | undefined): string[] {
  return (nodes ?? [])
    .map((node) => clean(node.data?.name ?? ""))
    .filter(Boolean)
    .map(decodeEntities);
}

/** The site states a rating, but only sometimes; its genres say the rest. */
function parseRating(comic: ComicData): ContentRating {
  const stated = (comic.contentRating ?? "").toLowerCase();
  const genres = (comic.genres ?? []).map((genre) => genre.trim().toLowerCase());

  const matches = (rating: string): boolean =>
    stated === rating ||
    CONTENT_RATING_GENRES[rating]?.some((genre) => genres.includes(genre)) === true;

  if (matches("pornographic")) return ContentRating.EXPLICIT;
  if (matches("erotica")) return ContentRating.EXPLICIT;
  if (matches("suggestive")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function parseContentType(type: string | null | undefined): ContentType | undefined {
  switch ((type ?? "").toLowerCase()) {
    case "manga":
      return ContentType.MANGA;
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "cartoon":
    case "western":
      return ContentType.COMIC;
    default:
      return undefined;
  }
}

function parseStatus(status: string | null | undefined): PublicationStatus | undefined {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
      return PublicationStatus.ONGOING;
    case "completed":
      return PublicationStatus.COMPLETED;
    case "hiatus":
      return PublicationStatus.HIATUS;
    case "cancelled":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

/** Timestamps arrive as seconds or milliseconds depending on the field. */
function parseTimestamp(value: number | string | null | undefined): Date | undefined {
  const number = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (number == null || !Number.isFinite(number) || number <= 0) return undefined;

  const date = new Date(number < 1e12 ? number * 1000 : number);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatChapterNumber(chapter: ChapterData | null | undefined): string | undefined {
  const raw = chapter?.chaNum ?? chapter?.serial;
  const value = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  if (value != null && Number.isFinite(value)) return String(value);

  return /(?:chapter|ch\.?)[\s_]*(\d+(?:\.\d+)?)/i.exec(chapter?.dname ?? "")?.[1];
}

/** The site's own label for a type, as the listing endpoints send it lowercased. */
function formatType(type: string | null | undefined): string {
  const value = clean(type ?? "").toLowerCase();
  if (!value) return "";
  return TYPE_OPTIONS.find((option) => option.id === value)?.title ?? value;
}

/**
 * Every listing endpoint already returns the type, genres and last chapter alongside the
 * cover, so the tile carries them without a second request.
 */
export function parseHighlight(comic: ComicData, latest?: ChapterData): Highlight {
  const number = formatChapterNumber(latest ?? comic.chapterNodes_last?.[0]?.data);
  const uploaded = latest ? parseTimestamp(latest.dateModify ?? latest.datePublic) : undefined;
  const type = formatType(comic.type);
  const genres = (comic.genres ?? []).map((genre) => decodeEntities(clean(genre))).filter(Boolean);

  const info: Pair[] = [];
  // Only the upload feed carries a date; elsewhere the subtitle already names the chapter.
  if (number && uploaded) info.push({ key: `Chapter ${number}`, value: relativeTime(uploaded) });
  if (type) info.push({ key: "Type", value: type });
  if (genres.length > 0) info.push({ key: "Genres", value: genres.slice(0, 3).join(", ") });

  const subtitle = [number ? `Chapter ${number}` : "", type].filter(Boolean).join(" • ");

  return {
    id: comic.id,
    title: decodeEntities(clean(comic.name)),
    cover: absoluteUrl(comic.urlCover),
    ...(subtitle ? { subtitle } : {}),
    ...(info.length > 0 ? { info } : {}),
    contentRating: parseRating(comic),
    webUrl: seriesUrl(comic),
  };
}

export function parseContent(comic: ComicData): Content {
  const tags: Tag[] = [...(comic.genres ?? []), ...(comic.tags ?? [])]
    .map((name) => clean(name))
    .filter(Boolean)
    .map((name) => ({ id: name.toLowerCase(), title: name }));

  const status = parseStatus(comic.originalStatus);
  const contentType = parseContentType(comic.type);
  const creators = [...names(comic.authorNodes), ...names(comic.artistNodes)];

  const info: Pair[] = [];
  if (comic.score_val != null) info.push({ key: "Score", value: comic.score_val.toFixed(2) });
  if (comic.follows != null) info.push({ key: "Follows", value: String(comic.follows) });
  const publishers = names(comic.publisherNodes);
  if (publishers.length > 0) info.push({ key: "Publishers", value: publishers.join(", ") });

  return {
    title: decodeEntities(clean(comic.name)),
    cover: absoluteUrl(comic.urlCover),
    summary: summaryFromHtml(comic.summary?.html ?? ""),
    additionalTitles: (comic.altNames ?? [])
      .map((name) => decodeEntities(clean(name)))
      .filter(Boolean),
    tags,
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: parseRating(comic),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: seriesUrl(comic),
  };
}

/** Chapters come from one endpoint newest first; only `index` is derived from the number. */
export function parseChapters(entries: readonly ChapterData[], language: string): Chapter[] {
  const parsed = entries.map((entry) => {
    const number = Number.parseFloat(formatChapterNumber(entry) ?? "") || 0;

    const label = [clean(entry.dname ?? ""), clean(entry.title ?? "")]
      .filter(Boolean)
      .filter((value, position, values) => position === 0 || value !== values[0])
      .map(decodeEntities)
      .join(": ");

    const source = clean(entry.srcName ?? "");
    const groups = names(entry.groupNodes);
    const uploader = clean(entry.userNode?.data?.name ?? "");
    const scanlator =
      (source ? source.charAt(0).toUpperCase() + source.slice(1) : "") ||
      groups.join(", ") ||
      uploader;

    return {
      chapterId: entry.id,
      number,
      index: 0,
      // The app prints this verbatim and never joins the number onto it.
      title: label || (number ? `Chapter ${number}` : "Chapter"),
      date: parseTimestamp(entry.dateModify ?? entry.dateCreate ?? entry.datePublic) ?? new Date(0),
      language: language || DefinedLanguages.ENGLISH,
      ...(entry.urlPath ? { webUrl: absoluteUrl(entry.urlPath) } : {}),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });

  // index 0 must be the earliest numbered chapter, or the app resumes partway through.
  // Anything the site left unnumbered — a notice or an extra — is indexed after the run.
  const positions = new Map<string, number>();
  [...parsed]
    .filter((chapter) => chapter.number !== 0)
    .sort((left, right) => left.number - right.number)
    .forEach((chapter, position) => positions.set(chapter.chapterId, position));

  let next = positions.size;
  for (const chapter of parsed) {
    if (!positions.has(chapter.chapterId)) positions.set(chapter.chapterId, next++);
  }

  return parsed.map((chapter) => ({
    ...chapter,
    index: positions.get(chapter.chapterId) ?? chapter.index,
  }));
}

export function parsePageUrls(urls: readonly string[]): string[] {
  return urls.map(absoluteUrl).filter(Boolean);
}

/** The site's own language tags use underscores, and `_t` means unspecified. */
export function parseLanguage(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "_t") return DefinedLanguages.ENGLISH;
  return raw.split("_").join("-");
}
