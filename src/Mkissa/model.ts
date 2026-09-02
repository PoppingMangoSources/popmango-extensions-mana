/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export type DiscoverSection = PageSectionSpec & { limit?: number };

export const BASE_URL = "https://mkissa.to";
// The site answers on both names; the signing bootstrap is tried on each in turn.
export const MIRROR_HOSTS = ["mkissa.to", "allmanga.to"];
export const API_URL = "https://api.allanime.day/api";

export const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
export const IMAGE_CDN = "https://wp.youtube-anime.com";
export const DEFAULT_IMAGE_SERVER = "https://ytimgf.youtube-anime.com/";

export const PAGE_SIZE = 20;

// Bump when the site rotates its reader bundle.
export const BUILD_ID = "13";
export const TS_BUCKET_MS = 5 * 60 * 1000;
export const SIGNING_PART_A = "f5dc46e6f42968c5ed0eab602d6ae8f2107991006f02876947e64fcb75d53da6";

export const FilterID = {
  Country: "country",
  Genres: "genres",
} as const;

export const PreferenceID = {
  ImageQuality: "image-quality",
  ShowAdult: "show-adult",
  SectionPrefix: "section",
} as const;

export const SortID = {
  Update: "update",
  NameAscending: "Name_ASC",
  NameDescending: "Name_DESC",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Update, title: "Update", isDefault: true },
  { id: SortID.NameAscending, title: "Name Ascending" },
  { id: SortID.NameDescending, title: "Name Descending" },
];

export const COUNTRY_OPTIONS: Option[] = [
  { id: "ALL", title: "All" },
  { id: "JP", title: "Japan" },
  { id: "CN", title: "China" },
  { id: "KR", title: "Korea" },
];

export const IMAGE_QUALITY_OPTIONS: Option[] = [
  { id: "original", title: "Original" },
  { id: "800", title: "Wp-800" },
  { id: "480", title: "Wp-480" },
];

export const SectionID = {
  Popular: "popular",
  PopularWeek: "popular_week",
  PopularMonth: "popular_month",
  Latest: "latest",
  Recommended: "recommended",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: SectionID.Popular,
    title: "Popular",
    subtitle: "The most read titles on the site",
    style: SectionStyle.SimpleHeroPaged,
    limit: 10,
  },
  {
    id: SectionID.PopularWeek,
    title: "Popular This Week",
    subtitle: "Climbing over the last seven days",
    style: SectionStyle.DetailedDoubleRowPaged,
  },
  {
    id: SectionID.PopularMonth,
    title: "Popular This Month",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: SectionID.Latest,
    title: "Latest Updates",
    subtitle: "Your daily dose of new chapters",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.Recommended,
    title: "Recommended",
    subtitle: "A fresh handful every visit",
    style: SectionStyle.SimpleSingleRow,
  },
];

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ImageQuality]: "original",
  [PreferenceID.ShowAdult]: false,
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  ),
};

export const GENRES = [
  "4 Koma",
  "Action",
  "Adult",
  "Adventure",
  "Cars",
  "Comedy",
  "Cooking",
  "Crossdressing",
  "Dementia",
  "Demons",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Gyaru",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Loli",
  "Magic",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Medical",
  "Military",
  "Monster Girls",
  "Music",
  "Mystery",
  "One Shot",
  "Parody",
  "Police",
  "Post Apocalyptic",
  "Psychological",
  "Reincarnation",
  "Reverse Harem",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shota",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Tragedy",
  "Unknown",
  "Vampire",
  "Webtoons",
  "Yaoi",
  "Youkai",
  "Yuri",
  "Zombies",
];

export function genreId(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_");
}

export const GENRE_OPTIONS: Option[] = GENRES.map((name) => ({ id: genreId(name), title: name }));

export const GENRE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  GENRES.map((name) => [genreId(name), name]),
);

export const POPULAR_QUERY = `query($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
  queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
    recommendations {
      anyCard { _id name thumbnail englishName nativeName score availableChapters }
      pageStatus { views }
    }
  }
}`;

export const RANDOM_QUERY = `query($format: String!, $allowAdult: Boolean) {
  queryRandomRecommendation(format: $format, allowAdult: $allowAdult) {
    _id name thumbnail englishName
  }
}`;

export const SEARCH_QUERY = `query($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName }
  }
}`;

export const LATEST_QUERY = `query($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName availableChapters availableChaptersDetail lastChapterDate }
  }
}`;

export const DETAILS_QUERY = `query($id: String!) {
  manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName }
}`;

export const CHAPTERS_QUERY = `query($id: String!, $showId: String!) {
  manga(_id: $id) { _id name availableChaptersDetail }
  episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) { episodeIdNum notes uploadDates }
}`;

// `manga` must be selected or chapterPages resolves to null.
export const PAGES_QUERY = `query($mangaId: String!, $translationType: VaildTranslationTypeMangaEnumType!, $chapterString: String!, $limit: Int!, $offset: Int) {
  chapterPages(mangaId: $mangaId, translationType: $translationType, chapterString: $chapterString, limit: $limit, offset: $offset) {
    edges { pictureUrlHead pictureUrls }
    manga { _id countryOfOrigin }
  }
}`;

export type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export type DateParts = {
  year?: number | null;
  month?: number | null;
  date?: number | null;
  hour?: number | null;
  minute?: number | null;
  second?: number | null;
};

export type MangaCard = {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
  nativeName?: string | null;
  score?: number | null;
  availableChapters?: { sub?: number | null } | null;
  availableChaptersDetail?: AvailableChaptersDetail | null;
  lastChapterDate?: { sub?: DateParts | null } | null;
};

export type PopularResponse = {
  queryPopular: {
    recommendations: {
      anyCard?: MangaCard | null;
      pageStatus?: { views?: string | null } | null;
    }[];
  };
};

export type SearchResponse = { mangas: { edges: MangaCard[] } };

export type RandomResponse = { queryRandomRecommendation?: MangaCard[] | null };

export type MangaDetail = {
  _id: string;
  name: string;
  thumbnail?: string | null;
  description?: string | null;
  authors?: string[] | null;
  genres?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  altNames?: string[] | null;
  englishName?: string | null;
};

export type DetailsResponse = { manga: MangaDetail };

export type AvailableChaptersDetail = { sub?: string[] };

export type EpisodeInfo = {
  episodeIdNum: number | string;
  notes?: string | null;
  uploadDates?: { sub?: string | null } | null;
};

export type ChaptersResponse = {
  manga: { _id: string; name: string; availableChaptersDetail?: AvailableChaptersDetail | null };
  episodeInfos?: EpisodeInfo[] | null;
};

export type PictureUrl = string | { url?: string | null };

export type ChapterPageEdge = {
  pictureUrlHead?: string | null;
  pictureUrls?: PictureUrl[] | null;
};

export type PagesResponse = { chapterPages?: { edges: ChapterPageEdge[] } | null };

export type SigningBootstrap = { epoch: number; partB: string; switchAt: number };

export type SearchBodyOptions = {
  query?: string;
  sort?: string;
  country: string;
  includedGenres: string[];
  excludedGenres: string[];
  showAdult: boolean;
};
