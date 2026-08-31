/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

export const DOMAIN = "https://www.mangago.me";

// The reader needs a desktop UA to return the whole image list in one response;
// browsing uses a mobile UA, which is what yields /read-manga/ chapter links.
export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export const BROWSE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const READER_MIRROR_HOSTS = [DOMAIN, "https://www.mangago.zone", "https://www.youhim.me"];

export const FilterID = {
  Genres: "genres",
  Statuses: "statuses",
} as const;

export const SortID = {
  Views: "views",
  CommentCount: "comment_count",
  CreateDate: "create_date",
  UpdateDate: "update_date",
  Random: "random",
  Alphabetical: "alphabetical",
} as const;

export const PreferenceID = {
  HiddenGenres: "hidden-genres",
  ContentType: "content-type",
  HideRaws: "hide-raws",
  RemoveTitleVersion: "remove-title-version",
  SectionPrefix: "section",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Views, title: "Views", isDefault: true, isOrderable: false },
  { id: SortID.CommentCount, title: "Comment Count", isOrderable: false },
  { id: SortID.UpdateDate, title: "Update Date", isOrderable: false },
  { id: SortID.CreateDate, title: "Creation Date", isOrderable: false },
  { id: SortID.Random, title: "Random", isOrderable: false },
  { id: SortID.Alphabetical, title: "Alphabetical", isOrderable: false },
];

const SORT_VALUES: Record<string, string> = {
  [SortID.Views]: "view",
  [SortID.CommentCount]: "comment_count",
  [SortID.CreateDate]: "create_date",
  [SortID.UpdateDate]: "update_date",
  [SortID.Random]: "random",
  [SortID.Alphabetical]: "",
};

export function sortValueFor(id: string | undefined): string {
  return SORT_VALUES[id ?? ""] ?? "";
}

export const STATUS_OPTIONS: Option[] = [
  { id: "f", title: "Completed" },
  { id: "o", title: "Ongoing" },
];

export const GENRES = [
  "Yaoi",
  "Comedy",
  "Shounen Ai",
  "Shoujo",
  "Yuri",
  "Josei",
  "Fantasy",
  "School Life",
  "Romance",
  "Doujinshi",
  "Smut",
  "Adult",
  "Mystery",
  "One Shot",
  "Ecchi",
  "Shounen",
  "Martial Arts",
  "Shoujo Ai",
  "Supernatural",
  "Drama",
  "Action",
  "Adventure",
  "Harem",
  "Historical",
  "Horror",
  "Mature",
  "Mecha",
  "Psychological",
  "Sci-fi",
  "Seinen",
  "Slice Of Life",
  "Sports",
  "Gender Bender",
  "Tragedy",
  "Bara",
  "Webtoons",
];

export function genreIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const GENRE_OPTIONS: Option[] = GENRES.map((genre) => ({
  id: genreIdFromTitle(genre),
  title: genre,
}));

export function getGenreTitle(idOrTitle: string): string {
  return (
    GENRE_OPTIONS.find((genre) => genre.id === idOrTitle || genre.title === idOrTitle)?.title ??
    idOrTitle
  );
}

export type DiscoverSection = {
  id: string;
  title: string;
  subtitle?: string;
  style: SectionStyle;
  limit?: number;
};

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: "featured_manga",
    title: "Featured Manga",
    subtitle: "The site's own hand-picked slider",
    style: SectionStyle.SimpleHeroPaged,
    limit: 20,
  },
  {
    id: "popular_manga",
    title: "Popular Manga",
    subtitle: "The most talked-about titles on the site",
    style: SectionStyle.DetailedSingleRowPaged,
  },
  {
    id: "new_chapters",
    title: "Latest Update",
    subtitle: "Your daily dose of the latest updates",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  ...(
    [
      ["yaoi", "Yaoi"],
      ["comedy", "Comedy"],
      ["shounen_ai", "Shounen Ai"],
      ["shoujo", "Shoujo"],
      ["yuri", "Yuri"],
      ["josei", "Josei"],
      ["fantasy", "Fantasy"],
      ["school_life", "School Life"],
      ["supernatural", "Supernatural"],
      ["mystery", "Mystery"],
    ] as const
  ).map(([id, genre]) => ({
    id: `top_${id}`,
    title: `${genre} Manga Top 10`,
    style: SectionStyle.SimpleDoubleRow,
    limit: 10,
  })),
];

export const DEFAULT_OFF_SECTION_IDS = new Set<string>([]);

export const SECTION_ALIASES: Record<string, string> = {
  popular: "popular_manga",
  latest: "new_chapters",
};

export const CONTENT_TYPE_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "webtoons", title: "Manhwa / Manhua" },
  { id: "manga", title: "Manga" },
];

export const PREFERENCE_DEFAULTS: Record<string, string | string[] | boolean | number> = {
  [PreferenceID.HiddenGenres]: [] as string[],
  [PreferenceID.ContentType]: "all",
  [PreferenceID.HideRaws]: true,
  [PreferenceID.RemoveTitleVersion]: false,
  ...Object.fromEntries(
    DISCOVER_SECTIONS.map((section) => [
      `${PreferenceID.SectionPrefix}-${section.id}`,
      !DEFAULT_OFF_SECTION_IDS.has(section.id),
    ]),
  ),
};

export type MangagoListing = {
  id: string;
  title: string;
  cover: string;
  subtitle?: string;
  chapterId?: string;
  publishDate?: Date;
  genres?: string[];
};

export const TITLE_VERSION_REGEX =
  /^(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩)\s*)+|(?:\s*(?:\([^()]*\)|\{[^{}]*\}|\[(?:(?!\]).)*\]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/\s*Official)\s*)+$/gi;
