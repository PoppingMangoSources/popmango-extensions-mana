/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  type Chapter,
  type Content,
  type Highlight,
  type Tag,
} from "@mana-app/types";

import { clean, decodeEntities, summaryFromHtml } from "../common/index.ts";
import {
  BASE_URL,
  DEFAULT_IMAGE_SERVER,
  IMAGE_CDN,
  THUMBNAIL_CDN,
  genreId,
  type ChaptersResponse,
  type DateParts,
  type EpisodeInfo,
  type MangaCard,
  type MangaDetail,
  type PagesResponse,
  type PictureUrl,
} from "./model.ts";

const ABSOLUTE_URL_REGEX = /^https?:\/\//;

export function buildThumbnailUrl(thumbnail?: string | null): string {
  const trimmed = thumbnail?.trim();
  if (!trimmed) return `${THUMBNAIL_CDN}?w=250`;
  if (ABSOLUTE_URL_REGEX.test(trimmed)) return trimmed;
  return `${THUMBNAIL_CDN}${trimmed.replace(/^\//, "")}?w=250`;
}

function parseTitle(value: string): string {
  return decodeEntities(clean(value));
}

export function seriesUrl(seriesId: string): string {
  return `${BASE_URL}/manga/${seriesId}`;
}

export function parseRating(genres: string[]): ContentRating {
  const lower = genres.map((genre) => genre.trim().toLowerCase());
  if (lower.some((genre) => ["adult", "hentai", "smut", "yaoi"].includes(genre))) {
    return ContentRating.EXPLICIT;
  }
  if (lower.some((genre) => ["ecchi", "mature"].includes(genre))) return ContentRating.MATURE;
  return ContentRating.SAFE;
}

function parseStatus(status?: string | null): PublicationStatus | undefined {
  const value = (status ?? "").toLowerCase();
  if (value.includes("releasing") || value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("finished") || value.includes("completed")) {
    return PublicationStatus.COMPLETED;
  }
  if (value.includes("hiatus")) return PublicationStatus.HIATUS;
  if (value.includes("cancel")) return PublicationStatus.CANCELLED;
  return undefined;
}

/** The site files these as genres; they are what it publishes rather than a theme. */
function parseContentType(genres: string[]): ContentType | undefined {
  const lower = genres.map((genre) => genre.trim().toLowerCase());
  if (lower.includes("manhwa")) return ContentType.MANHWA;
  if (lower.includes("manhua")) return ContentType.MANHUA;
  return undefined;
}

export function formatCount(value: string | number): string {
  const count = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return String(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function parseDateParts(parts?: DateParts | null): Date | undefined {
  if (!parts || parts.year == null) return undefined;
  const date = new Date(
    parts.year,
    parts.month ?? 0,
    parts.date ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildImageUrl(url: string, quality: string): string {
  if (quality === "original") return url;
  const match = /^https?:\/\/([^#]+)/.exec(url);
  return match?.[1] ? `${IMAGE_CDN}/${match[1]}?w=${quality}` : url;
}

export function parseHighlight(card: MangaCard, rating: ContentRating): Highlight {
  return {
    id: card._id,
    title: parseTitle(card.englishName || card.name),
    cover: buildThumbnailUrl(card.thumbnail),
    contentRating: rating,
    webUrl: seriesUrl(card._id),
  };
}

export function parseContent(seriesId: string, detail: MangaDetail): Content {
  const alternates = new Set<string>();
  if (detail.englishName && detail.name && detail.englishName !== detail.name) {
    alternates.add(parseTitle(detail.name));
  }
  for (const name of detail.altNames ?? []) {
    const trimmed = parseTitle(name);
    if (trimmed) alternates.add(trimmed);
  }

  const names = [...(detail.genres ?? []), ...(detail.tags ?? [])]
    .map((genre) => genre.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const tags: Tag[] = [];
  for (const name of names) {
    const id = genreId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, title: name });
  }

  const status = parseStatus(detail.status);
  const contentType = parseContentType(names);

  return {
    title: parseTitle(detail.englishName || detail.name),
    cover: buildThumbnailUrl(detail.thumbnail),
    summary: summaryFromHtml(detail.description ?? ""),
    additionalTitles: [...alternates],
    tags,
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    contentRating: parseRating(names),
    webUrl: seriesUrl(seriesId),
  };
}

/** Drops a note that only restates the episode number, keeping a real chapter name. */
function parseChapterName(notes: string): string {
  const withoutTag = notes.replace(/^\[[^\]]*\]\s*/, "");
  const name = withoutTag.replace(/^ep\.?\s*\d+(?:\.\d+)?\s*-?\s*/i, "").trim();
  return /[a-z]/i.test(name) ? name : "";
}

export function parseChapters(data: ChaptersResponse, seriesId: string): Chapter[] {
  const numbers = data.manga.availableChaptersDetail?.sub ?? [];

  const infoByNumber = new Map<string, EpisodeInfo>();
  for (const info of data.episodeInfos ?? []) {
    infoByNumber.set(String(info.episodeIdNum), info);
  }

  const chapters = numbers.map((value) => {
    const info = infoByNumber.get(value);
    const name = parseTitle(parseChapterName(info?.notes?.trim() ?? ""));
    const number = Number.parseFloat(value) || 0;
    const uploaded = info?.uploadDates?.sub;
    const date = uploaded ? new Date(uploaded) : undefined;

    return {
      chapterId: value,
      number,
      index: 0,
      // The app prints this verbatim and never joins the number onto it.
      title: name ? `Ch.${value} - ${name}` : `Ch.${value}`,
      date: date && !Number.isNaN(date.getTime()) ? date : new Date(0),
      language: DefinedLanguages.ENGLISH,
      webUrl: `${seriesUrl(seriesId)}/chapter-${value}-sub`,
    };
  });

  // index 0 must be the earliest chapter, or the app resumes partway through.
  return chapters
    .sort((left, right) => left.number - right.number)
    .map((chapter, index) => ({ ...chapter, index }))
    .reverse();
}

function pictureUrl(entry: PictureUrl): string | undefined {
  return typeof entry === "string" ? entry : (entry?.url ?? undefined);
}

export function parsePageUrls(data: PagesResponse, quality: string): string[] {
  const edges = data.chapterPages?.edges ?? [];
  if (edges.length === 0) return [];

  // Several edges can be returned; the usable one names a server or holds absolute URLs.
  const edge =
    edges.find(
      (candidate) =>
        candidate.pictureUrlHead != null ||
        (candidate.pictureUrls ?? []).some((entry) => {
          const url = pictureUrl(entry);
          return url != null && ABSOLUTE_URL_REGEX.test(url);
        }),
    ) ?? edges[0];

  const server = edge?.pictureUrlHead;
  const origin = server
    ? ABSOLUTE_URL_REGEX.test(server)
      ? `${server.replace(/\/$/, "")}/`
      : `https://${server.replace(/\/$/, "")}/`
    : DEFAULT_IMAGE_SERVER;

  return (edge?.pictureUrls ?? [])
    .map(pictureUrl)
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => (ABSOLUTE_URL_REGEX.test(url) ? url : origin + url.replace(/^\//, "")))
    .map((url) => buildImageUrl(url, quality));
}
