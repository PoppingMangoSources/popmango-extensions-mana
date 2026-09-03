/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  ContentType,
  PublicationStatus,
  type Content,
  type Highlight,
  type Pair,
  type Tag,
} from "@mana-app/types";

import { clean, decodeEntities, summaryFromHtml } from "../common/index.ts";
import { ADULT_GENRES, BASE_URL, MATURE_GENRES, type Series } from "./model.ts";

export function seriesUrl(series: Series): string {
  return series.url || `${BASE_URL}/series/${series.series_id ?? ""}`;
}

function genresOf(series: Series): string[] {
  return (series.genres ?? [])
    .map((entry) => clean(entry.genre ?? ""))
    .filter((genre): genre is string => genre.length > 0);
}

export function parseRating(series: Series): ContentRating {
  const genres = genresOf(series);
  if (genres.some((genre) => ADULT_GENRES.includes(genre))) return ContentRating.EXPLICIT;
  if (genres.some((genre) => MATURE_GENRES.includes(genre))) return ContentRating.MATURE;
  return ContentRating.SAFE;
}

function parseContentType(type: string | undefined): ContentType | undefined {
  switch ((type ?? "").toLowerCase()) {
    case "manga":
    case "doujinshi":
      return ContentType.MANGA;
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "novel":
      return ContentType.NOVEL;
    case "oel":
      return ContentType.COMIC;
    default:
      return undefined;
  }
}

/**
 * The status field is prose, not an enum — "38 Chapters (Ongoing)", or a per-season
 * breakdown, or "4 Volumes (Incomplete due to the artist's death)". Only the words in
 * brackets are reliable, and the most recent bracket wins on a multi-season entry.
 */
export function parseStatus(status: string | undefined): PublicationStatus | undefined {
  const notes = [...(status ?? "").matchAll(/\(([^)]*)\)/g)].map((match) =>
    (match[1] ?? "").toLowerCase(),
  );
  if (notes.length === 0) return undefined;

  const says = (word: string): boolean => notes.some((note) => note.includes(word));

  if (says("ongoing")) return PublicationStatus.ONGOING;
  if (says("hiatus")) return PublicationStatus.HIATUS;
  if (says("incomplete") || says("discontinued") || says("cancelled")) {
    return PublicationStatus.CANCELLED;
  }
  if (says("complete")) return PublicationStatus.COMPLETED;
  return undefined;
}

function titlesOf(series: Series): { title: string; alternates: string[] } {
  const all = [series.title, ...(series.associated ?? []).map((entry) => entry.title)]
    .map((title) => decodeEntities(clean(title ?? "")))
    .filter((title) => title.length > 0);

  return { title: all[0] ?? "", alternates: all.slice(1) };
}

function creditsOf(series: Series, role: "Author" | "Artist"): string[] {
  return (series.authors ?? [])
    .filter((author) => author.type === role)
    .map((author) => decodeEntities(clean(author.name)))
    .filter((name) => name.length > 0);
}

function ratingOf(series: Series): string {
  const score = series.bayesian_rating;
  if (score == null || !Number.isFinite(score) || score <= 0) return "";
  const votes = series.rating_votes;
  return votes ? `★ ${score.toFixed(2)} (${votes})` : `★ ${score.toFixed(2)}`;
}

export function parseHighlight(series: Series, hitTitle?: string): Highlight {
  const { title } = titlesOf(series);
  const score = ratingOf(series);

  const info: Pair[] = [];
  if (series.type) info.push({ key: "Type", value: series.type });
  if (series.year) info.push({ key: "Year", value: series.year });
  if (score) info.push({ key: "Rating", value: score });

  const subtitle = [series.type, series.year].filter(Boolean).join(" • ");

  return {
    id: String(series.series_id ?? ""),
    title: decodeEntities(clean(hitTitle ?? "")) || title,
    cover: series.image?.url?.original ?? series.image?.url?.thumb ?? "",
    ...(subtitle ? { subtitle } : {}),
    ...(info.length > 0 ? { info } : {}),
    contentRating: parseRating(series),
    webUrl: seriesUrl(series),
  };
}

export function parseContent(series: Series): Content {
  const { title, alternates } = titlesOf(series);

  const tags: Tag[] = [
    ...genresOf(series),
    ...(series.categories ?? [])
      .map((entry) => clean(entry.category ?? ""))
      .filter((category) => category.length > 0),
  ].map((name) => ({ id: name.toLowerCase(), title: name }));

  const status = parseStatus(series.status);
  const contentType = parseContentType(series.type);
  const creators = [...creditsOf(series, "Author"), ...creditsOf(series, "Artist")];

  const info: Pair[] = [];
  const score = ratingOf(series);
  if (score) info.push({ key: "Rating", value: score });
  if (series.year) info.push({ key: "Year", value: series.year });
  if (series.latest_chapter) {
    info.push({ key: "Latest Chapter", value: String(series.latest_chapter) });
  }
  if (series.licensed != null) {
    info.push({ key: "Licensed", value: series.licensed ? "Yes" : "No" });
  }
  const publishers = (series.publishers ?? [])
    .map((publisher) => clean(publisher.publisher_name ?? ""))
    .filter((name) => name.length > 0);
  if (publishers.length > 0) info.push({ key: "Publishers", value: publishers.join(", ") });

  return {
    title,
    cover: series.image?.url?.original ?? series.image?.url?.thumb ?? "",
    summary: summaryFromHtml(series.description ?? ""),
    ...(alternates.length > 0 ? { additionalTitles: alternates } : {}),
    tags,
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: parseRating(series),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: seriesUrl(series),
  };
}
