/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://xcomic.me";
export const API_URL = `${BASE_URL}/query/`;

export const PAGE_SIZE = 36;
export const CHAPTER_PAGE_SIZE = 1000;
export const RECENTLY_ADDED_SIZE = 50;

export const FilterID = {
  Types: "types",
  ContentRatings: "content_ratings",
  Demographics: "demographics",
  Genres: "genres",
  Formats: "formats",
  MatchAllGenres: "match_all_genres",
  OriginalStatus: "original_status",
  UploadStatus: "upload_status",
  ChapterCount: "chapter_count",
  Year: "year",
  OriginalLanguages: "original_languages",
  TranslatedLanguages: "translated_languages",
} as const;

export const PreferenceID = {
  ContentRatings: "content-ratings",
  ContentTypes: "content-types",
  ExcludedGenres: "excluded-genres",
  Languages: "languages",
  SectionPrefix: "section",
} as const;

export const SortID = {
  Score: "field_score",
  Update: "field_update",
  Create: "field_create",
  NameAscending: "field_name_asc",
  NameDescending: "field_name_desc",
  Chapters: "field_chapter",
  Follows: "field_follow",
  Reviews: "field_review",
  Comments: "field_comment",
  ViewsTotal: "views_d000",
  Views30Days: "views_d030",
  Views7Days: "views_d007",
  Views24Hours: "views_h024",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Score, title: "Rating Score", isDefault: true },
  { id: SortID.Update, title: "Latest Update" },
  { id: SortID.Create, title: "Recently Added" },
  { id: SortID.NameAscending, title: "Name A-Z" },
  { id: SortID.NameDescending, title: "Name Z-A" },
  { id: SortID.Chapters, title: "Most Chapters" },
  { id: SortID.Follows, title: "Most Follows" },
  { id: SortID.Reviews, title: "Most Reviews" },
  { id: SortID.Comments, title: "Most Comments" },
  { id: SortID.ViewsTotal, title: "Most Views (Total)" },
  { id: "views_d360", title: "Most Views (360 Days)" },
  { id: "views_d180", title: "Most Views (180 Days)" },
  { id: "views_d090", title: "Most Views (90 Days)" },
  { id: SortID.Views30Days, title: "Most Views (30 Days)" },
  { id: SortID.Views7Days, title: "Most Views (7 Days)" },
  { id: SortID.Views24Hours, title: "Most Views (24 Hours)" },
  { id: "views_h012", title: "Most Views (12 Hours)" },
  { id: "views_h006", title: "Most Views (6 Hours)" },
  { id: "views_h001", title: "Most Views (1 Hour)" },
];

export const TYPE_OPTIONS: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "cartoon", title: "Cartoon" },
  { id: "western", title: "Western" },
  { id: "artbook", title: "Artbook" },
  { id: "imageset", title: "Imageset" },
];

export const CONTENT_RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "kodomo", title: "Kodomo" },
  { id: "silver_golden", title: "Silver & Golden" },
  { id: "non_human", title: "Non-human" },
];

export const ORIGINAL_STATUS_OPTIONS: Option[] = [
  { id: "pending", title: "Pending" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const CHAPTER_COUNT_OPTIONS: Option[] = [
  { id: "1", title: "1+" },
  { id: "10", title: "10+" },
  { id: "20", title: "20+" },
  { id: "30", title: "30+" },
  { id: "50", title: "50+" },
  { id: "100", title: "100+" },
  { id: "200", title: "200+" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh", title: "Chinese" },
  { id: "es", title: "Spanish" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "pt", title: "Portuguese" },
  { id: "ru", title: "Russian" },
  { id: "id", title: "Indonesian" },
  { id: "vi", title: "Vietnamese" },
  { id: "th", title: "Thai" },
];

export const SectionID = {
  TopRated: "top_rated",
  Views24Hours: "views_24h",
  Views7Days: "views_7d",
  ViewsTotal: "views_total",
  LatestUploads: "latest_uploads",
  RecentlyAdded: "recently_added",
} as const;

/** A home row is the browse query under one sort, except the two that have endpoints. */
export type DiscoverSection = PageSectionSpec & { sort?: string };

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: SectionID.TopRated,
    title: "Top Rated",
    subtitle: "The site's highest scored",
    style: SectionStyle.SimpleHeroPaged,
    sort: SortID.Score,
  },
  {
    id: SectionID.Views24Hours,
    title: "Most Views Today",
    style: SectionStyle.DetailedDoubleRowPaged,
    sort: SortID.Views24Hours,
  },
  {
    id: SectionID.Views7Days,
    title: "Most Views This Week",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.Views7Days,
  },
  {
    id: SectionID.ViewsTotal,
    title: "Most Views All Time",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.ViewsTotal,
  },
  {
    id: SectionID.LatestUploads,
    title: "Latest Uploads",
    subtitle: "Fresh chapters as they land",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.RecentlyAdded,
    title: "Recently Added",
    style: SectionStyle.SimpleSingleRow,
  },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];
export const DEFAULT_CONTENT_TYPES = TYPE_OPTIONS.map((option) => option.id);

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.ContentRatings]: DEFAULT_CONTENT_RATINGS,
  [PreferenceID.ContentTypes]: DEFAULT_CONTENT_TYPES,
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.Languages]: ["en"],
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  ),
};

/** Genres the site files under a rating, used to infer one for a listing. */
export const CONTENT_RATING_GENRES: Record<string, readonly string[]> = {
  suggestive: ["ecchi", "mature", "yaoi", "yuri"],
  erotica: ["adult", "erotica", "smut"],
  pornographic: ["hentai", "pornographic"],
};

export const BROWSE_QUERY = `
query get_comic_browse_items($select: Comic_Browse_Select) {
  get_comic_browse_items(select: $select) {
    data {
      id name altNames urlPath urlCover
      translatedLanguage type contentRating genres tags
      summary { html }
      chapterNodes_last(amount: 1) { data { serial chaNum } }
    }
  }
}`;

export const LATEST_UPLOADS_QUERY = `
query get_comic_latestUploads($select: Comic_LatestUploads_Select) {
  get_comic_latestUploads(select: $select) {
    items {
      comic { data { id name urlPath urlCover translatedLanguage type contentRating genres tags } }
      chapters(amount: 1) { data { id serial chaNum urlPath dateCreate dateModify datePublic } }
    }
  }
}`;

export const RECENTLY_ADDED_QUERY = `
query get_comic_recentlyAdded($select: Comic_RecentlyAdded_Select) {
  get_comic_recentlyAdded(select: $select) {
    items { data { id name urlPath urlCover translatedLanguage type contentRating genres tags } }
  }
}`;

export const COMIC_QUERY = `
query get_comicNode($id: ID!) {
  get_comicNode(id: $id) {
    data {
      id name altNames
      originalLanguage translatedLanguage
      originalStatus uploadStatus
      type demographics contentRating genres tags
      authorNodes { data { name } }
      artistNodes { data { name } }
      publisherNodes { data { name } }
      summary { html }
      urlPath urlCover
      score_val follows chaps_normal
    }
  }
}`;

export const CHAPTERS_QUERY = `
query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
  get_comic_chapterList_uniqList(select: $select) {
    items {
      data {
        id serial chaNum dname title urlPath
        dateCreate dateModify datePublic
        srcName
        groupNodes { data { name } }
        userNode { data { name } }
      }
    }
  }
}`;

export const CHAPTER_PAGES_QUERY = `
query get_chapterNode($id: ID!) {
  get_chapterNode(id: $id) { data { imageUrls } }
}`;

export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export type NamedNode = { data?: { name?: string | null } | null };

export type ComicData = {
  id: string;
  name: string;
  altNames?: string[] | null;
  urlPath?: string | null;
  urlCover?: string | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  originalStatus?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  authorNodes?: NamedNode[] | null;
  artistNodes?: NamedNode[] | null;
  publisherNodes?: NamedNode[] | null;
  summary?: { html?: string | null } | null;
  score_val?: number | null;
  follows?: number | null;
  chaps_normal?: number | null;
  chapterNodes_last?: { data?: ChapterData | null }[] | null;
};

export type ChapterData = {
  id: string;
  serial?: number | null;
  chaNum?: number | string | null;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | string | null;
  dateModify?: number | string | null;
  datePublic?: number | string | null;
  srcName?: string | null;
  groupNodes?: NamedNode[] | null;
  userNode?: NamedNode | null;
};

export type BrowseResponse = { get_comic_browse_items?: { data?: ComicData[] | null } | null };

export type LatestUploadsResponse = {
  get_comic_latestUploads?: {
    items?: { comic?: { data?: ComicData | null } | null; chapters?: { data: ChapterData }[] }[];
  } | null;
};

export type RecentlyAddedResponse = {
  get_comic_recentlyAdded?: { items?: { data?: ComicData | null }[] } | null;
};

export type ComicNodeResponse = { get_comicNode?: { data?: ComicData | null } | null };

export type ChapterListResponse = {
  get_comic_chapterList_uniqList?: { items?: { data: ChapterData }[] } | null;
};

export type ChapterPagesResponse = {
  get_chapterNode?: { data?: { imageUrls?: string[] | null } | null } | null;
};

/** The `select` object the browse query takes; every field is sent, nulls included. */
export type BrowseSelect = {
  where: "browse";
  page: number;
  size: number;
  init: number;
  sortby: string;
  word: string;
  incOLangs: string[];
  incTLangs: string[];
  incGenres: string[];
  excGenres: string[];
  incGenresMode: string | null;
  excGenresMode: string | null;
  incTypes: string[];
  incDemographics: string[];
  incContentRatings: string[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
  origStatus: string | null;
  siteStatus: string | null;
  chapCount: string | null;
  ignoreGlobalULangs: boolean;
  ignoreGlobalGenres: boolean;
  ignoreGlobalBlocks: boolean;
};
