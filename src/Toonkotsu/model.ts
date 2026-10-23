/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://toonkotsu.com";

/** What the site's own browse asks for, so a page here is a page there. */
export const PAGE_SIZE = 42;

export const READER_TIMEOUT = 180;

/**
 * Distinct titles a page of Latest Updates is filled to.
 *
 * The feed lists every release, and a series uploaded whole fills a page of it with one
 * title — which a feed showing each title once draws as a single row.
 */
export const LATEST_PAGE_TITLES = 12;

/** The most of the site's own pages one page of Latest Updates reads to get there. */
export const LATEST_PAGE_READS = 4;

/** How often a read the site calls a momentary limit is asked again, as its own reader does. */
export const TRANSIENT_RETRIES = 2;

/** The longest the site's own reader waits out a momentary limit, in seconds. */
export const TRANSIENT_WAIT_LIMIT = 10;

/** How long the site's reader is given to pass its human check without a tap, in seconds. */
export const HUMAN_CHECK_SECONDS = 20;

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
  HasChapters: "has_chapters",
} as const;

export const PreferenceID = {
  ReaderLoader: "reader-loader",
  ContentRatings: "content-ratings",
  Types: "types",
  HiddenTags: "hidden-tags",
  HiddenGroups: "hidden-groups",
  DeduplicateChapters: "deduplicate-chapters",
  ShowUploadSize: "show-upload-size",
  BestUploadPerGroup: "best-upload-per-group",
  SectionPrefix: "section",
} as const;

/** The site's own sort names, as its search menu keys them. */
export const SortID = {
  CreatedAt: "createdAt",
  UpdatedAt: "updatedAt",
  LastUploadedChapterAt: "lastUploadedChapterAt",
  Relevance: "relevance",
  Title: "title",
  Year: "year",
  Rating: "rating",
  Views: "views",
  Follows: "follows",
  Chapters: "chapters",
} as const;

/**
 * What the catalogue is asked for under each name — the site's own table, so its menu and
 * this one pick the same list.
 *
 * The site offers ten names for eight orders: Updated and Uploaded Date are one order, and
 * View and Follow Count are another. Picking the other name of a pair gives the same list
 * there too, so neither is a mistake to correct here.
 */
export const SORT_VALUES: Record<string, string> = {
  [SortID.CreatedAt]: "new",
  [SortID.UpdatedAt]: "latest",
  [SortID.LastUploadedChapterAt]: "latest",
  [SortID.Relevance]: "relevance",
  [SortID.Title]: "title",
  [SortID.Year]: "year",
  [SortID.Rating]: "score",
  [SortID.Views]: "popular",
  [SortID.Follows]: "popular",
  [SortID.Chapters]: "chapters",
};

/**
 * The site's menu, in its order and under its names, each with the direction its own Order
 * menu sets — newest, biggest and best first, and a title from A.
 *
 * `defaultAscending` is ascending when left out, so every descending sort has to say so.
 * Best Match ranks against a typed word and has no direction, so it is not the default: a
 * reader who opens search without typing gets the site's own Uploaded Date instead.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.CreatedAt, title: "Created Date", isOrderable: true, defaultAscending: false },
  { id: SortID.UpdatedAt, title: "Updated Date", isOrderable: true, defaultAscending: false },
  {
    id: SortID.LastUploadedChapterAt,
    title: "Uploaded Date",
    isOrderable: true,
    defaultAscending: false,
  },
  // The default, so a typed search is ranked by how well titles match it, as the site ranks
  // one. With nothing typed there is nothing to match, and search falls back to the site's
  // own Uploaded Date.
  { id: SortID.Relevance, title: "Best Match", isDefault: true },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
  { id: SortID.Year, title: "Year", isOrderable: true, defaultAscending: false },
  { id: SortID.Rating, title: "Rating", isOrderable: true, defaultAscending: false },
  { id: SortID.Views, title: "View Count", isOrderable: true, defaultAscending: false },
  { id: SortID.Follows, title: "Follow Count", isOrderable: true, defaultAscending: false },
  { id: SortID.Chapters, title: "Chapter Count", isOrderable: true, defaultAscending: false },
];

export const SectionID = {
  MostDiscussed: "most-discussed",
  MostRead: "most-read",
  Trending: "trending",
  HiddenGems: "hidden-gems",
  Latest: "latest",
  BingeWorthy: "binge-worthy",
  RecentlyAdded: "recently-added",
  ThisSeason: "this-season",
  Completed: "completed",
  MostViewed: "most-viewed",
  RisingArrivals: "rising-arrivals",
  SchoolLife: "school-life",
  MahouShoujo: "mahou-shoujo",
  ShortReads: "short-reads",
  MostSaved: "most-saved",
} as const;

export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.MostViewed,
    title: "Most Viewed",
    subtitle: "The catalogue's most-viewed titles",
    style: SectionStyle.SimpleHeroPaged,
    viewMore: false,
  },
  {
    id: SectionID.Trending,
    title: "Trending",
    subtitle: "What is gaining momentum with readers",
    style: SectionStyle.DetailedDoubleRowPaged,
    viewMore: true,
  },
  {
    id: SectionID.HiddenGems,
    title: "Hidden Gems",
    subtitle: "Highly rated finds with fewer readers",
    style: SectionStyle.SimpleSingleRow,
    viewMore: true,
  },
  {
    id: SectionID.RisingArrivals,
    title: "Rising Arrivals",
    subtitle: "New series gaining readers fast",
    style: SectionStyle.SimpleSingleRow,
    viewMore: true,
  },
  {
    id: SectionID.MostDiscussed,
    title: "Most Discussed",
    subtitle: "The titles readers talk about most",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.Latest,
    title: "Latest Updates",
    subtitle: "Fresh chapter uploads as they arrive",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: true,
  },
  {
    id: SectionID.BingeWorthy,
    title: "Binge-Worthy",
    subtitle: "Long, well-rated runs to settle into",
    style: SectionStyle.SimpleSingleRow,
    viewMore: true,
  },
  {
    id: SectionID.MostRead,
    title: "Most Read",
    subtitle: "The titles readers open most",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.RecentlyAdded,
    title: "Recently Added",
    subtitle: "The newest titles the site has picked up",
    style: SectionStyle.SimpleSingleRow,
    viewMore: true,
  },
  {
    id: SectionID.SchoolLife,
    title: "School Life Spotlight",
    subtitle: "The best-rated school stories",
    style: SectionStyle.DetailedTripleRowPaged,
    viewMore: true,
  },
  {
    id: SectionID.MostSaved,
    title: "Most Saved",
    subtitle: "The titles the most readers keep in their library",
    style: SectionStyle.SimpleDoubleRow,
    viewMore: false,
  },
  {
    id: SectionID.ShortReads,
    title: "Short Reads",
    subtitle: "Well-rated stories you can finish in a sitting",
    style: SectionStyle.SimpleDoubleRow,
    viewMore: true,
  },
  {
    id: SectionID.MahouShoujo,
    title: "Mahou Shoujo Spotlight",
    subtitle: "Popular magical girl stories",
    style: SectionStyle.DetailedTripleRowPaged,
    viewMore: true,
  },
  {
    id: SectionID.ThisSeason,
    title: "This Season",
    subtitle: "The catalogue's seasonal picks",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.Completed,
    title: "Completed",
    subtitle: "Finished stories to read from start to end",
    style: SectionStyle.SimpleSingleRow,
    viewMore: true,
  },
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
  [PreferenceID.HiddenGroups]: "",
  [PreferenceID.DeduplicateChapters]: false,
  [PreferenceID.ShowUploadSize]: true,
  [PreferenceID.BestUploadPerGroup]: true,
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
  /** Download size in megabytes, which is how one team's two uploads of a chapter differ. */
  mb?: number | null;
  w?: number | null;
  partial?: boolean;
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

/** What the site's title page draws beneath the description, gathered from the trackers. */
export type Enrichment = {
  anilistId?: number | null;
  myanimelistId?: number | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  staff?:
    | { id?: number | null; name?: string | null; role?: string | null; image?: string | null }[]
    | null;
  officialLinks?: { url?: string | null; site?: string | null; language?: string | null }[] | null;
  searchLinks?: { kind?: string | null; label?: string | null; url?: string | null }[] | null;
};

export type ReaderResult = {
  /** The chapter as the site answered it, whose page list is found by `pagesIn`. */
  body?: unknown;
  gate?: string;
  retryAfter?: number;
  error?: string;
  loader?: string;
  /** The loader was not on this document, which is the one failure worth another page for. */
  missingLoader?: boolean;
};

export type BrowserResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type BrowserScope = {
  document: { querySelectorAll(selector: string): ArrayLike<{ href?: string }> };
  performance: { getEntriesByType(type: string): { name: string }[] };
  fetch: (
    url: string,
    init?: { credentials?: string; headers?: Record<string, string> },
  ) => Promise<BrowserResponse>;
};

export type SitePage = { src?: string; k?: string; n?: string };
export type SiteModule = { chapter(id: number): Promise<unknown> };
export type SiteFailure = {
  status?: number;
  message?: string;
  data?: {
    code?: string;
    reason?: string;
    retryAfterSec?: number;
    error?: string;
    /** The site wants the request signed, which only its own loader can do. */
    resign?: boolean;
    /** A limit that lifts by itself within seconds, which the site's reader simply waits out. */
    transient?: boolean;
  };
};

export function seriesUrl(contentId: string, slug?: string | null): string {
  return `${BASE_URL}/title/${contentId}${slug ? `-${slug}` : ""}`;
}

export function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/chapter/${chapterId}`;
}
