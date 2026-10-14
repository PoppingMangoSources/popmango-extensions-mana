/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  additionalInfo,
  AdditionalInfoType,
  ContentRating,
  PublicationStatus,
  type Chapter,
  type AdditionalInfoSection,
  type Content,
  type Highlight,
  type Option,
  type Pair,
  type Tag,
} from "@mana-app/types";

import {
  clean,
  compactCount,
  contentTypeOf,
  decodeEntities,
  firstFilled,
  Mark,
  panelMode,
  statusPill,
  summaryFromHtml,
  titleCase,
  toBadge,
  typePill,
} from "../common/index.ts";
import {
  BASE_URL,
  DEMOGRAPHIC_TAGS,
  CONTENT_TAGS,
  THEME_TAGS,
  FilterID,
  STATUS_NAMES,
  TAG_GROUPS,
  UNLISTED_TAGS,
  seriesUrl,
  chapterUrl,
  type ChapterEntry,
  type ChapterRelease,
  type ContentRatingId,
  type FacetsResponse,
  type LatestResponse,
  type Series,
  type SeriesResponse,
} from "./model.ts";

/** The short id the rest of the source keys on; a series without one cannot be opened. */
const HID_REGEX = /^[a-z][0-9a-z]{4}$/;

export function contentIdOf(series: Series): string | undefined {
  return series.hid && HID_REGEX.test(series.hid) ? series.hid : undefined;
}

export function parseContentIdFromUrl(url: string): string | undefined {
  const hid = /\/title\/([a-z][0-9a-z]{4})(?:[-/?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  return hid && HID_REGEX.test(hid) ? hid : undefined;
}

function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  return `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * The cover, at the width the tile it is going into needs.
 *
 * The site serves one cover at three sizes under the same path, so the big one costs only
 * the same request — a profile asks for 720 where a strip of tiles is happy with 460.
 */
const COVER_SIZE_REGEX = /\/(?:220|460|720)\.webp$/;

function coverUrl(cover: string | null | undefined, size: 460 | 720 = 460): string {
  return cover
    ? absoluteUrl(cover).replace(COVER_SIZE_REGEX, `/${size}.webp`)
    : `${BASE_URL}/images/cover.webp`;
}

/**
 * The site's own rating ladder, which it keeps in tags rather than in a field: flagged
 * adult or tagged Hentai is pornographic, Smut or Adult is erotica, Ecchi or Mature is
 * suggestive.
 */
export function ratingIdOf(series: Series): ContentRatingId {
  const tags = series.tags ?? [];
  if (series.adult || tags.includes("Hentai")) return "pornographic";
  if (tags.some((tag) => tag === "Smut" || tag === "Adult")) return "erotica";
  if (tags.some((tag) => tag === "Ecchi" || tag === "Mature")) return "suggestive";
  return "safe";
}

function contentRatingOf(series: Series): ContentRating {
  switch (ratingIdOf(series)) {
    case "safe":
      return ContentRating.SAFE;
    case "suggestive":
      return ContentRating.SUGGESTIVE;
    default:
      return ContentRating.EXPLICIT;
  }
}

/** Scores are out of a hundred, and an ungraded title is served as zero rather than null. */
function scoreOf(series: Series): number | undefined {
  return series.score && series.score > 0 ? series.score / 10 : undefined;
}

function chapterNumberLabel(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * How far a title has got, in the fewest words the site allows.
 *
 * A oneshot is numbered zero and labelled instead, so its label reads better than "Ch. 0".
 */
function progressLabel(series: Series): string {
  const number = series.latest?.n;
  const label = clean(decodeEntities(series.latest?.label ?? ""));
  if (number === 0 && label && !/\d/.test(label)) return label;
  if (typeof number === "number") return `Ch. ${chapterNumberLabel(number)}`;
  return series.chapters ? `${series.chapters} Chapters` : "";
}

export type HighlightOptions = {
  /** A rank the site gave this title, which leads the subtitle where there is one. */
  rank?: number;
  /** The chapter that put the title in a feed, rather than its newest overall. */
  latest?: ChapterEntry;
  /** A detailed tile draws its info rows and no pill, so the two never both appear. */
  detailed?: boolean;
};

export function parseHighlight(series: Series, options: HighlightOptions = {}): Highlight {
  const { rank, latest, detailed = false } = options;
  const score = scoreOf(series);
  const reads = compactCount(series.count ?? 0);
  const kind = titleCase(clean(series.type ?? ""));
  const state = titleCase(STATUS_NAMES[series.status ?? ""] ?? clean(series.status ?? ""));

  const progress = latest
    ? [
        typeof latest.n === "number" ? `Ch. ${chapterNumberLabel(latest.n)}` : "",
        clean(decodeEntities(latest.group?.name ?? "")),
      ]
        .filter(Boolean)
        .join(" • ")
    : progressLabel(series);

  // The pill takes the one best thing the site says: what it grades the title, else how
  // widely it is read, else what it is, else where it has got to.
  const taken = firstFilled(
    score === undefined ? "" : `${Mark.Rating} ${score.toFixed(1)}`,
    reads ? `${Mark.Views} ${reads}` : "",
    typePill(kind),
    statusPill(state),
  );

  const subtitle = [rank === undefined ? "" : `#${rank}`, progress].filter(Boolean).join(" • ");
  const info: Pair[] = [];
  if (score !== undefined)
    info.push({ key: "Rating", value: `${Mark.Rating} ${score.toFixed(1)}` });
  if (reads) info.push({ key: "Reads", value: reads });
  if (kind) info.push({ key: "Type", value: kind });
  if (progress) info.push({ key: "Progress", value: progress });
  if (state) info.push({ key: "Status", value: state });

  return {
    id: contentIdOf(series) ?? String(series.id),
    title: clean(decodeEntities(series.title)),
    cover: coverUrl(series.cover),
    ...(subtitle ? { subtitle } : {}),
    contentRating: contentRatingOf(series),
    // A detailed tile already prints everything below the cover; a pill there would say
    // the same number twice.
    ...(detailed ? { info } : { badge: toBadge(taken) }),
  };
}

export function parseHighlights(
  items: readonly Series[],
  options: HighlightOptions = {},
): Highlight[] {
  return items.flatMap((series) => (contentIdOf(series) ? [parseHighlight(series, options)] : []));
}

/** The uploads feed lists one entry per release, so a title appears once at its newest. */
export function parseLatestHighlights(
  items: NonNullable<LatestResponse["items"]>,
  seen: Set<string>,
  options: HighlightOptions = {},
): Highlight[] {
  return items.flatMap(({ chapter, series }) => {
    const contentId = contentIdOf(series);
    if (!contentId || seen.has(contentId)) return [];
    seen.add(contentId);
    return [parseHighlight(series, { ...options, latest: chapter })];
  });
}

/**
 * A chapter label reads "Chapter 12: Title [Group]". The bracketed team and the bare
 * number are not part of the title, and a "title" that only repeats the number is none.
 */
function parseLabel(
  release: ChapterRelease,
  number?: number | null,
): { title?: string; group?: string } {
  let label = clean(decodeEntities(release.label ?? ""));
  const bracket = /\s*\[([^\]]+)\]\s*$/.exec(label);
  const bracketGroup = bracket?.[1]?.trim();
  if (bracket) label = label.slice(0, bracket.index).trim();

  const numbered = /^(?:[A-Za-z]+\.?)?\s*#?\s*[\d.]+\s*(?:[:\-–—.|]\s*(.*))?$/.exec(label);
  const title = (numbered ? numbered[1] : label)?.trim();
  const group = clean(decodeEntities(release.group?.name ?? "")) || bracketGroup;
  const bare = title?.replace(/^(?:chapter|ch\.?|episode|ep\.?)\s*#?\s*/i, "");
  const repeatsNumber =
    number != null && bare !== undefined && bare !== "" && Number(bare) === number;

  return {
    ...(title && !repeatsNumber && title.toLowerCase() !== group?.toLowerCase() ? { title } : {}),
    ...(group ? { group } : {}),
  };
}

function tagGroupId(name: string, category: string | null | undefined): string {
  if (category) return FilterID.Themes;
  if (CONTENT_TAGS.has(name)) return FilterID.Content;
  if (name === "Doujinshi") return FilterID.Format;
  return THEME_TAGS.has(name) ? FilterID.Themes : FilterID.Genres;
}

export type TagGroup = { id: string; title: string; options: Option[] };

export function parseTagGroups(facets: FacetsResponse): TagGroup[] {
  const grouped = new Map<string, Option[]>();

  for (const facet of facets.genres ?? []) {
    if (UNLISTED_TAGS.has(facet.name) || facet.category === "Demographic") continue;

    const id = tagGroupId(facet.name, facet.category);
    grouped.set(id, [...(grouped.get(id) ?? []), { id: facet.name, title: facet.name }]);
  }

  return TAG_GROUPS.flatMap(({ id, title }) => {
    const options = (grouped.get(id) ?? []).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
    return options.length > 0 ? [{ id, title, options }] : [];
  });
}

function parseStatus(status: string | null | undefined): PublicationStatus | undefined {
  switch ((STATUS_NAMES[status ?? ""] ?? status ?? "").toLowerCase()) {
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

export function parseContent(
  { series, recs }: SeriesResponse,
  contentId: string,
  facets: FacetsResponse,
): Content {
  const title = clean(decodeEntities(series.title));
  const spoilers = new Set(series.spoilerTags ?? []);
  const tagNames = (series.tags ?? []).filter(
    (tag) => !UNLISTED_TAGS.has(tag) && !spoilers.has(tag),
  );
  const demographic = (series.tags ?? []).find((tag) => DEMOGRAPHIC_TAGS.has(tag));
  const tags: Tag[] = [...tagNames, ...(demographic ? [demographic] : [])].map((tag) => ({
    id: tag,
    title: tag,
  }));

  const creators = [
    ...new Set((series.authors ?? []).map((name) => clean(decodeEntities(name)))),
  ].filter(Boolean);
  const contentType = contentTypeOf(series.type) ?? undefined;
  const status = parseStatus(series.status);
  const panel = panelMode({
    type: contentType,
    tags: tags.map((tag) => tag.title),
  });

  const score = scoreOf(series);
  const info: Pair[] = [];
  if (score !== undefined)
    info.push({ key: "Rating", value: `${Mark.Rating} ${score.toFixed(1)}` });
  if (series.chapters) info.push({ key: "Chapters", value: String(series.chapters) });
  if (series.year) info.push({ key: "Year", value: String(series.year) });

  // The flat list above is what the app filters and navigates on; this is the same tags
  // again under the headings the site itself files them beneath, which is the only place
  // the difference between a genre, a theme and a format survives.
  //
  // Only the facet list knows which heading a tag belongs under, so without it there is no
  // grouping to draw — filing every tag under "Genres" would be worse than filing none.
  const categories = new Map((facets.genres ?? []).map((facet) => [facet.name, facet.category]));
  const grouped =
    categories.size === 0
      ? []
      : [
          ...TAG_GROUPS.flatMap(({ id, title }) => {
            const names = tagNames.filter((tag) => tagGroupId(tag, categories.get(tag)) === id);
            return names.length > 0 ? [{ id, title, names }] : [];
          }),
          ...(demographic
            ? [{ id: "demographic", title: "Demographic", names: [demographic] }]
            : []),
        ];

  const additionalTitles = [
    ...new Set(
      [series.titles?.english, series.titles?.romaji, series.titles?.native, ...(series.alt ?? [])]
        .map((name) => clean(decodeEntities(name ?? "")))
        .filter((name) => name && name !== title),
    ),
  ];

  // Most titles have no banner of their own but carry the wide hero the site draws in its
  // place. There is nowhere to put a banner, so it rides along as a second cover.
  const banner = series.banner || series.hero;
  const sections: AdditionalInfoSection[] = grouped.map((group) =>
    additionalInfo.tags.section({
      id: group.id,
      title: group.title,
      items: group.names.map((name) => additionalInfo.tags.item({ id: name, title: name })),
    }),
  );
  const related = parseHighlights(recs ?? []).slice(0, 10);
  if (related.length > 0) {
    sections.push(
      additionalInfo.highlights.section({
        id: "recommendations",
        title: "Recommendations",
        hasMore: false,
        items: related.map((entry) =>
          additionalInfo.highlights.item({
            type: AdditionalInfoType.Highlights,
            id: entry.id,
            title: entry.title,
            cover: entry.cover,
            contentRating: entry.contentRating,
            webUrl: entry.webUrl,
          }),
        ),
      }),
    );
  }

  return {
    title,
    cover: coverUrl(series.cover, 720),
    ...(banner ? { additionalCovers: [absoluteUrl(banner)] } : {}),
    summary: summaryFromHtml(series.description ?? ""),
    additionalTitles,
    tags,
    ...(status === undefined ? {} : { status }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(panel === undefined ? {} : { recommendedPanelMode: panel }),
    contentRating: contentRatingOf(series),
    ...(creators.length > 0 ? { creators } : {}),
    ...(info.length > 0 ? { info } : {}),
    trackerInfo: trackers(series.externalIds ?? {}),
    ...(sections.length > 0 ? { additionalInfo: sections } : {}),
    webUrl: seriesUrl(contentId, series.slug),
  };
}

function trackers(ids: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  if (ids["anilist"]) result["anilist"] = ids["anilist"];
  if (ids["myanimelist"]) result["mal"] = ids["myanimelist"];
  if (ids["mangaupdates"]) result["mangaupdates"] = ids["mangaupdates"];
  return result;
}

/**
 * Every upload, newest first.
 *
 * A chapter lists its own release and then any other team's take on the same number in
 * `alts`; each becomes a chapter of its own so the app can offer them as versions of one
 * another. `index` numbers the run from its oldest, which is not the order they arrive in.
 */
export function parseChapters({ chapters }: SeriesResponse): Chapter[] {
  // A chapter's own release sometimes appears in its `alts` as well, and the site draws
  // that upload once — so the id decides, not the position it was listed in.
  const seen = new Set<string>();
  const releases = (chapters ?? [])
    .flatMap((entry) => [entry, ...(entry.alts ?? [])].map((release) => ({ entry, release })))
    .filter(({ release }) => {
      const id = String(release.id);
      if (!release.id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  return releases.map(({ entry, release }, position) => {
    const { title, group } = parseLabel(release, entry.n);
    const number = typeof entry.n === "number" ? entry.n : 0;
    const at = release.at ?? entry.at;
    const volume = Number(entry.vol);

    const label = [
      typeof entry.n === "number" ? `Chapter ${chapterNumberLabel(entry.n)}` : "",
      title ?? "",
    ]
      .filter(Boolean)
      .join(": ");

    return {
      chapterId: String(release.id),
      number,
      // Oldest first, so the newest release is the last index rather than the first.
      index: releases.length - 1 - position,
      title: label || "Chapter",
      ...(Number.isFinite(volume) && volume > 0 ? { volume } : {}),
      date: at ? new Date(at) : new Date(0),
      language: "en",
      webUrl: chapterUrl(String(release.id)),
      ...(group ? { provider: { id: group, name: group } } : {}),
    };
  });
}
