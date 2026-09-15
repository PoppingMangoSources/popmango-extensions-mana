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
  firstFilled,
  Mark,
  statusPill,
  titleCase,
  toBadge,
  typePill,
} from "../common/index.ts";
import {
  CONTENT_RATING_GENRES,
  baseUrl,
  type ChapterData,
  type ComicData,
  type NamedNode,
  type TitleNode,
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

/** The site's own words for what a title is and where it has got to, as it spells them. */
function kindLabel(type: string | null | undefined): string {
  return titleCase(clean(type ?? ""));
}

function statusLabel(status: string | null | undefined): string {
  return titleCase(clean(status ?? ""));
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

/**
 * Timestamps arrive as seconds or milliseconds depending on the field, and browse states
 * its one as a date the site wrote out rather than counted.
 */
function parseTimestamp(value: number | string | null | undefined): Date | undefined {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    const written = new Date(value);
    return Number.isNaN(written.getTime()) ? undefined : written;
  }

  const number = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (number == null || !Number.isFinite(number) || number <= 0) return undefined;

  const date = new Date(number < 1e12 ? number * 1000 : number);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * When the site published a chapter, as a number to sort a feed by.
 *
 * A chapter the site gave no date sorts last rather than first, which is where an unknown
 * belongs in a list called "latest".
 */
export function publishedAt(chapter: ChapterData): number {
  return parseTimestamp(chapter.datePublic ?? chapter.dateCreate)?.getTime() ?? 0;
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

/**
 * Six figures of follows would push everything else off the row.
 *
 * A count of none is nothing the site has said about a title, so it reads as absent rather
 * than as a zero — otherwise a tile nobody has followed yet takes a pill saying so, and the
 * rating or the type that should have had it never gets a look in.
 */
function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** Every view the site has counted, which is the bucket its own "Total" sort reads. */
const TOTAL_VIEWS_FIELD = "views_d000";

function totalViews(comic: ComicData): number | undefined {
  const buckets = comic.views ?? [];
  const total = buckets.find((bucket) => bucket?.field === TOTAL_VIEWS_FIELD)?.count;
  if (typeof total === "number" && Number.isFinite(total)) return total;

  // A comic the site counts by window but not in total still has a largest window, and
  // that reads better than saying nothing about a title people plainly read.
  const counts = buckets
    .map((bucket) => bucket?.count)
    .filter((count): count is number => typeof count === "number" && Number.isFinite(count));
  return counts.length > 0 ? Math.max(...counts) : undefined;
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

/**
 * Who published an edition of a title — a scanlation team, or a house like WEBTOON or Tapas.
 *
 * One series published by several of them is several comics here, each with its own id,
 * cover and chapter run but the same name — so a row of them reads as the same title over
 * and over. `subName` is what the site labels them apart by; records made before that field
 * existed carry the name in a bracketed or parenthesised suffix on the title instead.
 */
export function teamOf(comic: ComicData): string {
  const stated = clean(comic.subName ?? "");
  if (stated) return decodeEntities(stated);

  const suffixed = /[[(]([^\])]+)[\])]\s*$/.exec(clean(comic.name));
  return suffixed?.[1] ? decodeEntities(suffixed[1].trim()) : "";
}

/** The title as a tile shows it, tagged with its publisher when more than one publishes it. */
function displayTitle(comic: ComicData, cleanTitle: TitleCleaner, showTeam: boolean): string {
  const name = cleanTitle(decodeEntities(clean(comic.name)));
  const team = showTeam ? teamOf(comic) : "";
  if (!team) return name;

  // A name already ending in the publisher reads as a stutter with it appended again —
  // whichever way round the site happened to write that suffix.
  const ending = name.toLowerCase();
  const tag = team.toLowerCase();
  if (ending.endsWith(`(${tag})`) || ending.endsWith(`[${tag}]`)) return name;

  return `${name} (${team})`;
}

/** How a reader's title settings rewrite the site's own name for a series. */
export type TitleCleaner = (title: string) => string;

const asIs: TitleCleaner = (title) => title;

export type HighlightOptions = {
  latest?: ChapterData;
  cleanTitle?: TitleCleaner;
  /** Whether a title shared by several teams names the one this edition belongs to. */
  showTeam?: boolean;
  /** A hero card shows no info rows, so its stats have to ride along in the subtitle. */
  hero?: boolean;
  /**
   * Whether the run's length stands in for a chapter number in the subtitle.
   *
   * Browse names no newest chapter, so the tile would otherwise lose the line it has
   * carried under every other row's.
   */
  countChapters?: boolean;
  /**
   * Whether this tile draws its info rows, and so draws no pill at all.
   *
   * The two say the same thing in different registers — a pill is the best single number
   * over the artwork, the rows are the whole read — and a tile carrying both repeats itself
   * a thumb's width apart.
   */
  detailed?: boolean;
};

/**
 * Every listing endpoint already returns the score, genres, follows and last chapter
 * alongside the cover, so the tile carries them without a second request.
 */
export function parseHighlight(comic: ComicData, options: HighlightOptions = {}): Highlight {
  const {
    latest,
    cleanTitle = asIs,
    showTeam = true,
    hero = false,
    countChapters = false,
    detailed = false,
  } = options;

  // A browse row carries its newest chapter the same way the uploads feed hands one over, so
  // the tile reads the same either way rather than losing its upload time off a listing.
  const newest = latest ?? comic.chapterNodes_last?.[0]?.data ?? undefined;
  const number = formatChapterNumber(newest);
  // Browse names no chapter but does say when the last one went up, so the tile keeps its
  // upload time either way.
  const uploaded = newest
    ? parseTimestamp(newest.dateModify ?? newest.datePublic)
    : parseTimestamp(comic.chapterPublishedAt);
  // Two genres: the third wraps and pushes the tile out of its row.
  const genres = (comic.genres ?? []).slice(0, 2).map(formatGenre).filter(Boolean);

  const score = formatScore(comic.score_val);
  const views = compactCount(totalViews(comic));
  const follows = compactCount(comic.follows);
  const comments = compactCount(comic.comments_total);

  // The pill falls through the house order: what the site grades a title, then what it has
  // been read, then what it counts, then what the title is, then where it has got to.
  // Browse answers per title and counts no views there, so a browse tile picks up again at
  // the follows.
  const viewLabel = views ? `${Mark.Views} ${views}` : "";
  const followLabel = follows ? `${Mark.Likes} ${follows}` : "";
  // The bubble carries U+FE0E so it draws as a filled mark beside the heart: a `Pair` takes
  // plain text, and the bare codepoint would render in colour.
  const commentLabel = comments ? `${Mark.Comments} ${comments}` : "";
  const kind = kindLabel(comic.type);
  const state = statusLabel(comic.originalStatus);
  const taken = firstFilled(
    score,
    viewLabel,
    followLabel,
    commentLabel,
    typePill(kind),
    statusPill(state),
  );

  // Four rows is the whole budget, so the counts are asked for ahead of the genres: what the
  // site grades and counts is what a reader compares two tiles by, and the genres are already
  // on the title page a tap away.
  const info: Pair[] = [];
  if (score) info.push({ key: "Rating", value: score });
  if (uploaded) info.push({ key: "Updated", value: relativeTime(uploaded) });
  if (followLabel) info.push({ key: "Likes", value: followLabel });
  if (commentLabel) info.push({ key: "Comments", value: commentLabel });
  if (genres.length > 0) {
    info.push({ key: genres.length > 1 ? "Genres" : "Genre", value: genres.join(", ") });
  }

  const chapters = comic.chaps_normal ?? 0;
  const counted = countChapters && chapters > 0 ? `${chapters} Chapters` : "";
  const subtitle = number ? `Chapter ${number}` : counted;
  const badge = detailed ? undefined : toBadge(taken);

  return {
    id: comic.id,
    title: displayTitle(comic, cleanTitle, showTeam),
    cover: absoluteUrl(comic.urlCover || comic.remoteCoverUrl),
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    // A tile stretches its whole row past about four lines, so the rest is dropped.
    ...(hero || info.length === 0 ? {} : { info: info.slice(0, 4) }),
    contentRating: parseRating(comic),
    webUrl: seriesUrl(comic),
  };
}

/**
 * Every edition of a title, as comics the rest of the source can read, best first.
 *
 * A title is the work; a comic is one team's or one publisher's rendering of it into one
 * language, and every id the source hands the app — a tile's, a chapter list's, a library
 * entry's — is a comic's. An edition inherits the work's cover and counts, which are what
 * the site prints on its own browse page, and overrides only what is its own.
 *
 * The order is the reader's languages first, longest run breaking a tie. A title with no
 * editions at all is nothing a reader can open, and comes back empty.
 */
export function parseTitleHighlights(
  node: TitleNode,
  languages: readonly string[],
  options: HighlightOptions = {},
): Highlight[] {
  const editions = (node.comicNodes ?? [])
    .map((edition) => edition.data)
    .filter((edition) => Boolean(edition?.id));
  if (editions.length === 0) return [];

  const preferred =
    languages.length === 0
      ? editions
      : editions.filter((edition) => languages.includes(edition.translatedLanguage ?? ""));

  return [...(preferred.length > 0 ? preferred : editions)]
    .sort((left, right) => {
      const order =
        languages.indexOf(left.translatedLanguage ?? "") -
        languages.indexOf(right.translatedLanguage ?? "");
      return order || (right.chaps_normal ?? 0) - (left.chaps_normal ?? 0);
    })
    .map((edition) =>
      parseHighlight(
        {
          ...node.data,
          id: edition.id,
          name: edition.name || node.data.name,
          // The publisher an edition came from belongs to the edition, so it has to be
          // carried over rather than left behind on the work the tile was built from.
          subName: edition.subName ?? null,
          translatedLanguage: edition.translatedLanguage ?? null,
          // The counts stay the work's, as the site prints them, except the run: a reader
          // is about to open this edition, not every translation of it at once.
          chaps_normal: edition.chaps_normal ?? node.data.chaps_normal ?? null,
          // The title's `urlPath` points at the work, and a reader tapping through to the
          // site should land on the edition the tile named.
          urlPath: null,
        },
        { ...options, countChapters: true },
      ),
    );
}

/**
 * The one edition a browse row stands for.
 *
 * A ranked row is a list of works, so it names each one once; search lists them all, where
 * a reader is looking for a particular team rather than for whatever ranks highest.
 */
export function parseTitleHighlight(
  node: TitleNode,
  languages: readonly string[],
  options: HighlightOptions = {},
): Highlight | undefined {
  return parseTitleHighlights(node, languages, options)[0];
}

export function parseContent(
  comic: ComicData,
  cleanTitle: TitleCleaner = asIs,
  showTeam = true,
): Content {
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
  const views = totalViews(comic);
  if (views != null) info.push({ key: "Views", value: views.toLocaleString("en-US") });
  if (comic.follows != null) info.push({ key: "Follows", value: String(comic.follows) });
  if (comic.comments_total != null) {
    info.push({ key: "Comments", value: String(comic.comments_total) });
  }
  if (comic.chaps_normal != null) info.push({ key: "Chapters", value: String(comic.chaps_normal) });

  const staff = staffItems(comic);

  return {
    title: displayTitle(comic, cleanTitle, showTeam),
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
export function parseChapters(
  entries: readonly ChapterData[],
  language: string,
  team = "",
): Chapter[] {
  const parsed = entries.map((entry) => {
    const value = Number.parseFloat(formatChapterNumber(entry) ?? "");
    // Whether the site stated a number at all, which is not the same as whether it is
    // zero: a prologue numbered 0 opens the run, while a notice carrying no number must
    // sit past its end so it is never the resume point.
    const numbered = Number.isFinite(value);
    const number = numbered ? value : 0;

    const label = [clean(entry.dname ?? ""), clean(entry.title ?? "")]
      .filter(Boolean)
      .filter((value, position, values) => position === 0 || value !== values[0])
      .map(decodeEntities)
      .join(": ");

    // `srcName` is the aggregator an upload came through rather than the team that made
    // it, so the edition's own team is named first where the site states one. `srcTitle` is
    // how the site writes that aggregator out, where `srcName` is the bare slug behind it.
    const source = decodeEntities(clean(entry.srcTitle ?? "")) || titleCase(entry.srcName);
    const groups = names(entry.groupNodes);
    const uploader = clean(entry.userNode?.data?.name ?? "");
    const scanlator = team || groups.join(", ") || source || uploader;

    const volume = Number.parseFloat(String(entry.volNum ?? ""));

    return {
      chapterId: entry.id,
      number,
      numbered,
      index: 0,
      ...(Number.isFinite(volume) ? { volume } : {}),
      // The app prints this verbatim and never joins the number onto it.
      title: label || (numbered ? `Chapter ${number}` : "Chapter"),
      date: parseTimestamp(entry.dateModify ?? entry.dateCreate ?? entry.datePublic) ?? new Date(0),
      language: language || DefinedLanguages.ENGLISH,
      ...(entry.urlPath ? { webUrl: absoluteUrl(entry.urlPath) } : {}),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });

  // index 0 must be the earliest numbered chapter, or the app resumes partway through.
  // Anything the site left unnumbered — a notice or an extra — is indexed after the run.
  // A chapter numbered 0 is numbered, so the run starts at it rather than after it.
  const positions = new Map<string, number>();
  [...parsed]
    .filter((chapter) => chapter.numbered)
    .sort((left, right) => left.number - right.number)
    .forEach((chapter, position) => positions.set(chapter.chapterId, position));

  let next = positions.size;
  for (const chapter of parsed) {
    if (!positions.has(chapter.chapterId)) positions.set(chapter.chapterId, next++);
  }

  return parsed.map(({ numbered: _numbered, ...chapter }) => ({
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
