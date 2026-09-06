/* SPDX-License-Identifier: GPL-3.0-or-later */

import { load } from "cheerio";
import {
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
  type StaffItem,
  type Tag,
} from "@mana-app/types";

import {
  clean,
  decodeEntities,
  relativeTime,
  resolveUrl,
  summaryFromHtml,
  text,
} from "../common/index.ts";
import {
  CONTENT_RATING_GENRES,
  baseUrl,
  type ChapterData,
  type ComicData,
  type NamedNode,
} from "./model.ts";

function absoluteUrl(target: string | null | undefined): string {
  const value = (target ?? "").trim();
  return value ? resolveUrl(value, baseUrl()) : "";
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
    case "oel":
    case "cartoon":
    case "western":
      return ContentType.COMIC;
    case "novel":
      return ContentType.NOVEL;
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

/** Listings send genres as slugs — `girls_love`, `full_color` — not as their labels. */
function formatGenre(genre: string | null | undefined): string {
  return clean(genre ?? "")
    .split("_")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
    .trim();
}

/** Six figures of follows would push everything else off the row. */
function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * The site marks its own rating with a filled star, so the tiles do too. The listing
 * endpoints have been seen quoting the number, hence the coercion.
 */
function formatScore(score: number | string | null | undefined): string {
  const value = typeof score === "string" ? Number.parseFloat(score) : score;
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return `★ ${value.toFixed(1)}`;
}

/** How a reader's title settings rewrite the site's own name for a series. */
export type TitleCleaner = (title: string) => string;

const asIs: TitleCleaner = (title) => title;

export type HighlightOptions = {
  latest?: ChapterData;
  cleanTitle?: TitleCleaner;
  /** A hero card shows no info rows, so its stats have to ride along in the subtitle. */
  hero?: boolean;
};

/**
 * Every listing endpoint already returns the score, genres, follows and last chapter
 * alongside the cover, so the tile carries them without a second request.
 */
export function parseHighlight(comic: ComicData, options: HighlightOptions = {}): Highlight {
  const { latest, cleanTitle = asIs, hero = false } = options;

  const number = formatChapterNumber(latest ?? comic.chapterNodes_last?.[0]?.data);
  const uploaded = latest ? parseTimestamp(latest.dateModify ?? latest.datePublic) : undefined;
  // Two genres: the third wraps and pushes the tile out of its row.
  const genres = (comic.genres ?? []).slice(0, 2).map(formatGenre).filter(Boolean);

  const score = formatScore(comic.score_val);
  const follows = compactCount(comic.follows);
  const comments = compactCount(comic.comments_total);

  const info: Pair[] = [];
  if (uploaded) info.push({ key: "Updated", value: relativeTime(uploaded) });
  if (genres.length > 0) {
    info.push({ key: genres.length > 1 ? "Genres" : "Genre", value: genres.join(", ") });
  }
  if (score) info.push({ key: "Rating", value: score });
  if (follows) info.push({ key: "Follows", value: `♥ ${follows}` });
  // A tile's info row carries plain text, so this is the speech bubble asked for in text
  // presentation rather than the SF symbol — the colour emoji sat oddly beside the heart.
  if (comments) info.push({ key: "Comments", value: `🗨︎ ${comments}` });

  const subtitle = [number ? `Chapter ${number}` : "", hero ? score : ""]
    .filter(Boolean)
    .join(" | ");

  return {
    id: comic.id,
    title: cleanTitle(decodeEntities(clean(comic.name))),
    cover: absoluteUrl(comic.urlCover),
    ...(subtitle ? { subtitle } : {}),
    // A tile stretches its whole row past about four lines, so the rest is dropped.
    ...(hero || info.length === 0 ? {} : { info: info.slice(0, 4) }),
    contentRating: parseRating(comic),
    webUrl: seriesUrl(comic),
  };
}

export function parseContent(comic: ComicData, cleanTitle: TitleCleaner = asIs): Content {
  const tags: Tag[] = [...(comic.genres ?? []), ...(comic.tags ?? [])]
    .map((name) => clean(name))
    .filter(Boolean)
    // The id stays the site's own slug, which is what the genre filter matches on.
    .map((name) => ({ id: name.toLowerCase(), title: formatGenre(name) }));

  const status = parseStatus(comic.originalStatus);
  const contentType = parseContentType(comic.type);
  const creators = [...names(comic.authorNodes), ...names(comic.artistNodes)];

  // The stat line the site prints under the title, in its own order.
  const info: Pair[] = [];
  const score = formatScore(comic.score_val);
  if (score) info.push({ key: "Score", value: score });
  if (comic.follows != null) info.push({ key: "Follows", value: String(comic.follows) });
  if (comic.reviews != null) info.push({ key: "Reviews", value: String(comic.reviews) });
  if (comic.comments_total != null) {
    info.push({ key: "Comments", value: String(comic.comments_total) });
  }
  if (comic.chaps_normal != null) info.push({ key: "Chapters", value: String(comic.chaps_normal) });

  const staff = staffItems(comic);

  return {
    title: cleanTitle(decodeEntities(clean(comic.name))),
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
    ...(staff.length === 0
      ? {}
      : {
          additionalInfo: [
            additionalInfo.staff.section({
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: staff,
            }),
          ],
        }),
    webUrl: seriesUrl(comic),
  };
}

/**
 * `creators` flattens everyone into one unlabelled line, so the same names are offered again
 * as staff, where each keeps the role the site filed it under. A person credited twice — the
 * usual case for a work drawn by its writer — is listed once, under the first role.
 */
function staffItems(comic: ComicData): StaffItem[] {
  const roles: [string, string, NamedNode[] | null | undefined][] = [
    ["author", "Author", comic.authorNodes],
    ["artist", "Artist", comic.artistNodes],
    ["publisher", "Publisher", comic.publisherNodes],
  ];

  const seen = new Set<string>();
  const items: StaffItem[] = [];

  for (const [role, label, nodes] of roles) {
    for (const name of names(nodes)) {
      if (seen.has(name)) continue;
      seen.add(name);
      items.push(
        additionalInfo.staff.item({ id: `${role}-${seen.size}`, title: name, subtitle: label }),
      );
    }
  }

  return items;
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

export type FilterTaxonomy = {
  genres: Option[];
  types: Option[];
  demographics: Option[];
  contentRatings: Option[];
};

/**
 * The search page carries every filter the site offers as `<details>` groups whose
 * options hold their API value in a bare `:` attribute. Reading them there is one
 * request for the complete lists, where the API exposes none of them.
 */
export function parseFilterTaxonomy(html: string): FilterTaxonomy {
  const taxonomy: FilterTaxonomy = { genres: [], types: [], demographics: [], contentRatings: [] };
  const $ = load(html);

  $("details.group").each((_, element) => {
    const group = $(element);
    const heading = text(group.find("summary").first()).toLowerCase();

    const bucket: keyof FilterTaxonomy | undefined = heading.includes("genre")
      ? "genres"
      : heading.includes("type")
        ? "types"
        : heading.includes("demographic")
          ? "demographics"
          : heading.includes("content rating")
            ? "contentRatings"
            : undefined;
    if (!bucket) return;

    const seen = new Set(taxonomy[bucket].map((option) => option.id));
    group.find("div[\\:]").each((__, node) => {
      const id = ($(node).attr(":") ?? "").trim();
      const title = decodeEntities(text($(node).find("span").first()));
      if (!id || !title || seen.has(id)) return;
      seen.add(id);
      taxonomy[bucket].push({ id, title });
    });
  });

  return taxonomy;
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
