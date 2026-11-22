/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://rinkocomics.com";

/** The theme paginates chapters through this rather than the usual endpoint. */
export const AJAX_PATH = "/wp-admin/admin-ajax.php";

/** A chapter with no free link of its own is marked here and refused when opened. */
export const LOCK_SUFFIX = "#lock";

/**
 * A chapter row, and only a chapter row.
 *
 * `a.chapter-item` also names the little chapter links on the front page's cards, so a
 * looser selector picks those up too and counts them as chapters. That matters more than
 * it looks: the walk below steps by how many rows it just read, so over-counting made it
 * skip past real chapters and keep asking for pages that were already behind it.
 */
export const CHAPTER_SELECTOR = "#cwChapters a.chapter-item, li.chapter";

/** The load-more control carries the id and offset the ajax action wants. */
export const LOAD_MORE_SELECTOR = "#loadMoreChaptersBtn, [data-comic-id]";

/** The run the load-more action hands over, which is what each offset steps by. */
export const CHAPTERS_PER_PAGE = 10;

/** Stop walking the ajax pages here so a misbehaving endpoint cannot spin forever. */
export const MAX_CHAPTER_PAGES = 60;

export const SectionID = {
  Hot: "hot",
  Pinned: "pinned",
  Latest: "latest",
} as const;

/** How many of a title's newest chapters a Latest Releases row lists beneath it. */
export const LATEST_CHAPTERS_SHOWN = 3;

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
 * Opening a title asks for its page three times over — once for the details, once for the
 * chapters, and once more for the nonce the chapter walk needs — and these run to two
 * hundred kilobytes each. Holding one briefly turns that into a single read.
 */
export const PAGE_CACHE_MS = 30_000;

/** The site marks a chapter it has locked; the tick of a padlock says so at a glance. */
export const LOCK_MARK = "Locked:";

/** The house mark for a view count, the same one the other sources here use. */
export const VIEWS_MARK = "◉";

export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Hot,
    title: "Editor's Choice",
    style: SectionStyle.SimpleHeroPaged,
    viewMore: false,
  },
  {
    id: SectionID.Pinned,
    title: "Featured This Week",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.Latest,
    title: "Latest Releases",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
];

export const FilterID = {
  Genres: "genres",
} as const;

export const SortID = {
  Newest: "updated",
  Added: "new",
  Views: "views",
  TitleAsc: "az",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Newest, title: "Latest Update", isDefault: true },
  { id: SortID.Added, title: "Newest Series" },
  { id: SortID.Views, title: "Most Viewed" },
  { id: SortID.TitleAsc, title: "A-Z" },
];

/** How long the browse page's genre list is kept before it is read again. */
export const GENRE_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
  summary?: string;
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
