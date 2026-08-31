/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://kagane.to";
export const API_URL = `${BASE_URL}/api/v2`;

/** The cache host used when a challenge response does not name one. */
export const DEFAULT_CACHE_URL = BASE_URL;

/** The site's own page size for a search request. */
export const PAGE_SIZE = 35;

export const FilterID = {
  Sort: "sort",
  ContentRating: "content_rating",
  Format: "format",
  Status: "upload_status",
  Genres: "genres",
  MatchAllGenres: "match_all_genres",
  Tags: "tags",
  MatchAllTags: "match_all_tags",
  Sources: "source_id",
} as const;

export const PreferenceID = {
  ContentRating: "content-rating",
  ExcludedGenres: "excluded-genres",
  PopularTimeSpan: "popular-time-span",
  UploadSource: "upload-source",
  ShowSourceInTitle: "show-source-in-title",
  ShowEditionInTitle: "show-edition-in-title",
  CleanTitle: "clean-title",
  ShowSpoilerTags: "show-spoiler-tags",
  DataSaver: "data-saver",
  ChapterTitleMode: "chapter-title-mode",
  ContentLanguages: "content-languages",
} as const;

/**
 * Sort ids are the API's own `sort` values. The app appends the direction, so
 * these are stored bare and `,desc` is added when the reader picks descending.
 */
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
  { id: SortID.Relevance, title: "Relevance", isDefault: true, isOrderable: false },
  { id: SortID.TotalViews, title: "Popular (Total Views)", isOrderable: true },
  { id: SortID.AverageViews, title: "Popular (Average Views)", isOrderable: true },
  { id: SortID.ViewsToday, title: "Popular (Today)", isOrderable: true },
  { id: SortID.ViewsWeek, title: "Popular (Week)", isOrderable: true },
  { id: SortID.ViewsMonth, title: "Popular (Month)", isOrderable: true },
  { id: SortID.Updated, title: "Latest", isOrderable: true },
  { id: SortID.Name, title: "By Name", isOrderable: true },
  { id: SortID.BooksCount, title: "Books Count", isOrderable: true },
  { id: SortID.Created, title: "Created At", isOrderable: true },
];

/** Ordered least to most explicit; the settings screen offers all four. */
export const CONTENT_RATINGS = ["Safe", "Suggestive", "Erotica", "Pornographic"];

export const CONTENT_RATING_OPTIONS: Option[] = CONTENT_RATINGS.map((rating) => ({
  id: rating,
  title: rating,
}));

export const FORMAT_OPTIONS: Option[] = ["Manga", "Manhwa", "Manhua", "Comic", "Other"].map(
  (format) => ({ id: format, title: format }),
);

/** The API's own wording — "Abandoned" is what it calls a cancelled series. */
export const STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Abandoned", title: "Cancelled" },
];

export const UPLOAD_SOURCE_OPTIONS: Option[] = [
  { id: "all", title: "All uploads" },
  { id: "official", title: "Official only" },
  { id: "scanlations", title: "Scanlations only" },
];

export const POPULAR_TIME_SPAN_OPTIONS: Option[] = [
  { id: "today", title: "Today" },
  { id: "week", title: "This Week" },
  { id: "month", title: "This Month" },
  { id: "allTime", title: "All Time" },
];

/** Which sort backs the "Popular" row, per the time-span setting. */
export const POPULAR_SORT_BY_SPAN: Record<string, string> = {
  today: SortID.ViewsToday,
  week: SortID.ViewsWeek,
  month: SortID.ViewsMonth,
  allTime: SortID.TotalViews,
};

export const CHAPTER_TITLE_MODE_OPTIONS: Option[] = [
  { id: "optional", title: "Title only — “Ch.5”" },
  { id: "always", title: "Chapter + title — “Ch.5 The Duel”" },
  { id: "vol_local", title: "Volume + chapter — “Vol.1 Ch.5”" },
  { id: "vol_chapter", title: "Volume + chapter + title — “Vol.1 Ch.5 The Duel”" },
];

/**
 * The catalog spans many languages. Only the common ones are offered; the
 * filter is a plain list of the API's own `content_lang` codes.
 */
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

export type SectionSpecOption = {
  id: string;
  title: string;
  subtitle?: string;
  style: SectionStyle;
  /** The API sort backing the row; `undefined` means "read it from settings". */
  sort?: string;
  limit?: number;
};

export const DISCOVER_SECTIONS: SectionSpecOption[] = [
  {
    id: "popular",
    title: "Popular",
    subtitle: "The most-read titles right now",
    style: SectionStyle.SimpleHeroPaged,
    limit: 10,
  },
  {
    id: "latest_updates",
    title: "Latest Updates",
    subtitle: "Your daily dose of the latest updates",
    style: SectionStyle.DetailedVerticalListGrouped,
    sort: SortID.Updated,
  },
  {
    id: "newly_added",
    title: "Newly Added",
    subtitle: "Fresh in the catalog",
    style: SectionStyle.SimpleDoubleRow,
    sort: SortID.Created,
  },
  {
    id: "popular_today",
    title: "Popular Today",
    style: SectionStyle.SimpleHero,
    sort: SortID.ViewsToday,
    limit: 10,
  },
  {
    id: "popular_week",
    title: "Popular This Week",
    style: SectionStyle.SimpleDoubleRow,
    sort: SortID.ViewsWeek,
    limit: 10,
  },
  {
    id: "popular_month",
    title: "Popular This Month",
    style: SectionStyle.SimpleDoubleRow,
    sort: SortID.ViewsMonth,
    limit: 10,
  },
  {
    id: "popular_all_time",
    title: "Popular All Time",
    style: SectionStyle.DetailedSingleRowPaged,
    sort: SortID.TotalViews,
    limit: 20,
  },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.ContentRating]: ["Safe", "Suggestive"],
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.PopularTimeSpan]: "week",
  [PreferenceID.UploadSource]: "all",
  [PreferenceID.ShowSourceInTitle]: false,
  [PreferenceID.ShowEditionInTitle]: false,
  [PreferenceID.CleanTitle]: false,
  [PreferenceID.ShowSpoilerTags]: false,
  [PreferenceID.DataSaver]: false,
  [PreferenceID.ChapterTitleMode]: "optional",
  [PreferenceID.ContentLanguages]: ["en"],
};

// ── API shapes ─────────────────────────────────────────────────────────────

export type GenreDto = { id: string; genre_name: string };
export type TagDto = { id: string; tag_name: string };

export type SourceDto = {
  source_id: string;
  /** "Official", "Unofficial" or "Mixed". */
  source_type: string;
  title: string;
};

export type SourcesDto = { sources?: SourceDto[] };

export type SeriesSummaryDto = {
  series_id: string;
  title: string;
  source_id?: string | null;
  current_books?: number;
  start_year?: number | null;
  cover_image_id?: string | null;
  alternate_titles?: string[];
};

export type SearchDto = {
  content?: SeriesSummaryDto[];
  last?: boolean;
  total_elements?: number;
  total_pages?: number;
};

export type ChapterBookDto = {
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

export type DetailsDto = {
  title: string;
  description?: string | null;
  upload_status?: string;
  format?: string | null;
  source_id?: string | null;
  series_staff?: { name: string; role: string }[];
  genres?: { genre_name: string }[];
  tags?: { tag_name: string; spoiler?: boolean }[];
  series_alternate_titles?: { title: string; label?: string | null }[];
  series_books?: ChapterBookDto[];
  edition_info?: string | null;
  tracker_id?: string | null;
  series_covers?: { image_id: string }[];
};

export type TrackerDto = {
  book_series?: {
    id: string;
    title: string;
    source_id?: string | null;
    cover_image_id?: string | null;
  }[];
};

export type PageDto = { page_no: number; page_id: string; ext?: string | null };
export type ManifestDto = { pages?: PageDto[] };

export type ChallengeDto = {
  access_token: string;
  cache_url?: string | null;
  manifest?: ManifestDto | null;
};

export type IntegrityDto = { token: string; exp: number };

/** Genres and tags the search form and settings are built from. */
export type KaganeMetadata = {
  /** id → display name */
  genres: Record<string, string>;
  /** id → display name */
  tags: Record<string, string>;
  sources: SourceDto[];
};

/**
 * Formats whose own chapter numbering is trustworthy. For everything else the
 * API's `sort_no` is a position in the series, not a chapter number.
 */
export const SOURCE_CHAPTER_NUMBER_FORMATS = new Set([
  "Dark Horse Comics",
  "Flame Comics",
  "MangaDex",
  "Square Enix Manga",
]);

/** A trailing "(...)" or "[...]" the reader can opt to strip from a title. */
export const TITLE_BRACKET_REGEX = /(\([^()]*\)|\[[^[\]]*\])\s*$/;

/** Trailing "{...}" metadata the site appends to a chapter title. */
export const CHAPTER_METADATA_REGEX = /(?:\s*\{[^{}]*\})+\s*$/;

/** A scanlation group named inside a chapter title. */
export const CHAPTER_GROUP_REGEX =
  /^Chapter\s+.*(?:-\s*Volume\s+.*\(([^()]+)\)|\[([^[\]]+)\])\s*$/i;
