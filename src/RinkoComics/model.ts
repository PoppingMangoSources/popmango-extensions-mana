/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type SortOption } from "@mana-app/types";

import { Mark, type PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://rinkocomics.com";

/** The theme paginates chapters through this rather than the usual endpoint. */
export const AJAX_PATH = "/wp-admin/admin-ajax.php";

/** A chapter with no free link of its own is marked here and refused when opened. */
export const LOCK_SUFFIX = "#lock";

/**
 * A chapter row, and only a chapter row: a comic's `#cwChapters` list, a novel's episodes
 * grouped under `#cwVolumes`, and the `li.chapter` rows the load-more action hands back.
 *
 * `a.chapter-item` also names the little chapter links on the front page's cards, so a
 * looser selector picks those up too and counts them as chapters. That matters more than
 * it looks: the walk below steps by how many rows it just read, so over-counting made it
 * skip past real chapters and keep asking for pages that were already behind it.
 */
// A novel's free episodes are bare links; only its locked ones carry `chapter-item`.
export const CHAPTER_SELECTOR = "#cwChapters a.chapter-item, #cwVolumes [data-ep] > a, li.chapter";

/**
 * The load-more control, which carries the id and offset the ajax action wants.
 *
 * Only the button itself: the library button also carries `data-comic-id`, and a novel,
 * which lists every episode inline, would otherwise send the walk asking for more.
 */
export const LOAD_MORE_SELECTOR = "#cwMoreChapters, #loadMoreChaptersBtn";

/** Where an episode's prose sits; a comic chapter has none of these. */
export const NOVEL_TEXT_SELECTOR = "#cwNovelText, #textContent, .novel-content";

/** The run the load-more action hands over, which is what each offset steps by. */
export const CHAPTERS_PER_PAGE = 10;

/** Stop walking the ajax pages here so a misbehaving endpoint cannot spin forever. */
export const MAX_CHAPTER_PAGES = 60;

export const SectionID = {
  Hot: "hot",
  Pinned: "pinned",
  Novels: "novels",
  Latest: "latest",
  NovelLatest: "novel-latest",
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
export const LOCK_MARK = Mark.Locked;

/**
 * The home page, in the site's own order and under its own names.
 *
 * Everything but the novels' releases is read out of one document — the site builds its
 * whole front page server-side — and the novels' releases are that same front page with its
 * Novels tab chosen, so the whole home costs two requests however many rows are on.
 *
 * The site's latest releases are one block with a Comics/Novels switch; a row cannot hold a
 * switch, so the two tabs are two rows, each named for the block and the tab. Comics read
 * the site's Today tab, novels its All tab: novel releases come in bursts, and Today is
 * often empty for them.
 */
export const DISCOVER_SECTIONS: PageSectionSpec[] = [
  {
    id: SectionID.Hot,
    title: "Editor's Choice",
    style: SectionStyle.SimpleHeroPaged,
    // A fixed set the site assembles for its front page, with no longer listing behind it.
    viewMore: false,
  },
  {
    id: SectionID.Pinned,
    title: "Featured This Week",
    subtitle: "Most read",
    style: SectionStyle.SimpleSingleRow,
    viewMore: false,
  },
  {
    id: SectionID.Novels,
    title: "New Novels",
    style: SectionStyle.SimpleSingleRow,
    // The site's "See all" opens its novel listing, newest first.
  },
  {
    id: SectionID.Latest,
    title: "Latest Releases (Comics)",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
  {
    id: SectionID.NovelLatest,
    title: "Latest Releases (Novels)",
    style: SectionStyle.DetailedVerticalListGrouped,
    viewMore: false,
  },
];

export const FilterID = {
  Type: "type",
  Genres: "genres",
} as const;

/** The site keeps comics and novels in separate listings, so search reads one at a time. */
export const TypeID = {
  Comic: "comic",
  Novel: "novel",
} as const;

export type TitleKind = (typeof TypeID)[keyof typeof TypeID];

export const TYPE_OPTIONS = [
  { id: TypeID.Comic, title: "Comics" },
  { id: TypeID.Novel, title: "Novels" },
];

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
  /** Where the title stands, as a listing card prints it. */
  status?: string;
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
