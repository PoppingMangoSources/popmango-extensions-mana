/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://flamecomics.xyz";
export const CDN_URL = "https://cdn.flamecomics.xyz";

// Only used if the build id cannot be read off the homepage; it goes stale on redeploy.
export const FALLBACK_BUILD_ID = "FSAQN1WFneGAAio7sG9-F";

// The site rotates its build id only on redeploy.
export const BUILD_ID_TTL_MS = 6 * 60 * 60 * 1000;
export const PAYLOAD_TTL_MS = 60_000;

export const PAGE_SIZE = 30;

export const FilterID = {
  Categories: "categories",
  MatchAllCategories: "match_all_categories",
  Types: "types",
  Status: "status",
  Publisher: "publisher",
  Author: "author",
  Artist: "artist",
  Year: "year",
  Language: "language",
  Country: "country",
} as const;

export const PreferenceID = {
  SectionPrefix: "section",
} as const;

export const SortID = {
  Latest: "latest",
  TitleAscending: "title_asc",
  TitleDescending: "title_desc",
  Likes: "likes",
  Year: "year",
  Random: "random",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest Update", isDefault: true },
  { id: SortID.TitleAscending, title: "Title ↑" },
  { id: SortID.TitleDescending, title: "Title ↓" },
  { id: SortID.Likes, title: "Most Liked" },
  { id: SortID.Year, title: "Year" },
  { id: SortID.Random, title: "Random" },
];

export const SectionID = {
  Popular: "popular",
  StaffPicks: "staff_picks",
  Latest: "latest",
  Featured: "featured",
} as const;

export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Popular,
    title: "Popular",
    subtitle: "What the site is putting forward",
    style: SectionStyle.SimpleHeroPaged,
  },
  {
    id: SectionID.StaffPicks,
    title: "Staff Picks",
    subtitle: "Chosen by the people who run the site",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: SectionID.Latest,
    title: "Latest Updates",
    subtitle: "Fresh chapters as they land",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.Featured,
    title: "Featured",
    subtitle: "The site's own front-page carousel",
    style: SectionStyle.SimpleSingleRow,
  },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> =
  Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  );

/** A series as the listing endpoints return it; the shape varies slightly per endpoint. */
export type SeriesListItem = {
  series_id: number;
  novel_id?: number | null;
  title: string;
  description?: string;
  language?: string;
  type?: string;
  categories?: string[];
  tags?: string[];
  country?: string;
  author?: string[];
  artist?: string[];
  publisher?: string[];
  year?: number;
  status?: string;
  likes?: number;
  cover: string;
  last_edit: number;
  updated?: number;
  time?: number;
  chapters?: ChapterListItem[];
};

export type ChapterListItem = {
  series_id: number;
  chapter: string;
  title?: string;
  language?: string;
  release_date: number;
  token: string;
};

export type HomepageBlock = {
  title: string;
  showChapters?: boolean;
  carousel?: boolean;
  series: SeriesListItem[];
};

export type CarouselSlide = {
  series_id: number | null;
  novel_id?: number | null;
  title: string;
  image: string;
  categories?: string[];
  link?: string | null;
};

export type HomepageResponse = {
  pageProps: {
    popularEntries: { blocks: HomepageBlock[] };
    latestEntries: { blocks: HomepageBlock[] };
    staffPicks: { blocks: HomepageBlock[] };
    carousel?: CarouselSlide[];
  };
};

export type BrowseResponse = {
  pageProps: {
    series: SeriesListItem[];
  };
};

export type SeriesDetail = {
  series_id: number;
  title: string;
  altTitles?: string[];
  description?: string;
  language?: string;
  type?: string;
  tags?: string[];
  country?: string;
  author?: string[];
  artist?: string[];
  publisher?: string[];
  year?: number;
  status?: string;
  likes?: number;
  cover: string;
  last_edit: number;
};

export type ChapterDetail = {
  chapter_id: number;
  series_id: number;
  chapter: string;
  title?: string;
  release_date: number;
  token: string;
};

export type SeriesDetailResponse = {
  pageProps: { series: SeriesDetail; chapters: ChapterDetail[] };
};

export type ChapterImage = { name: string };

export type ChapterReaderResponse = {
  pageProps: {
    chapter: {
      series_id: number;
      token: string;
      images: Record<string, ChapterImage>;
    };
  };
};

/** The advanced-search choices, resolved from the form before filtering runs locally. */
export type SearchCriteria = {
  query: string;
  includedCategories: string[];
  excludedCategories: string[];
  matchAllCategories: boolean;
  types: string[];
  status: string[];
  includedPublishers: string[];
  excludedPublishers: string[];
  includedAuthors: string[];
  excludedAuthors: string[];
  includedArtists: string[];
  excludedArtists: string[];
  years: string[];
  language: string;
  country: string;
  sort: string;
};
