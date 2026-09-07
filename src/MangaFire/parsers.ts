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
  type Provider,
  type Tag,
} from "@mana-app/types";

import { clean, decodeEntities, relativeTime, summaryFromHtml } from "../common/index.ts";
import {
  BASE_URL,
  type ChapterItem,
  type Entity,
  type PagesResponse,
  type SubtitleStyle,
  type TitleDetails,
  type TitleItem,
  type VolumeItem,
  VOLUME_PREFIX,
} from "./model.ts";

export function titleUrl(hid: string): string {
  return `${BASE_URL}/title/${hid}`;
}

/**
 * A title is addressed by its hid alone, and every link the site writes puts that first:
 * `/title/dkw-one-piece`, and a chapter link continues `/title/pm666-…/7511141-chapter-34-en`.
 * Splitting on the first `-` or `/` recovers it from any of them.
 */
export function hidFromId(value: string): string {
  return value.trim().split(/[-/]/)[0] ?? value.trim();
}

export function hidFromUrl(value: string): string | undefined {
  const path = /^https?:\/\/(?:www\.)?mangafire\.to\/title\/([^?#]+)/i.exec(value.trim())?.[1];
  if (!path) return undefined;
  const hid = hidFromId(path);
  return hid || undefined;
}

/** The poster comes in three sizes; a tile wants the largest the site actually has. */
function coverUrl(item: TitleItem): string {
  const poster = item.poster;
  return clean(poster?.large ?? poster?.medium ?? poster?.small ?? "");
}

export function parseStatus(status: string | null | undefined): PublicationStatus | undefined {
  switch ((status ?? "").toLowerCase()) {
    case "releasing":
      return PublicationStatus.ONGOING;
    case "finished":
      return PublicationStatus.COMPLETED;
    case "on_hiatus":
      return PublicationStatus.HIATUS;
    case "discontinued":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

/** The site's own word for the state, behind the house symbol. */
function statusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toLowerCase()) {
    case "releasing":
      return "Releasing";
    case "finished":
      return "Finished";
    case "on_hiatus":
      return "On Hiatus";
    case "discontinued":
      return "Discontinued";
    case "not_yet_released":
      return "Not Yet Released";
    default:
      return "";
  }
}

function parseContentType(type: string | null | undefined): ContentType {
  switch ((type ?? "").toLowerCase()) {
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    default:
      return ContentType.MANGA;
  }
}

/** The site's own word for the format, which is what a tile writes under the title. */
function kindLabel(type: string | null | undefined): string {
  const value = clean(type ?? "");
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const EXPLICIT_GENRES = new Set(["hentai", "adult", "smut"]);
const MATURE_GENRES = new Set(["mature"]);
const SUGGESTIVE_GENRES = new Set(["ecchi"]);

/**
 * A listing carries no genres, so only a title's own page can be graded. The host's policy
 * is pushed into the request instead, which is why a row never needs this.
 */
export function parseRating(genres: readonly Entity[] | null | undefined): ContentRating {
  const names = (genres ?? []).map((genre) => clean(genre.title ?? "").toLowerCase());

  if (names.some((name) => EXPLICIT_GENRES.has(name))) return ContentRating.EXPLICIT;
  if (names.some((name) => MATURE_GENRES.has(name))) return ContentRating.MATURE;
  if (names.some((name) => SUGGESTIVE_GENRES.has(name))) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

/** `12` reads better than `12.0`, and `12.5` has to survive. */
export function formatChapterNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(Number(value));
}

function parseTimestamp(value: string | number | null | undefined): Date | undefined {
  if (value == null || value === "") return undefined;
  // The chapter endpoint counts in seconds; the listing writes an ISO string.
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatScore(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return "";
  return `★ ${rating.toFixed(1)}`;
}

/**
 * What a tile puts under its title.
 *
 * This line carries no symbols. A glyph belongs on a labelled info row, where the key says
 * what it stands for; on the line under a title it is a mark with nothing to read it
 * against. Only `buildInfoRows` and the title page use them.
 */
function buildSubtitle(item: TitleItem, style: SubtitleStyle): string {
  const chapter = formatChapterNumber(item.latestChapter);
  const chapterLabel = chapter ? `Chapter ${chapter}` : "";
  const kind = kindLabel(item.type);
  const updated = parseTimestamp(item.chapterUpdatedAt);
  const rank = item.rank != null && Number.isFinite(item.rank) && item.rank > 0 ? item.rank : 0;

  switch (style) {
    case "hero":
      return [chapterLabel, kind].filter(Boolean).join(" | ");
    // A ranked row says where the site put it; the same row on a title it did not rank
    // falls back to the format rather than showing an empty line.
    case "kind":
      return [rank ? `#${rank}` : "", kind].filter(Boolean).join(" • ") || chapterLabel;
    case "updated":
      return [chapterLabel, updated ? relativeTime(updated) : ""].filter(Boolean).join(" • ");
    default:
      return chapterLabel;
  }
}

/**
 * The key/value rows a vertical list draws beneath a title, which is the only style that
 * renders them — so they are built for that row alone rather than on every tile.
 */
function buildInfoRows(item: TitleItem): Pair[] {
  const rows: Pair[] = [];

  const chapter = formatChapterNumber(item.latestChapter);
  if (chapter) rows.push({ key: "Latest", value: `Chapter ${chapter}` });

  const updated = parseTimestamp(item.chapterUpdatedAt);
  if (updated) rows.push({ key: "Updated", value: relativeTime(updated) });

  const kind = kindLabel(item.type);
  if (kind) rows.push({ key: "Type", value: `♤ ${kind}` });

  return rows;
}

export function parseHighlight(item: TitleItem, style: SubtitleStyle = "chapter"): Highlight {
  const subtitle = buildSubtitle(item, style);
  const info = style === "updated" ? buildInfoRows(item) : [];

  return {
    id: item.hid,
    title: decodeEntities(clean(item.title)),
    cover: coverUrl(item),
    ...(subtitle ? { subtitle } : {}),
    ...(info.length === 0 ? {} : { info }),
    webUrl: titleUrl(item.hid),
  };
}

export function parseHighlights(
  items: readonly TitleItem[] | null | undefined,
  style: SubtitleStyle,
): Highlight[] {
  // A row without a cover draws a blank tile, which reads as a broken source.
  return (items ?? [])
    .filter((item) => item.hid && item.title)
    .map((item) => parseHighlight(item, style));
}

function entityTitles(entities: readonly Entity[] | null | undefined): string[] {
  return (entities ?? [])
    .map((entity) => decodeEntities(clean(entity.title ?? "")))
    .filter(Boolean);
}

export function parseContent(details: TitleDetails): Content {
  const genres = details.genres ?? [];
  const themes = details.themes ?? [];

  const tags: Tag[] = [...genres, ...themes]
    .filter((entity) => entity.title)
    // The id stays the site's own numeric tag id, which is what the genre filter matches on.
    .map((entity) => ({
      id: String(entity.id ?? clean(entity.title ?? "")),
      title: decodeEntities(clean(entity.title ?? "")),
    }));

  const title = decodeEntities(clean(details.title));
  const status = parseStatus(details.status);
  const creators = [...entityTitles(details.authors), ...entityTitles(details.artists)];

  // The stat line the site prints under the title, in its own order.
  const info: Pair[] = [];
  const score = formatScore(details.rating);
  if (score) info.push({ key: "Rating", value: score });
  const kind = kindLabel(details.type);
  if (kind) info.push({ key: "Type", value: `♤ ${kind}` });
  const state = statusLabel(details.status);
  if (state) info.push({ key: "Status", value: `◌ ${state}` });

  const alternates = (details.altTitles ?? [])
    .map((name) => decodeEntities(clean(name)))
    .filter((name) => name && name.toLowerCase() !== title.toLowerCase());

  return {
    title,
    cover: coverUrl(details),
    summary: summaryFromHtml(details.synopsisHtml ?? ""),
    additionalTitles: [...new Set(alternates)],
    tags,
    ...(status === undefined ? {} : { status }),
    contentType: parseContentType(details.type),
    contentRating: parseRating(genres),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: titleUrl(details.hid),
  };
}

const LANGUAGES: Record<string, DefinedLanguages> = {
  en: DefinedLanguages.ENGLISH,
  es: DefinedLanguages.SPANISH,
  "es-la": DefinedLanguages.SPANISH,
  fr: DefinedLanguages.FRENCH,
  ja: DefinedLanguages.JAPANESE,
  pt: DefinedLanguages.PORTUGUESE,
  "pt-br": DefinedLanguages.PORTUGUESE,
};

export function definedLanguage(code: string): DefinedLanguages {
  return LANGUAGES[code.toLowerCase()] ?? DefinedLanguages.UNIVERSAL;
}

/** A name the site already wrote a number into is used as it stands. */
const NUMBERED = /(?:\bch(?:\.|apter)?|\bep(?:\.|isode)?)\s*\d/i;

/**
 * Who put the chapter up: the site's own word for the release, official or otherwise.
 *
 * The tick marks an official upload, the way the Kagane source here does. It earns its
 * place on a list that shows several uploads of the same chapter side by side — which is
 * the default — where the publisher's own release is the one most readers want.
 */
function parseProvider(type: string | null | undefined): Provider | undefined {
  const raw = clean(type ?? "");
  if (!raw) return undefined;

  const id = raw.toLowerCase();
  const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return { id, name: id === "official" ? `${name} ✓` : name };
}

export type ChapterOptions = {
  /** Collapse the several uploads the site lists for one chapter down to a single row. */
  merge: boolean;
  /** Which upload survives that merge. Meaningless when nothing is being merged. */
  officialFirst: boolean;
};

export function parseChapters(
  items: readonly ChapterItem[] | null | undefined,
  language: string,
  options: ChapterOptions,
): Chapter[] {
  const parsed = (items ?? []).map((item) => {
    const value = Number(item.number);
    // The site files a side story, an extra or an epilogue as number 0. That is "no number
    // of its own", not chapter zero, and it decides both the label and the ordering below.
    const numbered = Number.isFinite(value) && value > 0;
    const label = numbered ? `Chapter ${formatChapterNumber(value)}` : "";
    const name = decodeEntities(clean(item.name ?? ""));
    const official = (item.type ?? "").toLowerCase() === "official";

    // The app prints this verbatim and never joins the number onto it, so the whole label
    // is built here. A name the site already wrote a number into is used as it stands.
    const title = name ? (label && !NUMBERED.test(name) ? `${label} - ${name}` : name) : label;

    const provider = parseProvider(item.type);

    return {
      chapterId: String(item.id),
      number: numbered ? value : 0,
      index: 0,
      ...(title ? { title } : {}),
      date: parseTimestamp(item.createdAt) ?? new Date(0),
      language: definedLanguage(language),
      webUrl: undefined,
      ...(provider ? { provider } : {}),
      numbered,
      official,
    };
  });

  // The site lists several uploads of one chapter, and by default every one of them is
  // shown — a reader who wants a particular group's release can only pick it if it is
  // there. Merging is what collapses them, and only then does a preference decide which
  // upload survives: sorting that flag to the front puts it first in the pass below.
  const preferred =
    options.merge && options.officialFirst
      ? [...parsed].sort((left, right) => Number(right.official) - Number(left.official))
      : parsed;

  // Only a numbered chapter can be a duplicate of another. Every extra shares the number 0
  // without being the same chapter, so deduplicating those would keep just one of them.
  const seen = new Set<number>();
  const unique = !options.merge
    ? preferred
    : preferred.filter((chapter) => {
        if (!chapter.numbered) return true;
        if (seen.has(chapter.number)) return false;
        seen.add(chapter.number);
        return true;
      });

  // A chapter the site left unnumbered would otherwise sort ahead of chapter 1 and become
  // what the app opens first, so the extras are numbered above the main run in listed order.
  const highest = unique.reduce((max, chapter) => Math.max(max, chapter.number), 0);
  const extras = unique.filter((chapter) => !chapter.numbered);
  extras.forEach((chapter, position) => {
    chapter.number = highest + (extras.length - position);
  });

  // index 0 must be the earliest chapter, or the app resumes partway through.
  return unique
    .sort((left, right) => left.number - right.number)
    .map(({ official: _official, numbered: _numbered, ...chapter }, index) => ({
      ...chapter,
      index,
    }))
    .reverse();
}

/**
 * A volume read as one entry, for a reader who would rather have the bound release than
 * the chapters it collects. Its pages come from an endpoint of its own, so the id is
 * marked here and `chapterIsVolume` reads that mark back when the entry is opened.
 */
export function parseVolumes(
  items: readonly VolumeItem[] | null | undefined,
  language: string,
): Chapter[] {
  const parsed = (items ?? [])
    .filter((item) => (item.language ?? "").toLowerCase() === language.toLowerCase())
    .map((item) => {
      const value = Number(item.number);
      const number = Number.isFinite(value) && value > 0 ? value : 0;
      const name = decodeEntities(clean(item.name ?? ""));
      const label = `Vol. ${number || "?"}`;

      return {
        chapterId: `${VOLUME_PREFIX}:${item.id}`,
        number,
        index: 0,
        title: name ? `${label} - ${name}` : label,
        // The site publishes no date for a volume, and an invalid one renders broken.
        date: new Date(0),
        language: definedLanguage(language),
        webUrl: undefined,
      };
    });

  // index 0 must be the earliest volume, or the app resumes partway through.
  return parsed
    .sort((left, right) => left.number - right.number)
    .map((volume, index) => ({ ...volume, index }))
    .reverse();
}

export function chapterIsVolume(chapterId: string): boolean {
  return chapterId.startsWith(`${VOLUME_PREFIX}:`);
}

export function volumeIdOf(chapterId: string): string {
  return chapterId.slice(VOLUME_PREFIX.length + 1);
}

export function parsePages(response: PagesResponse): string[] {
  return (response.data?.pages ?? []).map((page) => clean(page.url ?? "")).filter(Boolean);
}
