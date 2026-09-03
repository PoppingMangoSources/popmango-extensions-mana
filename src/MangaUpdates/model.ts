/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://www.mangaupdates.com";
export const API_URL = "https://api.mangaupdates.com/v1";

/** The session token is a JWT, so it belongs in the keychain rather than the database. */
export const SESSION_KEY = "mangaupdates.session-token";

/**
 * What the sign-in fields have been given so far. The app runs each form callback on its
 * own, so anything the source only holds in memory is gone by the time the button is
 * pressed — these have to outlive the keystroke that set them.
 */
export const PENDING_USERNAME_KEY = "mangaupdates.pending-username";
export const PENDING_PASSWORD_KEY = "mangaupdates.pending-password";

export const PAGE_SIZE = 25;
export const SECTION_SIZE = 20;

/**
 * The site rejects a second write within five seconds of the last one, so every
 * mutation waits its turn behind the one before it.
 */
export const MUTATION_INTERVAL_MS = 5000;

export const FilterID = {
  Genres: "genres",
  Types: "types",
  Categories: "categories",
  Licensed: "licensed",
  Filters: "filters",
  Year: "year",
} as const;

export const SectionID = {
  TrendingNow: "trending_now",
  PopularManga: "popular_manga",
  PopularManhwa: "popular_manhwa",
  TopRated: "top_rated",
} as const;

export const SortID = {
  Default: "",
  Title: "title",
  Year: "year",
  Rating: "rating",
  Score: "score",
  Rank: "rank",
  DateAdded: "date_added",
  Week: "week_pos",
  Month: "month1_pos",
  ThreeMonths: "month3_pos",
  SixMonths: "month6_pos",
  YearPosition: "year_pos",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Default, title: "Best Match", isDefault: true },
  { id: SortID.Title, title: "Title" },
  { id: SortID.Year, title: "Year" },
  { id: SortID.Rating, title: "Rating" },
  { id: SortID.Score, title: "Score" },
  { id: SortID.Rank, title: "Rank" },
  { id: SortID.DateAdded, title: "Date Added" },
  { id: SortID.Week, title: "Popularity (Week)" },
  { id: SortID.Month, title: "Popularity (Month)" },
  { id: SortID.ThreeMonths, title: "Popularity (3 Months)" },
  { id: SortID.SixMonths, title: "Popularity (6 Months)" },
  { id: SortID.YearPosition, title: "Popularity (Year)" },
];

/**
 * The five lists every account has. A reader may rename them or add their own, so the
 * id here is the list *type* and the account's own numeric list id is looked up per call.
 */
export const STATUS_OPTIONS: Option[] = [
  { id: "read", title: "Reading" },
  { id: "wish", title: "Wish List" },
  { id: "complete", title: "Complete" },
  { id: "unfinished", title: "Unfinished" },
  { id: "hold", title: "On Hold" },
];

export const DEFAULT_STATUS = "read";

/** The site's own type enum, in full — anything outside it is rejected by the search. */
export const TYPE_OPTIONS: Option[] = [
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Novel", title: "Novel" },
  { id: "Doujinshi", title: "Doujinshi" },
  { id: "Artbook", title: "Artbook" },
  { id: "Filipino", title: "Filipino" },
  { id: "Indonesian", title: "Indonesian" },
  { id: "Thai", title: "Thai" },
  { id: "Vietnamese", title: "Vietnamese" },
  { id: "Malaysian", title: "Malaysian" },
  { id: "Nordic", title: "Nordic" },
  { id: "German", title: "German" },
  { id: "French", title: "French" },
  { id: "Spanish", title: "Spanish" },
  { id: "OEL", title: "OEL" },
  { id: "Drama CD", title: "Drama CD" },
];

export const LICENSED_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "yes", title: "Licensed" },
  { id: "no", title: "Unlicensed" },
];

export const RELEASE_FILTER_OPTIONS: Option[] = [
  { id: "scanlated", title: "Scanlated" },
  { id: "completed", title: "Completed" },
  { id: "oneshots", title: "Oneshots" },
  { id: "no_oneshots", title: "No Oneshots" },
  { id: "some_releases", title: "Has Releases" },
  { id: "no_releases", title: "No Releases" },
];

/** The genres the site itself treats as adult, used to keep them out of discover rows. */
export const ADULT_GENRES = ["Adult", "Hentai", "Smut"];
export const MATURE_GENRES = ["Ecchi"];
export const UNSAFE_GENRES = [...ADULT_GENRES, ...MATURE_GENRES];

export type DiscoverSection = PageSectionSpec & {
  sort: string;
  type?: string;
};

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: SectionID.TrendingNow,
    title: "Trending Now",
    style: SectionStyle.SimpleHeroPaged,
    sort: SortID.Week,
  },
  {
    id: SectionID.PopularManga,
    title: "Popular Manga",
    style: SectionStyle.DetailedDoubleRowPaged,
    sort: SortID.YearPosition,
    type: "Manga",
  },
  {
    id: SectionID.PopularManhwa,
    title: "Popular Manhwa",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.YearPosition,
    type: "Manhwa",
  },
  {
    id: SectionID.TopRated,
    title: "Top Rated",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.Rating,
  },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> =
  Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true]));

export type SeriesSearchBody = {
  search?: string;
  page: number;
  perpage: number;
  orderby?: string;
  genre?: string[];
  exclude_genre?: string[];
  category?: string[];
  type?: string[];
  filter_types?: string[];
  filters?: string[];
  licensed?: "yes" | "no";
  year?: string;
  list?: string;
};

export type Series = {
  series_id?: number;
  title?: string;
  associated?: { title: string }[];
  description?: string;
  image?: { url?: { original?: string; thumb?: string } };
  authors?: { name: string; type: "Author" | "Artist" }[];
  genres?: { genre?: string }[];
  categories?: { category?: string }[];
  publishers?: { publisher_name?: string; type?: string }[];
  status?: string;
  type?: string;
  year?: string;
  licensed?: boolean;
  bayesian_rating?: number;
  rating_votes?: number;
  latest_chapter?: number;
  url?: string;
};

export type SeriesSearchResponse = {
  total_hits?: number;
  page?: number;
  per_page?: number;
  results?: { hit_title?: string; record?: Series }[];
};

export type ListEntry = {
  list_id?: number;
  list_type?: string;
  series: { id: number; title?: string };
  status?: { chapter?: number; volume?: number };
};

export type ListDefinition = {
  list_id?: number;
  title?: string;
  type?: "read" | "wish" | "complete" | "unfinished" | "hold";
  custom?: boolean;
};

export type RatingResponse = { rating?: number };

export type LoginResponse = { context?: { session_token?: string; uid?: number } };

export type Profile = {
  user_id?: number;
  username?: string;
  url?: string;
  avatar?: { url?: string };
  time_joined?: { as_string?: string };
};

export type Genre = { genre?: string };
