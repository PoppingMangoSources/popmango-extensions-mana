/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://xcomic.me";

/** The site's filter lists change rarely; a day old is still a usable form. */
export const TAXONOMY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** The site answers on any of these hosts; a reader on a blocked network picks another. */
export const MIRROR_OPTIONS: Option[] = [
  { id: "https://xcomic.me", title: "xcomic.me" },
  { id: "https://xcomic.net", title: "xcomic.net" },
  { id: "https://yona.to", title: "yona.to" },
  { id: "https://comik.to", title: "comik.to" },
];

// Every URL the source builds goes through here so the mirror setting reaches the
// parsers, which have no way to await a preference read of their own.
//
// Two of them: the host the reader chose, and the one that last answered. They differ only
// while the chosen host is unreachable — a request that falls through to another mirror
// leaves it here, so the rest of a screen goes straight there instead of every row waiting
// out the same dead host again.
let selectedBaseUrl: string = BASE_URL;
let activeBaseUrl: string = BASE_URL;

function isMirror(url: string): boolean {
  return MIRROR_OPTIONS.some((option) => option.id === url);
}

export function baseUrl(): string {
  return activeBaseUrl;
}

/**
 * The setting is read again before every request, so this only moves the active host when
 * the reader actually picked a different one. Reasserting the same choice would otherwise
 * throw away what the last request learned, and each row would rediscover the dead host.
 */
export function setBaseUrl(url: string): void {
  const chosen = isMirror(url) ? url : BASE_URL;
  if (chosen === selectedBaseUrl) return;

  selectedBaseUrl = chosen;
  activeBaseUrl = chosen;
}

/** Remembers the host that answered, so the next request starts there. */
export function setActiveBaseUrl(url: string): void {
  if (isMirror(url)) activeBaseUrl = url;
}

/**
 * The mirror a URL belongs to, if any. Built by hand rather than with `URL`, which the
 * runtime does not have.
 */
export function mirrorOrigin(url: string): string | undefined {
  return MIRROR_OPTIONS.map((option) => option.id).find(
    (origin) => url === origin || url.startsWith(`${origin}/`),
  );
}

/** Where to try a request, in order: what last worked, what was chosen, then the rest. */
export function mirrorCandidates(): string[] {
  return [...new Set([activeBaseUrl, selectedBaseUrl, ...MIRROR_OPTIONS.map((o) => o.id)])];
}

export function searchPageUrl(): string {
  return `${activeBaseUrl}/search`;
}

export const PAGE_SIZE = 36;
export const CHAPTER_PAGE_SIZE = 1000;
// The full list repeats every scanlator's upload, so it is read in smaller pages.
export const CHAPTER_FULL_PAGE_SIZE = 100;
export const RECENTLY_ADDED_SIZE = 50;

export const FilterID = {
  Types: "types",
  ContentRatings: "content_ratings",
  Demographics: "demographics",
  Genres: "genres",
  IncludeMode: "include_mode",
  ExcludeMode: "exclude_mode",
  OriginalStatus: "original_status",
  UploadStatus: "upload_status",
  ChapterCount: "chapter_count",
  Year: "year",
  OriginalLanguages: "original_languages",
  TranslatedLanguages: "translated_languages",
  LetterMode: "letter_mode",
} as const;

export const PreferenceID = {
  Mirror: "mirror",
  ContentRatings: "content-ratings",
  ContentTypes: "content-types",
  ExcludedGenres: "excluded-genres",
  Languages: "languages",
  RemoveTitleVersion: "remove-title-version",
  CustomTitleRegex: "custom-title-regex",
  IgnoreGenreBlocklist: "ignore-genre-blocklist",
  DeduplicateChapters: "deduplicate-chapters",
  ShowSourceInTitle: "show-source-in-title",
  SectionPrefix: "section",
} as const;

export const SortID = {
  Score: "field_score",
  Update: "field_update",
  Create: "field_create",
  NameAscending: "field_name_asc",
  NameDescending: "field_name_desc",
  Chapters: "field_chapter",
  Follows: "field_follow",
  Reviews: "field_review",
  Comments: "field_comment",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Score, title: "Rating Score", isDefault: true },
  { id: SortID.Update, title: "Latest Update" },
  { id: SortID.Create, title: "Recently Added" },
  { id: SortID.NameAscending, title: "Name A-Z" },
  { id: SortID.NameDescending, title: "Name Z-A" },
  { id: SortID.Chapters, title: "Most Chapters" },
  { id: SortID.Follows, title: "Most Follows" },
  { id: SortID.Reviews, title: "Most Reviews" },
  { id: SortID.Comments, title: "Most Comments" },
];

export const TYPE_OPTIONS: Option[] = [
  { id: "manhwa", title: "Manhwa" },
  { id: "manga", title: "Manga" },
  { id: "manhua", title: "Manhua" },
  { id: "other", title: "Other" },
  { id: "oel", title: "OEL" },
  { id: "novel", title: "Novel" },
];

export const CONTENT_RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "josei", title: "Josei" },
  { id: "male_demographic_with_female_lead", title: "Male Demographic with Female Lead" },
  { id: "kodomo", title: "Kodomo" },
  { id: "male_demographic_with_female_author", title: "Male Demographic with Female Author" },
  { id: "female_demographic_with_male_lead", title: "Female Demographic with Male Lead" },
  { id: "male_oriented", title: "Male Oriented" },
  { id: "female_oriented", title: "Female Oriented" },
];

// A picker cannot be cleared once set, so every one of them opens with its own
// "everything" row rather than relying on nothing being chosen.
export const STATUS_OPTIONS: Option[] = [
  { id: "", title: "All" },
  { id: "pending", title: "Pending" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const GENRE_MODE_OPTIONS: Option[] = [
  { id: "and", title: "AND" },
  { id: "or", title: "OR" },
];

export const LETTER_MODE_OPTIONS: Option[] = [
  { id: "", title: "Disabled" },
  { id: "letter", title: "Enabled" },
];

export const CHAPTER_COUNT_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "0", title: "0" },
  { id: "1", title: "1+" },
  { id: "10", title: "10+" },
  { id: "20", title: "20+" },
  { id: "30", title: "30+" },
  { id: "40", title: "40+" },
  { id: "50", title: "50+" },
  { id: "60", title: "60+" },
  { id: "70", title: "70+" },
  { id: "80", title: "80+" },
  { id: "90", title: "90+" },
  { id: "100", title: "100+" },
  { id: "200", title: "200+" },
  { id: "300", title: "300+" },
  { id: "1-9", title: "1~9" },
  { id: "10-19", title: "10~19" },
  { id: "20-29", title: "20~29" },
  { id: "30-39", title: "30~39" },
  { id: "40-49", title: "40~49" },
  { id: "50-59", title: "50~59" },
  { id: "60-69", title: "60~69" },
  { id: "70-79", title: "70~79" },
  { id: "80-89", title: "80~89" },
  { id: "90-99", title: "90~99" },
  { id: "100-199", title: "100~199" },
  { id: "200-299", title: "200~299" },
];

// The site's own language codes: underscored regional variants, and `_t` for
// anything it does not name.
export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "fr", title: "French" },
  { id: "pt", title: "Portuguese" },
  { id: "pt_br", title: "Portuguese (BR)" },
  { id: "es", title: "Spanish" },
  { id: "es_419", title: "Spanish (LA)" },
  { id: "ko", title: "Korean" },
  { id: "ja", title: "Japanese" },
  { id: "id", title: "Indonesian" },
  { id: "zh", title: "Chinese" },
  { id: "ru", title: "Russian" },
  { id: "ab", title: "Abkhazian" },
  { id: "af", title: "Afrikaans" },
  { id: "sq", title: "Albanian" },
  { id: "am", title: "Amharic" },
  { id: "ar", title: "Arabic" },
  { id: "hy", title: "Armenian" },
  { id: "az", title: "Azerbaijani" },
  { id: "eu", title: "Basque" },
  { id: "be", title: "Belarusian" },
  { id: "bn", title: "Bengali" },
  { id: "bs", title: "Bosnian" },
  { id: "bg", title: "Bulgarian" },
  { id: "my", title: "Burmese" },
  { id: "km", title: "Cambodian" },
  { id: "ca", title: "Catalan" },
  { id: "ceb", title: "Cebuano" },
  { id: "cv", title: "Chuvash" },
  { id: "hr", title: "Croatian" },
  { id: "cs", title: "Czech" },
  { id: "da", title: "Danish" },
  { id: "nl", title: "Dutch" },
  { id: "eo", title: "Esperanto" },
  { id: "et", title: "Estonian" },
  { id: "fo", title: "Faroese" },
  { id: "fil", title: "Filipino" },
  { id: "fi", title: "Finnish" },
  { id: "gl", title: "Galician" },
  { id: "ka", title: "Georgian" },
  { id: "de", title: "German" },
  { id: "el", title: "Greek" },
  { id: "gn", title: "Guarani" },
  { id: "gu", title: "Gujarati" },
  { id: "ht", title: "Haitian Creole" },
  { id: "ha", title: "Hausa" },
  { id: "he", title: "Hebrew" },
  { id: "hi", title: "Hindi" },
  { id: "hu", title: "Hungarian" },
  { id: "is", title: "Icelandic" },
  { id: "ig", title: "Igbo" },
  { id: "ga", title: "Irish" },
  { id: "it", title: "Italian" },
  { id: "jv", title: "Javanese" },
  { id: "kn", title: "Kannada" },
  { id: "kk", title: "Kazakh" },
  { id: "ku", title: "Kurdish" },
  { id: "ky", title: "Kyrgyz" },
  { id: "lo", title: "Laothian" },
  { id: "la", title: "Latin" },
  { id: "lv", title: "Latvian" },
  { id: "lt", title: "Lithuanian" },
  { id: "lb", title: "Luxembourgish" },
  { id: "mk", title: "Macedonian" },
  { id: "mg", title: "Malagasy" },
  { id: "ms", title: "Malay" },
  { id: "ml", title: "Malayalam" },
  { id: "mt", title: "Maltese" },
  { id: "mi", title: "Maori" },
  { id: "mr", title: "Marathi" },
  { id: "mo", title: "Moldavian" },
  { id: "mn", title: "Mongolian" },
  { id: "ne", title: "Nepali" },
  { id: "no", title: "Norwegian" },
  { id: "ny", title: "Nyanja" },
  { id: "ps", title: "Pashto" },
  { id: "fa", title: "Persian" },
  { id: "pl", title: "Polish" },
  { id: "ro", title: "Romanian" },
  { id: "rm", title: "Romansh" },
  { id: "sm", title: "Samoan" },
  { id: "sr", title: "Serbian" },
  { id: "sh", title: "Serbo-Croatian" },
  { id: "st", title: "Sesotho" },
  { id: "sn", title: "Shona" },
  { id: "sd", title: "Sindhi" },
  { id: "si", title: "Sinhalese" },
  { id: "sk", title: "Slovak" },
  { id: "sl", title: "Slovenian" },
  { id: "so", title: "Somali" },
  { id: "sw", title: "Swahili" },
  { id: "ss", title: "Swati" },
  { id: "sv", title: "Swedish" },
  { id: "tg", title: "Tajik" },
  { id: "ta", title: "Tamil" },
  { id: "te", title: "Telugu" },
  { id: "th", title: "Thai" },
  { id: "ti", title: "Tigrinya" },
  { id: "to", title: "Tonga" },
  { id: "tr", title: "Turkish" },
  { id: "tk", title: "Turkmen" },
  { id: "uk", title: "Ukrainian" },
  { id: "ur", title: "Urdu" },
  { id: "uz", title: "Uzbek" },
  { id: "vi", title: "Vietnamese" },
  { id: "yo", title: "Yoruba" },
  { id: "zu", title: "Zulu" },
  { id: "_t", title: "Other" },
];

export const SectionID = {
  TopRated: "top_rated",
  MostReviews: "most_reviews",
  MostFollows: "most_follows",
  LatestUploads: "latest_uploads",
  MostChapters: "most_chapters",
  RecentlyAdded: "recently_added",
} as const;

/** A home row is the browse query under one sort, except the two that have endpoints. */
export type DiscoverSection = PageSectionSpec & { sort?: string };

// Titles are the site's own, as the other clients for it use them.
export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: SectionID.TopRated,
    title: "Rating Score",
    style: SectionStyle.SimpleHeroPaged,
    sort: SortID.Score,
  },
  {
    id: SectionID.MostReviews,
    title: "Most Reviews",
    style: SectionStyle.DetailedDoubleRowPaged,
    sort: SortID.Reviews,
  },
  {
    id: SectionID.MostFollows,
    title: "Most Follows",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.Follows,
  },
  {
    id: SectionID.LatestUploads,
    title: "Latest Uploads",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.MostChapters,
    title: "Most Chapters",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.Chapters,
  },
  {
    id: SectionID.RecentlyAdded,
    title: "Recently Added",
    style: SectionStyle.SimpleSingleRow,
  },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];
export const DEFAULT_CONTENT_TYPES = TYPE_OPTIONS.map((option) => option.id);

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.Mirror]: BASE_URL,
  [PreferenceID.ContentRatings]: DEFAULT_CONTENT_RATINGS,
  [PreferenceID.ContentTypes]: DEFAULT_CONTENT_TYPES,
  [PreferenceID.ExcludedGenres]: [] as string[],
  [PreferenceID.Languages]: ["en"],
  [PreferenceID.RemoveTitleVersion]: false,
  [PreferenceID.CustomTitleRegex]: "",
  [PreferenceID.IgnoreGenreBlocklist]: false,
  // Off: the site lists every group's upload, and collapsing them by chapter number hides
  // translations a reader may have come for.
  [PreferenceID.DeduplicateChapters]: false,
  [PreferenceID.ShowSourceInTitle]: true,
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [`${PreferenceID.SectionPrefix}-${section.id}`, true]),
  ),
};

/**
 * Bracketed edition markers the site appends to a title — `(Official)`, `[Yaoi]`,
 * `《…》` and the rest — stripped when the reader asks for plain titles.
 */
export const TITLE_VERSION_REGEX =
  /\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/ ?Official/gi;

/** Genres the site files under a rating, used to infer one for a listing. */
export const CONTENT_RATING_GENRES: Record<string, readonly string[]> = {
  suggestive: ["ecchi", "mature", "yaoi", "yuri"],
  erotica: ["adult", "erotica", "smut"],
  pornographic: ["hentai", "pornographic"],
};

/** What every listing tile needs, so a row never costs a second request to fill in. */
const LISTING_FIELDS = `
      id name urlPath urlCover
      translatedLanguage type contentRating genres tags
      score_val follows comments_total chaps_normal
      views { field count }`;

/**
 * The team behind an edition, which only some of the endpoints' types carry.
 *
 * `get_comic_browse_items` answers a lighter comic than the feeds do, and asking it for a
 * field that type does not have fails the whole query rather than leaving the field null —
 * so a browse row falls back to the team the site wrote into the name instead.
 */
const TEAM_FIELD = `
      subName`;

/**
 * Browse, which the site keys by title rather than by comic.
 *
 * `get_comic_browse_items` still validates but throws inside its own resolver — every
 * request to it comes back `INTERNAL_SERVER_ERROR` against a null `get_comic_browse_items`,
 * whatever the fields or the filters. The site's own browse page reads titles, and a title
 * carries the editions of it as `comicNodes`; the one matching the reader's language is the
 * entry a tile stands for, since a comic id is what the rest of the source is keyed by.
 *
 * The field names differ from every other endpoint's — this type spells them in snake
 * case — so they are aliased back to the shape the parsers already read.
 *
 * `comicNodes` is the one field here the site's own page does not ask for. It answers all
 * the same, and it is the only thing that turns a title back into something openable.
 * `subName` rides along with it: the label belongs to the edition, not to the work, so
 * asking for it on the title itself would answer nothing.
 */
export const BROWSE_QUERY = `
query get_title_browse_items($select: Title_Browse_Select) {
  get_title_browse_items(select: $select) {
    data {
      id
      name: title
      urlPath
      urlCover: cover_local_url
      remoteCoverUrl: cover_url
      originalLanguage: original_language
      translatedLanguages: translated_languages
      type: type_id
      contentRating: content_rating_id
      genres: genre_ids
      tags: format_ids
      originalStatus: status
      score_val: vote_val
      follows: total_follows
      comments_total: total_comments
      chaps_normal: total_chapters
      chapterPublishedAt: chap_last_public_at
    }
    comicNodes { data { id name subName translatedLanguage chaps_normal } }
  }
}`;

/**
 * The latest-uploads feed, which the site keys by title rather than by comic.
 *
 * `get_comic_latestUploads` still answers and still validates, but it answers with nothing —
 * an empty feed, not an error — so a source reading it shows an empty row and no reason why.
 * This is the one that carries the uploads. An item is a title holding its newest chapters,
 * each of which holds the comic it belongs to.
 */
export const LATEST_UPLOADS_QUERY = `
query get_title_latestUploads($select: Title_LatestUploads_Select) {
  get_title_latestUploads(select: $select) {
    before
    items {
      chapters(amount: 3) {
        id
        data {
          id serial chaNum urlPath dbStatus dateCreate dateModify datePublic
          comicNode { data {${LISTING_FIELDS}${TEAM_FIELD}
          } }
        }
      }
    }
  }
}`;

export const RECENTLY_ADDED_QUERY = `
query get_comic_recentlyAdded($select: Comic_RecentlyAdded_Select) {
  get_comic_recentlyAdded(select: $select) {
    before
    items { data {${LISTING_FIELDS}${TEAM_FIELD}
    } }
  }
}`;

export const COMIC_QUERY = `
query get_comicNode($id: ID!) {
  get_comicNode(id: $id) {
    data {
      id name subName altNames
      originalLanguage translatedLanguage
      originalStatus uploadStatus
      type demographics contentRating genres tags
      authorNodes { data { name } }
      artistNodes { data { name } }
      publisherNodes { data { name } }
      summary { html }
      urlPath urlCover
      score_val follows comments_total chaps_normal
      views { field count }
    }
  }
}`;

const CHAPTER_FIELDS = `
    paging { next total }
    items {
      data {
        id serial chaNum volNum dname title urlPath
        dateCreate dateModify datePublic
        srcName srcTitle
        groupNodes { data { name } }
        userNode { data { name } }
      }
    }`;

/** The server-deduplicated list: one entry per chapter number, newest source wins. */
export const CHAPTERS_UNIQUE_QUERY = `
query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
  get_comic_chapterList_uniqList(select: $select) {${CHAPTER_FIELDS}
  }
}`;

/** Every upload, including a second scanlator's take on a chapter already listed. */
export const CHAPTERS_FULL_QUERY = `
query get_comic_chapterList_fullList($select: Select_Comic_ChapterList) {
  get_comic_chapterList_fullList(select: $select) {${CHAPTER_FIELDS}
  }
}`;

export const CHAPTER_PAGES_QUERY = `
query get_chapterNode($id: ID!) {
  get_chapterNode(id: $id) { data { imageUrls } }
}`;

export type GraphQLResponse<T> = {
  data?: T;
  errors?: {
    message: string;
    /** Where in the query the server gave up, which is the only clue it offers. */
    locations?: { line?: number; column?: number }[] | null;
    extensions?: { code?: string | null } | null;
  }[];
};

export type NamedNode = { data?: { name?: string | null } | null };

export type ComicData = {
  id: string;
  name: string;
  /** The team behind this edition. A title published by several has one comic each. */
  subName?: string | null;
  altNames?: string[] | null;
  urlPath?: string | null;
  urlCover?: string | null;
  /** Where browse keeps the cover it has not mirrored yet; the local one is empty then. */
  remoteCoverUrl?: string | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  /** Browse answers per title, so it names every language an edition of one was made in. */
  translatedLanguages?: string[] | null;
  originalStatus?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  authorNodes?: NamedNode[] | null;
  artistNodes?: NamedNode[] | null;
  publisherNodes?: NamedNode[] | null;
  summary?: { html?: string | null } | null;
  // The API has been seen sending this as a string as well as a number.
  score_val?: number | string | null;
  follows?: number | null;
  comments_total?: number | null;
  chaps_normal?: number | null;
  /**
   * Views, counted once per window rather than as a single total.
   *
   * `field` is the same id the sort options use — `views_d000` is every view the site has
   * ever counted, `views_h024` the last day's — so the total is the `views_d000` bucket.
   */
  views?: { field?: string | null; count?: number | null }[] | null;
  /** When the newest chapter went up. Browse states it on the title rather than naming one. */
  chapterPublishedAt?: number | string | null;
  chapterNodes_last?: { data?: ChapterData | null }[] | null;
};

export type ChapterData = {
  id: string;
  serial?: number | null;
  chaNum?: number | string | null;
  /** Which volume a chapter was collected into, where the site knows of one. */
  volNum?: number | string | null;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | string | null;
  dateModify?: number | string | null;
  datePublic?: number | string | null;
  srcName?: string | null;
  /** The aggregator's name as the site writes it, where `srcName` is its bare slug. */
  srcTitle?: string | null;
  groupNodes?: NamedNode[] | null;
  userNode?: NamedNode | null;
  /** Anything but `normal` is a chapter the site has withdrawn but still lists. */
  dbStatus?: string | null;
  /** Only the latest-uploads feed fills this: the comic the chapter belongs to. */
  comicNode?: ComicNode | null;
};

export type ComicNode = { data: ComicData };

/** A title as browse returns it: the work itself, plus one comic per edition of it. */
export type TitleNode = { data: ComicData; comicNodes?: ComicNode[] | null };

export type BrowseResponse = { get_title_browse_items?: TitleNode[] | null };

export type LatestUploadsResponse = {
  get_title_latestUploads?: {
    before?: number | null;
    items?: { chapters?: { data: ChapterData }[] | null }[] | null;
  } | null;
};

export type RecentlyAddedResponse = {
  get_comic_recentlyAdded?: { before?: number | null; items?: ComicNode[] | null } | null;
};

export type ComicNodeResponse = { get_comicNode?: ComicNode | null };

export type ChapterListPage = {
  paging?: { next?: number | null; total?: number | null } | null;
  items?: { data: ChapterData }[] | null;
};

export type ChapterListResponse = {
  get_comic_chapterList_uniqList?: ChapterListPage | null;
  get_comic_chapterList_fullList?: ChapterListPage | null;
};

export type ChapterPagesResponse = {
  get_chapterNode?: { data?: { imageUrls?: string[] | null } | null } | null;
};

/** The `select` object the browse query takes; every field is sent, nulls included. */
export type BrowseSelect = {
  // "letter" runs the site's slower prefix match instead of its usual index search.
  where: "browse" | "letter";
  page: number;
  size: number;
  sortby: string;
  word: string;
  incOLangs: string[];
  incTLangs: string[];
  incGenres: string[];
  excGenres: string[];
  incGenresMode: string | null;
  excGenresMode: string | null;
  incTypes: string[];
  incDemographics: string[];
  incContentRatings: string[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
  origStatus: string | null;
  chapCount: string;
  /** Where the site has got to with an edition, sent only where a reader picked one. */
  siteStatus?: string;
  /**
   * Asks the site to stand its own account-level filtering aside.
   *
   * Sent only when a reader turned it on: the site's own clients send none of these, and a
   * field browse does not expect is a field it can throw on.
   */
  ignoreGlobalGenres?: boolean;
};
