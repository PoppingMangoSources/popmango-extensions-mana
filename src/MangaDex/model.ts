/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SectionStyle, type Option, type SortOption } from "@mana-app/types";

import type { PageSectionSpec } from "../common/index.ts";

export const BASE_URL = "https://mangadex.org";
export const API_URL = "https://api.mangadex.org";
/** Covers are served from the uploads host, never from the API one. */
export const COVER_URL = "https://uploads.mangadex.org/covers";

/** `/manga` and `/chapter` both refuse a limit above this. */
export const MAX_LIMIT = 100;
export const PAGE_SIZE = 24;
/** The uploads feed is read long and collapsed to one row per title, so it asks for more. */
export const LATEST_LIMIT = 60;
/** `/manga/{id}/feed` pages at five hundred, which is most titles in one request. */
export const FEED_LIMIT = 500;

/** The tag list and the curated lists are the site's own furniture; a day old is fine. */
export const TAXONOMY_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const CURATED_LISTS_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Popular New Titles is the site's own name for "followed most, published this month". */
export const POPULAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const FilterID = {
  ContentRatings: "content_ratings",
  Statuses: "statuses",
  Demographics: "demographics",
  OriginalLanguages: "original_languages",
  Year: "year",
  Author: "author",
  IncludedTagsMode: "included_tags_mode",
  ExcludedTagsMode: "excluded_tags_mode",
  /** One excludable picker per tag group, suffixed with the group's own name. */
  TagPrefix: "tags",
} as const;

export const PreferenceID = {
  ContentRatings: "content-ratings",
  TranslatedLanguages: "translated-languages",
  OriginalLanguages: "original-languages",
  CoverQuality: "cover-quality",
  DataSaver: "data-saver",
  ForcePort443: "force-port-443",
  HideOfficialPublishers: "hide-official-publishers",
  ShowVolume: "show-volume",
  ShowChapter: "show-chapter",
  SectionPrefix: "section",
} as const;

export const SortID = {
  Relevance: "relevance",
  LatestChapter: "latestUploadedChapter",
  Follows: "followedCount",
  Rating: "rating",
  CreatedAt: "createdAt",
  UpdatedAt: "updatedAt",
  Year: "year",
  Title: "title",
} as const;

// Worded as MangaDex's own sort menu words them.
export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.LatestChapter, title: "Latest Upload", isDefault: true },
  { id: SortID.Relevance, title: "Best Match" },
  { id: SortID.Follows, title: "Most Follows" },
  { id: SortID.Rating, title: "Highest Rating" },
  { id: SortID.CreatedAt, title: "Recently Added" },
  { id: SortID.UpdatedAt, title: "Recently Updated" },
  { id: SortID.Year, title: "Year" },
  { id: SortID.Title, title: "Title" },
];

/** `relevance` only means anything to a query with words in it. */
export const RELEVANCE_SORT_NEEDS_QUERY = true;

export const CONTENT_RATING_OPTIONS: Option[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

/** What the site itself ships with, and what a reader who changes nothing sees. */
export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive"];

export const STATUS_OPTIONS: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "none", title: "None" },
];

/** The three the site offers as a one-tap filter, under the words it uses for them. */
export const ORIGINAL_LANGUAGE_OPTIONS: Option[] = [
  { id: "ja", title: "Japanese (Manga)" },
  { id: "ko", title: "Korean (Manhwa)" },
  { id: "zh", title: "Chinese (Manhua)" },
  { id: "zh-hk", title: "Chinese (Traditional)" },
];

export const TAG_MODE_OPTIONS: Option[] = [
  { id: "AND", title: "And" },
  { id: "OR", title: "Or" },
];

/** Original quality, then the two thumbnails the CDN renders beside every cover. */
export const COVER_QUALITY_OPTIONS: Option[] = [
  { id: "", title: "Original" },
  { id: ".512.jpg", title: "Medium" },
  { id: ".256.jpg", title: "Low" },
];

/**
 * Groups that upload a placeholder pointing at their own reader rather than pages.
 *
 * Their chapters exist on MangaDex and open to nothing, so they are excluded by default —
 * the site's own reader does the same. A reader who wants them turns the setting off.
 */
export const OFFICIAL_PUBLISHER_GROUPS = [
  "5fed0576-8b94-4f9a-b6a7-08eecd69800d",
  "06a9fecb-b608-4f19-b93c-7caab06b7f44",
  "8d8ecf83-8d42-4f8c-add8-60963f9f28d9",
  "caa63201-4a17-4b7f-95ff-ed884a2b7e60",
  "319c1b10-cbd0-4f55-a46e-c4ee17e65139",
  "4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb",
];

/** The user whose public lists are the site's own curated rows. */
export const CURATOR_USER_ID = "d2ae45e0-b5e2-4e7f-a688-17925c2d7d6b";

/** Where the curated rows point when the curator's lists cannot be read at all. */
export const FALLBACK_LIST_IDS = {
  seasonal: "68ab4f4e-6f01-4898-9038-c5eee066be27",
  recommended: "805ba886-dd99-4aa4-b460-4bd7c7b71352",
  selfPublished: "f66ebc10-ef89-46d1-be96-bb704559e04a",
} as const;

export const SectionID = {
  PopularNew: "popular_new",
  LatestUpdates: "latest_updates",
  Seasonal: "seasonal",
  Recommended: "recommended",
  SelfPublished: "self_published",
  RecentlyAdded: "recently_added",
} as const;

export type DiscoverSection = PageSectionSpec & { sort?: string };

// Titles are the site's own, in the order its home page runs them.
export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    id: SectionID.PopularNew,
    title: "Popular New Titles",
    style: SectionStyle.SimpleHeroPaged,
  },
  {
    id: SectionID.LatestUpdates,
    title: "Latest Updates",
    style: SectionStyle.DetailedVerticalListGrouped,
  },
  {
    id: SectionID.Seasonal,
    title: "Seasonal",
    style: SectionStyle.DetailedDoubleRowPaged,
  },
  {
    id: SectionID.Recommended,
    title: "Recommended",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: SectionID.SelfPublished,
    title: "Self-Published",
    style: SectionStyle.SimpleSingleRow,
  },
  {
    id: SectionID.RecentlyAdded,
    title: "Recently Added",
    style: SectionStyle.SimpleSingleRow,
    sort: SortID.CreatedAt,
  },
];

/** Which of the three curated lists a section draws from. */
export const CURATED_SECTIONS: Record<string, keyof typeof FALLBACK_LIST_IDS> = {
  [SectionID.Seasonal]: "seasonal",
  [SectionID.Recommended]: "recommended",
  [SectionID.SelfPublished]: "selfPublished",
};

export type TagGroup = { group: string; tags: Option[] };

/**
 * The tag list as the site had it when this was written.
 *
 * `/manga/tag` is read once a day and replaces this; it stands in only while that read has
 * not happened or could not be made, so a filter form is never empty.
 */
export const BUNDLED_TAG_GROUPS: TagGroup[] = [
  {
    group: "Content",
    tags: [
      { id: "b29d6a3d-1569-4e7a-8caf-7557bc92cd5d", title: "Gore" },
      { id: "97893a4c-12af-4dac-b6be-0dffb353568e", title: "Sexual Violence" },
    ],
  },
  {
    group: "Format",
    tags: [
      { id: "b11fda93-8f1d-4bef-b2ed-8803d3733170", title: "4-Koma" },
      { id: "f4122d1c-3b44-44d0-9936-ff7502c39ad3", title: "Adaptation" },
      { id: "51d83883-4103-437c-b4b1-731cb73d786c", title: "Anthology" },
      { id: "0a39b5a1-b235-4886-a747-1d05d216532d", title: "Award Winning" },
      { id: "b13b2a48-c720-44a9-9c77-39c9979373fb", title: "Doujinshi" },
      { id: "7b2ce280-79ef-4c09-9b58-12b7c23a9b78", title: "Fan Colored" },
      { id: "f5ba408b-0e7a-484d-8d49-4e9125ac96de", title: "Full Color" },
      { id: "3e2b8dae-350e-4ab8-a8ce-016e844b9f0d", title: "Long Strip" },
      { id: "320831a8-4026-470b-94f6-8353740e6f04", title: "Official Colored" },
      { id: "0234a31e-a729-4e28-9d6a-3f87c4966b9e", title: "Oneshot" },
      { id: "891cf039-b895-47f0-9229-bef4c96eccd4", title: "Self-Published" },
      { id: "e197df38-d0e7-43b5-9b09-2842d0c326dd", title: "Web Comic" },
    ],
  },
  {
    group: "Genre",
    tags: [
      { id: "391b0423-d847-456f-aff0-8b0cfc03066b", title: "Action" },
      { id: "87cc87cd-a395-47af-b27a-93258283bbc6", title: "Adventure" },
      { id: "5920b825-4181-4a17-beeb-9918b0ff7a30", title: "Boys' Love" },
      { id: "4d32cc48-9f00-4cca-9b5a-a839f0764984", title: "Comedy" },
      { id: "5ca48985-9a9d-4bd8-be29-80dc0303db72", title: "Crime" },
      { id: "b9af3a63-f058-46de-a9a0-e0c13906197a", title: "Drama" },
      { id: "cdc58593-87dd-415e-bbc0-2ec27bf404cc", title: "Fantasy" },
      { id: "a3c67850-4684-404e-9b7f-c69850ee5da6", title: "Girls' Love" },
      { id: "33771934-028e-4cb3-8744-691e866a923e", title: "Historical" },
      { id: "cdad7e68-1419-41dd-bdce-27753074a640", title: "Horror" },
      { id: "ace04997-f6bd-436e-b261-779182193d3d", title: "Isekai" },
      { id: "81c836c9-914a-4eca-981a-560dad663e73", title: "Magical Girls" },
      { id: "50880a9d-5440-4732-9afb-8f457127e836", title: "Mecha" },
      { id: "c8cbe35b-1b2b-4a3f-9c37-db84c4514856", title: "Medical" },
      { id: "ee968100-4191-4968-93d3-f82d72be7e46", title: "Mystery" },
      { id: "b1e97889-25b4-4258-b28b-cd7f4d28ea9b", title: "Philosophical" },
      { id: "3b60b75c-a2d7-4860-ab56-05f391bb889c", title: "Psychological" },
      { id: "423e2eae-a7a2-4a8b-ac03-a8351462d71d", title: "Romance" },
      { id: "256c8bd9-4904-4360-bf4f-508a76d67183", title: "Sci-Fi" },
      { id: "e5301a23-ebd9-49dd-a0cb-2add944c7fe9", title: "Slice of Life" },
      { id: "69964a64-2f90-4d33-beeb-f3ed2875eb4c", title: "Sports" },
      { id: "7064a261-a137-4d3a-8848-2d385de3a99c", title: "Superhero" },
      { id: "07251805-a27e-4d59-b488-f0bfbec15168", title: "Thriller" },
      { id: "f8f62932-27da-4fe4-8ee1-6779a8c5edba", title: "Tragedy" },
      { id: "acc803a4-c95a-4c22-86fc-eb6b582d82a2", title: "Wuxia" },
    ],
  },
  {
    group: "Theme",
    tags: [
      { id: "e64f6742-c834-471d-8d72-dd51fc02b835", title: "Aliens" },
      { id: "3de8c75d-8ee3-48ff-98ee-e20a65c86451", title: "Animals" },
      { id: "ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869", title: "Cooking" },
      { id: "9ab53f92-3eed-4e9b-903a-917c86035ee3", title: "Crossdressing" },
      { id: "da2d50ca-3018-4cc0-ac7a-6b7d472a29ea", title: "Delinquents" },
      { id: "39730448-9a5f-48a2-85b0-a70db87b1233", title: "Demons" },
      { id: "2bd2e8d0-f146-434a-9b51-fc9ff2c5fe6a", title: "Genderswap" },
      { id: "3bb26d85-09d5-4d2e-880c-c34b974339e9", title: "Ghosts" },
      { id: "fad12b5e-68ba-460e-b933-9ae8318f5b65", title: "Gyaru" },
      { id: "aafb99c1-7f60-43fa-b75f-fc9502ce29c7", title: "Harem" },
      { id: "5bd0e105-4481-44ca-b6e7-7544da56b1a3", title: "Incest" },
      { id: "2d1f5d56-a1e5-4d0d-a961-2193588b08ec", title: "Loli" },
      { id: "85daba54-a71c-4554-8a28-9901a8b0afad", title: "Mafia" },
      { id: "a1f53773-c69a-4ce5-8cab-fffcd90b1565", title: "Magic" },
      { id: "799c202e-7daa-44eb-9cf7-8a3c0441531e", title: "Martial Arts" },
      { id: "ac72833b-c4e9-4878-b9db-6c8a4a99444a", title: "Military" },
      { id: "dd1f77c5-dea9-4e2b-97ae-224af09caf99", title: "Monster Girls" },
      { id: "36fd93ea-e8b8-445e-b836-358f02b3d33d", title: "Monsters" },
      { id: "f42fbf9e-188a-447b-9fdc-f19dc1e4d685", title: "Music" },
      { id: "489dd859-9b61-4c37-af75-5b18e88daafc", title: "Ninja" },
      { id: "92d6d951-ca5e-429c-ac78-451071cbf064", title: "Office Workers" },
      { id: "df33b754-73a3-4c54-80e6-1a74a8058539", title: "Police" },
      { id: "9467335a-1b83-4497-9231-765337a00b96", title: "Post-Apocalyptic" },
      { id: "0bc90acb-ccc1-44ca-a34a-b9f3a73259d0", title: "Reincarnation" },
      { id: "65761a2a-415e-47f3-bef2-a9dababba7a6", title: "Reverse Harem" },
      { id: "81183756-1453-4c81-aa9e-f6e1b63be016", title: "Samurai" },
      { id: "caaa44eb-cd40-4177-b930-79d3ef2afe87", title: "School Life" },
      { id: "ddefd648-5140-4e5f-ba18-4eca4071d19b", title: "Shota" },
      { id: "eabc5b4c-6aff-42f3-b657-3e90cbd00b75", title: "Supernatural" },
      { id: "5fff9cde-849c-4d78-aab0-0d52b2ee1d25", title: "Survival" },
      { id: "292e862b-2d17-4062-90a2-0356caa4ae27", title: "Time Travel" },
      { id: "31932a7e-5b8e-49a6-9f12-2afa39dc544c", title: "Traditional Games" },
      { id: "d7d1730f-6eb0-4ba6-9437-602cac38664c", title: "Vampires" },
      { id: "9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8", title: "Video Games" },
      { id: "d14322ac-4d6f-4e9b-afd9-629d5f4d8a41", title: "Villainess" },
      { id: "8c86611e-fab7-4986-9dec-d1a2f44acdd5", title: "Virtual Reality" },
      { id: "631ef465-9aba-4afb-b0fc-ea10efe274a8", title: "Zombies" },
    ],
  },
];

/** The languages MangaDex actually has translations in, as it names them. */
export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh", title: "Chinese (Simplified)" },
  { id: "zh-hk", title: "Chinese (Traditional)" },
  { id: "es", title: "Spanish" },
  { id: "es-la", title: "Spanish (Latin America)" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "it", title: "Italian" },
  { id: "pt", title: "Portuguese" },
  { id: "pt-br", title: "Portuguese (Brazil)" },
  { id: "ru", title: "Russian" },
  { id: "pl", title: "Polish" },
  { id: "nl", title: "Dutch" },
  { id: "tr", title: "Turkish" },
  { id: "id", title: "Indonesian" },
  { id: "vi", title: "Vietnamese" },
  { id: "th", title: "Thai" },
  { id: "ar", title: "Arabic" },
  { id: "uk", title: "Ukrainian" },
  { id: "cs", title: "Czech" },
  { id: "hu", title: "Hungarian" },
  { id: "ro", title: "Romanian" },
  { id: "sv", title: "Swedish" },
  { id: "da", title: "Danish" },
  { id: "fi", title: "Finnish" },
  { id: "no", title: "Norwegian" },
  { id: "el", title: "Greek" },
  { id: "he", title: "Hebrew" },
  { id: "hi", title: "Hindi" },
  { id: "bn", title: "Bengali" },
  { id: "fa", title: "Persian" },
  { id: "ms", title: "Malay" },
  { id: "tl", title: "Filipino" },
  { id: "ca", title: "Catalan" },
  { id: "bg", title: "Bulgarian" },
  { id: "sr", title: "Serbian" },
  { id: "hr", title: "Croatian" },
  { id: "sk", title: "Slovak" },
  { id: "lt", title: "Lithuanian" },
  { id: "et", title: "Estonian" },
  { id: "mn", title: "Mongolian" },
  { id: "ne", title: "Nepali" },
  { id: "ta", title: "Tamil" },
  { id: "kk", title: "Kazakh" },
];

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ContentRatings]: DEFAULT_CONTENT_RATINGS,
  [PreferenceID.TranslatedLanguages]: ["en"],
  [PreferenceID.OriginalLanguages]: [] as string[],
  [PreferenceID.CoverQuality]: "",
  [PreferenceID.DataSaver]: false,
  [PreferenceID.ForcePort443]: false,
  [PreferenceID.HideOfficialPublishers]: true,
  [PreferenceID.ShowVolume]: true,
  [PreferenceID.ShowChapter]: true,
};

// ----- what the API sends back -----

export type Relationship = {
  id: string;
  type: string;
  attributes?: {
    fileName?: string | null;
    name?: string | null;
    description?: string | null;
    volume?: string | null;
  } | null;
};

export type LocalizedString = Record<string, string | undefined>;

export type MangaAttributes = {
  title?: LocalizedString | null;
  altTitles?: LocalizedString[] | null;
  description?: LocalizedString | null;
  originalLanguage?: string | null;
  lastVolume?: string | null;
  lastChapter?: string | null;
  publicationDemographic?: string | null;
  status?: string | null;
  year?: number | null;
  contentRating?: string | null;
  tags?: TagEntity[] | null;
  availableTranslatedLanguages?: (string | null)[] | null;
  links?: Record<string, string | undefined> | null;
};

export type TagEntity = {
  id: string;
  attributes?: { name?: LocalizedString | null; group?: string | null } | null;
};

export type MangaEntity = {
  id: string;
  type?: string;
  attributes?: MangaAttributes | null;
  relationships?: Relationship[] | null;
};

export type ChapterAttributes = {
  title?: string | null;
  volume?: string | null;
  chapter?: string | null;
  translatedLanguage?: string | null;
  pages?: number | null;
  externalUrl?: string | null;
  publishAt?: string | null;
  readableAt?: string | null;
  createdAt?: string | null;
};

export type ChapterEntity = {
  id: string;
  attributes?: ChapterAttributes | null;
  relationships?: Relationship[] | null;
};

export type ListResponse<T> = {
  result?: string;
  data?: T[] | null;
  limit?: number;
  offset?: number;
  total?: number;
};

export type SingleResponse<T> = { result?: string; data?: T | null };

export type CustomListEntity = {
  id: string;
  attributes?: { name?: string | null; visibility?: string | null } | null;
  relationships?: Relationship[] | null;
};

export type AtHomeResponse = {
  baseUrl?: string | null;
  chapter?: { hash?: string | null; data?: string[] | null; dataSaver?: string[] | null } | null;
};

export type StatisticsResponse = {
  statistics?: Record<
    string,
    {
      rating?: { average?: number | null; bayesian?: number | null } | null;
      follows?: number | null;
      comments?: { repliesCount?: number | null } | null;
    }
  > | null;
};
