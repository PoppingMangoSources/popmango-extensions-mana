/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://rinkocomics.com";

/** The theme paginates chapters through this rather than the usual endpoint. */
export const AJAX_PATH = "/wp-admin/admin-ajax.php";

/** A chapter with no free link of its own is marked here and refused when opened. */
export const LOCK_SUFFIX = "#lock";

/**
 * Comic pages list chapters as `li.chapter`, novel pages as `div.chapter`, and a reader
 * sidebar as `a.chapter-item`. One selector covers all three.
 */
export const CHAPTER_SELECTOR = "li.chapter, div.chapter, a.chapter-item";

/** The load-more control carries the id and offset the ajax action wants. */
export const LOAD_MORE_SELECTOR = "[data-comic-id]";

/** Stop walking the ajax pages here so a misbehaving endpoint cannot spin forever. */
export const MAX_CHAPTER_PAGES = 60;

export const SectionID = {
  Hot: "hot",
  Pinned: "pinned",
  Latest: "latest",
} as const;

/** How many of a title's newest chapters a Latest Releases row lists beneath it. */
export const LATEST_CHAPTERS_SHOWN = 3;

/** The site marks a chapter it has locked; the tick of a padlock says so at a glance. */
export const LOCK_MARK = "🔒";

/**
 * The home page, in the site's own order and under its own names.
 *
 * Every row is read out of one document — the site builds its whole front page server-side
 * — so all three together cost a single request rather than one each.
 *
 * The shapes follow the other sources here, which all lay a front page out the same way: a
 * hero for the set the site is pushing, a plain strip for a shelf of picks, and a grouped
 * vertical list for new chapters, that last being the one style the app draws
 * `Highlight.info` in. Hot This Week takes the hero because it is what the site ranks and
 * what its own slider repeats — the slider is the same titles in the same order, so giving
 * it a row of its own would put one query on the page twice.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Hot,
    title: "Hot This Week",
    subtitle: "Most read over the last seven days",
    style: SectionStyle.SimpleHeroPaged,
    // Each of these is a fixed set the site assembles for its front page. None has a
    // longer listing behind it, so there is nothing for a "view more" to open.
    viewMore: false,
  },
  {
    id: SectionID.Pinned,
    title: "Editor's Choice",
    subtitle: "Pinned by the site",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.Latest,
    title: "Latest Releases",
    subtitle: "Fresh chapters as they land",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
];

export const FilterID = {
  Genres: "genres",
} as const;

export const SortID = {
  Newest: "newest",
  Oldest: "oldest",
  TitleAsc: "az",
  TitleDesc: "za",
} as const;

/** The site's own sort menu, in its own words. */
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Newest, title: "Newest First", isDefault: true },
  { id: SortID.Oldest, title: "Oldest First" },
  { id: SortID.TitleAsc, title: "A-Z" },
  { id: SortID.TitleDesc, title: "Z-A" },
];

/** How long the browse page's genre list is kept before it is read again. */
export const GENRE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const PreferenceID = {
  ShowLockedChapters: "show-locked-chapters",
  SectionPrefix: "section",
} as const;

export const PREFERENCE_DEFAULTS = {
  // Listed by default, marked with a padlock. The home page already advertises them that
  // way, so hiding them here would mean tapping a chapter in and not finding it.
  [PreferenceID.ShowLockedChapters]: true,
  ...Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true])),
};

/** One of the recent chapters a Latest Releases card lists under its title. */
export type CardChapter = {
  label: string;
  uploaded?: Date;
  locked: boolean;
};

/** A card as the front page draws it, before it becomes a tile. */
export type Card = {
  id: string;
  title: string;
  cover: string;
  genres: string[];
  /** The site's own position in a ranked row. */
  rank?: string;
  views?: string;
  chapterCount?: string;
  /** What a "latest" card lists beneath the title: the newest chapters, newest first. */
  chapters: CardChapter[];
};

export type ChapterRow = {
  id: string;
  name: string;
  date?: Date;
  locked: boolean;
};
