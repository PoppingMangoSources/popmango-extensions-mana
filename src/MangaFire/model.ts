/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://mangafire.to";
export const API_URL = `${BASE_URL}/api`;

/** What the site's own browse page asks for, and what a "view more" page then continues. */
export const PAGE_SIZE = 30;

/** The chapter endpoint's own ceiling; asking for more returns this many anyway. */
export const CHAPTER_PAGE_SIZE = 200;

/**
 * A title with more chapters than this is read in several requests, and a long-running
 * series can be thousands. The cap stops a broken `hasNext` from paging forever.
 */
export const MAX_CHAPTER_PAGES = 20;

export const SectionID = {
  MostViewed: "most_viewed",
  Trending: "trending",
  LatestUpdates: "latest_updates",
  RecentlyAdded: "recently_added",
} as const;

/**
 * The home page, in the order the rows appear.
 *
 * Each row is one request. Most Viewed leads as the hero because an all-time ranking is the
 * steadiest list the site keeps — the biggest slot on the page holds the same well-known
 * titles for weeks rather than reshuffling on a day's traffic, which is what Trending is
 * for directly beneath it.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.MostViewed,
    title: "Most Viewed (All Time)",
    subtitle: "The site's most-read titles",
    style: SectionStyle.SimpleHeroPaged,
  },
  {
    id: SectionID.Trending,
    title: "Trending",
    subtitle: "Climbing today",
    style: SectionStyle.DetailedDoubleRowPaged,
    // The trending endpoint answers with one fixed run and takes no page, so there is no
    // longer list for a "view more" to open.
    viewMore: false,
  },
  {
    id: SectionID.LatestUpdates,
    title: "Latest Updates",
    subtitle: "Fresh chapters",
    // The one style that draws `Highlight.info`, which is what carries the chapter and the
    // time it landed as rows of their own rather than crammed onto one line.
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.RecentlyAdded,
    title: "Recently Added",
    subtitle: "New to the site",
    // A plain strip of covers: what is new is the artwork, and there is no ranking or
    // chapter to report under it.
    style: SectionStyle.SimpleSingleRow,
  },
];

/** The ranking each listing row is built on, in the site's own sort vocabulary. */
export const SECTION_ORDERS: Record<string, string> = {
  [SectionID.MostViewed]: "views_total",
  [SectionID.LatestUpdates]: "chapter_updated_at",
  [SectionID.RecentlyAdded]: "created_at",
};

/** What a tile writes under its title. A hero card draws no info rows, so it says more. */
export type SubtitleStyle = "chapter" | "kind" | "updated" | "hero";

export const SECTION_SUBTITLES: Record<string, SubtitleStyle> = {
  [SectionID.MostViewed]: "hero",
  [SectionID.Trending]: "kind",
  [SectionID.LatestUpdates]: "updated",
  [SectionID.RecentlyAdded]: "kind",
};

export const FilterID = {
  Genres: "genres",
  GenreMode: "genre_mode",
  Themes: "themes",
  Demographics: "demographics",
  Types: "types",
  Statuses: "statuses",
  Author: "author",
  YearFrom: "year_from",
  YearTo: "year_to",
  MinChapters: "min_chapters",
} as const;

export const SortID = {
  Relevance: "relevance:desc",
  LatestUpdate: "chapter_updated_at:desc",
  RecentlyAdded: "created_at:desc",
  TitleAsc: "title:asc",
  TitleDesc: "title:desc",
  YearNewest: "year:desc",
  YearOldest: "year:asc",
  Rated: "score:desc",
  Views7Days: "views_7d:desc",
  Views30Days: "views_30d:desc",
  ViewsTotal: "views_total:desc",
  Follows: "follows_total:desc",
} as const;

/** The site's own sort menu, in its own words and its own order. */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Relevance, title: "Best Match", isDefault: true },
  { id: SortID.LatestUpdate, title: "Latest Update" },
  { id: SortID.RecentlyAdded, title: "Recently Added" },
  { id: SortID.TitleAsc, title: "Title (A-Z)" },
  { id: SortID.TitleDesc, title: "Title (Z-A)" },
  { id: SortID.YearNewest, title: "Year (Newest)" },
  { id: SortID.YearOldest, title: "Year (Oldest)" },
  { id: SortID.Rated, title: "Highest Rated" },
  { id: SortID.Views7Days, title: "Most Viewed (7 Days)" },
  { id: SortID.Views30Days, title: "Most Viewed (30 Days)" },
  { id: SortID.ViewsTotal, title: "Most Viewed (All Time)" },
  { id: SortID.Follows, title: "Most Followed" },
];

export const TYPE_OPTIONS: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "other", title: "Other" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "releasing", title: "Releasing" },
  { id: "finished", title: "Finished" },
  { id: "on_hiatus", title: "On Hiatus" },
  { id: "discontinued", title: "Discontinued" },
  { id: "not_yet_released", title: "Not Yet Released" },
];

export const GENRE_MODE_OPTIONS: Option[] = [
  { id: "and", title: "Match all" },
  { id: "or", title: "Match any" },
];

/** The site's own tag ids. A genre is addressed by number, never by name. */
export const GENRE_OPTIONS: Option[] = [
  { id: "1", title: "Action" },
  { id: "268929", title: "Adult" },
  { id: "78", title: "Adventure" },
  { id: "3", title: "Avant Garde" },
  { id: "4", title: "Boys Love" },
  { id: "5", title: "Comedy" },
  { id: "268921", title: "Crime" },
  { id: "77", title: "Demons" },
  { id: "6", title: "Drama" },
  { id: "7", title: "Ecchi" },
  { id: "79", title: "Fantasy" },
  { id: "9", title: "Girls Love" },
  { id: "10", title: "Gourmet" },
  { id: "11", title: "Harem" },
  { id: "268930", title: "Hentai" },
  { id: "268922", title: "Historical" },
  { id: "530", title: "Horror" },
  { id: "13", title: "Isekai" },
  { id: "531", title: "Iyashikei" },
  { id: "15", title: "Josei" },
  { id: "532", title: "Kids" },
  { id: "539", title: "Magic" },
  { id: "268923", title: "Magical Girls" },
  { id: "533", title: "Mahou Shoujo" },
  { id: "534", title: "Martial Arts" },
  { id: "268931", title: "Mature" },
  { id: "19", title: "Mecha" },
  { id: "268924", title: "Medical" },
  { id: "535", title: "Military" },
  { id: "21", title: "Music" },
  { id: "22", title: "Mystery" },
  { id: "23", title: "Parody" },
  { id: "268925", title: "Philosophical" },
  { id: "536", title: "Psychological" },
  { id: "25", title: "Reverse Harem" },
  { id: "26", title: "Romance" },
  { id: "73", title: "School" },
  { id: "28", title: "Sci-Fi" },
  { id: "537", title: "Seinen" },
  { id: "30", title: "Shoujo" },
  { id: "31", title: "Shounen" },
  { id: "538", title: "Slice of Life" },
  { id: "268932", title: "Smut" },
  { id: "33", title: "Space" },
  { id: "34", title: "Sports" },
  { id: "75", title: "Super Power" },
  { id: "268926", title: "Superhero" },
  { id: "76", title: "Supernatural" },
  { id: "37", title: "Suspense" },
  { id: "38", title: "Thriller" },
  { id: "268927", title: "Tragedy" },
  { id: "39", title: "Vampire" },
  { id: "268928", title: "Wuxia" },
];

export const THEME_OPTIONS: Option[] = [
  { id: "268933", title: "Aliens" },
  { id: "268934", title: "Animals" },
  { id: "268935", title: "Cooking" },
  { id: "268936", title: "Crossdressing" },
  { id: "268937", title: "Delinquents" },
  { id: "268938", title: "Demons" },
  { id: "268939", title: "Genderswap" },
  { id: "268940", title: "Ghosts" },
  { id: "268941", title: "Gyaru" },
  { id: "268942", title: "Harem" },
  { id: "268943", title: "Incest" },
  { id: "268944", title: "Loli" },
  { id: "268945", title: "Mafia" },
  { id: "268946", title: "Magic" },
  { id: "268947", title: "Martial Arts" },
  { id: "268948", title: "Military" },
  { id: "268949", title: "Monster Girls" },
  { id: "268950", title: "Monsters" },
  { id: "268951", title: "Music" },
  { id: "268952", title: "Ninja" },
  { id: "268953", title: "Office Workers" },
  { id: "268954", title: "Police" },
  { id: "268955", title: "Post-Apocalyptic" },
  { id: "268956", title: "Reincarnation" },
  { id: "268957", title: "Reverse Harem" },
  { id: "268958", title: "Samurai" },
  { id: "268959", title: "School Life" },
  { id: "268960", title: "Shota" },
  { id: "268961", title: "Supernatural" },
  { id: "268962", title: "Survival" },
  { id: "268963", title: "Time Travel" },
  { id: "268964", title: "Traditional Games" },
  { id: "268965", title: "Vampires" },
  { id: "268966", title: "Video Games" },
  { id: "268967", title: "Villainess" },
  { id: "268968", title: "Virtual Reality" },
  { id: "268969", title: "Zombies" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "268919", title: "Josei" },
  { id: "268920", title: "Seinen" },
  { id: "268917", title: "Shoujo" },
  { id: "268918", title: "Shounen" },
];

/**
 * The languages the site publishes in, keyed by the code its chapter endpoint takes.
 *
 * A chapter list is fetched per language, so this is also the cost of the setting: each
 * language a reader picks is another request per title.
 */
export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "es", title: "Español" },
  { id: "es-la", title: "Español (Latinoamérica)" },
  { id: "fr", title: "Français" },
  { id: "ja", title: "日本語" },
  { id: "pt", title: "Português" },
  { id: "pt-br", title: "Português (Brasil)" },
];

/** The site's own rating vocabulary, in the order it grades them. */
export const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"] as const;

export const CONTENT_RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const PreferenceID = {
  ContentRatings: "content-ratings",
  Languages: "languages",
  ShowVolumes: "show-volumes",
  MergeChapters: "merge-chapters",
  OfficialFirst: "official-first",
  SectionPrefix: "section",
} as const;

export const PREFERENCE_DEFAULTS = {
  // Empty means every grade, which is the site's own default and one fewer thing to sign.
  [PreferenceID.ContentRatings]: [] as string[],
  [PreferenceID.Languages]: ["en"],
  [PreferenceID.ShowVolumes]: false,
  [PreferenceID.MergeChapters]: false,
  [PreferenceID.OfficialFirst]: true,
  ...Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true])),
};

/** The envelope every listing endpoint answers with. */
export type ApiList<T> = {
  items?: T[] | null;
  meta?: { hasNext?: boolean | null; lastPage?: number | null } | null;
};

export type Poster = {
  small?: string | null;
  medium?: string | null;
  large?: string | null;
};

export type Entity = {
  id?: number | null;
  title?: string | null;
};

export type TitleItem = {
  hid: string;
  slug?: string | null;
  title: string;
  type?: string | null;
  poster?: Poster | null;
  latestChapter?: number | null;
  chapterUpdatedAt?: string | null;
  rank?: number | null;
};

export type TitleDetails = TitleItem & {
  status?: string | null;
  synopsisHtml?: string | null;
  altTitles?: string[] | null;
  rating?: number | null;
  authors?: Entity[] | null;
  artists?: Entity[] | null;
  genres?: Entity[] | null;
  themes?: Entity[] | null;
};

export type DetailsResponse = { data?: TitleDetails | null };

export type ChapterItem = {
  id: number;
  number?: number | null;
  name?: string | null;
  type?: string | null;
  createdAt?: number | null;
};

/**
 * The site also collects chapters into volumes, which is a different list rather than a
 * different view of the same one — a volume opens as one long read of its own.
 */
export type VolumeItem = {
  id: number;
  number?: number | null;
  name?: string | null;
  chapterCount?: number | null;
  language?: string | null;
};

/** A volume's pages come from an endpoint of its own, so its id is marked as it is stored. */
export const VOLUME_PREFIX = "v";

export type PagesResponse = { data?: { pages?: { url?: string | null }[] | null } | null };

export type TagsResponse = {
  data?: { id?: number | null; name?: string | null; type?: string | null }[] | null;
};
