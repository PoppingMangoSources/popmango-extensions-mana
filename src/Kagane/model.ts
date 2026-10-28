/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type JsonValue, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://kagane.cx";
export const API_URL = `${BASE_URL}/api/v2`;

export const DEFAULT_CACHE_URL = BASE_URL;

/** Every address the site answers on; each serves the same library and the same API. */
export const MIRRORS = ["kagane.cx", "kagane.org", "kagane.si", "kagane.moe", "kagane.net"];

export const MIRROR_OPTIONS: Option[] = MIRRORS.map((host) => ({ id: host, title: host }));

/**
 * Whether a host may be sent a reader token: one of the mirrors, a subdomain of one, or
 * the image CDN they share. A `cache_url` naming anything else is not followed.
 */
export function isTrustedHost(host: string): boolean {
  const name = host.toLowerCase();
  return (
    name === "kstatic.to" ||
    name.endsWith(".kstatic.to") ||
    MIRRORS.some((mirror) => name === mirror || name.endsWith(`.${mirror}`))
  );
}

/** A request body, which the API is sent as JSON. */
export type JsonObject = { [key: string]: JsonValue };

// The size the site's own rows ask for.
export const PAGE_SIZE = 50;
export const PAGES_PER_SECOND = 5;

export const FilterID = {
  Sort: "sort",
  ContentRating: "content_rating",
  AgeRating: "age_rating",
  Pornographic: "is_pornographic",
  Format: "format",
  Status: "upload_status",
  Genres: "genres",
  MatchAllGenres: "match_all_genres",
  Tags: "tags",
  TagQuery: "tag_query",
  MatchAllTags: "match_all_tags",
  Sources: "source_id",
  ExactMatch: "exact_match",
  PublicationStatus: "publication_status",
  Disturbing: "is_disturbing",
  OriginalLanguage: "original_language",
  TranslatedLanguage: "translated_language",
  ContentLanguage: "content_lang",
  StartYear: "start_year",
  EndYear: "end_year",
  Chapters: "current_books",
  ChapterRange: "chapter_range",
  Volumes: "current_volumes",
  Staff: "staff",
  Groups: "groups",
  SourceType: "source_type",
} as const;

export const PreferenceID = {
  // Renamed once, on purpose: the old key holds a saved "Safe and Suggestive" that is
  // indistinguishable from the old default, and that default was the bug. A new key lets
  // the corrected default reach installs that already have the old one written.
  ContentRating: "content-rating-all",
  NormalizedRatings: "content-ratings",
  AgeRating: "age-rating",
  ShowPornographic: "show-pornographic",
  ExcludedGenres: "excluded-genres",
  IncludedGenres: "included-genres",
  ExcludedTags: "excluded-tags",
  IncludedTags: "included-tags",
  IncludedSources: "included-sources",
  ExcludedSources: "excluded-sources",
  Mirror: "mirror",
  UploadSource: "upload-source",
  ShowSourceInTitle: "show-source-in-title",
  ShowEditionInTitle: "show-edition-in-title",
  CleanTitle: "clean-title",
  ShowSpoilerTags: "show-spoiler-tags",
  DataSaver: "data-saver",
  ChapterTitle: "chapter-title",
  ContentLanguages: "content-languages",
  OriginalLanguages: "original-languages",
  TranslatedLanguages: "translated-languages",
  HideDisturbing: "hide-disturbing",
} as const;

export const SortID = {
  Relevance: "",
  AverageViews: "avg_views",
  ViewsToday: "avg_views_today",
  PopularNow: "popular_now",
  ViewsWeek: "avg_views_week",
  ViewsMonth: "avg_views_month",
  Updated: "updated_at",
  Rating: "rating",
  Created: "created_at",
  Chapters: "current_books",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Relevance", isDefault: true },
  { id: SortID.ViewsWeek, title: "Most read" },
  { id: SortID.Updated, title: "Updated", isOrderable: true, defaultAscending: false },
  { id: SortID.Rating, title: "Rating", isOrderable: true, defaultAscending: false },
  { id: SortID.Created, title: "Added", isOrderable: true, defaultAscending: false },
  { id: SortID.Chapters, title: "Chapter count", isOrderable: true, defaultAscending: false },
  { id: SortID.PopularNow, title: "Popular now" },
  { id: SortID.ViewsMonth, title: "Most read this month" },
  { id: SortID.AverageViews, title: "Most read of all time" },
];

export const CONTENT_RATINGS = ["Safe", "Suggestive", "Erotica", "Pornographic"];

export const CONTENT_RATING_OPTIONS: Option[] = CONTENT_RATINGS.map((rating) => ({
  id: rating,
  title: rating,
}));

export const RANGE_FIELDS = [
  { id: FilterID.Chapters, title: "Chapters", lower: "Min", upper: "Max" },
  { id: FilterID.Volumes, title: "Volumes", lower: "Min", upper: "Max" },
  { id: FilterID.StartYear, title: "Year started", lower: "From", upper: "To" },
  { id: FilterID.EndYear, title: "Year ended", lower: "From", upper: "To" },
] as const;

export const FORMAT_OPTIONS: Option[] = ["Manga", "Manhwa", "Manhua", "Comic", "Other"].map(
  (format) => ({ id: format, title: format }),
);

export const STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Abandoned", title: "Abandoned" },
];

/** The search form's status labels, which name an abandoned series the way the site does. */
export const SEARCH_STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Abandoned", title: "Cancelled" },
];

export const SOURCE_TYPE_OPTIONS: Option[] = [
  { id: "Official", title: "Official" },
  { id: "Unofficial", title: "Fan translation" },
  { id: "Mixed", title: "Mixed" },
];

/** The upload kinds the Upload Source setting lets through. */
export function uploadTypes(setting: string): string[] {
  if (setting === "official") return ["Official"];
  if (setting === "scanlations") return ["Unofficial", "Mixed"];
  return SOURCE_TYPE_OPTIONS.map((option) => option.id);
}

export const UPLOAD_SOURCE_OPTIONS: Option[] = [
  { id: "all", title: "All uploads" },
  { id: "official", title: "Official only" },
  { id: "scanlations", title: "Scanlations only" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh", title: "Chinese" },
  { id: "es", title: "Spanish" },
  { id: "es-419", title: "Spanish (Latin America)" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "it", title: "Italian" },
  { id: "pt", title: "Portuguese" },
  { id: "pt-br", title: "Portuguese (Brazil)" },
  { id: "ru", title: "Russian" },
  { id: "pl", title: "Polish" },
  { id: "tr", title: "Turkish" },
  { id: "ar", title: "Arabic" },
  { id: "id", title: "Indonesian" },
  { id: "th", title: "Thai" },
  { id: "vi", title: "Vietnamese" },
  { id: "hi", title: "Hindi" },
];

export function languageOption(code: string): Option {
  const id = code.toLowerCase();
  if (id === "zh-hk") return { id, title: "Chinese (zh-hk)" };
  if (id === "es-la") return { id, title: "Spanish (es-la)" };
  const known = LANGUAGE_OPTIONS.find((option) => option.id === id);
  return known ?? { id, title: id };
}

export const SectionLayout = {
  Hero: "hero",
  Detailed: "detailed",
  ChapterUpdates: "chapter-updates",
  Simple: "simple",
} as const;

export type SectionLayoutKind = (typeof SectionLayout)[keyof typeof SectionLayout];

export type DiscoverSection = {
  id: string;
  title: string;
  subtitle?: string;
  style: SectionStyle;
  layout: SectionLayoutKind;
  sort: string;
};

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: "popular",
    title: "Popular All Time",
    subtitle: "The most-read titles across all time",
    style: SectionStyle.SimpleHeroPaged,
    layout: SectionLayout.Hero,
    sort: SortID.AverageViews,
  },
  {
    id: "weekly_chart",
    title: "Trending This Week",
    subtitle: "Titles gaining reading momentum this week",
    style: SectionStyle.DetailedTripleRowPaged,
    layout: SectionLayout.Detailed,
    sort: "",
  },
  {
    id: "trending_month",
    title: "Popular This Month",
    subtitle: "The most-read titles this month",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Simple,
    sort: SortID.ViewsMonth,
  },
  {
    id: "trending_week",
    title: "Popular This Week",
    subtitle: "The most-read titles this week",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Simple,
    sort: SortID.ViewsWeek,
  },
  {
    id: "latest_updates",
    title: "Recently Updated",
    subtitle: "Fresh chapters as they arrive",
    style: SectionStyle.DetailedVerticalListGrouped,
    layout: SectionLayout.ChapterUpdates,
    sort: SortID.Updated,
  },
  {
    id: "trending_today",
    title: "Popular Today",
    subtitle: "The most-read titles today",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Simple,
    sort: SortID.ViewsToday,
  },
  {
    id: "recently_added",
    title: "Recently Added",
    subtitle: "New arrivals in the catalogue",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Simple,
    sort: SortID.Created,
  },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  // Every rung the site publishes. Narrowing this here hid editions of a title that the
  // site itself returns — a second scanlation of the same series rated a rung higher than
  // the first simply vanished from search. The app's own content setting is the place that
  // decision belongs, and it is applied on top of this.
  [PreferenceID.ContentRating]: [...CONTENT_RATINGS],
  [PreferenceID.NormalizedRatings]: [] as string[],
  [PreferenceID.AgeRating]: [] as string[],
  [PreferenceID.ShowPornographic]: true,
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.IncludedGenres]: [] as string[],
  [PreferenceID.ExcludedTags]: [] as string[],
  [PreferenceID.Mirror]: "kagane.cx",
  [PreferenceID.IncludedSources]: [] as string[],
  [PreferenceID.ExcludedSources]: [] as string[],
  [PreferenceID.UploadSource]: "all",
  [PreferenceID.ShowSourceInTitle]: false,
  [PreferenceID.ShowEditionInTitle]: false,
  [PreferenceID.CleanTitle]: false,
  [PreferenceID.ShowSpoilerTags]: false,
  [PreferenceID.DataSaver]: false,
  [PreferenceID.ChapterTitle]: "auto",
  // Emptying this asks the site for every language rather than for none.
  [PreferenceID.ContentLanguages]: ["en"],
  [PreferenceID.OriginalLanguages]: [] as string[],
  [PreferenceID.TranslatedLanguages]: [] as string[],
  [PreferenceID.HideDisturbing]: true,
};

export type GenreEntry = { id: string; genre_name: string; genre_type?: string };
export type TagEntry = { id: string; tag_name: string };

export type UploadSource = {
  source_id: string;
  source_type: string;
  title: string;
};

export type SourcesResponse = { sources?: UploadSource[] };

export type LatestChapter = {
  book_id: string;
  title?: string | null;
  chapter_no?: string | null;
  volume_no?: string | null;
  created_at?: string | null;
  available_at?: string | null;
};

export type SeriesSummary = {
  series_id: string;
  title: string;
  source_id?: string | null;
  current_books?: number;
  start_year?: number | null;
  cover_image_id?: string | null;
  alternate_titles?: string[];
  age_rating?: string | null;
  content_rating?: string | null;
  is_pornographic?: boolean;
  is_disturbing?: boolean;
  format?: string | null;
  publication_status?: string | null;
  translated_language?: string | null;
  genres?: string[];
  tags?: string[];
  genre_list?: { id: string; name: string }[];
  latest_chapters?: LatestChapter[];
  slug?: string;
  rating?: number | null;
  hidden_by_filter?: boolean;
};

export type SearchResponse = {
  content?: SeriesSummary[];
  last?: boolean;
  total_elements?: number;
  total_pages?: number;
  next_cursor?: string | null;
  facets?: { content_lang?: { value: string; count: number }[] };
};

export type BookIndexResponse = {
  count: number;
  fields: string[];
  groups: { title: string }[];
  books: unknown[][];
};

export type TrendingResponse = {
  items: {
    position: number;
    delta: number | null;
    is_new: boolean;
    lift: number;
    hidden_by_filter: boolean;
    series: SeriesSummary;
  }[];
};

export type ChapterBook = {
  book_id: string;
  series_id?: string | null;
  title: string;
  created_at?: string | null;
  published_on?: string | null;
  became_visible_at?: string | null;
  page_count?: number;
  sort_no?: number;
  chapter_no?: string | null;
  volume_no?: string | null;
  groups?: { title: string }[];
};

export type DetailsResponse = {
  title: string;
  description?: string | null;
  upload_status?: string;
  format?: string | null;
  source_id?: string | null;
  series_staff?: { name: string; role: string }[];
  genres?: { genre_id: string; genre_name: string; is_spoiler?: boolean }[];
  tags?: { tag_id: string; tag_name: string; is_spoiler?: boolean }[];
  series_alternate_titles?: { title: string; label?: string | null }[];
  series_books?: ChapterBook[];
  edition_info?: string | null;
  tracker_id?: string | null;
  series_covers?: { image_id: string }[];
  age_rating?: string | null;
  content_rating?: string | null;
  is_pornographic?: boolean;
  is_disturbing?: boolean;
  translated_language?: string | null;
  publication_status?: string;
  current_books?: number;
  series_links?: { url: string; label: string; kind?: string }[];
  external_ids?: Record<string, string | number>;
  average_rating?: number | null;
  bayesian_rating?: number | null;
  total_views?: number | null;
};

export type TrackerResponse = {
  book_series?: TrackedSeries[];
};

/** One row of `/trackers/<id>/series`: every edition the tracker knows this work by. */
export type TrackedSeries = {
  id: string;
  title: string;
  source_id?: string | null;
  cover_image_id?: string | null;
  age_rating?: string | null;
  content_rating?: string | null;
  is_pornographic?: boolean;
  is_disturbing?: boolean;
};

export type SimilarOptions = {
  ratings: string[];
  languages: string[];
  uploadSource: string;
  hideDisturbing: boolean;
};

export type ManifestPage = { page_no: number; page_id: string; ext?: string | null };
export type PageManifest = { pages?: ManifestPage[] };

export type ChallengeResponse = {
  access_token: string;
  cache_url?: string | null;
  manifest?: PageManifest | null;
};

export type IntegrityResponse = { token: string; exp: number };

export const TITLE_BRACKET_REGEX = /(\([^()]*\)|\[[^[\]]*\])\s*$/;

export const CHAPTER_METADATA_REGEX = /(?:\s*\{[^{}]*\})+\s*$/;

export const CHAPTER_GROUP_REGEX =
  /^Chapter\s+.*(?:-\s*Volume\s+.*\(([^()]+)\)|\[([^[\]]+)\])\s*$/i;

export const CHAPTER_NUMBER_PREFIX_REGEX =
  /^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)\s*/i;

export const CHAPTER_VOLUME_SUFFIX_REGEX = /\s*[-–—]?\s*volumes?\s*\.?\s*\d+(?:\.\d+)?\s*$/i;

export const CHAPTER_TRAILING_GROUP_REGEX = /\s*(?:\([^()]*\)|\[[^[\]]*\])\s*$/;
