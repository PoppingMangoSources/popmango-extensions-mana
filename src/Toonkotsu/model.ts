/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://toonkotsu.com";

/** What the site's own browse asks for, so a page here is a page there. */
export const PAGE_SIZE = 42;

export const READER_TIMEOUT = 180;

/**
 * The range the publication-year steppers run over.
 *
 * Nothing on the site predates the earliest, and a year at either bound is read as "not
 * asked for" — a stepper has no empty state, so its bound has to be one.
 */
export const EARLIEST_YEAR = 1900;

export function latestYear(): number {
  return new Date().getFullYear() + 1;
}

export const FilterID = {
  Content: "content",
  Genres: "genres",
  Themes: "themes",
  Cast: "cast",
  Setting: "setting",
  Format: "format",
  IncludeMode: "include_mode",
  ExcludeMode: "exclude_mode",
  Demographics: "demographics",
  Statuses: "statuses",
  Languages: "languages",
  ContentRatings: "content_ratings",
  Author: "author",
  YearFrom: "year_from",
  YearTo: "year_to",
  ChaptersMin: "chapters_min",
  ChaptersMax: "chapters_max",
} as const;

export const PreferenceID = {
  ReaderLoader: "reader-loader",
  ContentRatings: "content-ratings",
  Types: "types",
  HiddenTags: "hidden-tags",
  SectionPrefix: "section",
} as const;

/** The site's browse orders as `<sort>-<order>`; relevance has no direction. */
export const SortID = {
  Relevance: "relevance",
  LatestDesc: "latest-desc",
  LatestAsc: "latest-asc",
  NewDesc: "new-desc",
  NewAsc: "new-asc",
  ScoreDesc: "score-desc",
  ScoreAsc: "score-asc",
  PopularDesc: "popular-desc",
  PopularAsc: "popular-asc",
  ChaptersDesc: "chapters-desc",
  ChaptersAsc: "chapters-asc",
  YearDesc: "year-desc",
  YearAsc: "year-asc",
  TitleAsc: "title-asc",
  TitleDesc: "title-desc",
} as const;

/**
 * Best Match ranks against a typed word, so it is not the default: a reader who opened
 * search without typing gets the site's own newest-first order instead.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Best Match" },
  { id: SortID.LatestDesc, title: "Latest Upload", isDefault: true },
  { id: SortID.LatestAsc, title: "Oldest Upload" },
  { id: SortID.NewDesc, title: "Recently Added" },
  { id: SortID.NewAsc, title: "Oldest Added" },
  { id: SortID.ScoreDesc, title: "Highest Rated" },
  { id: SortID.ScoreAsc, title: "Lowest Rated" },
  { id: SortID.PopularDesc, title: "Most Popular" },
  { id: SortID.PopularAsc, title: "Least Popular" },
  { id: SortID.ChaptersDesc, title: "Most Chapters" },
  { id: SortID.ChaptersAsc, title: "Fewest Chapters" },
  { id: SortID.YearDesc, title: "Newest Year" },
  { id: SortID.YearAsc, title: "Oldest Year" },
  { id: SortID.TitleAsc, title: "Title A-Z" },
  { id: SortID.TitleDesc, title: "Title Z-A" },
];

export const SectionID = {
  MostRead: "most-read",
  Trending: "trending",
  TopRated: "top-rated",
  HiddenGems: "hidden-gems",
  Latest: "latest",
  RecentlyAdded: "recently-added",
  ThisSeason: "this-season",
  Completed: "completed",
} as const;

/**
 * The home page, in the site's own order and under its own names.
 *
 * Most Read leads as a hero because the site ranks it and a rank wants the space; Trending
 * and Hidden Gems draw their rows, where the reads and the rating they are chosen on are
 * worth printing rather than hiding behind one pill. The rest are strips of covers.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  { id: SectionID.MostRead, title: "Most Read", style: SectionStyle.SimpleHeroPaged },
  { id: SectionID.Trending, title: "Trending", style: SectionStyle.DetailedDoubleRowPaged },
  { id: SectionID.HiddenGems, title: "Hidden Gems", style: SectionStyle.DetailedDoubleRowPaged },
  { id: SectionID.TopRated, title: "Top Rated", style: SectionStyle.SimpleSingleRow },
  {
    id: SectionID.Latest,
    title: "Latest Updates",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  { id: SectionID.RecentlyAdded, title: "Recently Added", style: SectionStyle.SimpleSingleRow },
  { id: SectionID.ThisSeason, title: "This Season", style: SectionStyle.SimpleSingleRow },
  { id: SectionID.Completed, title: "Completed", style: SectionStyle.SimpleSingleRow },
];

export const CONTENT_RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica"];

/** The catalogue files a series by its original language; these are the types it makes. */
export const TYPE_OPTIONS: (Option & { languages: string[] })[] = [
  { id: "manga", title: "Manga", languages: ["ja", "ja-ro"] },
  { id: "manhwa", title: "Manhwa", languages: ["ko", "ko-ro"] },
  { id: "manhua", title: "Manhua", languages: ["zh", "zh-hk", "zh-ro"] },
  { id: "oel", title: "OEL", languages: ["en"] },
  { id: "other", title: "Other", languages: ["xx"] },
];

export const COUNTRY_OPTIONS: Option[] = [
  { id: "ja", title: "Japan" },
  { id: "ko", title: "Korea" },
  { id: "zh", title: "China" },
  { id: "en", title: "Western" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "none", title: "None" },
];

/** The site spells two of these differently in its filter than in its own prose. */
export const STATUS_OPTIONS: (Option & { value: string })[] = [
  { id: "ongoing", title: "Ongoing", value: "Ongoing" },
  { id: "completed", title: "Completed", value: "Complete" },
  { id: "hiatus", title: "Hiatus", value: "Hiatus" },
  { id: "cancelled", title: "Cancelled", value: "Canceled" },
];

export const MATCH_MODE_OPTIONS: Option[] = [
  { id: "all", title: "AND" },
  { id: "any", title: "OR" },
];

/**
 * Tags the site keeps out of its own genre list: the demographics have a filter of their
 * own, and the rest it never offers for browsing.
 */
export const UNLISTED_TAGS = new Set([
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
  "Lolicon",
  "Shotacon",
  "Other",
]);

export const PORNOGRAPHIC_TAGS = new Set(["Hentai", "Adult", "Smut"]);

export const DEMOGRAPHIC_TAGS = new Set(["Shounen", "Shoujo", "Seinen", "Josei"]);

export const CONTENT_TAGS = new Set(["Ecchi", "Mature", "Smut", "Adult", "Hentai"]);
export const THEME_TAGS = new Set([
  "School Life",
  "Martial Arts",
  "Harem",
  "Isekai",
  "Gender Bender",
  "Mecha",
  "Supernatural",
  "Historical",
]);

/** The site's picker merges catalogue categories into Theme. */
export const TAG_GROUPS: { id: string; title: string }[] = [
  { id: FilterID.Content, title: "Content" },
  { id: FilterID.Format, title: "Format" },
  { id: FilterID.Genres, title: "Genre" },
  { id: FilterID.Themes, title: "Theme" },
];

export const STATUS_NAMES: Record<string, string> = {
  Complete: "Completed",
  Canceled: "Cancelled",
};

/** The facet list changes rarely, and every filter form and home row reads it. */
export const FACETS_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> & {
  [PreferenceID.ReaderLoader]: string;
} = {
  [PreferenceID.ReaderLoader]: "",
  [PreferenceID.ContentRatings]: DEFAULT_CONTENT_RATINGS,
  [PreferenceID.Types]: TYPE_OPTIONS.map((option) => option.id),
  [PreferenceID.HiddenTags]: [] as string[],
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  ),
};

export type ContentRatingId = "safe" | "suggestive" | "erotica" | "pornographic";

/** The query a catalogue request carries. The site skips empties and sends `true` as `1`. */
export type CatalogueParams = Record<string, string | number | boolean | undefined>;

export type LatestChapterRef = {
  id?: number;
  label?: string | null;
  n?: number | null;
  at?: number | null;
};

export type Series = {
  id: number;
  /** The short id every link and every other endpoint keys on. */
  hid?: string | null;
  slug?: string | null;
  title: string;
  titles?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
  alt?: string[] | null;
  description?: string | null;
  year?: number | null;
  type?: string | null;
  tags?: string[] | null;
  spoilerTags?: string[] | null;
  status?: string | null;
  cover?: string | null;
  banner?: string | null;
  hero?: string | null;
  score?: number | null;
  latest?: LatestChapterRef | null;
  chapters?: number | null;
  authors?: string[] | null;
  externalIds?: Record<string, string | null> | null;
  adult?: boolean | null;
  /** Chapter opens, which only the reading rankings count. */
  count?: number | null;
};

export type ChapterGroup = { slug?: string | null; name?: string | null };

export type ChapterRelease = {
  id: number;
  label?: string | null;
  at?: number | null;
  src?: string | null;
  group?: ChapterGroup | null;
};

export type ChapterEntry = ChapterRelease & {
  n?: number | null;
  vol?: string | number | null;
  /** A second team's upload of the same chapter, which the app offers as a version. */
  alts?: ChapterRelease[] | null;
};

export type SeriesListResponse = {
  items?: Series[] | null;
  page?: number;
  limit?: number;
  total?: number;
  hasNextPage?: boolean;
};

export type LatestResponse = {
  items?: { chapter: ChapterEntry; series: Series }[] | null;
  page?: number;
  hasNextPage?: boolean;
};

export type SeriesResponse = {
  series: Series;
  chapters?: ChapterEntry[] | null;
  recs?: Series[] | null;
};

export type Facet = { name: string; category?: string | null; isAdult?: boolean | null };

export type FacetsResponse = { genres?: Facet[] | null };

export type ReaderPage = {
  url?: string;
  raw?: string;
};

export type ReaderResult = {
  pages?: ReaderPage[];
  gate?: string;
  retryAfter?: number;
  error?: string;
  loader?: string;
};

export type BrowserResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type BrowserScope = {
  document: { querySelectorAll(selector: string): ArrayLike<{ href?: string }> };
  performance: { getEntriesByType(type: string): { name: string }[] };
  location: { href: string };
  fetch: (url: string, init?: { credentials: string }) => Promise<BrowserResponse>;
  crypto: {
    subtle: {
      importKey(
        format: string,
        key: Uint8Array,
        algorithm: { name: string },
        extractable: boolean,
        usages: string[],
      ): Promise<unknown>;
      decrypt(
        algorithm: { name: string; counter: Uint8Array; length: number },
        key: unknown,
        data: ArrayBuffer,
      ): Promise<ArrayBuffer>;
    };
  };
  atob(value: string): string;
  btoa(value: string): string;
  URL: new (url: string, base: string) => { href: string };
};

export type SitePage = { src?: string; k?: string; n?: string };
export type SiteModule = { chapter(id: number): Promise<unknown> };
export type SiteFailure = {
  status?: number;
  message?: string;
  data?: { code?: string; reason?: string; retryAfterSec?: number; error?: string };
};

export function seriesUrl(contentId: string, slug?: string | null): string {
  return `${BASE_URL}/title/${contentId}${slug ? `-${slug}` : ""}`;
}

export function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/chapter/${chapterId}`;
}
