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

import { clean, relativeTime, summaryFromHtml } from "../common/index.ts";
import {
  BASE_URL,
  CDN_URL,
  type CarouselSlide,
  type ChapterDetail,
  type SeriesDetail,
  type SeriesListItem,
} from "./model.ts";

export function seriesUrl(seriesId: number | string): string {
  return `${BASE_URL}/series/${seriesId}`;
}

/** `last_edit` doubles as the cache-buster the site appends. */
export function buildCoverUrl(item: {
  series_id: number;
  cover: string;
  last_edit: number;
}): string {
  return `${CDN_URL}/uploads/images/series/${item.series_id}/${item.cover}?${item.last_edit}`;
}

export function buildPageUrl(seriesId: number, token: string, name: string): string {
  return `${CDN_URL}/uploads/images/series/${seriesId}/${token}/${encodeURIComponent(name)}?${token}`;
}

export function parseStatus(status: string | undefined): PublicationStatus | undefined {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
      return PublicationStatus.ONGOING;
    case "completed":
      return PublicationStatus.COMPLETED;
    case "hiatus":
      return PublicationStatus.HIATUS;
    case "cancelled":
    case "dropped":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

export function parseContentType(type: string | undefined): ContentType | undefined {
  switch ((type ?? "").toLowerCase()) {
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "manga":
      return ContentType.MANGA;
    case "comic":
      return ContentType.COMIC;
    default:
      return undefined;
  }
}

/** The site tags nothing as adult, so the rating is inferred from its categories. */
export function parseRating(categories: readonly string[]): ContentRating {
  const lower = categories.map((entry) => entry.trim().toLowerCase());
  if (lower.some((entry) => ["adult", "smut", "mature"].includes(entry))) {
    return ContentRating.MATURE;
  }
  if (lower.includes("ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

export function categoriesOf(item: SeriesListItem | SeriesDetail): string[] {
  const source = "categories" in item ? (item.categories ?? item.tags) : item.tags;
  return (source ?? []).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * What a tile puts under the title. Rows about new chapters name the chapter; the poster
 * rows have no chapter to speak of, so they carry the type and the site's like count.
 */
export type HighlightSubtitle = "chapter" | "stats";

export function parseHighlight(
  item: SeriesListItem,
  style: HighlightSubtitle = "chapter",
): Highlight {
  const categories = categoriesOf(item);
  const latest = item.chapters?.[0];

  // Every listing carries the status and the like count the site shows as a heart.
  const info: Pair[] = [];
  if (latest) {
    info.push({
      key: `Chapter ${formatChapterNumber(latest.chapter)}`,
      value: relativeTime(new Date(latest.release_date * 1000)),
    });
  }
  if (item.status) info.push({ key: "Status", value: item.status });
  if (item.likes != null) info.push({ key: "Likes ♥", value: String(item.likes) });

  const subtitle =
    style === "stats"
      ? [item.type, item.likes == null ? "" : `♥ ${item.likes}`].filter(Boolean).join(" • ")
      : latest
        ? `Chapter ${formatChapterNumber(latest.chapter)}`
        : "";

  return {
    id: String(item.series_id),
    title: clean(item.title),
    cover: buildCoverUrl(item),
    ...(subtitle ? { subtitle } : {}),
    ...(info.length > 0 ? { info } : {}),
    contentRating: parseRating(categories),
    webUrl: seriesUrl(item.series_id),
  };
}

/** A carousel slide names a series but carries its own artwork under a separate folder. */
export function parseCarouselHighlight(slide: CarouselSlide): Highlight | undefined {
  if (slide.series_id == null) return undefined;

  return {
    id: String(slide.series_id),
    title: clean(slide.title),
    cover: `${CDN_URL}/uploads/images/carousel/${slide.image}`,
    contentRating: parseRating(slide.categories ?? []),
    webUrl: seriesUrl(slide.series_id),
  };
}

export function parseContent(seriesId: string, detail: SeriesDetail): Content {
  const categories = categoriesOf(detail);
  const tags: Tag[] = categories.map((name) => ({ id: name.toLowerCase(), title: name }));

  const status = parseStatus(detail.status);
  const contentType = parseContentType(detail.type);

  const creators = [...(detail.author ?? []), ...(detail.artist ?? [])]
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    title: clean(detail.title),
    cover: buildCoverUrl(detail),
    summary: summaryFromHtml(detail.description ?? ""),
    additionalTitles: (detail.altTitles ?? []).map(clean).filter(Boolean),
    tags,
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: parseRating(categories),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    webUrl: seriesUrl(seriesId),
  };
}

/** `"131.00"` reads better as `131`, and `"131.50"` as `131.5`. */
export function formatChapterNumber(raw: string): string {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? String(value) : raw;
}

export function parseChapters(chapters: readonly ChapterDetail[]): Chapter[] {
  const parsed = chapters.map((entry) => {
    const number = Number.parseFloat(entry.chapter) || 0;
    const name = clean(entry.title ?? "");
    const label = `Chapter ${formatChapterNumber(entry.chapter)}`;

    return {
      // Both halves are needed to reach the reader payload.
      chapterId: `${entry.series_id}:${entry.token}`,
      number,
      index: 0,
      // The app prints this verbatim and never joins the number onto it.
      title: name ? `${label} - ${name}` : label,
      date: new Date(entry.release_date * 1000),
      language: DefinedLanguages.ENGLISH,
      webUrl: `${seriesUrl(entry.series_id)}/${entry.token}`,
    };
  });

  // index 0 must be the earliest chapter, or the app resumes partway through.
  return parsed
    .sort((left, right) => left.number - right.number)
    .map((chapter, index) => ({ ...chapter, index }))
    .reverse();
}

export function parseFilterOptions(series: readonly SeriesListItem[]): {
  categories: Option[];
  types: Option[];
  status: Option[];
  publishers: Option[];
  authors: Option[];
  artists: Option[];
  years: Option[];
  languages: Option[];
  countries: Option[];
} {
  const collect = (pick: (item: SeriesListItem) => readonly string[] | undefined): Option[] => {
    const seen = new Set<string>();
    for (const item of series) {
      for (const value of pick(item) ?? []) {
        const trimmed = value.trim();
        if (trimmed) seen.add(trimmed);
      }
    }
    return [...seen]
      .sort((left, right) => left.localeCompare(right))
      .map((title) => ({ id: title.toLowerCase(), title }));
  };

  return {
    categories: collect(categoriesOf),
    types: collect((item) => (item.type ? [item.type] : [])),
    status: collect((item) => (item.status ? [item.status] : [])),
    publishers: collect((item) => item.publisher),
    authors: collect((item) => item.author),
    artists: collect((item) => item.artist),
    years: collect((item) => (item.year ? [String(item.year)] : [])),
    languages: collect((item) => (item.language ? [item.language] : [])),
    countries: collect((item) => (item.country ? [item.country] : [])),
  };
}
