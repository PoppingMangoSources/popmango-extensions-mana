/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

export const DOMAIN = "https://www.mangago.me";

/**
 * The reader needs a desktop UA (alongside the `_m_superu` cookie) to return
 * the whole image list in one response; browsing uses a mobile UA, which is
 * what makes chapter links come back as `/read-manga/` URLs.
 */
export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export const BROWSE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Hosts that can serve a numeric `/chapter/` reader; www.mangago.me 404s them. */
export const READER_MIRROR_HOSTS = [DOMAIN, "https://www.mangago.zone", "https://www.youhim.me"];

export const FilterID = {
  Genres: "genres",
  Statuses: "statuses",
} as const;

export const SortID = {
  Views: "views",
  CommentCount: "comment_count",
  CreateDate: "create_date",
  UpdateDate: "update_date",
  Random: "random",
  Alphabetical: "alphabetical",
} as const;

export const PreferenceID = {
  HiddenGenres: "hidden-genres",
  ContentType: "content-type",
  HideRaws: "hide-raws",
  RemoveTitleVersion: "remove-title-version",
  SectionPrefix: "section",
} as const;

/**
 * The site's own sort values. "Alphabetical" is the absence of a `sortby`
 * parameter rather than a value of its own.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Views, title: "Views", isDefault: true, isOrderable: false },
  { id: SortID.CommentCount, title: "Comment Count", isOrderable: false },
  { id: SortID.UpdateDate, title: "Update Date", isOrderable: false },
  { id: SortID.CreateDate, title: "Creation Date", isOrderable: false },
  { id: SortID.Random, title: "Random", isOrderable: false },
  { id: SortID.Alphabetical, title: "Alphabetical", isOrderable: false },
];

const SORT_VALUES: Record<string, string> = {
  [SortID.Views]: "view",
  [SortID.CommentCount]: "comment_count",
  [SortID.CreateDate]: "create_date",
  [SortID.UpdateDate]: "update_date",
  [SortID.Random]: "random",
  [SortID.Alphabetical]: "",
};

export function sortValueFor(id: string | undefined): string {
  return SORT_VALUES[id ?? ""] ?? "";
}

export const STATUS_OPTIONS: Option[] = [
  { id: "f", title: "Completed" },
  { id: "o", title: "Ongoing" },
];

export const GENRES = [
  "Yaoi",
  "Comedy",
  "Shounen Ai",
  "Shoujo",
  "Yuri",
  "Josei",
  "Fantasy",
  "School Life",
  "Romance",
  "Doujinshi",
  "Smut",
  "Adult",
  "Mystery",
  "One Shot",
  "Ecchi",
  "Shounen",
  "Martial Arts",
  "Shoujo Ai",
  "Supernatural",
  "Drama",
  "Action",
  "Adventure",
  "Harem",
  "Historical",
  "Horror",
  "Mature",
  "Mecha",
  "Psychological",
  "Sci-fi",
  "Seinen",
  "Slice Of Life",
  "Sports",
  "Gender Bender",
  "Tragedy",
  "Bara",
  "Webtoons",
];

/**
 * The site matches a genre by its display title, so an id is only ever an
 * internal handle. Deriving it the same way everywhere is what lets a tag
 * tapped on a details page round-trip back through the genre filter.
 */
export function genreIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const GENRE_OPTIONS: Option[] = GENRES.map((genre) => ({
  id: genreIdFromTitle(genre),
  title: genre,
}));

export function getGenreTitle(idOrTitle: string): string {
  return (
    GENRE_OPTIONS.find((genre) => genre.id === idOrTitle || genre.title === idOrTitle)?.title ??
    idOrTitle
  );
}

export type SectionSpecOption = {
  id: string;
  title: string;
  subtitle?: string;
  style: SectionStyle;
  /** "Top N" rows cap their items to N; omitted rows paginate uncapped. */
  limit?: number;
};

export const DISCOVER_SECTIONS: SectionSpecOption[] = [
  {
    id: "featured_manga",
    title: "Featured Manga",
    subtitle: "Hand-picked from what's climbing right now",
    style: SectionStyle.SimpleHeroPaged,
  },
  {
    id: "popular_manga",
    title: "Popular Manga",
    subtitle: "The most talked-about titles on the site",
    style: SectionStyle.DetailedSingleRowPaged,
  },
  {
    id: "new_chapters",
    title: "New Chapters",
    subtitle: "Your daily dose of the latest updates",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  { id: "top_yaoi", title: "Yaoi Manga Top 5", style: SectionStyle.SimpleHero, limit: 5 },
  {
    id: "top_shoujo",
    title: "Shoujo Manga Top 10",
    style: SectionStyle.SimpleDoubleRow,
    limit: 10,
  },
  { id: "top_comedy", title: "Comedy Manga Top 5", style: SectionStyle.SimpleHero, limit: 5 },
  {
    id: "top_supernatural",
    title: "Supernatural Manga Top 10",
    style: SectionStyle.SimpleDoubleRow,
    limit: 10,
  },
  { id: "top_fantasy", title: "Fantasy Manga Top 5", style: SectionStyle.SimpleHero, limit: 5 },
  {
    id: "top_mystery",
    title: "Mystery Manga Top 10",
    style: SectionStyle.SimpleDoubleRow,
    limit: 10,
  },
  { id: "top_josei", title: "Josei Manga Top 5", style: SectionStyle.SimpleHero, limit: 5 },
  {
    id: "top_shounen_ai",
    title: "Shounen Ai Manga Top 5",
    style: SectionStyle.SimpleSingleRow,
    limit: 5,
  },
  { id: "top_yuri", title: "Yuri Manga Top 5", style: SectionStyle.SimpleHero, limit: 5 },
  {
    id: "top_school_life",
    title: "School Life Manga Top 5",
    style: SectionStyle.SimpleSingleRow,
    limit: 5,
  },
  { id: "genres", title: "Genres", subtitle: "Browse by genre", style: SectionStyle.Grid },
];

/** Home sections hidden until the reader turns them on. */
export const DEFAULT_OFF_SECTION_IDS = new Set(["top_shounen_ai", "top_yuri", "top_school_life"]);

/** Genre tops that add ",Webtoons" so they list only manhwa/manhua. */
export const MANHWA_TOP_SECTION_IDS = new Set(["top_supernatural", "top_mystery"]);

/** Legacy section ids an older install may still ask for. */
export const SECTION_ALIASES: Record<string, string> = {
  popular: "popular_manga",
  latest: "new_chapters",
};

/** How many featured titles get enriched from their detail pages. */
export const FEATURED_HERO_LIMIT = 8;

/**
 * The site has no content-type field; "Webtoons" is its only manhwa/manhua
 * signal, so the type filter includes or excludes that one genre.
 */
export const CONTENT_TYPE_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "webtoons", title: "Manhwa / Manhua" },
  { id: "manga", title: "Manga" },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.HiddenGenres]: [] as string[],
  [PreferenceID.ContentType]: "all",
  [PreferenceID.HideRaws]: true,
  [PreferenceID.RemoveTitleVersion]: false,
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [
      `${PreferenceID.SectionPrefix}-${section.id}`,
      !DEFAULT_OFF_SECTION_IDS.has(section.id),
    ]),
  ),
};

/** A search/discover tile, plus the extras only some listings carry. */
export type MangagoListing = {
  id: string;
  title: string;
  cover: string;
  subtitle?: string;
  /** Reader path of the tile's newest chapter, when the listing shows one. */
  chapterId?: string;
  publishDate?: Date;
  genres?: string[];
};

/** Detail-page fields that enrich the featured hero. */
export type FeaturedDetail = {
  rating?: string;
  status?: string;
  author?: string;
  summary?: string;
  chapters?: number;
};

/**
 * Version tags the site appends to a title. Stripping them makes duplicate
 * library entries collapse onto one another.
 */
export const TITLE_VERSION_REGEX =
  /^(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩)\s*)+|(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/\s*Official)\s*)+$/gi;
