/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://rokaricomics.com";

/** Where the theme files its series, and the listing every filtered browse goes through. */
export const DIRECTORY_PATH = "manga";

/** A chapter the site has held back is marked here and refused when opened. */
export const LOCK_SUFFIX = "#lock";

/** The site marks a chapter it has locked; the tick of a padlock says so at a glance. */
export const LOCK_MARK = "🔒";

/**
 * How long the parsed front page is held.
 *
 * Every row on it is cut from one document, and the app resolves rows one after another —
 * so without this the same page is fetched and parsed once per row. Short enough that
 * pulling to refresh still fetches the site again.
 */
export const HOME_CACHE_MS = 20_000;

/**
 * How long a page already read is held.
 *
 * A title's page answers both the details and the chapter list, and the app asks for those
 * separately. Holding one briefly turns that into a single read.
 */
export const PAGE_CACHE_MS = 30_000;

/** How long the directory's own filter lists are kept before they are read again. */
export const TAXONOMY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** How many of a title's newest chapters a Latest Updates row lists beneath it. */
export const LATEST_CHAPTERS_SHOWN = 3;

export const SectionID = {
  Featured: "featured",
  Latest: "latest-updates",
  PopularToday: "popular-today",
  Recommendation: "recommendation",
  PopularWeekly: "popular-weekly",
  PopularMonthly: "popular-monthly",
  PopularAllTime: "popular-alltime",
} as const;

/** Which tab of the site's Popular widget a ranked row is cut from. */
export const RANKING_RANGE: Record<string, string> = {
  [SectionID.PopularWeekly]: "weekly",
  [SectionID.PopularMonthly]: "monthly",
  [SectionID.PopularAllTime]: "alltime",
};

export type SubtitleStyle = "hero" | "chapters" | "chapter" | "rank";

/** What each row writes under a title, so no two say the same thing down the page. */
export const SECTION_SUBTITLES: Record<string, SubtitleStyle> = {
  [SectionID.Featured]: "hero",
  [SectionID.Latest]: "chapters",
  [SectionID.PopularToday]: "chapter",
  [SectionID.Recommendation]: "chapter",
  [SectionID.PopularWeekly]: "rank",
  [SectionID.PopularMonthly]: "rank",
  [SectionID.PopularAllTime]: "rank",
};

/**
 * The home page, top to bottom as the site builds it, under its own names.
 *
 * Every row is read out of one document — the theme renders its whole front page, sidebar
 * included — so all seven together cost a single request rather than one each.
 *
 * The site's Popular widget is one box with three tabs behind it, and all three arrive in
 * that document already. They are rows of their own here rather than a strip of chips: the
 * app has a style for a ranked row, and a row shows what is climbing without a tap first.
 * Only the weekly one is drawn detailed — the three carry the same fields, and three
 * detailed rows in a column would be a wall.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Featured,
    title: "Featured",
    subtitle: "The site's own front-page slider",
    style: SectionStyle.SimpleHeroPaged,
    // Each of these is a fixed set the theme assembles for its front page. None has a
    // longer listing behind it, so there is nothing for a "view more" to open.
    viewMore: false,
  },
  {
    id: SectionID.Latest,
    title: "Latest Updates",
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
    id: SectionID.Recommendation,
    title: "Recommendation",
    subtitle: "The site's own picks",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.PopularWeekly,
    title: "Popular Weekly",
    subtitle: "Most read over the last seven days",
    style: SectionStyle.DetailedDoubleRowPaged,
    viewMore: false,
  },
  {
    id: SectionID.PopularMonthly,
    title: "Popular Monthly",
    subtitle: "Most read over the last month",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.PopularAllTime,
    title: "Popular All-Time",
    subtitle: "The catalogue's best read, all time",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
];

export const FilterID = {
  Genres: "genres",
  Status: "status",
  Type: "type",
} as const;

export const SortID = {
  Default: "default",
  TitleAsc: "title",
  TitleDesc: "titlereverse",
  Update: "update",
  Added: "latest",
  Popular: "popular",
} as const;

/**
 * The theme's own sort menu, in its own words. `default` is the site's unsorted order and
 * is sent as no parameter at all, which is what the site itself does.
 */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Default, title: "Default", isDefault: true },
  { id: SortID.TitleAsc, title: "A-Z" },
  { id: SortID.TitleDesc, title: "Z-A" },
  { id: SortID.Update, title: "Update" },
  { id: SortID.Added, title: "Added" },
  { id: SortID.Popular, title: "Popular" },
];

export const PreferenceID = {
  HideLockedChapters: "hide-locked-chapters",
  SectionPrefix: "section",
} as const;

export const PREFERENCE_DEFAULTS = {
  // Locked chapters are listed by default, marked with a padlock — the front page already
  // advertises them that way, so leaving them out here would mean tapping one in and not
  // finding it. The setting is worded as the thing being turned on for a reason: a toggle
  // whose default is `false` reads back the same whether the stored value survives or not.
  [PreferenceID.HideLockedChapters]: false,
  ...Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true])),
};

/** One of the recent chapters a Latest Updates card lists under its title. */
export type CardChapter = {
  label: string;
  uploaded?: Date;
};

/** A card as the front page draws it, before it becomes a tile. */
export type Card = {
  id: string;
  title: string;
  cover: string;
  /** The chapter label the theme prints on the card, already the site's own wording. */
  chapter?: string;
  genres?: string;
  /** The site's own position in a ranked row. */
  rank?: number;
  /** What a Latest Updates card lists beneath the title: newest chapters, newest first. */
  chapters: CardChapter[];
};

export type ChapterRow = {
  id: string;
  name: string;
  date?: Date;
  locked: boolean;
};
