/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://valirscans.org";

/** The account endpoint the site's own front-end reads to know who is signed in. */
export const SESSION_PATH = "/api/auth/session";

/**
 * The cookie whose arrival means the sign-in took.
 *
 * The site runs Auth.js, which names its session cookie `authjs.session-token` and
 * prefixes it `__Secure-` over HTTPS. Both spellings are accepted, and the older
 * `next-auth` naming with them, because the library renamed itself and a site can be on
 * either side of that.
 */
export const SESSION_COOKIE = /^(?:__(?:secure|host)-)?(?:authjs|next-auth)[._-]session-token$/i;

/** A chapter with no free access of its own is marked here and refused when opened. */
export const LOCK_SUFFIX = "#lock";

/** The site marks a chapter it has locked; the tick of a padlock says so at a glance. */
export const LOCK_MARK = "🔒";

/** The house mark for a view count, the same one the other sources here use. */
export const VIEWS_MARK = "⏯︎";

/**
 * The site's own word for a prose series, and the one kind not offered here.
 *
 * A Mana chapter is a list of images and has no text form, so a novel would list and then
 * open to nothing. It is excluded through the site's own filter rather than by dropping
 * rows, so a page of results still runs to the length the site says it has.
 */
export const NOVEL_TYPE = "Novel";

/** Stops a runaway `totalPages` from turning one chapter list into hundreds of requests. */
export const MAX_CHAPTER_PAGES = 20;

/**
 * How long the parsed front page is held.
 *
 * Long enough that every row on one opening of the page comes from a single read, short
 * enough that pulling to refresh a moment later still fetches the site again.
 */
export const HOME_CACHE_MS = 20_000;

/**
 * How long a page already read is held.
 *
 * Opening a title asks for its page twice over — once for the details and once for the
 * chapters — and a rendered Next.js page carries its whole payload inline. Holding one
 * briefly turns that into a single read.
 */
export const PAGE_CACHE_MS = 30_000;

/** How long the browse page's genre and tag lists are kept before they are read again. */
export const TAXONOMY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** How many of a title's newest chapters a Latest Comic Updates row lists beneath it. */
export const LATEST_CHAPTERS_SHOWN = 3;

export const SectionID = {
  Featured: "featured",
  MostPopular: "most-popular",
  LatestComics: "latest-comics",
  PopularToday: "popular-today",
  EditorsPicks: "editors-picks",
  NewSeries: "new-series",
} as const;

/**
 * The home page, under the site's own names.
 *
 * Every row but New Series is cut from one document — the site renders its whole front
 * page server-side — so those together cost a single request rather than one each. New
 * Series is the browse listing sorted newest-first, which is the only one of them with a
 * longer list behind it and so the only one offering a "view more".
 *
 * The shapes follow the other sources here: a hero for the set the site is pushing, the
 * chart it ranks as a detailed row that can carry its numbers, a grouped vertical list for
 * new chapters — the one style the app draws `Highlight.info` in — and plain strips of
 * covers for the shelves.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Featured,
    title: "Top Featured",
    subtitle: "The site's own front-page slider",
    style: SectionStyle.SimpleHeroPaged,
    viewMore: false,
  },
  {
    id: SectionID.MostPopular,
    title: "Most Popular",
    subtitle: "The catalogue's most read, in the site's own order",
    style: SectionStyle.DetailedDoubleRowPaged,
    viewMore: false,
  },
  {
    id: SectionID.EditorsPicks,
    title: "Editors' Picks",
    subtitle: "Chosen by the site",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.LatestComics,
    title: "Latest Comic Updates",
    subtitle: "Fresh chapters as they land",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
  {
    id: SectionID.PopularToday,
    title: "Popular Today",
    subtitle: "What is being read right now",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.NewSeries,
    title: "New Series",
    subtitle: "The newest additions to the catalogue",
    style: SectionStyle.SimpleSingleRow,
  },
];

/** What each row writes under a title, so no two say the same thing down the page. */
export const SECTION_SUBTITLES: Record<string, SubtitleStyle> = {
  [SectionID.Featured]: "hero",
  [SectionID.MostPopular]: "rank",
  [SectionID.LatestComics]: "chapters",
  [SectionID.PopularToday]: "stats",
  [SectionID.EditorsPicks]: "stats",
  [SectionID.NewSeries]: "stats",
};

export type SubtitleStyle = "hero" | "rank" | "chapters" | "stats";

export const FilterID = {
  Genres: "genres",
  Tags: "tags",
  Types: "types",
  Statuses: "statuses",
  Origins: "origins",
  MinChapters: "min-chapters",
  MaxChapters: "max-chapters",
} as const;

export const SortID = {
  Updated: "updated",
  Popular: "popular",
  Views: "views",
  Longest: "longest",
  Trending: "trending",
  Rating: "rating",
  Newest: "newest",
} as const;

/** The site's own sort menu, in its own words. */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Updated, title: "Recently Updated", isDefault: true },
  { id: SortID.Popular, title: "Most Bookmarked" },
  { id: SortID.Views, title: "Most Viewed" },
  { id: SortID.Longest, title: "Longest" },
  { id: SortID.Trending, title: "Trending" },
  { id: SortID.Rating, title: "Top Rated" },
  { id: SortID.Newest, title: "Newest" },
];

/**
 * The values the browse URL takes for each facet, exactly as the site spells them —
 * `?type=Manhwa`, `?status=Ongoing`, `?origin=KOREAN`. Novel is not among the types for
 * the reason given above.
 */
export const TYPE_OPTIONS: Option[] = [
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manga", title: "Manga" },
  { id: "Comic", title: "Comic" },
  { id: "Webtoon", title: "Webtoon" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Cancelled", title: "Cancelled" },
];

export const ORIGIN_OPTIONS: Option[] = [
  { id: "KOREAN", title: "Korean" },
  { id: "JAPANESE", title: "Japanese" },
  { id: "CHINESE", title: "Chinese" },
  { id: "ENGLISH", title: "English" },
];

/**
 * Stands in when the browse page's own genre list cannot be read, so the filter form still
 * opens. The site is the authority on its own slugs — this is only a fallback, replaced by
 * the live list on the first successful read.
 */
export const BUNDLED_GENRES: Option[] = [
  { id: "action", title: "Action" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gamelit", title: "GameLit" },
  { id: "gender-bender", title: "Gender Bender" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "litrpg", title: "LitRPG" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "military", title: "Military" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo-ai", title: "Shoujo Ai" },
  { id: "shounen", title: "Shounen" },
  { id: "shounen-ai", title: "Shounen Ai" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "thriller", title: "Thriller" },
  { id: "tragedy", title: "Tragedy" },
  { id: "virtual-reality", title: "Virtual Reality" },
  { id: "wuxia", title: "Wuxia" },
  { id: "xianxia", title: "Xianxia" },
  { id: "xuanhuan", title: "Xuanhuan" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

export const PreferenceID = {
  HideLockedChapters: "hide-locked-chapters",
  SectionPrefix: "section",
} as const;

export const PREFERENCE_DEFAULTS = {
  // Locked chapters are listed by default, marked with a padlock — the home page already
  // advertises them that way, so leaving them out here would mean tapping one in and not
  // finding it. The setting is worded as the thing being turned on for a reason: a toggle
  // whose default is `false` reads back the same whether the stored value survives or not.
  [PreferenceID.HideLockedChapters]: false,
  ...Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true])),
};

// ========================= What the site's payloads carry =========================

/**
 * A genre as the site writes it, which is not one shape.
 *
 * The home and browse payloads wrap each entry as `{ genre: { name, slug } }`; a series
 * page flattens it to `{ name, slug }`. Both are read.
 */
export type ValirGenre = {
  genre?: { slug?: string; name?: string };
  slug?: string;
  name?: string;
};

export type ValirChapterItem = {
  id: string;
  number: number;
  title?: string | null;
  isLocked?: boolean;
  /** Set once the account reading has paid for or been granted the chapter. */
  hasAccess?: boolean;
  publishedAt?: string | null;
};

export type ValirSeries = {
  slug: string;
  urlSlug?: string;
  title: string;
  type?: string;
  coverImage?: string | null;
  bannerImage?: string | null;
  description?: string | null;
  status?: string | null;
  rating?: number;
  viewCount?: number;
  chapterCount?: number;
  isMature?: boolean;
  author?: string | null;
  artist?: string | null;
  altTitle?: string | null;
  originalTitle?: string | null;
  aliases?: string[];
  genres?: ValirGenre[];
  tags?: { name?: string; slug?: string }[];
  chapters?: ValirChapterItem[];
  lastChapterAt?: string | null;
};

/** The series detail page's own props: the record, plus one page of its chapter list. */
export type ValirSeriesPage = {
  series: ValirSeries;
  chapters?: ValirChapterItem[];
  totalPages?: number;
};

export type ValirReaderPage = {
  pageNumber: number;
  imageUrl: string;
};

export type ValirChapterData = {
  /** Prose, for the novels this source does not offer — its presence is what names one. */
  content?: string | null;
  pages?: ValirReaderPage[];
  isLocked?: boolean;
};

export type ValirReaderData = {
  chapter?: ValirChapterData;
  isUnlocked?: boolean;
  isLocked?: boolean;
};

export type HomeSections = {
  featured: ValirSeries[];
  editorsPicks: ValirSeries[];
  latestUpdates: ValirSeries[];
  popularToday: ValirSeries[];
  mostPopular: ValirSeries[];
};

export type BrowsePage = {
  series: ValirSeries[];
  hasMore: boolean;
};

export type FilterTaxonomy = {
  genres: Option[];
  tags: Option[];
};

/** An account as `/api/auth/session` reports it. */
export type AccountStatus = {
  authenticated: boolean;
  displayName?: string;
  email?: string;
  avatar?: string;
};
