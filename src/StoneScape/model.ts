/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://stonescape.xyz";
export const API_URL = `${BASE_URL}/api`;

/** What `/api/series` hands back per page, and what the listings ask for. */
export const PAGE_SIZE = 24;

/** The genre list changes as the site adds one; a day-old copy is still a usable form. */
export const GENRE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Only the comic half of the catalogue is offered. The site also publishes novels, whose
 * chapters are HTML text, and a Mana chapter is a list of images with no text form — a
 * novel would list here and then open to nothing.
 */
export const CONTENT_TYPE = "manhwa";

export const FilterID = {
  Status: "status",
  Genres: "genres",
} as const;

export const SortID = {
  Latest: "latest",
  PopularMonth: "popular_month",
  PopularYear: "popular_year",
  Title: "title",
  TitleDescending: "title_desc",
} as const;

export const SectionID = {
  Featured: "featured",
  PopularWeek: "popular_week",
  PopularMonth: "popular_month",
  PopularYear: "popular_year",
  Latest: "latest",
} as const;

export const PreferenceID = {
  ShowLockedChapters: "show-locked-chapters",
  SectionPrefix: "section",
} as const;

// A picker cannot be cleared once set, so it opens with its own "any" row rather than
// relying on nothing being chosen.
export const STATUS_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

/**
 * Stands in when `/api/genres` cannot be read, so the filter form still opens. The site is
 * the authority on its own slugs — this list is only a fallback and is replaced by the
 * live one on the first successful read.
 */
export const BUNDLED_GENRES: Option[] = [
  { id: "action", title: "Action" },
  { id: "adaptation", title: "Adaptation" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "demons", title: "Demons" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gore", title: "Gore" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "magic", title: "Magic" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "military", title: "Military" },
  { id: "monsters", title: "Monsters" },
  { id: "mystery", title: "Mystery" },
  { id: "post-apocalyptic", title: "Post-Apocalyptic" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "thriller", title: "Thriller" },
  { id: "tragedy", title: "Tragedy" },
  { id: "video-games", title: "Video Games" },
  { id: "webtoons", title: "Webtoons" },
  { id: "wuxia", title: "Wuxia" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

/**
 * The site sorts one way per option and answers an ascending request with the same order,
 * so none of these are offered as orderable — A–Z and Z–A are separate options instead,
 * which is how the site itself presents them.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest", isDefault: true, isOrderable: false },
  { id: SortID.PopularMonth, title: "Popular This Month", isOrderable: false },
  { id: SortID.PopularYear, title: "Popular This Year", isOrderable: false },
  { id: SortID.Title, title: "A–Z", isOrderable: false },
  { id: SortID.TitleDescending, title: "Z–A", isOrderable: false },
];

/**
 * The site's front page, with its popular strip opened out. That strip is a set of
 * week/month/year tabs, and a tab costs a tap to discover, so each period gets its own row.
 *
 * The year leads as the hero: it is the steadiest of the three — a year's reading moves too
 * slowly to churn — so the biggest slot on the page holds the same well-regarded titles for
 * weeks rather than reshuffling on a day's traffic.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.PopularYear,
    title: "Popular This Year",
    subtitle: "The catalogue's best read of the year",
    style: SectionStyle.SimpleHeroPaged,
  },
  {
    id: SectionID.PopularWeek,
    title: "Popular This Week",
    subtitle: "Most read over the last seven days",
    style: SectionStyle.DetailedDoubleRowPaged,
  },
  {
    id: SectionID.PopularMonth,
    title: "Popular This Month",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: SectionID.Latest,
    title: "Latest Releases",
    subtitle: "Fresh chapters as they land",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.Featured,
    title: "Featured",
    subtitle: "The site's own front-page carousel",
    style: SectionStyle.SimpleSingleRow,
    // The banner is a hand-picked set with no listing behind it.
    viewMore: false,
  },
];

/** Which rows are drawn as a wide hero card, and so want the banner rather than the cover. */
export function isHeroSection(sectionId: string): boolean {
  const style = DISCOVER_SECTIONS.find((section) => section.id === sectionId)?.style;
  return style === SectionStyle.SimpleHero || style === SectionStyle.SimpleHeroPaged;
}

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.ShowLockedChapters]: false,
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  ),
};

/** The periods `/api/series/popular` accepts, keyed by the section that asks for one. */
export const SECTION_PERIODS: Record<string, PopularPeriod> = {
  [SectionID.PopularWeek]: "week",
  [SectionID.PopularMonth]: "month",
  [SectionID.PopularYear]: "year",
};

export type PopularPeriod = "week" | "month" | "year";

/** Genres the site files under a rating, used to infer one for a listing row. */
export const CONTENT_RATING_GENRES: Record<string, readonly string[]> = {
  explicit: ["adult", "hentai", "smut", "yaoi"],
  mature: ["ecchi", "gore", "mature"],
};

export type SeriesChapter = {
  chapterId: string;
  chapterNumber: string;
  title?: string | null;
  createdAt?: string | null;
};

export type Series = {
  seriesId: string;
  title: string;
  slug: string;
  originalTitle?: string | null;
  author?: string | null;
  artist?: string | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  description?: string | null;
  publicationStatus?: string | null;
  countryOfOrigin?: string | null;
  contentType?: string | null;
  updatedAt?: string | null;
  lastChapterUploadedAt?: string | null;
  genres?: string[] | null;
  chapterCount?: number | null;
  latestChapter?: SeriesChapter | null;
  bookmarkCount?: number | null;
  averageRating?: number | null;
  ratingCount?: number | null;
  totalViews?: string | number | null;
};

export type SeriesResponse = {
  data?: Series[] | null;
  pagination?: {
    page?: number | null;
    limit?: number | null;
    total?: number | null;
    totalPages?: number | null;
  } | null;
};

export type BannerResponse = { featuredSeries?: Series[] | null };

export type GenreResponse = { genres?: { slug: string; label: string }[] | null };

export type SeriesChapterDetails = SeriesChapter & {
  releaseDate?: string | null;
  price?: number | null;
  isFreeNow?: boolean | null;
  isPurchased?: boolean | null;
};

export type ChapterListResponse = { chapters?: SeriesChapterDetails[] | null };

export type ChapterPageItem = { pageNumber?: number | null; url: string };

export type ChapterPagesResponse = {
  pages?: ChapterPageItem[] | null;
  images?: ChapterPageItem[] | null;
};

export type SeriesQuery = {
  page: number;
  limit?: number;
  genres?: string[];
  status?: string;
  search?: string;
  sort?: string;
};
