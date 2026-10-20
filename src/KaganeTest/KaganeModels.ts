/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Option, SectionStyle, SortOption } from "@mana-app/types";

export const DOMAIN = "https://kagane.org";
export const MIRRORS = ["kagane.org", "kagane.cx", "kagane.si", "kagane.moe", "kagane.net"];
let site = DOMAIN;
// Every URL is built from the chosen mirror when it is needed, so a changed setting reaches all of them.
export const origin = (): string => site;
export const api = (): string => `${site}/api/v2`;
export function setMirror(host: unknown): string {
  const chosen = typeof host === "string" && MIRRORS.includes(host) ? host : "kagane.org";
  site = `https://${chosen}`;
  return chosen;
}
/** The app's runtime has no URL global; only HTTPS on the default port, without credentials, is read. */
export function parseURL(
  value: string,
): { origin: string; hostname: string; pathname: string } | undefined {
  const match = /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^?#]*)?(?:[?#].*)?$/i.exec(value);
  const hostname = match?.[1]?.toLowerCase();
  return hostname
    ? { origin: `https://${hostname}`, hostname, pathname: match?.[2] ?? "/" }
    : undefined;
}
// kstatic.to is the exact CDN published by Kagane's own reader challenge.
export const trustedHost = (host: string): boolean =>
  host === "kstatic.to" || MIRRORS.some((mirror) => host === mirror || host.endsWith(`.${mirror}`));
export const PAGE_SIZE = 50;
export const FilterID = { Tags: "tags" } as const;
export const RATINGS = ["Safe", "Suggestive", "Erotica", "Pornographic"] as const;
export type Rating = (typeof RATINGS)[number];
export const options = (values: readonly string[]): Option[] =>
  values.map((value) => ({ id: value, title: value }));
export const FORMATS = options(["Manga", "Manhwa", "Manhua", "Comic", "Other"]);
export const STATUSES: Option[] = [
  ...options(["Ongoing", "Completed", "Hiatus"]),
  { id: "Abandoned", title: "Cancelled" },
];
export const UPLOADS: Option[] = [
  { id: "all", title: "All uploads" },
  { id: "official", title: "Official only" },
  { id: "scanlations", title: "Scanlations only" },
];
export const LANGUAGES: Option[] = [
  ["en", "English"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-Hans", "Chinese (Simplified)"],
  ["zh-Hant", "Chinese (Traditional)"],
  ["es", "Spanish"],
  ["es-419", "Spanish (Latin America)"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["ru", "Russian"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
  ["ar", "Arabic"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["hi", "Hindi"],
].map(([id, title]) => ({ id: id ?? "", title: title ?? "" }));
export const SORTS: SortOption[] = [
  { id: "relevance", title: "Relevance", isDefault: true },
  ...[
    ["total_views", "Popular (Total Views)"],
    ["avg_views", "Popular (Average Views)"],
    ["avg_views_today", "Popular (Today)"],
    ["popular_now", "Popular Now"],
    ["avg_views_week", "Popular (Week)"],
    ["avg_views_month", "Popular (Month)"],
  ].map(([id, title]) => ({ id: id ?? "", title: title ?? "" })),
  ...[
    ["updated_at", "Updated"],
    ["current_books", "Chapter count"],
    ["created_at", "Added"],
    ["rating", "Rating"],
  ].map(([id, title]) => ({
    id: id ?? "",
    title: title ?? "",
    isOrderable: true,
    defaultAscending: false,
  })),
];
export const CHART = "trending_chart";
export const SECTIONS = [
  {
    id: "popular",
    title: "Popular",
    subtitle: "The most-read titles across all time",
    sort: "total_views",
    style: SectionStyle.SimpleHeroPaged,
  },
  // The chart keeps its own order.
  {
    id: CHART,
    title: "Trending This Week",
    subtitle: "Titles gaining reading momentum this week",
    sort: "relevance",
    style: SectionStyle.DetailedTripleRowPaged,
  },
  {
    id: "trending_month",
    title: "Popular This Month",
    subtitle: "The most-read titles this month",
    sort: "avg_views_month",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: "trending_week",
    title: "Popular This Week",
    subtitle: "The most-read titles this week",
    sort: "avg_views_week",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: "latest_updates",
    title: "Latest Updates",
    subtitle: "Fresh chapters as they arrive",
    sort: "updated_at",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: "trending_today",
    title: "Popular Today",
    subtitle: "The most-read titles today",
    sort: "avg_views_today",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: "recently_added",
    title: "Recently Added",
    subtitle: "New arrivals in the catalogue",
    sort: "created_at",
    style: SectionStyle.SimpleSingleRow,
  },
];
// Detailed layouts draw info rows instead of the cover pill.
export const isDetailed = (style?: SectionStyle): boolean =>
  style === SectionStyle.DetailedTripleRowPaged ||
  style === SectionStyle.DetailedVerticalListGrouped;
export const AGE_RATINGS: Record<Rating, string> = {
  Safe: "Safe",
  Suggestive: "FifteenPlus",
  Erotica: "EighteenPlus",
  Pornographic: "EighteenPlus",
};
// Field, lowest and highest accepted value, and for a stepper the value it starts at.
export const RANGES: readonly (readonly [string, number, number, number?])[] = [
  ["current_books", 0, 2147483647, 0],
  ["current_volumes", 0, 2147483647, 0],
  ["start_year", 1, 9999],
  ["end_year", 1, 9999],
];
// The site accepts at most this many genres, tags or sources in one filter.
export const MAX_IDS = 50;
export const CHAPTER_PRESETS: Option[] = [
  { id: "1-20", title: "1–20" },
  { id: "21-100", title: "21–100" },
  { id: "101+", title: "101+" },
];
export type Classification = {
  content_rating?: string | null;
  age_rating?: string | null;
  is_pornographic?: boolean | null;
};
export type AlternateTitle = { title: string; label?: string | null };
export type Series = Classification & {
  series_id: string;
  title: string;
  title_language?: string | null;
  source_id?: string | null;
  edition_info?: string | null;
  cover_image_id?: string | null;
  current_books?: number;
  start_year?: number | null;
  rating?: number | null;
  format?: string | null;
  publication_status?: string | null;
  upload_status?: string | null;
  translated_language?: string | null;
  genres?: string[];
  tags?: string[];
  is_disturbing?: boolean | null;
  hidden_by_filter?: boolean;
  genre_list?: { id: string; name: string }[];
  latest_chapters?: {
    title?: string | null;
    chapter_no?: string | null;
    volume_no?: string | null;
    created_at?: string | null;
    available_at?: string | null;
  }[];
};
export type TrendingEntry = {
  position: number;
  delta?: number | null;
  is_new?: boolean;
  lift?: number | null;
  hidden_by_filter?: boolean;
  series: Series;
};
export type Detail = Classification & {
  series_id?: string;
  title: string;
  title_language?: string | null;
  description?: string | null;
  source_id?: string | null;
  edition_info?: string | null;
  format?: string | null;
  publication_status?: string | null;
  upload_status?: string | null;
  translated_language?: string | null;
  series_covers?: { image_id: string; is_main?: boolean }[];
  series_staff?: { name: string; role: string }[];
  genres?: { genre_id?: string; genre_name: string; is_spoiler?: boolean }[];
  tags?: { tag_id?: string; tag_name: string; is_spoiler?: boolean; spoiler?: boolean }[];
  tracker_id?: string | null;
  series_alternate_titles?: AlternateTitle[];
  average_rating?: number | null;
  bayesian_rating?: number | null;
  total_ratings?: number | null;
  total_views?: number | null;
  series_links?: { url?: string | null; label?: string | null; kind?: string | null }[] | null;
};
export type Book = {
  book_id: string;
  series_id?: string | null;
  title: string;
  chapter_no?: string | null;
  volume_no?: string | null;
  sort_no?: number;
  released_at?: string | null;
  created_at?: string | null;
  available_at?: string | null;
  page_count?: number;
  groups?: { title: string }[];
  is_locked?: boolean;
  requires_login?: boolean;
  is_paid?: boolean;
};
export type SearchResponse = {
  content: Series[];
  last: boolean;
  total_elements?: number;
  total_pages?: number;
  facets?: { content_lang?: { value: string }[] };
};
export type Genre = { id: string; genre_name: string };
export type TagEntry = { id: string; tag_name: string };
export type UploadSource = { source_id: string; source_type: string; title: string };
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function strictUUID(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}
export type ManifestPage = { page_no: number; page_id: string; ext?: string | null };
export type Challenge = {
  access_token: string;
  expires_at?: number | string;
  expires_in?: number;
  cache_url?: string | null;
  manifest?: { pages?: ManifestPage[] } | null;
};
export type Settings = {
  contentRatings: Rating[];
  showSource: boolean;
  showEdition: boolean;
  cleanTitle: boolean;
  showSpoilers: boolean;
  dataSaver: boolean;
  uploadSource: string;
  languages: string[];
  excludedGenres: string[];
  excludedTags: string[];
  chapterTitle: string;
  hideDisturbing: boolean;
  mirror: string;
};
export type Selection = { included: Option[]; excluded: Option[] };
export type Filters = Record<string, string | number | boolean | Option | Option[] | Selection>;

export function validId(id: string): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Kagane ID");
  return id;
}
export const seriesURL = (id: string): string => `${origin()}/series/${validId(id)}`;
export const chapterURL = (id: string, chapter: string): string =>
  `${seriesURL(id)}/reader/${validId(chapter)}`;
export const imageURL = (id?: string | null): string =>
  id?.trim() ? `${api()}/image/${encodeURIComponent(id.trim())}` : "";
