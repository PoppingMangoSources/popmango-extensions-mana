/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://kagane.to";
export const API_URL = `${BASE_URL}/api/v2`;

export const DEFAULT_CACHE_URL = BASE_URL;

// The size the site's own rows ask for.
export const PAGE_SIZE = 50;

export const FilterID = {
  Sort: "sort",
  ContentRating: "content_rating",
  Format: "format",
  Status: "upload_status",
  Genres: "genres",
  MatchAllGenres: "match_all_genres",
  Tags: "tags",
  TagQuery: "tag_query",
  MatchAllTags: "match_all_tags",
  Sources: "source_id",
  ExactMatch: "exact_match",
} as const;

export const PreferenceID = {
  // Renamed once, on purpose: the old key holds a saved "Safe and Suggestive" that is
  // indistinguishable from the old default, and that default was the bug. A new key lets
  // the corrected default reach installs that already have the old one written.
  ContentRating: "content-rating-all",
  ExcludedGenres: "excluded-genres",
  ExcludedTags: "excluded-tags",
  UploadSource: "upload-source",
  ShowSourceInTitle: "show-source-in-title",
  ShowEditionInTitle: "show-edition-in-title",
  CleanTitle: "clean-title",
  ShowSpoilerTags: "show-spoiler-tags",
  DataSaver: "data-saver",
  ContentLanguages: "content-languages",
} as const;

export const SortID = {
  Relevance: "",
  TotalViews: "total_views",
  AverageViews: "avg_views",
  ViewsToday: "avg_views_today",
  ViewsWeek: "avg_views_week",
  ViewsMonth: "avg_views_month",
  Updated: "updated_at",
  Name: "series_name",
  BooksCount: "books_count",
  Created: "created_at",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Relevance", isDefault: true },
  { id: SortID.TotalViews, title: "Popular (Total Views)" },
  { id: SortID.AverageViews, title: "Popular (Average Views)" },
  { id: SortID.ViewsToday, title: "Popular (Today)" },
  { id: SortID.ViewsWeek, title: "Popular (Week)" },
  { id: SortID.ViewsMonth, title: "Popular (Month)" },
  { id: SortID.Updated, title: "Latest" },
  { id: SortID.Name, title: "By Name" },
  { id: SortID.BooksCount, title: "Books Count" },
  { id: SortID.Created, title: "Created At" },
];

export const CONTENT_RATINGS = ["Safe", "Suggestive", "Erotica", "Pornographic"];

export const CONTENT_RATING_OPTIONS: Option[] = CONTENT_RATINGS.map((rating) => ({
  id: rating,
  title: rating,
}));

export const FORMAT_OPTIONS: Option[] = ["Manga", "Manhwa", "Manhua", "Comic", "Other"].map(
  (format) => ({ id: format, title: format }),
);

export const STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  // "Abandoned" is the API's word for cancelled.
  { id: "Abandoned", title: "Cancelled" },
];

export const UPLOAD_SOURCE_OPTIONS: Option[] = [
  { id: "all", title: "All uploads" },
  { id: "official", title: "Official only" },
  { id: "scanlations", title: "Scanlations only" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh-Hans", title: "Chinese (Simplified)" },
  { id: "zh-Hant", title: "Chinese (Traditional)" },
  { id: "es", title: "Spanish" },
  { id: "es-419", title: "Spanish (Latin America)" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "it", title: "Italian" },
  { id: "pt", title: "Portuguese" },
  { id: "pt-BR", title: "Portuguese (Brazil)" },
  { id: "ru", title: "Russian" },
  { id: "pl", title: "Polish" },
  { id: "tr", title: "Turkish" },
  { id: "ar", title: "Arabic" },
  { id: "id", title: "Indonesian" },
  { id: "th", title: "Thai" },
  { id: "vi", title: "Vietnamese" },
];

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
    title: "Popular",
    style: SectionStyle.SimpleHeroPaged,
    layout: SectionLayout.Hero,
    // All-time, by cumulative views. The averaged sorts read as a monthly chart.
    sort: SortID.TotalViews,
  },
  {
    id: "trending_month",
    title: "Trending This Month",
    style: SectionStyle.DetailedDoubleRowPaged,
    layout: SectionLayout.Detailed,
    sort: SortID.ViewsMonth,
  },
  {
    id: "trending_week",
    title: "Trending This Week",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Detailed,
    sort: SortID.ViewsWeek,
  },
  {
    id: "trending_today",
    title: "Trending Today",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Detailed,
    sort: SortID.ViewsToday,
  },
  {
    id: "latest_updates",
    title: "Latest Updates",
    style: SectionStyle.DetailedVerticalListGrouped,
    layout: SectionLayout.ChapterUpdates,
    sort: SortID.Updated,
  },
  {
    id: "recently_added",
    title: "Recently Added",
    style: SectionStyle.SimpleSingleRow,
    layout: SectionLayout.Detailed,
    sort: SortID.Created,
  },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  // Every rung the site publishes. Narrowing this here hid editions of a title that the
  // site itself returns — a second scanlation of the same series rated a rung higher than
  // the first simply vanished from search. The app's own content setting is the place that
  // decision belongs, and it is applied on top of this.
  [PreferenceID.ContentRating]: [...CONTENT_RATINGS],
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.ExcludedTags]: [] as string[],
  [PreferenceID.UploadSource]: "all",
  [PreferenceID.ShowSourceInTitle]: false,
  [PreferenceID.ShowEditionInTitle]: false,
  [PreferenceID.CleanTitle]: false,
  [PreferenceID.ShowSpoilerTags]: false,
  [PreferenceID.DataSaver]: false,
  [PreferenceID.ContentLanguages]: ["en"],
};

export type GenreEntry = { id: string; genre_name: string };
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
  content_rating?: string | null;
  format?: string | null;
  publication_status?: string | null;
  translated_language?: string | null;
  genres?: string[];
  latest_chapters?: LatestChapter[];
};

export type SearchResponse = {
  content?: SeriesSummary[];
  last?: boolean;
  total_elements?: number;
  total_pages?: number;
};

export type ChapterBook = {
  book_id: string;
  series_id?: string | null;
  title: string;
  created_at?: string | null;
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
  genres?: { genre_name: string }[];
  tags?: { tag_name: string; spoiler?: boolean }[];
  series_alternate_titles?: { title: string; label?: string | null }[];
  series_books?: ChapterBook[];
  edition_info?: string | null;
  tracker_id?: string | null;
  series_covers?: { image_id: string }[];
  content_rating?: string | null;
  average_rating?: number | null;
  bayesian_rating?: number | null;
  total_views?: number | null;
};

export type TrackerResponse = {
  book_series?: {
    id: string;
    title: string;
    source_id?: string | null;
    cover_image_id?: string | null;
  }[];
};

export type ManifestPage = { page_no: number; page_id: string; ext?: string | null };
export type PageManifest = { pages?: ManifestPage[] };

export type ChallengeResponse = {
  access_token: string;
  cache_url?: string | null;
  manifest?: PageManifest | null;
};

export type IntegrityResponse = { token: string; exp: number };

export const SOURCE_CHAPTER_NUMBER_FORMATS = new Set([
  "Dark Horse Comics",
  "Flame Comics",
  "MangaDex",
  "Square Enix Manga",
]);

export const TITLE_BRACKET_REGEX = /(\([^()]*\)|\[[^[\]]*\])\s*$/;

export const CHAPTER_METADATA_REGEX = /(?:\s*\{[^{}]*\})+\s*$/;

export const CHAPTER_GROUP_REGEX =
  /^Chapter\s+.*(?:-\s*Volume\s+.*\(([^()]+)\)|\[([^[\]]+)\])\s*$/i;

export const CHAPTER_NUMBER_PREFIX_REGEX =
  /^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)\s*/i;

export const CHAPTER_VOLUME_SUFFIX_REGEX = /\s*[-–—]?\s*volumes?\s*\.?\s*\d+(?:\.\d+)?\s*$/i;

export const CHAPTER_TRAILING_GROUP_REGEX = /\s*(?:\([^()]*\)|\[[^[\]]*\])\s*$/;
