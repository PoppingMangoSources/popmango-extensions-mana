/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  AdditionalInfoType,
  ContentRating,
  additionalInfo,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  type Chapter,
  type Content,
  type Highlight,
  type Option,
  type Pair,
  type SimpleHighlight,
  type Tag,
} from "@mana-app/types";

import {
  clean,
  firstFilled,
  relativeTime,
  statusPill,
  titleCase,
  summaryFromHtml,
  toBadge,
  typePill,
} from "../common/index.ts";
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
 * The carousel names nothing — its artwork already carries the title.
 */
export type HighlightSubtitle = "chapter" | "stats" | "none";

export function parseHighlight(
  item: SeriesListItem,
  style: HighlightSubtitle = "chapter",
): Highlight {
  const categories = categoriesOf(item);
  const latest = item.chapters?.[0];

  // The pill falls through the house order. The site grades nothing, so what it counts —
  // the likes it shows as a heart — comes first, then what the title is, then where it has
  // got to. Whatever the pill takes is left out of the lines below it.
  const likes = item.likes == null ? "" : `♥ ${item.likes}`;
  const kind = titleCase(clean(item.type ?? ""));
  const state = titleCase(clean(item.status ?? ""));
  const taken = firstFilled(likes, typePill(kind), statusPill(state));
  const badge = toBadge(taken);

  const info: Pair[] = [];
  if (latest) {
    info.push({
      key: `Chapter ${formatChapterNumber(latest.chapter)}`,
      value: relativeTime(new Date(latest.release_date * 1000)),
    });
  }
  // A detailed row draws no pill over its thumbnail, so its rows carry the whole read —
  // including whatever the pill took, which is not repeated anywhere near them.
  if (state) info.push({ key: "Status", value: `◌ ${state}` });
  if (likes) info.push({ key: "Likes", value: likes });

  const subtitle =
    style === "stats"
      ? kind && taken.endsWith(kind)
        ? ""
        : kind
      : style === "chapter" && latest
        ? `Chapter ${formatChapterNumber(latest.chapter)}`
        : "";

  return {
    id: String(item.series_id),
    title: clean(item.title),
    cover: buildCoverUrl(item),
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    ...(info.length > 0 ? { info } : {}),
    contentRating: parseRating(categories),
    webUrl: seriesUrl(item.series_id),
  };
}

/**
 * The recommendations the site prints under a series. They arrive in the same shape as a
 * listing row, so the cover is built the same way — `last_edit` and all.
 */
export function parseSimilar(items: readonly SeriesListItem[]): SimpleHighlight[] {
  return items.map((item) =>
    additionalInfo.highlights.item({
      type: AdditionalInfoType.Highlights,
      id: String(item.series_id),
      title: clean(item.title),
      cover: buildCoverUrl(item),
      contentRating: parseRating(item.categories ?? []),
      webUrl: seriesUrl(item.series_id),
    }),
  );
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
    const value = Number.parseFloat(entry.chapter);
    // Whether the site stated a number at all, which is not the same as whether it is
    // zero: a prologue numbered 0 opens the run and belongs exactly where it is.
    const numbered = Number.isFinite(value);
    const name = clean(entry.title ?? "");
    const label = `Chapter ${formatChapterNumber(entry.chapter)}`;

    return {
      // Both halves are needed to reach the reader payload.
      chapterId: `${entry.series_id}:${entry.token}`,
      number: numbered ? value : 0,
      index: 0,
      // The app prints this verbatim and never joins the number onto it.
      title: name ? `${label} - ${name}` : label,
      date: new Date(entry.release_date * 1000),
      language: DefinedLanguages.ENGLISH,
      webUrl: `${seriesUrl(entry.series_id)}/${entry.token}`,
      numbered,
    };
  });

  // A chapter the site left unnumbered would otherwise sit at 0 and become what an unread
  // title opens at, so those are numbered above the main run in listed order.
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
