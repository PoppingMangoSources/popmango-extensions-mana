/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://kagane.to";
export const API_URL = `${BASE_URL}/api/v2`;

export const DEFAULT_CACHE_URL = BASE_URL;

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
  ExcludedTags: "excluded-tags",
  UploadSource: "upload-source",
  ShowSourceInTitle: "show-source-in-title",
  ShowEditionInTitle: "show-edition-in-title",
  CleanTitle: "clean-title",
  ShowSpoilerTags: "show-spoiler-tags",
  DataSaver: "data-saver",
  ChapterTitleMode: "chapter-title-mode",
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

export const CHAPTER_TITLE_MODE_OPTIONS: Option[] = [
  { id: "optional", title: "Title only — “Chapter 5”" },
  { id: "always", title: "Chapter + title — “Ch.5 The Duel”" },
  { id: "vol_local", title: "Volume + chapter — “Vol.1 Ch.5”" },
  { id: "vol_chapter", title: "Volume + chapter + title — “Vol.1 Ch.5 The Duel”" },
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

export type SectionSpecOption = {
  id: string;
  title: string;
  subtitle?: string;
  style: SectionStyle;
  layout: SectionLayoutKind;
  sort: string;
  limit?: number;
};

export const DISCOVER_SECTIONS: SectionSpecOption[] = [
  {
    id: "popular",
    title: "Popular",
    style: SectionStyle.SimpleHeroPaged,
    layout: SectionLayout.Hero,
    sort: SortID.TotalViews,
    limit: 10,
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
  [PreferenceID.ContentRating]: ["Safe", "Suggestive"],
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.ExcludedTags]: [] as string[],
  [PreferenceID.UploadSource]: "all",
  [PreferenceID.ShowSourceInTitle]: false,
  [PreferenceID.ShowEditionInTitle]: false,
  [PreferenceID.CleanTitle]: false,
  [PreferenceID.ShowSpoilerTags]: false,
  [PreferenceID.DataSaver]: false,
  [PreferenceID.ChapterTitleMode]: "optional",
  [PreferenceID.ContentLanguages]: ["en"],
};

export type GenreDto = { id: string; genre_name: string };
export type TagDto = { id: string; tag_name: string };

export type SourceDto = {
  source_id: string;
  source_type: string;
  title: string;
};

export type SourcesDto = { sources?: SourceDto[] };

export type LatestChapterDto = {
  book_id: string;
  title?: string | null;
  chapter_no?: string | null;
  volume_no?: string | null;
  created_at?: string | null;
  available_at?: string | null;
};

export type SeriesSummaryDto = {
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
  latest_chapters?: LatestChapterDto[];
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
  content_rating?: string | null;
  average_rating?: number | null;
  bayesian_rating?: number | null;
  total_views?: number | null;
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

export type KaganeMetadata = {
  genres: Record<string, string>;
  tags: Record<string, string>;
  sources: SourceDto[];
};

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
