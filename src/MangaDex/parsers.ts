/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  DefinedLanguages,
  PublicationStatus,
  type Chapter,
  type Content,
  type Highlight,
  type Pair,
  type Tag,
} from "@mana-app/types";

import {
  Mark,
  clean,
  decodeEntities,
  firstFilled,
  relativeTime,
  statusPill,
  titleCase,
  toBadge,
  typePill,
} from "../common/index.ts";
import {
  BASE_URL,
  COVER_URL,
  type ChapterEntity,
  type LocalizedString,
  type MangaEntity,
  type Relationship,
} from "./model.ts";

/** How a reader's title settings rewrite the site's own name for a series. */
export type TitleCleaner = (title: string) => string;

const asIs: TitleCleaner = (title) => title;

/**
 * One string out of a localised map, preferring the reader's languages.
 *
 * The romanised forms are asked for before the native script: a shelf of Japanese titles
 * a reader cannot read is a shelf they cannot search. `en` comes first because that is what
 * the site itself shows, and the map's own first entry is the last resort — a title with
 * only a Portuguese name still has a name.
 */
export function localized(
  value: LocalizedString | null | undefined,
  preferred: readonly string[] = [],
): string {
  return clean(pickLocalized(value, preferred));
}

/**
 * The same, left as the site wrote it.
 *
 * A description is paragraphs, and `clean` squashes every run of whitespace — including the
 * blank line between them — into a single space.
 */
export function localizedRaw(
  value: LocalizedString | null | undefined,
  preferred: readonly string[] = [],
): string {
  return pickLocalized(value, preferred);
}

function pickLocalized(
  value: LocalizedString | null | undefined,
  preferred: readonly string[],
): string {
  if (!value) return "";
  const order = [...preferred, "en", "ja-ro", "ko-ro", "zh-ro"];

  for (const language of order) {
    const found = value[language];
    if (found && found.trim()) return found;
  }

  for (const entry of Object.values(value)) {
    if (entry && entry.trim()) return entry;
  }
  return "";
}

function relationship(
  entity: { relationships?: Relationship[] | null },
  type: string,
): Relationship | undefined {
  return (entity.relationships ?? []).find((one) => one?.type === type);
}

function relationshipNames(
  entity: { relationships?: Relationship[] | null },
  type: string,
): string[] {
  return (entity.relationships ?? [])
    .filter((one) => one?.type === type)
    .map((one) => clean(one.attributes?.name ?? ""))
    .filter(Boolean)
    .map(decodeEntities);
}

/** The manga a chapter belongs to, which the uploads feed sends as a relationship. */
export function chapterMangaId(chapter: ChapterEntity): string | undefined {
  const id = relationship(chapter, "manga")?.id;
  return id ? id.toLowerCase() : undefined;
}

/**
 * A cover's URL, at the size the reader asked for.
 *
 * The CDN renders a `.512.jpg` and a `.256.jpg` beside every upload, so the suffix is
 * appended to the file name rather than swapped into it. A title with no cover relationship
 * gets an empty string, which the app draws its own placeholder for.
 */
export function coverUrl(manga: MangaEntity, quality: string): string {
  const fileName = relationship(manga, "cover_art")?.attributes?.fileName;
  if (!fileName) return "";
  return `${COVER_URL}/${manga.id}/${fileName}${quality}`;
}

export function seriesUrl(mangaId: string): string {
  return `${BASE_URL}/title/${mangaId}`;
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
 * The site grades four ratings where the app has three, so erotica and pornographic both
 * land on explicit. An unknown word is treated as the strongest rather than the weakest:
 * a rating this source has not been taught about should not slip past a reader's filter.
 */
export function parseRating(rating: string | null | undefined): ContentRating {
  switch ((rating ?? "").toLowerCase()) {
    case "safe":
      return ContentRating.SAFE;
    case "suggestive":
      return ContentRating.SUGGESTIVE;
    case "":
      return ContentRating.SAFE;
    default:
      return ContentRating.EXPLICIT;
  }
}

/**
 * MangaDex descriptions are markdown with BBCode mixed in, and the app prints plain text.
 *
 * Links are unwrapped to their label rather than dropped — "see [this](url)" reading as
 * "see" loses the sentence. What is left is the words, which is what a summary is for.
 */
export function parseDescription(text: string): string {
  return decodeEntities(
    text
      // A spoiler tag hides the sentence inside it on the site; here it is just text.
      .replace(/\[\/?spoiler\]/gi, "")
      .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
      .replace(/\[\/?[a-z*][^\]]*\]/gi, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/** Five figures of follows would push everything else off the row. */
function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score) || score <= 0) return "";
  return `${Mark.Rating} ${score.toFixed(2)}`;
}

/** What the site prints under a title: how it is graded and how many follow it. */
export type MangaStats = { rating?: number | null; follows?: number | null };

export type HighlightOptions = {
  quality: string;
  titles?: readonly string[];
  cleanTitle?: TitleCleaner;
  stats?: MangaStats;
  /** The chapter that put this title in an uploads row. */
  latest?: ChapterEntity;
  /** A hero card draws no info rows, so its read has to ride in the subtitle. */
  hero?: boolean;
  /** A `Detailed*` tile draws no pill over its thumbnail, so it is given none. */
  detailed?: boolean;
  showVolume?: boolean;
  showChapter?: boolean;
};

/**
 * A listing tile. Everything on it comes from the one `/manga` response the row already
 * paid for, except the statistics a caller may have batched separately.
 */
export function parseHighlight(manga: MangaEntity, options: HighlightOptions): Highlight {
  const {
    quality,
    titles = [],
    cleanTitle = asIs,
    stats,
    latest,
    hero = false,
    detailed = false,
    showVolume = true,
    showChapter = true,
  } = options;

  const attributes = manga.attributes ?? {};
  const title = localized(attributes.title, titles) || localized(attributes.altTitles?.[0], titles);

  const score = formatScore(stats?.rating);
  const follows = compactCount(stats?.follows);
  const followLabel = follows ? `${Mark.Likes} ${follows}` : "";
  const kind = titleCase(attributes.publicationDemographic ?? "");
  const state = titleCase(attributes.status ?? "");

  // The pill falls through the house order: what the site grades a title, then what it is,
  // then where it has got to. Whatever it takes stays in the rows below — no pill is drawn
  // over the thumbnail those rows belong to.
  const taken = firstFilled(score, followLabel, typePill(kind), statusPill(state));

  const genres = (attributes.tags ?? [])
    .filter((tag) => (tag.attributes?.group ?? "") === "genre")
    .map((tag) => localized(tag.attributes?.name, titles))
    .filter(Boolean)
    .slice(0, 2);

  const uploaded = latest ? parseDate(latest.attributes?.readableAt) : undefined;

  const info: Pair[] = [];
  if (score) info.push({ key: "Rating", value: score });
  if (uploaded) info.push({ key: "Updated", value: relativeTime(uploaded) });
  if (followLabel) info.push({ key: "Follows", value: followLabel });
  if (state) info.push({ key: "Status", value: `${Mark.Status} ${state}` });
  if (genres.length > 0) {
    info.push({ key: genres.length > 1 ? "Genres" : "Genre", value: genres.join(", ") });
  }

  const subtitle = latest
    ? chapterLabel(latest.attributes ?? {}, { showVolume, showChapter })
    : hero
      ? firstFilled(score, followLabel, typePill(kind), statusPill(state))
      : "";
  const badge = detailed ? undefined : toBadge(taken);

  return {
    id: manga.id,
    title: cleanTitle(decodeEntities(title)) || manga.id,
    cover: coverUrl(manga, quality),
    ...(subtitle ? { subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    // A tile stretches its whole row past about four lines, so the rest is dropped.
    ...(hero || info.length === 0 ? {} : { info: info.slice(0, 4) }),
    contentRating: parseRating(attributes.contentRating),
    webUrl: seriesUrl(manga.id),
  };
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type ChapterLabelOptions = { showVolume?: boolean; showChapter?: boolean };

/**
 * The whole label for a chapter, because the app prints it verbatim and never joins a
 * volume or a number onto it.
 *
 * A chapter with neither a number nor a name is the site's own "Oneshot" — it has one
 * entry and no numbering to give it.
 */
export function chapterLabel(
  attributes: { volume?: string | null; chapter?: string | null; title?: string | null },
  options: ChapterLabelOptions = {},
): string {
  const { showVolume = true, showChapter = true } = options;
  const name = decodeEntities(clean(attributes.title ?? ""));

  const volume = showVolume && attributes.volume ? `Vol. ${attributes.volume}` : "";
  const chapter = showChapter && attributes.chapter ? `Ch. ${attributes.chapter}` : "";
  const prefix = [volume, chapter].filter(Boolean).join(" ");

  if (prefix && name) return `${prefix} - ${name}`;
  return prefix || name || "Oneshot";
}

export type ChapterOptions = {
  showVolume?: boolean;
  showChapter?: boolean;
};

/**
 * The chapter run, newest first as the feed serves it.
 *
 * `index` is a chapter's place counted from the oldest, which is not its place in this
 * array. A chapter the site left unnumbered — a bonus, an omake, a note from the group —
 * is indexed past the end of the run rather than left at zero, so it is never the point
 * the app resumes a reader at.
 */
export function parseChapters(entities: ChapterEntity[], options: ChapterOptions = {}): Chapter[] {
  const { showVolume = true, showChapter = true } = options;

  const parsed = entities.map((entity) => {
    const attributes = entity.attributes ?? {};
    const value = Number.parseFloat(attributes.chapter ?? "");
    // Whether the site stated a number at all, which is not the same as whether it is
    // zero: a prologue numbered 0 opens the run, while an extra carrying no number must
    // sit past its end.
    const numbered = Number.isFinite(value);

    const volume = Number.parseFloat(attributes.volume ?? "");
    const groups = relationshipNames(entity, "scanlation_group");
    const uploader = relationshipNames(entity, "user");
    const scanlator = groups.join(", ") || uploader[0] || "";

    return {
      chapterId: entity.id,
      number: numbered ? value : 0,
      numbered,
      index: 0,
      // The app prints this verbatim and never joins the volume or number onto it.
      title: chapterLabel(attributes, { showVolume, showChapter }),
      date:
        parseDate(attributes.readableAt ?? attributes.publishAt ?? attributes.createdAt) ??
        new Date(0),
      language: attributes.translatedLanguage || DefinedLanguages.ENGLISH,
      ...(Number.isFinite(volume) ? { volume } : {}),
      webUrl: `${BASE_URL}/chapter/${entity.id}`,
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });

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

/** The title page: everything the site says about a series, in its own order. */
export function parseContent(
  manga: MangaEntity,
  options: {
    quality: string;
    titles?: readonly string[];
    cleanTitle?: TitleCleaner;
    stats?: MangaStats;
  },
): Content {
  const { quality, titles = [], cleanTitle = asIs, stats } = options;
  const attributes = manga.attributes ?? {};

  const tags: Tag[] = (attributes.tags ?? [])
    .map((tag) => ({ id: tag.id, title: localized(tag.attributes?.name, titles) }))
    .filter((tag) => tag.title);

  const status = parseStatus(attributes.status);
  const creators = [...relationshipNames(manga, "author"), ...relationshipNames(manga, "artist")];

  const primary = localized(attributes.title, titles);
  const additional = (attributes.altTitles ?? [])
    .map((entry) => localized(entry, titles))
    .filter((name) => name && name !== primary);

  const info: Pair[] = [];
  const score = formatScore(stats?.rating);
  if (score) info.push({ key: "Rating", value: score });
  if (stats?.follows != null) info.push({ key: "Follows", value: String(stats.follows) });
  if (attributes.year) info.push({ key: "Year", value: String(attributes.year) });
  const demographic = titleCase(attributes.publicationDemographic ?? "");
  if (demographic) info.push({ key: "Demographic", value: `${Mark.Type} ${demographic}` });
  if (attributes.lastChapter) {
    info.push({ key: "Final Chapter", value: attributes.lastChapter });
  }

  return {
    title: cleanTitle(decodeEntities(primary)) || manga.id,
    cover: coverUrl(manga, quality),
    summary: parseDescription(localizedRaw(attributes.description, titles)),
    additionalTitles: [...new Set(additional.map((name) => decodeEntities(name)))],
    tags,
    ...(status === undefined ? {} : { status }),
    contentRating: parseRating(attributes.contentRating),
    ...(creators.length > 0 ? { creators: [...new Set(creators)] } : {}),
    ...(info.length > 0 ? { info } : {}),
    webUrl: seriesUrl(manga.id),
  };
}
