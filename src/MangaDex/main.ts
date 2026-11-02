/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  SearchGroup,
  SearchMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchPicker,
  SearchTextField,
  SearchToggle,
  SectionStyle,
  type Chapter,
  type ChapterData,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Form,
  type HttpClient,
  type ImageRequest,
  type OAuthAuthenticatable,
  type OAuthURL,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceContext,
  type SourceInfo,
  type SourcePreferenceProvider,
  type User,
} from "@mana-app/types";

import {
  FilterReader,
  PreferenceStore,
  TimedCache,
  buildPreferenceMenu,
  buildSearchForm,
  isMigration,
  pageOf,
  resolveSortId,
  isDetailedStyle,
  sectionById,
  toPageSections,
  type PreferenceValue,
  type QueryParams,
} from "../common/index.ts";
import {
  SignedOutError,
  authorizationRequest,
  completeSignIn,
  hasSession,
  signOut,
} from "./auth.ts";
import { MangaDexApi } from "./client.ts";
import {
  BASE_URL,
  BUNDLED_TAG_GROUPS,
  ACCOUNT_SECTIONS,
  CONTENT_RATING_OPTIONS,
  CREATED_WITHIN_OPTIONS,
  LIST_SECTION_PREFIX,
  SUPPORTED_LANGUAGES,
  COVER_QUALITY_OPTIONS,
  CURATED_SECTIONS,
  CURATED_LISTS_LIFETIME_MS,
  CURATOR_USER_ID,
  DEFAULT_CONTENT_RATINGS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  FALLBACK_LIST_IDS,
  FEED_LIMIT,
  FilterID,
  LANGUAGE_OPTIONS,
  LATEST_LIMIT,
  MAX_LIMIT,
  OFFICIAL_PUBLISHER_GROUPS,
  ORIGINAL_LANGUAGE_OPTIONS,
  PAGE_SIZE,
  POPULAR_WINDOW_MS,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  TAG_MODE_OPTIONS,
  TAXONOMY_LIFETIME_MS,
  type AtHomeResponse,
  type ChapterEntity,
  type CustomListEntity,
  type ListResponse,
  type MangaEntity,
  type SingleResponse,
  type StatisticsResponse,
  type TagEntity,
  type TagGroup,
  type DiscoverSection,
  type StatusResponse,
  type UserResponse,
} from "./model.ts";
import {
  chapterMangaId,
  localized,
  parseChapters,
  parseContent,
  parseHighlight,
  type MangaStats,
} from "./parsers.ts";

const info: SourceInfo = {
  id: "mangadex",
  name: "MangaDex",
  version: "1.2.4",
  description: "Scanlations in every language, from mangadex.org.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: SUPPORTED_LANGUAGES,
  thumbnail: "MangaDex.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
};

function isDetailed(sectionId: string): boolean {
  return isDetailedStyle(sectionById(DISCOVER_SECTIONS, sectionId)?.style);
}

/** Which of the site's four ratings a host policy leaves standing. */
/** MangaDex's four ratings against the app's four levels, one to one. */
const RATING_LEVELS: Record<string, ContentRating> = {
  safe: ContentRating.SAFE,
  suggestive: ContentRating.SUGGESTIVE,
  erotica: ContentRating.MATURE,
  pornographic: ContentRating.EXPLICIT,
};

function permittedRatings(chosen: string[], context: SourceContext | undefined): string[] {
  const allowed = context?.allowedContentRatings;
  const permitted = allowed
    ? chosen.filter((rating) => allowed.includes(RATING_LEVELS[rating] ?? ContentRating.EXPLICIT))
    : chosen;
  return permitted.length > 0 ? permitted : ["safe"];
}

/** The uploads feed and the curated lists both need their manga fetched in batches. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

/** Puts a `/manga?ids[]` answer back into the order the ids were asked for. */
function reorderById(entities: MangaEntity[], ids: readonly string[]): MangaEntity[] {
  const byId = new Map(entities.map((entity) => [entity.id.toLowerCase(), entity]));
  return ids.flatMap((id) => {
    const found = byId.get(id.toLowerCase());
    return found ? [found] : [];
  });
}

type CuratedListIds = { seasonal: string; recommended: string; selfPublished: string };

/** Winter is January to March, and so on round the year. */
function currentSeasonRank(now: Date): number {
  const quarter = Math.floor(now.getUTCMonth() / 3);
  return now.getUTCFullYear() * 4 + quarter;
}

const SEASON_RANK: Record<string, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };
const SEASONAL_NAME = /^Seasonal:\s+(Winter|Spring|Summer|Fall)\s+(\d{4})\b/i;

class MangaDexSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    OAuthAuthenticatable
{
  readonly info = info;
  readonly config = config;

  private readonly api = new MangaDexApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // The tag list is a whole extra request in front of a filter form, so it is kept on disk
  // and the bundled copy stands in until the first read lands.
  private readonly tagCache = new TimedCache<TagGroup[]>("mangadex.tags", TAXONOMY_LIFETIME_MS);
  // The curator renames these lists rarely — a new seasonal one appears four times a year.
  private readonly listCache = new TimedCache<CuratedListIds>(
    "mangadex.curated-lists",
    CURATED_LISTS_LIFETIME_MS,
  );

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  // ----- settings -----

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, [
      {
        header: "Content",
        footer:
          "MangaDex grades every title itself. Leaving a rating out hides it everywhere — " +
          "home rows, search and the library alike.",
        fields: [
          {
            type: "multiselect",
            key: PreferenceID.ContentRatings,
            title: "Content Ratings",
            options: CONTENT_RATING_OPTIONS,
            minSelectionCount: 1,
          },
          {
            type: "multiselect",
            key: PreferenceID.OriginalLanguages,
            title: "Original Work Language",
            options: ORIGINAL_LANGUAGE_OPTIONS,
          },
        ],
      },
      {
        header: "Translation",
        footer: "A title with nothing translated into these languages is left out of a row.",
        fields: [
          {
            type: "multiselect",
            key: PreferenceID.TranslatedLanguages,
            title: "Translated Languages",
            options: LANGUAGE_OPTIONS,
            minSelectionCount: 1,
          },
        ],
      },
      {
        header: "Chapters",
        footer:
          "Official publishers upload a chapter that only points at their own app, so it " +
          "opens to nothing here. Hiding them is what the site's own reader does.",
        fields: [
          {
            type: "toggle",
            key: PreferenceID.HideOfficialPublishers,
            title: "Hide Publisher Placeholders",
          },
          { type: "toggle", key: PreferenceID.ShowVolume, title: "Show Volume Number" },
          { type: "toggle", key: PreferenceID.ShowChapter, title: "Show Chapter Number" },
        ],
      },
      {
        header: "Blocked",
        footer:
          "Chapters from these groups and uploaders are left out of every list. Paste their " +
          "MangaDex page links or ids, separated by commas or spaces.",
        fields: [
          {
            type: "text",
            key: PreferenceID.BlockedGroups,
            title: "Blocked Groups",
            placeholder: "Group links or ids",
          },
          {
            type: "text",
            key: PreferenceID.BlockedUploaders,
            title: "Blocked Uploaders",
            placeholder: "Uploader links or ids",
          },
        ],
      },
      {
        header: "Images",
        footer:
          "Data saver serves the compressed copy MangaDex keeps beside each page. Port 443 " +
          "is for networks that allow nothing else out.",
        fields: [
          {
            type: "select",
            key: PreferenceID.CoverQuality,
            title: "Cover Quality",
            options: COVER_QUALITY_OPTIONS,
          },
          { type: "toggle", key: PreferenceID.DataSaver, title: "Data Saver" },
          { type: "toggle", key: PreferenceID.ForcePort443, title: "Force Port 443" },
        ],
      },
      {
        header: "Home Page",
        footer:
          "A row turned off here costs no request when the home page loads. Updates, Library " +
          "and a row for each of your MangaDex lists appear while you are signed in.",
        fields: [...DISCOVER_SECTIONS, ...ACCOUNT_SECTIONS].map((section) => ({
          type: "toggle" as const,
          key: `${PreferenceID.SectionPrefix}.${section.id}`,
          title: section.title,
        })),
      },
    ]);
  }

  private sectionKey(sectionId: string): string {
    return `${PreferenceID.SectionPrefix}.${sectionId}`;
  }

  private async sectionEnabled(sectionId: string): Promise<boolean> {
    // `ObjectStore.boolean` answers null for a stored `false`, which would read a row the
    // reader switched off as untouched and turn it back on.
    const stored = await ObjectStore.get(this.preferences.keyFor(this.sectionKey(sectionId)));
    // A row nobody has touched is on: the home page ships as the site's own.
    return typeof stored === "boolean" ? stored : true;
  }

  // ----- the shared request shape -----

  private async ratings(context?: SourceContext): Promise<string[]> {
    const chosen = await this.preferences.strings(PreferenceID.ContentRatings);
    return permittedRatings(chosen.length > 0 ? chosen : DEFAULT_CONTENT_RATINGS, context);
  }

  private async languages(): Promise<string[]> {
    const chosen = await this.preferences.strings(PreferenceID.TranslatedLanguages);
    return chosen.length > 0 ? chosen : ["en"];
  }

  private async coverQuality(): Promise<string> {
    return this.preferences.text(PreferenceID.CoverQuality, "");
  }

  /** The languages a title is preferred to be named in, which is what the reader reads. */
  private async titleLanguages(): Promise<string[]> {
    return this.languages();
  }

  private async chapterLabelOptions(): Promise<{ showVolume: boolean; showChapter: boolean }> {
    const [showVolume, showChapter] = await Promise.all([
      this.preferences.flag(PreferenceID.ShowVolume),
      this.preferences.flag(PreferenceID.ShowChapter),
    ]);
    return { showVolume, showChapter };
  }

  private async blockedGroups(): Promise<string[]> {
    const [hideOfficial, chosen] = await Promise.all([
      this.preferences.flag(PreferenceID.HideOfficialPublishers),
      this.preferences.text(PreferenceID.BlockedGroups, ""),
    ]);
    return [...new Set([...(hideOfficial ? OFFICIAL_PUBLISHER_GROUPS : []), ...uuids(chosen)])];
  }

  private async blockedUploaders(): Promise<string[]> {
    return uuids(await this.preferences.text(PreferenceID.BlockedUploaders, ""));
  }

  // ----- home -----

  async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    if (link.id !== "home") return [];

    const signedIn = await hasSession();
    const candidates = [...(signedIn ? ACCOUNT_SECTIONS : []), ...DISCOVER_SECTIONS];
    const [enabled, lists] = await Promise.all([
      Promise.all(
        candidates.map(async (section) => (await this.sectionEnabled(section.id)) && section),
      ),
      signedIn ? this.ownLists() : [],
    ]);

    const chosen = enabled.filter((section): section is DiscoverSection => Boolean(section));
    // The account's own rows lead, as the site's Follows pages do in its own menu.
    const account = chosen.filter((section) => ACCOUNT_SECTIONS.includes(section));
    return toPageSections([
      ...account,
      ...lists,
      ...chosen.filter((section) => !ACCOUNT_SECTIONS.includes(section)),
    ]);
  }

  /** A row per list on the reader's account, each under the name they gave it. */
  private async ownLists(): Promise<DiscoverSection[]> {
    try {
      const response = await this.api.getSigned<ListResponse<CustomListEntity>>("/user/list", {
        limit: MAX_LIMIT,
      });
      return (response.data ?? []).flatMap((list) => {
        const name = (list.attributes?.name ?? "").trim();
        const held = (list.relationships ?? []).some((one) => one?.type === "manga");
        return name && held
          ? [
              {
                id: `${LIST_SECTION_PREFIX}${list.id}`,
                title: name,
                style: SectionStyle.SimpleSingleRow,
              },
            ]
          : [];
      });
    } catch {
      // The home page still opens without them; the rows come back on the next refresh.
      return [];
    }
  }

  private isSection(sectionId: string): boolean {
    return (
      Boolean(sectionById([...DISCOVER_SECTIONS, ...ACCOUNT_SECTIONS], sectionId)) ||
      sectionId.startsWith(LIST_SECTION_PREFIX)
    );
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!this.isSection(sectionID)) return { items: [] };

    const { results } = await this.loadSection(sectionID, 1, link.context);
    return { items: results };
  }

  private async loadSection(
    sectionId: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    if (sectionId === SectionID.LatestUpdates) return this.latestUpdates(page, context);
    if (sectionId === SectionID.FollowedUpdates) {
      return this.latestUpdates(page, context, "followed");
    }
    if (sectionId === SectionID.Library) return this.library(page, context);
    if (sectionId.startsWith(LIST_SECTION_PREFIX)) {
      const ids = await this.listMangaIds(sectionId.slice(LIST_SECTION_PREFIX.length), true);
      return this.mangaPage(ids, page, context, false);
    }
    if (CURATED_SECTIONS[sectionId]) return this.curatedList(sectionId, page, context);

    const spec = sectionById(DISCOVER_SECTIONS, sectionId);
    const hero = sectionId === SectionID.PopularNew;

    return this.browse({
      page,
      context,
      hero,
      detailed: isDetailed(sectionId),
      order: { key: spec?.sort ?? SortID.Follows, value: "desc" },
      // Popular New Titles is the site's own row: most followed of what appeared this month.
      ...(hero
        ? { createdAtSince: sinceStamp(Date.now() - POPULAR_WINDOW_MS), withChapters: true }
        : {}),
    });
  }

  /**
   * The uploads feed, collapsed to one row per title.
   *
   * The feed lists a chapter at a time, so a title that published three at once is three
   * entries and the site shows it once. The manga themselves come back in a second request
   * because the feed carries only the ids.
   */
  private async latestUpdates(
    page: number,
    context?: SourceContext,
    from: "everyone" | "followed" = "everyone",
  ): Promise<PagedSearchResult> {
    const [ratings, languages, quality, titles, labels, groups, uploaders] = await Promise.all([
      this.ratings(context),
      this.languages(),
      this.coverQuality(),
      this.titleLanguages(),
      this.chapterLabelOptions(),
      this.blockedGroups(),
      this.blockedUploaders(),
    ]);

    const params: QueryParams = {
      limit: LATEST_LIMIT,
      offset: (page - 1) * LATEST_LIMIT,
      "translatedLanguage[]": languages,
      "contentRating[]": ratings,
      "order[readableAt]": "desc",
      includeFutureUpdates: "0",
      "excludedGroups[]": groups,
      "excludedUploaders[]": uploaders,
    };
    const feed =
      from === "followed"
        ? await this.api.getSigned<ListResponse<ChapterEntity>>("/user/follows/manga/feed", params)
        : await this.api.get<ListResponse<ChapterEntity>>("/chapter", params);

    const newest = new Map<string, ChapterEntity>();
    for (const chapter of feed.data ?? []) {
      const mangaId = chapterMangaId(chapter);
      if (!mangaId || newest.has(mangaId)) continue;
      newest.set(mangaId, chapter);
    }

    const ids = [...newest.keys()].slice(0, PAGE_SIZE);
    if (ids.length === 0) return { results: [], isLastPage: true };

    const manga = await this.api.get<ListResponse<MangaEntity>>("/manga", {
      limit: ids.length,
      "ids[]": ids,
      "contentRating[]": ratings,
      "includes[]": ["cover_art"],
    });

    const results = reorderById(manga.data ?? [], ids).map((entity) =>
      parseHighlight(entity, {
        quality,
        titles,
        detailed: true,
        ...labels,
        ...(newest.get(entity.id.toLowerCase())
          ? { latest: newest.get(entity.id.toLowerCase()) as ChapterEntity }
          : {}),
      }),
    );

    const total = feed.total ?? 0;
    return { results, isLastPage: page * LATEST_LIMIT >= total || (feed.data ?? []).length === 0 };
  }

  /**
   * One of the curator's own lists — Seasonal, Recommended, Self-Published.
   *
   * The list itself is only ids in the curator's order, so the order is put back after the
   * titles are fetched. `/manga?ids[]` takes a hundred at a time and the seasonal list runs
   * longer than that, so a page of the row is a slice of the ids rather than of the answer.
   */
  private async curatedList(
    sectionId: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const [lists, ratings, quality, titles] = await Promise.all([
      this.curatedListIds(),
      this.ratings(context),
      this.coverQuality(),
      this.titleLanguages(),
    ]);

    const listId = lists[CURATED_SECTIONS[sectionId] ?? "recommended"];
    return this.mangaPage(await this.listMangaIds(listId), page, context, isDetailed(sectionId), {
      ratings,
      quality,
      titles,
    });
  }

  /**
   * One page of titles out of an ordered list of ids, put back in that order after they are
   * fetched — `/manga?ids[]` answers in its own.
   */
  private async mangaPage(
    ids: readonly string[],
    page: number,
    context: SourceContext | undefined,
    detailed: boolean,
    known?: { ratings: string[]; quality: string; titles: string[] },
  ): Promise<PagedSearchResult> {
    const slice = chunk(ids, PAGE_SIZE)[page - 1] ?? [];
    if (slice.length === 0) return { results: [], isLastPage: true };

    const { ratings, quality, titles } = known ?? {
      ratings: await this.ratings(context),
      quality: await this.coverQuality(),
      titles: await this.titleLanguages(),
    };
    const manga = await this.api.get<ListResponse<MangaEntity>>("/manga", {
      limit: slice.length,
      "ids[]": slice,
      "contentRating[]": ratings,
      "includes[]": ["cover_art"],
    });

    return {
      results: reorderById(manga.data ?? [], slice).map((entity) =>
        parseHighlight(entity, { quality, titles, detailed }),
      ),
      isLastPage: page * PAGE_SIZE >= ids.length,
    };
  }

  /** Every title with a reading status on the account. */
  private async library(page: number, context?: SourceContext): Promise<PagedSearchResult> {
    const response = await this.api.getSigned<StatusResponse>("/manga/status");
    return this.mangaPage(Object.keys(response.statuses ?? {}), page, context, false);
  }

  /**
   * The manga a list holds, in the order its owner put them in. A list on the reader's own
   * account may be private, so it is asked for signed in.
   */
  private async listMangaIds(listId: string, own = false): Promise<string[]> {
    const path = `/list/${listId}`;
    const list = own
      ? await this.api.getSigned<SingleResponse<CustomListEntity>>(path)
      : await this.api.get<SingleResponse<CustomListEntity>>(path);
    return (list.data?.relationships ?? [])
      .filter((one) => one?.type === "manga")
      .map((one) => one.id)
      .filter(Boolean);
  }

  /**
   * Which list is which, read from the curator rather than pinned to an id.
   *
   * The seasonal list is replaced four times a year, so a pinned id goes stale by design.
   * The newest one whose season has actually started is the one the site is showing — a
   * list for next season often appears weeks early.
   */
  private async curatedListIds(): Promise<CuratedListIds> {
    return this.listCache
      .get(() => this.readCuratedListIds())
      .catch(() => ({
        ...FALLBACK_LIST_IDS,
      }));
  }

  private async readCuratedListIds(): Promise<CuratedListIds> {
    const response = await this.api.get<ListResponse<CustomListEntity>>(
      `/user/${CURATOR_USER_ID}/list`,
      { limit: MAX_LIMIT },
    );

    let recommended: string | undefined;
    let selfPublished: string | undefined;
    let seasonal: { id: string; rank: number } | undefined;
    const started = currentSeasonRank(new Date());

    for (const entry of response.data ?? []) {
      const name = (entry.attributes?.name ?? "").trim();
      if (!name || entry.attributes?.visibility !== "public") continue;
      const held = (entry.relationships ?? []).filter((one) => one?.type === "manga").length;
      if (held === 0) continue;

      const normalised = name.toLowerCase().replace(/[-_\s]+/g, "");
      if (!recommended && normalised === "recommended") {
        recommended = entry.id;
        continue;
      }
      if (!selfPublished && normalised === "selfpublished") {
        selfPublished = entry.id;
        continue;
      }

      const season = SEASONAL_NAME.exec(name);
      if (!season) continue;
      const rank =
        Number.parseInt(season[2] ?? "0", 10) * 4 +
        (SEASON_RANK[(season[1] ?? "").toLowerCase()] ?? 0);
      if (rank > started) continue;
      if (!seasonal || rank > seasonal.rank) seasonal = { id: entry.id, rank };
    }

    return {
      seasonal: seasonal?.id ?? FALLBACK_LIST_IDS.seasonal,
      recommended: recommended ?? FALLBACK_LIST_IDS.recommended,
      selfPublished: selfPublished ?? FALLBACK_LIST_IDS.selfPublished,
    };
  }

  // ----- search -----

  async getSearchForm(): Promise<SearchForm> {
    const groups = await this.tags();

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        SearchMultiPicker({
          id: FilterID.ContentRatings,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({
          id: FilterID.Statuses,
          title: "Publication Status",
          options: STATUS_OPTIONS,
        }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographic",
          options: DEMOGRAPHIC_OPTIONS,
        }),
        SearchMultiPicker({
          id: FilterID.OriginalLanguages,
          title: "Original Work Language",
          options: ORIGINAL_LANGUAGE_OPTIONS,
        }),
        SearchGroup({
          id: "tag_matching",
          title: "Tag Matching",
          children: [
            SearchPicker({
              id: FilterID.IncludedTagsMode,
              title: "Include Mode",
              options: TAG_MODE_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.ExcludedTagsMode,
              title: "Exclude Mode",
              options: TAG_MODE_OPTIONS,
            }),
          ],
        }),
        // A group runs to nearly forty tags read off the site, and the host no longer
        // promotes a long list to a sheet on its own, so each one asks to be one.
        ...groups.map((group) =>
          SearchExcludableMultiPickerSheet({
            id: `${FilterID.TagPrefix}.${group.group}`,
            title: group.group,
            options: group.tags,
          }),
        ),
        SearchGroup({
          id: "details",
          title: "Details",
          children: [
            SearchTextField({ id: FilterID.Year, title: "Year", placeholder: "2015" }),
            SearchTextField({
              id: FilterID.Author,
              title: "Author or Artist",
              placeholder: "Name",
            }),
            SearchPicker({
              id: FilterID.CreatedWithin,
              title: "Created Within",
              options: CREATED_WITHIN_OPTIONS,
            }),
            SearchToggle({ id: FilterID.HasChapters, title: "Has Available Chapters" }),
          ],
        }),
      ],
    });
  }

  /** The tag list, read from the site once a day, bundled copy standing in until then. */
  private tags(): Promise<TagGroup[]> {
    return this.tagCache.get(() => this.readTags()).catch(() => BUNDLED_TAG_GROUPS);
  }

  private async readTags(): Promise<TagGroup[]> {
    const response = await this.api.get<ListResponse<TagEntity>>("/manga/tag");
    const byGroup = new Map<string, { id: string; title: string }[]>();

    for (const tag of response.data ?? []) {
      const group = tag.attributes?.group ?? "";
      const title = localized(tag.attributes?.name);
      if (!group || !title) continue;
      const held = byGroup.get(group) ?? [];
      held.push({ id: tag.id, title });
      byGroup.set(group, held);
    }

    // The site orders its own filter panel this way; anything new lands after them.
    const order = ["content", "format", "genre", "theme"];
    const groups = [...byGroup.keys()].sort((left, right) => {
      const leftAt = order.indexOf(left);
      const rightAt = order.indexOf(right);
      return (leftAt < 0 ? order.length : leftAt) - (rightAt < 0 ? order.length : rightAt);
    });

    const parsed = groups.map((group) => ({
      group: group.charAt(0).toUpperCase() + group.slice(1),
      tags: (byGroup.get(group) ?? []).sort((left, right) => left.title.localeCompare(right.title)),
    }));

    // A tag list that parsed to nothing did not really parse, and must not be cached.
    if (parsed.length === 0) throw new Error("MangaDex listed no tags");
    return parsed;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && this.isSection(request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    const filters = new FilterReader(request);
    const query = request.query?.trim() ?? "";

    const chosenRatings = filters.options(FilterID.ContentRatings);
    const included: string[] = [];
    const excluded: string[] = [];
    for (const group of await this.tags()) {
      const picked = filters.excludable(`${FilterID.TagPrefix}.${group.group}`);
      included.push(...picked.included);
      excluded.push(...picked.excluded);
    }

    const year = Number.parseInt(filters.text(FilterID.Year), 10);
    const author = filters.text(FilterID.Author);
    const days = Number.parseInt(filters.option(FilterID.CreatedWithin), 10);

    // Best Match only means anything to a query with words in it; without one the API
    // answers an empty page rather than an unordered one.
    const sort = resolveSortId(SORT_OPTIONS, request, SortID.LatestChapter);
    const order = sort === SortID.Relevance && !query ? SortID.LatestChapter : sort;

    return this.browse({
      page: pageOf(request),
      context: request.context,
      order: { key: order, value: order === SortID.Title ? "asc" : "desc" },
      ...(query ? { title: query } : {}),
      ...(chosenRatings.length > 0 ? { ratings: chosenRatings } : {}),
      statuses: filters.options(FilterID.Statuses),
      demographics: filters.options(FilterID.Demographics),
      originalLanguages: filters.options(FilterID.OriginalLanguages),
      includedTags: included,
      excludedTags: excluded,
      includedTagsMode: filters.option(FilterID.IncludedTagsMode, "AND"),
      excludedTagsMode: filters.option(FilterID.ExcludedTagsMode, "OR"),
      ...(Number.isFinite(year) ? { year } : {}),
      ...(author ? { author } : {}),
      ...(days > 0 ? { createdAtSince: sinceStamp(Date.now() - days * DAY_MS) } : {}),
      ...(filters.toggle(FilterID.HasChapters) ? { withChapters: true } : {}),
    });
  }

  /** Every cover row and every search lands here: one `/manga` request, one page of tiles. */
  private async browse(options: {
    page: number;
    context?: SourceContext;
    hero?: boolean;
    detailed?: boolean;
    order: { key: string; value: "asc" | "desc" };
    title?: string;
    ratings?: string[];
    statuses?: string[];
    demographics?: string[];
    originalLanguages?: string[];
    includedTags?: string[];
    excludedTags?: string[];
    includedTagsMode?: string;
    excludedTagsMode?: string;
    year?: number;
    author?: string;
    createdAtSince?: string;
    withChapters?: boolean;
  }): Promise<PagedSearchResult> {
    const { page, context, hero = false, detailed = false, order } = options;

    const [defaultRatings, languages, quality, titles, chosenOriginal] = await Promise.all([
      this.ratings(context),
      this.languages(),
      this.coverQuality(),
      this.titleLanguages(),
      this.preferences.strings(PreferenceID.OriginalLanguages),
    ]);

    const ratings = options.ratings ? permittedRatings(options.ratings, context) : defaultRatings;
    const originalLanguages =
      options.originalLanguages && options.originalLanguages.length > 0
        ? options.originalLanguages
        : chosenOriginal;

    const params: QueryParams = {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      "contentRating[]": ratings,
      "availableTranslatedLanguage[]": languages,
      "includes[]": ["cover_art"],
      [`order[${order.key}]`]: order.value,
      ...(options.title ? { title: options.title } : {}),
      "status[]": options.statuses ?? [],
      "publicationDemographic[]": options.demographics ?? [],
      "originalLanguage[]": originalLanguages,
      "includedTags[]": options.includedTags ?? [],
      "excludedTags[]": options.excludedTags ?? [],
      ...(options.includedTags?.length ? { includedTagsMode: options.includedTagsMode } : {}),
      ...(options.excludedTags?.length ? { excludedTagsMode: options.excludedTagsMode } : {}),
      ...(options.year ? { year: options.year } : {}),
      ...(options.author ? { authorOrArtist: options.author } : {}),
      ...(options.createdAtSince ? { createdAtSince: options.createdAtSince } : {}),
      ...(options.withChapters ? { hasAvailableChapters: "true" } : {}),
    };

    const response = await this.api.get<ListResponse<MangaEntity>>("/manga", params);
    const entities = response.data ?? [];

    // A hero shows no info rows, so what the site grades a title by has to reach its
    // subtitle — and that is one extra request for the whole row rather than one per tile.
    const stats = hero ? await this.statistics(entities.map((entity) => entity.id)) : undefined;

    const results = entities.map((entity) =>
      parseHighlight(entity, {
        quality,
        titles,
        hero,
        detailed,
        ...(stats?.get(entity.id) ? { stats: stats.get(entity.id) as MangaStats } : {}),
      }),
    );

    const total = response.total ?? 0;
    return { results, isLastPage: page * PAGE_SIZE >= total || results.length === 0 };
  }

  /** How the site grades a set of titles, in one request rather than one apiece. */
  private async statistics(ids: string[]): Promise<Map<string, MangaStats>> {
    const stats = new Map<string, MangaStats>();
    if (ids.length === 0) return stats;

    try {
      const response = await this.api.get<StatisticsResponse>("/statistics/manga", {
        "manga[]": ids,
      });
      for (const [id, entry] of Object.entries(response.statistics ?? {})) {
        stats.set(id, { rating: entry?.rating?.bayesian, follows: entry?.follows });
      }
    } catch {
      // A row without its numbers still shows its covers; the pill falls through instead.
    }
    return stats;
  }

  // ----- a title -----

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
    const [response, quality, titles] = await Promise.all([
      this.api.get<SingleResponse<MangaEntity>>(`/manga/${contentId}`, {
        "includes[]": ["cover_art", "author", "artist"],
      }),
      this.coverQuality(),
      this.titleLanguages(),
    ]);

    const manga = response.data;
    if (!manga) throw new Error(`MangaDex has no title with id ${contentId}`);

    // A migration walks a whole library through here and wants only enough to match a
    // title, so the statistics and related works are skipped rather than bought per title.
    if (isMigration(context)) return parseContent(manga, { quality, titles });

    const [stats, related] = await Promise.all([
      this.statistics([contentId]).then((all) => all.get(contentId)),
      this.relatedWorks(manga, context),
    ]);
    return parseContent(manga, { quality, titles, related, ...(stats ? { stats } : {}) });
  }

  /** The works this one links to, with their covers, in one request. */
  private async relatedWorks(manga: MangaEntity, context?: SourceContext): Promise<MangaEntity[]> {
    const ids = (manga.relationships ?? [])
      .filter((one) => one?.type === "manga")
      .map((one) => one.id)
      .slice(0, MAX_LIMIT);
    if (ids.length === 0) return [];

    try {
      const response = await this.api.get<ListResponse<MangaEntity>>("/manga", {
        limit: ids.length,
        "ids[]": ids,
        "contentRating[]": await this.ratings(context),
        "includes[]": ["cover_art"],
      });
      return response.data ?? [];
    } catch {
      // A title page without its related works is a smaller loss than no page at all.
      return [];
    }
  }

  async getChapters(contentId: string, context?: SourceContext): Promise<Chapter[]> {
    const [ratings, languages, blocked, uploaders, labels] = await Promise.all([
      this.ratings(context),
      this.languages(),
      this.blockedGroups(),
      this.blockedUploaders(),
      this.chapterLabelOptions(),
    ]);

    const read = (offset: number): Promise<ListResponse<ChapterEntity>> =>
      this.api.get<ListResponse<ChapterEntity>>(`/manga/${contentId}/feed`, {
        limit: FEED_LIMIT,
        offset,
        "includes[]": ["scanlation_group", "user"],
        "translatedLanguage[]": languages,
        "contentRating[]": ratings,
        "excludedGroups[]": blocked,
        "excludedUploaders[]": uploaders,
        // Chapter leads so a volume-tagged chapter does not sink below a feed of nulls.
        "order[chapter]": "desc",
        "order[volume]": "desc",
        "order[createdAt]": "desc",
        // Scheduled chapters would open to a 404 at the reader, so they are left out.
        includeFutureUpdates: "0",
      });

    const first = await read(0);
    const entities = [...(first.data ?? [])];
    const total = first.total ?? entities.length;

    // A long series runs past one page of five hundred; the rest are asked for at once.
    if (total > FEED_LIMIT) {
      const offsets: number[] = [];
      for (let offset = FEED_LIMIT; offset < total; offset += FEED_LIMIT) offsets.push(offset);
      const rest = await Promise.all(offsets.map((offset) => read(offset)));
      for (const page of rest) entities.push(...(page.data ?? []));
    }

    // A chapter that points at a publisher's own app has no pages here, whatever it says.
    const readable = entities.filter((entity) => !entity.attributes?.externalUrl);

    return parseChapters(readable, labels);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const [dataSaver, forcePort] = await Promise.all([
      this.preferences.flag(PreferenceID.DataSaver),
      this.preferences.flag(PreferenceID.ForcePort443),
    ]);

    const response = await this.api.get<AtHomeResponse>(
      `/at-home/server/${chapterId}`,
      forcePort ? { forcePort443: "true" } : undefined,
    );

    const host = response.baseUrl;
    const hash = response.chapter?.hash;
    if (!host || !hash) throw new Error(`MangaDex served no pages for chapter ${chapterId}`);

    // A chapter uploaded moments ago often has no compressed copy yet, so data saver falls
    // back to the full one rather than showing an empty chapter.
    const saver = response.chapter?.dataSaver ?? [];
    const full = response.chapter?.data ?? [];
    const useSaver = dataSaver && saver.length > 0;
    const files = useSaver ? saver : full;
    if (files.length === 0) throw new Error(`MangaDex served no pages for chapter ${chapterId}`);

    return {
      pages: files.map((file) => ({
        url: `${host}/${useSaver ? "data-saver" : "data"}/${hash}/${file}`,
      })),
    };
  }

  // ----- sign-in -----

  async getOAuthRequestURL(): Promise<OAuthURL> {
    return authorizationRequest();
  }

  async handleOAuthCallback(response: string): Promise<void> {
    await completeSignIn(response);
  }

  async getAuthenticatedUser(): Promise<User | null> {
    try {
      const me = await this.api.getSigned<UserResponse>("/user/me");
      const handle = (me.data?.attributes?.username ?? "").trim();
      return handle ? { handle } : null;
    } catch (error) {
      // Only a session MangaDex has ended is a signed-out reader; a failed request is not.
      if (error instanceof SignedOutError) return null;
      throw error;
    }
  }

  async handleUserSignOut(): Promise<void> {
    await signOut();
  }

  getCoverTransport(_request: ImageRequest): HttpClient {
    return this.api.images;
  }

  getPageTransport(_request: ImageRequest): HttpClient {
    return this.api.images;
  }

  // ----- links -----

  async canHandleURL(url: string): Promise<boolean> {
    return /mangadex\.org\/(?:title|chapter)\/[0-9a-f-]{36}/i.test(url);
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = await this.linkedContentId(url);
    if (!contentId) return null;

    try {
      const content = await this.getContent(contentId);
      return {
        content: {
          id: contentId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          ...(content.webUrl ? { webUrl: content.webUrl } : {}),
        },
      };
    } catch {
      return null;
    }
  }

  /** A chapter link names no title, so the one it belongs to is asked for. */
  private async linkedContentId(url: string): Promise<string | undefined> {
    const title = /mangadex\.org\/title\/([0-9a-f-]{36})/i.exec(url);
    if (title?.[1]) return title[1];

    const chapter = /mangadex\.org\/chapter\/([0-9a-f-]{36})/i.exec(url);
    if (!chapter?.[1]) return undefined;

    try {
      const response = await this.api.get<SingleResponse<ChapterEntity>>(`/chapter/${chapter[1]}`);
      return response.data ? chapterMangaId(response.data) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** The API takes a timestamp without a zone, to the second. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every MangaDex id in what a reader pasted — bare ids, or the page links that hold them. */
function uuids(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map(
        (id) => id.toLowerCase(),
      ),
    ),
  ];
}

function sinceStamp(at: number): string {
  return new Date(at).toISOString().replace(/\.\d+Z$/, "");
}

export class Target extends MangaDexSource {}
