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
  Featured: "featured",
  Hot: "hot",
  Pinned: "pinned",
  Latest: "latest",
} as const;

/**
 * The home page, in the site's own order and under its own names.
 *
 * Every row is read out of one document — the site builds its whole front page server-side
 * — so the four together cost a single request rather than one each.
 *
 * The shapes are chosen for what each row actually knows. Featured is a hand-drawn slider
 * and carries nothing but artwork and genres, so it takes the biggest slot. Hot This Week
 * is the only row with numbers behind it, and a vertical list is the one style the app
 * draws `Highlight.info` in, so its rank, views and chapter count get rows of their own and
 * it reads as the chart it is. Editor's Choice is a browsing shelf. Latest Releases carries
 * a chapter and a time, which fit on one line under a cover.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Featured,
    title: "Featured",
    subtitle: "The site's own picks",
    style: SectionStyle.SimpleHeroPaged,
    // Each of these is a fixed set the site assembles for its front page. None has a
    // longer listing behind it, so there is nothing for a "view more" to open.
    viewMore: false,
  },
  {
    id: SectionID.Hot,
    title: "Hot This Week",
    subtitle: "Most read over the last seven days",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
  {
    id: SectionID.Pinned,
    title: "Editor's Choice",
    subtitle: "Pinned by the site",
    style: SectionStyle.DetailedDoubleRowPaged,
    viewMore: false,
  },
  {
    id: SectionID.Latest,
    title: "Latest Releases",
    subtitle: "Fresh chapters",
    style: SectionStyle.DetailedSingleRowPaged,
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
  [PreferenceID.ShowLockedChapters]: false,
  ...Object.fromEntries(DISCOVER_SECTIONS.map((section) => [`section-${section.id}`, true])),
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
  /** The newest chapter a "latest" card links to, and when it landed. */
  chapter?: string;
  uploaded?: Date;
};

export type ChapterRow = {
  id: string;
  name: string;
  date?: Date;
  locked: boolean;
};
