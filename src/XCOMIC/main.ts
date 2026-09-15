/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  SectionStyle,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchPickerSheet,
  SearchTextField,
  type Chapter,
  type ChapterData as ChapterPages,
  type Content,
  type ChapterSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
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
} from "@mana-app/types";

import {
  FilterReader,
  PreferenceStore,
  TimedCache,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { XCOMICApi } from "./client.ts";
import {
  BASE_URL,
  BROWSE_QUERY,
  CHAPTERS_FULL_QUERY,
  CHAPTERS_UNIQUE_QUERY,
  CHAPTER_FULL_PAGE_SIZE,
  CHAPTER_PAGES_QUERY,
  CHAPTER_PAGE_SIZE,
  COMIC_QUERY,
  CONTENT_RATING_OPTIONS,
  CHAPTER_COUNT_OPTIONS,
  TAXONOMY_LIFETIME_MS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  FilterID,
  GENRE_MODE_OPTIONS,
  LANGUAGE_OPTIONS,
  LATEST_UPLOADS_QUERY,
  LETTER_MODE_OPTIONS,
  MIRROR_OPTIONS,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  RECENTLY_ADDED_QUERY,
  RECENTLY_ADDED_SIZE,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  TITLE_VERSION_REGEX,
  TYPE_OPTIONS,
  setBaseUrl,
  searchPageUrl,
  type BrowseResponse,
  type BrowseSelect,
  type ChapterListPage,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type LatestUploadsResponse,
  type ComicNodeResponse,
  type RecentlyAddedResponse,
} from "./model.ts";
import {
  parseChapters,
  parseContent,
  parseFilterTaxonomy,
  parseHighlight,
  parseTitleHighlight,
  teamOf,
  publishedAt,
  parseLanguage,
  parsePageUrls,
  type FilterTaxonomy,
  type TitleCleaner,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "xcomic",
  name: "XCOMIC",
  version: "1.1.10",
  description: "Manga, manhwa, manhua and comics from xcomic.me.",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "XCOMIC.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: MIRROR_OPTIONS.map((option) => option.title),
};

/** What the filter form falls back to when the search page cannot be read. */
const BUNDLED_TAXONOMY: FilterTaxonomy = {
  genres: [],
  types: TYPE_OPTIONS,
  demographics: DEMOGRAPHIC_OPTIONS,
  contentRatings: CONTENT_RATING_OPTIONS,
};

class XCOMICSource
  implements ChapterSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly api = new XCOMICApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // Reading the filter lists means reading the whole search page, so the answer is kept
  // on disk as well: a form opened again does not pay for that page a second time.
  private readonly taxonomyCache = new TimedCache<FilterTaxonomy>(
    "xcomic.taxonomy",
    TAXONOMY_LIFETIME_MS,
  );
  // Recently Added pages by cursor while the app counts pages, so the cursor for the next
  // page is remembered as each one is read. Paging is sequential, so this keeps up.
  private readonly feedCursors = new Map<string, number>();

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  /**
   * The API exposes no filter lists, but the search page's markup holds all of them.
   * It is read once per session, and the bundled lists stand in if that read fails.
   */
  private taxonomy(): Promise<FilterTaxonomy> {
    // A failed read falls back to the bundled lists and is not stored, so the next form
    // open asks the site again rather than remembering that it once could not be read.
    return this.taxonomyCache.get(() => this.readTaxonomy()).catch(() => BUNDLED_TAXONOMY);
  }

  private async readTaxonomy(): Promise<FilterTaxonomy> {
    await this.applyMirror();
    const parsed = parseFilterTaxonomy(await this.api.page(searchPageUrl()));

    // Genres are the one list with no bundled stand-in, so a page that parsed to none of
    // them did not really parse. Failing here keeps it out of the cache for a day.
    if (parsed.genres.length === 0) throw new Error("the search page listed no genres");

    return {
      genres: parsed.genres,
      types: parsed.types.length > 0 ? parsed.types : BUNDLED_TAXONOMY.types,
      demographics:
        parsed.demographics.length > 0 ? parsed.demographics : BUNDLED_TAXONOMY.demographics,
      contentRatings:
        parsed.contentRatings.length > 0 ? parsed.contentRatings : BUNDLED_TAXONOMY.contentRatings,
    };
  }

  async getSearchForm(): Promise<SearchForm> {
    const taxonomy = await this.taxonomy();

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        SearchMultiPicker({
          id: FilterID.ContentRatings,
          title: "Content Rating",
          options: taxonomy.contentRatings,
        }),
        SearchMultiPicker({ id: FilterID.Types, title: "Types", options: taxonomy.types }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographics",
          options: taxonomy.demographics,
        }),
        SearchGroup({
          id: "genre_matching",
          title: "Genre Matching",
          children: [
            SearchPicker({
              id: FilterID.IncludeMode,
              title: "Include Mode",
              options: GENRE_MODE_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.ExcludeMode,
              title: "Exclude Mode",
              options: GENRE_MODE_OPTIONS,
            }),
          ],
        }),
        SearchGroup({
          id: "status",
          title: "Status",
          children: [
            SearchPicker({
              id: FilterID.OriginalStatus,
              title: "Original Work Status",
              options: STATUS_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.UploadStatus,
              title: "Upload Status",
              options: STATUS_OPTIONS,
            }),
            SearchPickerSheet({
              id: FilterID.ChapterCount,
              title: "Chapter Count",
              options: CHAPTER_COUNT_OPTIONS,
            }),
            SearchTextField({
              id: FilterID.Year,
              title: "Year",
              placeholder: "2015, or 1901-2027",
            }),
          ],
        }),
        SearchGroup({
          id: "languages",
          title: "Languages",
          children: [
            SearchMultiPickerSheet({
              id: FilterID.OriginalLanguages,
              title: "Original Work Language",
              options: LANGUAGE_OPTIONS,
            }),
            SearchMultiPickerSheet({
              id: FilterID.TranslatedLanguages,
              title: "Translated Language",
              options: LANGUAGE_OPTIONS,
            }),
          ],
        }),
        SearchPicker({
          id: FilterID.LetterMode,
          title: "Letter Matching Mode (Slow)",
          subtitle: "Match the query as a prefix instead of searching the index",
          options: LETTER_MODE_OPTIONS,
        }),
      ],
      ...(taxonomy.genres.length > 0
        ? {
            tags: SearchExcludableMultiPicker({
              id: FilterID.Genres,
              title: "Genres",
              options: taxonomy.genres,
            }),
            tagsHeader: "Genres",
          }
        : {}),
      sortHeader: "Sort",
    });
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(
      this.preferences,
      buildSettingsSections({
        genres: async () => (await this.taxonomy()).genres,
        types: async () => (await this.taxonomy()).types,
        contentRatings: async () => (await this.taxonomy()).contentRatings,
      }),
    );
  }

  /** Every request path starts here so the mirror setting is in force before a URL is built. */
  private async applyMirror(): Promise<void> {
    setBaseUrl(await this.preferences.text(PreferenceID.Mirror, BASE_URL));
  }

  /** Whether a tile names the team behind its edition, read once rather than per row. */
  private showTeam(): Promise<boolean> {
    return this.preferences.flag(PreferenceID.ShowSourceInTitle);
  }

  /** Reader-configured title rewriting, resolved once per call rather than per row. */
  private async titleCleaner(): Promise<TitleCleaner> {
    const [strip, custom] = await Promise.all([
      this.preferences.flag(PreferenceID.RemoveTitleVersion),
      this.preferences.text(PreferenceID.CustomTitleRegex, ""),
    ]);

    let extra: RegExp | undefined;
    if (custom) {
      // A reader can type anything here; an unparseable pattern must not break browsing.
      try {
        extra = new RegExp(custom, "g");
      } catch {}
    }

    if (!strip && !extra) return (title) => title;

    return (title) => {
      let value = title;
      if (extra) value = value.replace(extra, "");
      if (strip) value = value.replace(TITLE_VERSION_REGEX, "");
      return value.replace(/\s+/g, " ").trim() || title;
    };
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.preferences.flag(sectionPreferenceKey(section.id))),
    );

    return toPageSections(DISCOVER_SECTIONS.filter((_, position) => enabled[position]));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };

    const { results } = await this.loadSection(sectionID, 1, link.context);
    return { items: results };
  }

  private async loadSection(
    sectionId: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    await this.applyMirror();
    const cursor = page > 1 ? this.feedCursors.get(`${sectionId}:${page}`) : undefined;

    if (sectionId === SectionID.LatestUploads) {
      const [data, cleanTitle, showTeam] = await Promise.all([
        this.api.query<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
          // This feed pages by cursor; it rejects a `page` outright.
          select: {
            first: 0,
            limit: PAGE_SIZE,
            ...(cursor === undefined ? {} : { before: cursor }),
          },
        }),
        this.titleCleaner(),
        this.showTeam(),
      ]);

      const feed = data.get_title_latestUploads;

      // An item is a title holding the chapters it just published, each of which holds the
      // comic it belongs to — and one title can carry more than one comic, so the rows are
      // taken from the chapters rather than from the items. They arrive grouped by title
      // rather than in time order, so the whole page is sorted before it is cut down: the
      // first chapter a comic appears in is then its newest, and the rest of that comic's
      // uploads are the same row over again.
      const seen = new Set<string>();
      const results = (feed?.items ?? [])
        .flatMap((entry) => entry.chapters ?? [])
        .filter((chapter) => chapter.data.dbStatus === "normal")
        .sort((left, right) => publishedAt(right.data) - publishedAt(left.data))
        .flatMap((chapter): Highlight[] => {
          const comic = chapter.data.comicNode?.data;
          if (!comic || seen.has(comic.id)) return [];
          seen.add(comic.id);
          return [parseHighlight(comic, { latest: chapter.data, cleanTitle, showTeam })];
        });

      // The cursor has to move backwards or the feed hands back the page just read; the
      // site answering with its own starting point again would page forever.
      const next = feed?.before;
      if (next != null && (cursor === undefined || next < cursor)) {
        this.feedCursors.set(`${sectionId}:${page + 1}`, next);
        return { results, isLastPage: results.length === 0 };
      }
      return { results, isLastPage: true };
    }

    if (sectionId === SectionID.RecentlyAdded) {
      const [data, cleanTitle, showTeam] = await Promise.all([
        this.api.query<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
          select: {
            size: RECENTLY_ADDED_SIZE,
            ...(cursor === undefined ? {} : { before: cursor }),
          },
        }),
        this.titleCleaner(),
        this.showTeam(),
      ]);

      const feed = data.get_comic_recentlyAdded;
      const results = (feed?.items ?? []).map((node) =>
        parseHighlight(node.data, { cleanTitle, showTeam }),
      );

      if (feed?.before != null) this.feedCursors.set(`${sectionId}:${page + 1}`, feed.before);
      return { results, isLastPage: feed?.before == null || results.length === 0 };
    }

    const spec = sectionById(DISCOVER_SECTIONS, sectionId);
    return this.browse(
      this.browseSelect({
        page,
        size: PAGE_SIZE,
        sort: spec?.sort ?? SortID.Score,
        ...(await this.preferenceDefaults(context)),
      }),
      spec?.style === SectionStyle.SimpleHeroPaged,
    );
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    await this.applyMirror();

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const defaults = await this.preferenceDefaults(request.context);
    const [yearMin, yearMax] = parseYearRange(filters.text(FilterID.Year));

    const chosenTypes = filters.options(FilterID.Types);
    const chosenRatings = filters.options(FilterID.ContentRatings);
    const chosenLanguages = filters.options(FilterID.TranslatedLanguages);

    return this.browse(
      this.browseSelect({
        page: pageOf(request),
        size: PAGE_SIZE,
        sort: resolveSortId(SORT_OPTIONS, request, SortID.Score),
        word: request.query?.trim() ?? "",
        // The site files formats among its genres, so both selections travel together.
        where: filters.option(FilterID.LetterMode) === "letter" ? "letter" : "browse",
        incTypes: chosenTypes.length > 0 ? chosenTypes : defaults.incTypes,
        incContentRatings: chosenRatings.length > 0 ? chosenRatings : defaults.incContentRatings,
        incTLangs: chosenLanguages.length > 0 ? chosenLanguages : defaults.incTLangs,
        incOLangs: filters.options(FilterID.OriginalLanguages),
        incDemographics: filters.options(FilterID.Demographics),
        // The site files its formats — Full Color, 4 Koma, Doujinshi — among its genres,
        // so the one list covers both.
        incGenres: genres.included,
        excGenres: [...new Set([...genres.excluded, ...defaults.excGenres])],
        incGenresMode: filters.option(FilterID.IncludeMode) || "and",
        excGenresMode: filters.option(FilterID.ExcludeMode) || "or",
        origStatus: filters.option(FilterID.OriginalStatus) || null,
        chapCount: filters.option(FilterID.ChapterCount),
        releaseYearMin: yearMin,
        releaseYearMax: yearMax,
        // Both of these are left out entirely rather than sent empty: they are the two
        // fields the site's own clients never send, and browse throws inside its resolver
        // rather than saying which field it choked on.
        ...(filters.option(FilterID.UploadStatus)
          ? { siteStatus: filters.option(FilterID.UploadStatus) }
          : {}),
        ...((await this.preferences.flag(PreferenceID.IgnoreGenreBlocklist))
          ? { ignoreGlobalGenres: true }
          : {}),
      }),
    );
  }

  /** Settings stand in for anything the search form leaves blank. */
  private async preferenceDefaults(context?: SourceContext): Promise<{
    incTypes: string[];
    incContentRatings: string[];
    incTLangs: string[];
    excGenres: string[];
  }> {
    const [types, ratings, languages, excluded] = await Promise.all([
      this.preferences.strings(PreferenceID.ContentTypes),
      this.preferences.strings(PreferenceID.ContentRatings),
      this.preferences.strings(PreferenceID.Languages),
      this.preferences.strings(PreferenceID.ExcludedGenres),
    ]);

    // A host policy that bars explicit content narrows the ratings for that request.
    const allowed = context?.allowedContentRatings;
    const permitted =
      allowed && !allowed.includes(ContentRating.EXPLICIT)
        ? ratings.filter((rating) => rating === "safe" || rating === "suggestive")
        : ratings;

    return {
      incTypes: types,
      incContentRatings: permitted.length > 0 ? permitted : ["safe"],
      incTLangs: languages,
      excGenres: excluded,
    };
  }

  private browseSelect(overrides: Partial<BrowseSelect> & { sort: string }): BrowseSelect {
    const { sort, ...rest } = overrides;

    const page = rest.page ?? 1;
    const size = rest.size ?? PAGE_SIZE;

    return {
      where: "browse",
      page,
      size,
      sortby: sort,
      word: "",
      incOLangs: [],
      incTLangs: [],
      incGenres: [],
      excGenres: [],
      incGenresMode: "or",
      excGenresMode: "or",
      incTypes: [],
      incDemographics: [],
      incContentRatings: [],
      releaseYearMin: null,
      releaseYearMax: null,
      origStatus: null,
      chapCount: "",
      ...rest,
    };
  }

  private async browse(select: BrowseSelect, hero = false): Promise<PagedSearchResult> {
    const [data, cleanTitle, showTeam] = await Promise.all([
      this.api.query<BrowseResponse>(BROWSE_QUERY, { select }),
      this.titleCleaner(),
      this.showTeam(),
    ]);
    const nodes = data.get_title_browse_items ?? [];

    return {
      results: nodes
        .map((node) => parseTitleHighlight(node, select.incTLangs, { cleanTitle, showTeam, hero }))
        .filter((highlight): highlight is Highlight => highlight !== undefined),
      // Counted before a title with no edition in the reader's languages is dropped: the
      // page the site served is what says whether another one follows it.
      isLastPage: nodes.length < select.size,
    };
  }

  async getContent(contentId: string): Promise<Content> {
    await this.applyMirror();

    const [data, cleanTitle, showTeam] = await Promise.all([
      this.api.query<ComicNodeResponse>(COMIC_QUERY, { id: contentId }),
      this.titleCleaner(),
      this.showTeam(),
    ]);
    const comic = data.get_comicNode?.data;
    if (!comic) throw new Error(`XCOMIC has no title with id ${contentId}`);

    return parseContent(comic, cleanTitle, showTeam);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    await this.applyMirror();

    const deduplicate = await this.preferences.flag(PreferenceID.DeduplicateChapters);
    const size = deduplicate ? CHAPTER_PAGE_SIZE : CHAPTER_FULL_PAGE_SIZE;

    const [comic, first] = await Promise.all([
      this.api.query<ComicNodeResponse>(COMIC_QUERY, { id: contentId }),
      this.chapterPage(contentId, 1, deduplicate, size),
    ]);

    const entries = (first?.items ?? []).map((item) => item.data);

    // The full list runs to several pages on a long series; the deduplicated one
    // almost never does, so the extra pages are only ever fetched when they exist.
    const total = first?.paging?.total ?? entries.length;
    if (total > size && (first?.paging?.next ?? 0) !== 0) {
      const pages = Math.ceil(total / size);
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, offset) =>
          this.chapterPage(contentId, offset + 2, deduplicate, size),
        ),
      );
      for (const page of rest) {
        entries.push(...(page?.items ?? []).map((item) => item.data));
      }
    }

    const data = comic.get_comicNode?.data;
    const language = parseLanguage(data?.translatedLanguage);
    return parseChapters(entries, language, data ? teamOf(data) : "");
  }

  private async chapterPage(
    contentId: string,
    page: number,
    deduplicate: boolean,
    size: number,
  ): Promise<ChapterListPage | null | undefined> {
    const data = await this.api.query<ChapterListResponse>(
      deduplicate ? CHAPTERS_UNIQUE_QUERY : CHAPTERS_FULL_QUERY,
      {
        // The chapter list keys on snake_case and names its own order.
        select: { comic_id: contentId, page, size, sortby: "chapter_desc" },
      },
    );

    return deduplicate ? data.get_comic_chapterList_uniqList : data.get_comic_chapterList_fullList;
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterPages> {
    await this.applyMirror();

    const data = await this.api.query<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, {
      id: chapterId,
    });

    const pages = parsePageUrls(data.get_chapterNode?.data?.imageUrls ?? []);
    if (pages.length === 0) throw new Error(`XCOMIC returned no pages for chapter ${chapterId}`);

    return { pages: pages.map((url) => ({ url })) };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = /\/(?:comic|title|series)\/([^/?#]+)/i.exec(url)?.[1];
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
}

/** Accepts a single year or a `2005-2009` range, as the site's own field does. */
function parseYearRange(value: string): [number | null, number | null] {
  const trimmed = value.trim();
  if (!trimmed) return [null, null];

  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(trimmed);
  if (range) return [Number(range[1]), Number(range[2])];

  const single = /^(\d{4})$/.exec(trimmed);
  return single ? [Number(single[1]), Number(single[1])] : [null, null];
}

export class Target extends XCOMICSource {}
