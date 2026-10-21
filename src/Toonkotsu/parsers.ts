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
  type Enrichment,
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
  card?: "trending";
  /** What a ranking's `count` counts: chapter opens unless the ranking says otherwise. */
  tally?: "reads" | "comments" | "saves";
};

export function parseHighlight(series: Series, options: HighlightOptions = {}): Highlight {
  const { rank, latest, detailed = false, tally = "reads" } = options;
  const score = scoreOf(series);
  const reads = compactCount(series.count ?? 0);
  const [countMark, countKey] =
    tally === "comments"
      ? [Mark.Comments, "Comments"]
      : tally === "saves"
        ? [Mark.Likes, "Saves"]
        : [Mark.Views, "Reads"];
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
    reads ? `${countMark} ${reads}` : "",
    typePill(kind),
    statusPill(state),
  );

  const subtitle = [
    rank === undefined ? "" : `#${rank}`,
    progress,
    options.card && score !== undefined ? `${Mark.Rating} ${score.toFixed(1)}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
  const info: Pair[] = [];
  if (!options.card && score !== undefined)
    info.push({ key: "Rating", value: `${Mark.Rating} ${score.toFixed(1)}` });
  if (kind) info.push({ key: "Type", value: kind });
  if (state) info.push({ key: "Status", value: state });
  if (options.card === "trending" && series.year)
    info.push({ key: "Year", value: String(series.year) });
  if (options.card === "trending") {
    const genre = series.tags?.find(
      (tag) =>
        !UNLISTED_TAGS.has(tag) &&
        !series.spoilerTags?.includes(tag) &&
        tagGroupId(tag, undefined) === FilterID.Genres,
    );
    if (genre) info.push({ key: "Genre", value: clean(decodeEntities(genre)) });
  }
  if (reads && options.card !== "trending") info.push({ key: countKey, value: reads });

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
    if (UNLISTED_TAGS.has(facet.name)) continue;

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
  enrichment?: Enrichment,
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
  const started = dateLabel(enrichment?.startDate);
  if (started) info.push({ key: "Serialization", value: started });

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
  sections.push(...enrichmentSections(enrichment));
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
    trackerInfo: trackers({
      ...(enrichment?.anilistId ? { anilist: String(enrichment.anilistId) } : {}),
      ...(enrichment?.myanimelistId ? { myanimelist: String(enrichment.myanimelistId) } : {}),
      ...(series.externalIds ?? {}),
    }),
    ...(sections.length > 0 ? { additionalInfo: sections } : {}),
    webUrl: seriesUrl(contentId, series.slug),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Written as the site writes it, to whatever precision the trackers know the date. */
function dateLabel(date: Enrichment["startDate"]): string | undefined {
  if (!date?.year) return undefined;
  const month = date.month ? MONTHS[date.month - 1] : undefined;
  if (!month) return String(date.year);
  return date.day ? `${month} ${date.day}, ${date.year}` : `${month} ${date.year}`;
}

const isWebUrl = (url: string | null | undefined): url is string =>
  typeof url === "string" && /^https?:\/\//i.test(url);

/** The staff, publisher links and shop searches the site's title page draws, in its order. */
function enrichmentSections(enrichment: Enrichment | undefined): AdditionalInfoSection[] {
  if (!enrichment) return [];
  const sections: AdditionalInfoSection[] = [];

  const people = (enrichment.staff ?? []).flatMap((person, index) => {
    const name = clean(decodeEntities(person.name ?? ""));
    if (!name) return [];
    return [
      additionalInfo.staff.item({
        id: String(person.id ?? `${index}-${name}`),
        title: name,
        ...(person.role ? { subtitle: clean(person.role) } : {}),
        ...(isWebUrl(person.image) ? { image: person.image } : {}),
      }),
    ];
  });
  if (people.length > 0) {
    sections.push(
      additionalInfo.staff.section({
        id: "staff",
        title: "Staff",
        hasMore: false,
        items: people.slice(0, 10),
      }),
    );
  }

  const official = (enrichment.officialLinks ?? []).flatMap((link) =>
    isWebUrl(link.url) && link.site
      ? [
          additionalInfo.links.item({
            id: link.url,
            title: link.language
              ? `${clean(link.site)} · ${clean(link.language)}`
              : clean(link.site),
            url: link.url,
          }),
        ]
      : [],
  );
  if (official.length > 0) {
    sections.push(
      additionalInfo.links.section({ id: "links", title: "Links", items: official.slice(0, 10) }),
    );
  }

  const shops = (enrichment.searchLinks ?? []).flatMap((link) =>
    isWebUrl(link.url) && link.label
      ? [additionalInfo.links.item({ id: link.url, title: clean(link.label), url: link.url })]
      : [],
  );
  if (shops.length > 0) {
    sections.push(
      additionalInfo.links.section({ id: "buy", title: "Buy", items: shops.slice(0, 10) }),
    );
  }

  return sections;
}

function trackers(ids: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  if (ids["anilist"]) result["anilist"] = ids["anilist"];
  if (ids["myanimelist"]) result["mal"] = ids["myanimelist"];
  if (ids["mangaupdates"]) result["mangaupdates"] = ids["mangaupdates"];
  return result;
}

/**
 * A volume or a number the site did not state, which ranks above every one it did.
 *
 * Both absences are deliberate rather than missing data. A chapter not yet filed into a
 * volume is the newest thing the title has, and a release carrying no chapter number is a
 * whole volume — all of them at once — which the site's own list puts at the head of the
 * volume it collects. Ranking an absence highest is what puts both where the site has them.
 */
const UNFILED = Number.POSITIVE_INFINITY;

/** Ascending, and `Infinity - Infinity` is `NaN`, which would scramble the sort. */
function byAscending(left: number, right: number): number {
  return left === right ? 0 : left - right;
}

/** Where a release sits in the run: its volume, then its number within that volume. */
function rankOf(entry: ChapterEntry): [number, number] {
  const volume = Number(entry.vol);
  return [
    Number.isFinite(volume) && volume > 0 ? volume : UNFILED,
    typeof entry.n === "number" ? entry.n : UNFILED,
  ];
}

/**
 * The whole label, because the app prints it verbatim and never joins the volume or the
 * number onto it.
 *
 * Worded as the site words its own rows — `Vol. 1 Ch. 1 - Friends`, and `Vol. 2` for a
 * whole volume. The volume leads where the site states one, because the teams publishing
 * by volume restart their numbering inside each: three rows reading "Ch. 1" one after
 * another is that list read without it.
 *
 * The download closes the row, because a team often has the same chapter up twice at two
 * sizes and that is the whole of the difference between them. It belongs here rather than
 * on the team's name: the app draws one name per provider id, so a size carried there
 * would make one team read as several, and every row of theirs would take whichever name
 * the app happened to read first.
 */
function chapterTitle(
  entry: ChapterEntry,
  release: ChapterRelease,
  title: string | undefined,
  [volume, number]: readonly [number, number],
  size: string,
): string {
  const quoted = size ? ` (${size})` : "";

  // A whole volume has no number to build a row around, and the site names it by the
  // volume alone.
  if (number === UNFILED) {
    if (volume !== UNFILED) return `Vol. ${chapterNumberLabel(volume)}${quoted}`;
    const label = clean(decodeEntities(release.label ?? entry.label ?? ""));
    return `${label || "Chapter"}${quoted}`;
  }

  const prefix = [
    volume === UNFILED ? "" : `Vol. ${chapterNumberLabel(volume)}`,
    `Ch. ${chapterNumberLabel(number)}`,
  ]
    .filter(Boolean)
    .join(" ");

  return `${title ? `${prefix} - ${title}` : prefix}${quoted}`;
}

/**
 * Nothing left to tell two releases apart by: the same chapter, the same team, the same
 * wording and the same download.
 *
 * The site lists some uploads twice under one team with every one of those the same, and
 * two rows a reader cannot choose between are not a choice. Where the download differs
 * both are kept, because that one is a choice — a bigger scan against a smaller one.
 */
function sameUpload(
  [volume, number]: readonly [number, number],
  group: string,
  label: string,
): string {
  return `${volume}|${number}|${group.toLowerCase()}|${label.toLowerCase()}`;
}

/**
 * The download the site quotes for an upload, which is what one team's two uploads differ by.
 *
 * Written as the site writes it: megabytes however large it gets — a whole volume runs to
 * `1274 MB` there rather than a gigabyte and a bit — and a decimal only while it is small
 * enough for one to mean anything.
 */
function sizeLabel(mb: number | null | undefined): string {
  if (typeof mb !== "number" || !Number.isFinite(mb) || mb <= 0) return "";
  return `${mb >= 100 ? Math.round(mb) : Number(mb.toFixed(1))} MB`;
}

/**
 * The team, and nothing else.
 *
 * The app draws one name per provider id, so anything varying between a team's own uploads
 * — their downloads above all — would either make one team read as several or be read off
 * whichever of their rows the app saw first. The row itself carries that instead.
 */
function providerOf(group: string | undefined): { id: string; name: string } | undefined {
  return group ? { id: group, name: group } : undefined;
}

export type ChapterOptions = {
  /** Keep only the upload the site shows first for each chapter, as its own list does. */
  mainOnly?: boolean;
  /**
   * Close each chapter's name with the download it is offering.
   *
   * Turning it off is what makes a team's two uploads of one chapter the same row: with
   * nothing left to choose between them, only one of them is listed.
   */
  showSize?: boolean;
  /** Teams whose uploads are left out, matched on their name whatever its case. */
  hiddenGroups?: readonly string[];
};

/**
 * The run in the site's own order: by volume, then by number inside it, newest first.
 *
 * Sorting on the number alone is what the site does not do, and the teams publishing by
 * volume are why — their numbering restarts at one in every volume, so a flat sort files
 * volume three's opening chapter between volume one's second and first.
 *
 * A chapter lists its own release and then any other team's take on the same number in
 * `alts`; each becomes a chapter of its own so the app can offer them as versions of one
 * another. `index` numbers the run from its oldest, counted over the order below.
 *
 * Every upload a team has made of a chapter is kept and each carries its own download, so
 * the reader decides between a bigger scan and a smaller one — a judgement this cannot
 * make for them. Only an upload with nothing at all to tell it from another is dropped.
 */
export function parseChapters(
  { chapters }: SeriesResponse,
  options: ChapterOptions = {},
): Chapter[] {
  // A chapter's own release sometimes appears in its `alts` as well, and the site draws
  // that upload once — so the id decides, not the position it was listed in.
  const seen = new Set<number>();
  const uploads = new Set<string>();
  const kept: {
    rank: [number, number];
    chapter: Omit<Chapter, "index" | "number">;
  }[] = [];

  const hidden = new Set((options.hiddenGroups ?? []).map((name) => name.toLowerCase()));

  for (const entry of chapters ?? []) {
    const rank = rankOf(entry);
    // A hidden team's upload gives way to the next team's, so deduplicating keeps the chapter.
    const visible = [entry, ...(entry.alts ?? [])].filter(
      (release) => !hidden.has(parseLabel(release, entry.n).group?.toLowerCase() ?? ""),
    );
    const releases = options.mainOnly === true ? visible.slice(0, 1) : visible;

    for (const release of releases) {
      if (!release.id || seen.has(release.id)) continue;
      seen.add(release.id);

      const { title, group } = parseLabel(release, entry.n);
      const at = release.at ?? entry.at;
      const size = options.showSize === false ? "" : sizeLabel(release.mb);
      const label = chapterTitle(entry, release, title, rank, size);

      // The label already carries the download, so two uploads that differ by one differ
      // here too, and only a row with nothing at all to tell it from another is dropped.
      const upload = sameUpload(rank, group ?? "", label);
      if (uploads.has(upload)) continue;
      uploads.add(upload);

      const provider = providerOf(group);
      kept.push({
        rank,
        chapter: {
          chapterId: String(release.id),
          title: label,
          ...(rank[0] === UNFILED ? {} : { volume: rank[0] }),
          date: at ? new Date(at) : new Date(0),
          language: "en",
          webUrl: chapterUrl(String(release.id)),
          ...(provider ? { provider } : {}),
        },
      });
    }
  }

  // `index` counts from the first chapter, so it is read off the run the other way up.
  // Both sorts start from the order the releases were built in and both are stable, so two
  // teams' takes on one chapter stay in the order the site listed them either way round —
  // which is the order the app draws them in once its own sort finds them equal.
  const indices = new Map(
    [...kept]
      .sort(
        (left, right) =>
          byAscending(left.rank[0], right.rank[0]) || byAscending(left.rank[1], right.rank[1]),
      )
      .map(({ chapter }, position) => [chapter.chapterId, position]),
  );

  // Newest first.
  const ordered = kept.sort(
    (left, right) =>
      byAscending(right.rank[0], left.rank[0]) || byAscending(right.rank[1], left.rank[1]),
  );

  return ordered.map(({ rank, chapter }) => ({
    ...chapter,
    // Trackers consume this as chapter progress; volume ordering stays in rank and index.
    number: rank[1] === UNFILED ? highestIn(ordered, rank[0]) + 1 : rank[1],
    index: indices.get(chapter.chapterId) ?? 0,
  }));
}

/** The largest number the site stated inside one volume, or across the run without one. */
function highestIn(entries: readonly { rank: [number, number] }[], volume: number): number {
  let highest = 0;
  for (const { rank } of entries) {
    if (rank[0] === volume && rank[1] !== UNFILED && rank[1] > highest) highest = rank[1];
  }
  return highest;
}
