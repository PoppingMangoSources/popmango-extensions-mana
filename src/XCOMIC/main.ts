/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  SectionStyle,
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
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  isDetailedStyle,
  sectionById,
  toPageSections,
  withCovers,
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
  CHAPTER_REQUEST_SLOTS,
  COMIC_QUERY,
  CONTENT_RATING_OPTIONS,
  CHAPTER_COUNT_OPTIONS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  FilterID,
  GENRE_MODE_OPTIONS,
  GENRE_OPTIONS,
  LANGUAGE_OPTIONS,
  LATEST_UPLOADS_QUERY,
  LATEST_UPLOADS_SIZE,
  LETTER_MODE_OPTIONS,
  MIRROR_OPTIONS,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  RANDOM_QUERY,
  RANDOM_SIZE,
  RECENTLY_ADDED_QUERY,
  RECENTLY_ADDED_SIZE,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SUPPORTED_LANGUAGES,
  SectionID,
  SortID,
  TITLE_COMICS_QUERY,
  TITLE_NODE_QUERY,
  TITLE_VERSION_REGEX,
  TYPE_OPTIONS,
  appLanguage,
  setBaseUrl,
  setLanguages,
  type BrowseResponse,
  type ComicData,
  type BrowseSelect,
  type ChapterData,
  type ChapterListPage,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type LatestUploadsResponse,
  type RandomResponse,
  type ComicNodeResponse,
  type RecentlyAddedResponse,
  type TitleNodeData,
  type TitleNodeResponse,
} from "./model.ts";
import {
  mergedEditions,
  parseChapters,
  parseContent,
  parseHighlight,
  parseTitleHighlight,
  parseTitleHighlights,
  parseTrackers,
  rankEditions,
  teamOf,
  publishedAt,
  parsePageUrls,
  type TitleCleaner,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "xcomic",
  name: "XCOMIC",
  version: "1.4.1",
  description: "Manga, manhwa, manhua and comics from xcomic.me.",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: SUPPORTED_LANGUAGES,
  thumbnail: "XCOMIC.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: MIRROR_OPTIONS.map((option) => option.title),
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

  // Recently Added pages by cursor while the app counts pages, so the cursor for the next
  // page is remembered as each one is read. Paging is sequential, so this keeps up.
  private readonly feedCursors = new Map<string, number>();
  private readonly chapterSlots = new Slots(CHAPTER_REQUEST_SLOTS);

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        SearchMultiPicker({
          id: FilterID.ContentRatings,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({ id: FilterID.Types, title: "Types", options: TYPE_OPTIONS }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographics",
          options: DEMOGRAPHIC_OPTIONS,
        }),
        SearchExcludableMultiPicker({
          id: FilterID.Formats,
          title: "Formats",
          options: FORMAT_OPTIONS,
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
            SearchMultiPicker({
              id: FilterID.OriginalStatus,
              title: "Original Work Status",
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
      tags: SearchExcludableMultiPicker({
        id: FilterID.Genres,
        title: "Genres",
        options: GENRE_OPTIONS,
      }),
      tagsHeader: "Genres",
      sortHeader: "Sort",
    });
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, buildSettingsSections());
  }

  /** Every request path starts here so the mirror setting is in force before a URL is built. */
  private async applyMirror(): Promise<void> {
    const [mirror, languages] = await Promise.all([
      this.preferences.text(PreferenceID.Mirror, BASE_URL),
      this.preferences.strings(PreferenceID.Languages),
    ]);
    setBaseUrl(mirror);
    setLanguages(languages);
  }

  /**
   * Whether a tile names the team behind its edition, read once rather than per row. A merged
   * title holds every team's chapters, so it names none of them.
   */
  private async showTeam(): Promise<boolean> {
    const [show, merged] = await Promise.all([
      this.preferences.flag(PreferenceID.ShowSourceInTitle),
      this.merged(),
    ]);
    return show && !merged;
  }

  private merged(): Promise<boolean> {
    return this.preferences.flag(PreferenceID.MergeEditions);
  }

  /** What makes two tiles the same entry: the edition, or — merged — the work it belongs to. */
  private async entryKey(): Promise<(comic: ComicData) => string> {
    return (await this.merged()) ? (comic) => comic.titleId || comic.id : (comic) => comic.id;
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
    // A row that draws each tile's info rows draws no pill over its cover.
    const detailed = isDetailedStyle(sectionById(DISCOVER_SECTIONS, sectionId)?.style);

    if (sectionId === SectionID.LatestUploads) {
      const [data, cleanTitle, showTeam, keyOf] = await Promise.all([
        this.api.query<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
          // This feed pages by cursor; it rejects a `page` outright.
          select: {
            first: 0,
            limit: LATEST_UPLOADS_SIZE,
            ...(cursor === undefined ? {} : { before: cursor }),
          },
        }),
        this.titleCleaner(),
        this.showTeam(),
        this.entryKey(),
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
          if (!comic || seen.has(keyOf(comic))) return [];
          seen.add(keyOf(comic));
          return [parseHighlight(comic, { latest: chapter.data, cleanTitle, showTeam, detailed })];
        });
      const covered = withCovers(results);

      // The cursor has to move backwards or the feed hands back the page just read; the
      // site answering with its own starting point again would page forever.
      const next = feed?.before;
      if (next != null && (cursor === undefined || next < cursor)) {
        this.feedCursors.set(`${sectionId}:${page + 1}`, next);
        return { results: covered, isLastPage: results.length === 0 };
      }
      return { results: covered, isLastPage: true };
    }

    if (sectionId === SectionID.Random) {
      const [data, cleanTitle, showTeam] = await Promise.all([
        this.api.query<RandomResponse>(RANDOM_QUERY, { select: { amount: RANDOM_SIZE } }),
        this.titleCleaner(),
        this.showTeam(),
      ]);

      const languages = await this.preferences.strings(PreferenceID.Languages);
      return {
        results: withCovers(
          (data.get_title_randomList ?? []).flatMap(
            (node) =>
              parseTitleHighlight(node, languages, { cleanTitle, showTeam, detailed }) ?? [],
          ),
        ),
        // The site picks a fresh handful every time it is asked; there is no page two.
        isLastPage: true,
      };
    }

    if (sectionId === SectionID.RecentlyAdded) {
      const [data, cleanTitle, showTeam, keyOf] = await Promise.all([
        this.api.query<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
          select: {
            size: RECENTLY_ADDED_SIZE,
            ...(cursor === undefined ? {} : { before: cursor }),
          },
        }),
        this.titleCleaner(),
        this.showTeam(),
        this.entryKey(),
      ]);

      const feed = data.get_comic_recentlyAdded;
      const seen = new Set<string>();
      const results = withCovers(
        (feed?.items ?? []).flatMap((node) => {
          if (seen.has(keyOf(node.data))) return [];
          seen.add(keyOf(node.data));
          return [parseHighlight(node.data, { cleanTitle, showTeam, detailed })];
        }),
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
      { hero: spec?.style === SectionStyle.SimpleHeroPaged, detailed },
    );
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    await this.applyMirror();

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const formats = filters.excludable(FilterID.Formats);
    const defaults = await this.preferenceDefaults(request.context);
    const [yearMin, yearMax] = parseYearRange(filters.text(FilterID.Year));

    const chosenTypes = filters.options(FilterID.Types);
    const chosenRatings = filters.options(FilterID.ContentRatings);
    const chosenLanguages = filters.options(FilterID.TranslatedLanguages);

    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Score);
    const word = request.query?.trim() ?? "";

    // Looking for one series and ranking the whole catalogue are different jobs. A word
    // with no order asked for is the first: the reader has a series in mind and wants the
    // team they follow, so every edition is listed. Ordering it — or filtering with no word
    // at all — is the second, which the site answers a work at a time, and so does this.
    // Merged, every edition is already one entry.
    const everyEdition = word !== "" && sort === SortID.Score && !(await this.merged());

    return this.browse(
      this.browseSelect({
        page: pageOf(request),
        size: PAGE_SIZE,
        sort,
        word,
        where: filters.option(FilterID.LetterMode) === "letter" ? "letter" : "browse",
        incTypes: chosenTypes.length > 0 ? chosenTypes : defaults.incTypes,
        incContentRatings: chosenRatings.length > 0 ? chosenRatings : defaults.incContentRatings,
        incTLangs: chosenLanguages.length > 0 ? chosenLanguages : defaults.incTLangs,
        incOLangs: filters.options(FilterID.OriginalLanguages),
        incDemographics: filters.options(FilterID.Demographics),
        // The API takes formats as genres, so both selections travel together.
        incGenres: [...genres.included, ...formats.included],
        excGenres: [...new Set([...genres.excluded, ...formats.excluded, ...defaults.excGenres])],
        incGenresMode: filters.option(FilterID.IncludeMode) || "and",
        excGenresMode: filters.option(FilterID.ExcludeMode) || "or",
        origStatus: filters.options(FilterID.OriginalStatus),
        chapCount: filters.option(FilterID.ChapterCount),
        releaseYearMin: yearMin,
        releaseYearMax: yearMax,
        // Left out entirely rather than sent empty: the site's own clients never send this
        // one, and browse throws inside its resolver rather than saying which field it
        // choked on.
        ...((await this.preferences.flag(PreferenceID.IgnoreGenreBlocklist))
          ? { ignoreGlobalGenres: true }
          : {}),
      }),
      { everyEdition },
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
      origStatus: [],
      chapCount: "",
      ...rest,
    };
  }

  private async browse(
    select: BrowseSelect,
    options: { hero?: boolean; detailed?: boolean; everyEdition?: boolean } = {},
  ): Promise<PagedSearchResult> {
    const { hero = false, detailed = false, everyEdition = false } = options;

    const [data, cleanTitle, showTeam] = await Promise.all([
      this.api.query<BrowseResponse>(BROWSE_QUERY, { select }),
      this.titleCleaner(),
      this.showTeam(),
    ]);
    const nodes = data.get_title_browse_items ?? [];
    const tile = { cleanTitle, showTeam, hero, detailed };

    return {
      results: withCovers(
        nodes.flatMap((node) =>
          everyEdition
            ? parseTitleHighlights(node, select.incTLangs, tile)
            : (parseTitleHighlight(node, select.incTLangs, tile) ?? []),
        ),
      ),
      // Counted over the titles the site served rather than the editions they expanded to:
      // the page it answered is what says whether another one follows it.
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

    return parseContent(comic, cleanTitle, showTeam, await this.trackers(comic.titleId));
  }

  /**
   * The tracking ids the site holds for the work behind this edition.
   *
   * They live on the title rather than on the comic, so they cost a request the profile
   * otherwise does not need — which is why a failure here is swallowed: a page without
   * tracker links is a smaller loss than no page at all.
   */
  private async trackers(titleId: string | null | undefined): Promise<Record<string, string>> {
    if (!titleId) return {};

    try {
      const title = await this.titleNode(titleId);
      // A work the site has folded into another keeps its own row but not its ids; they
      // moved to whatever it was merged into.
      const surviving =
        title?.isMerged && title.mergedTo && title.mergedTo !== titleId
          ? ((await this.titleNode(title.mergedTo)) ?? title)
          : title;

      return parseTrackers(surviving?.trackingSites);
    } catch {
      return {};
    }
  }

  private async titleNode(titleId: string): Promise<TitleNodeData | undefined> {
    const data = await this.api.query<TitleNodeResponse>(TITLE_NODE_QUERY, { id: titleId });
    return data.get_title_titleNode?.data ?? undefined;
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    await this.applyMirror();

    const [deduplicate, merge, groupByEdition, included, languages] = await Promise.all([
      this.preferences.flag(PreferenceID.DeduplicateChapters),
      this.merged(),
      this.preferences.flag(PreferenceID.GroupByEdition),
      this.preferences.text(PreferenceID.IncludedEditions, ""),
      this.preferences.strings(PreferenceID.Languages),
    ]);

    // The opened edition's list is asked for beside the details rather than after them;
    // only the other editions have to wait to be named.
    const [data, [own = []]] = await Promise.all([
      this.api.query<ComicNodeResponse>(COMIC_QUERY, { id: contentId }),
      this.chapterLists([contentId], deduplicate),
    ]);
    const comic = data.get_comicNode?.data ?? { id: contentId, name: "" };
    const editions = merge ? mergedEditions(comic, languages) : [comic];
    // `mergedEditions` puts the opened edition first, so its list leads.
    const lists = [
      own,
      ...(await this.chapterLists(
        editions.slice(1).map((edition) => edition.id),
        deduplicate,
      )),
    ];

    return parseChapters(
      editions.map((edition, position) => ({
        entries: lists[position] ?? [],
        language: appLanguage(edition.translatedLanguage),
        team: teamOf(edition),
      })),
      merge
        ? {
            included: included
              .split(",")
              .map((team) => team.trim())
              .filter(Boolean),
            groupByEdition,
          }
        : {},
    );
  }

  /**
   * Every chapter of each edition, one list per id in the order given.
   *
   * A list that comes back short of its total lost a page somewhere, and is refused rather
   * than shown as though it were complete.
   */
  private async chapterLists(
    ids: readonly string[],
    deduplicate: boolean,
  ): Promise<ChapterData[][]> {
    const size = deduplicate ? CHAPTER_PAGE_SIZE : CHAPTER_FULL_PAGE_SIZE;

    return Promise.all(
      ids.map(async (id) => {
        const first = await this.chapterPage(id, 1, deduplicate, size);
        const entries = (first?.items ?? []).map((item) => item.data);
        const total = first?.paging?.total ?? entries.length;

        // Further pages are asked for only when they exist, as soon as this edition's first
        // one says so rather than after every other edition's first page has come back.
        if (total > size && (first?.paging?.next ?? 0) !== 0) {
          const rest = await Promise.all(
            Array.from({ length: Math.ceil(total / size) - 1 }, (_, offset) =>
              this.chapterPage(id, offset + 2, deduplicate, size),
            ),
          );
          for (const page of rest) entries.push(...(page?.items ?? []).map((item) => item.data));
        }

        if (entries.length < total) {
          throw new Error(
            `XCOMIC sent ${entries.length} of ${total} chapters; refresh to try again`,
          );
        }
        return entries;
      }),
    );
  }

  private async chapterPage(
    contentId: string,
    page: number,
    deduplicate: boolean,
    size: number,
  ): Promise<ChapterListPage | null | undefined> {
    // More than three at once and the site answers 429, losing the list. The slots are the
    // instance's, so a library update opening several titles together stays under it too,
    // and a page starts the moment any other finishes rather than waiting on a whole batch.
    const data = await this.chapterSlots.run(() =>
      this.api.query<ChapterListResponse>(
        deduplicate ? CHAPTERS_UNIQUE_QUERY : CHAPTERS_FULL_QUERY,
        {
          // The chapter list keys on snake_case and names its own order.
          select: { comic_id: contentId, page, size, sortby: "chapter_desc" },
        },
      ),
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

  /**
   * A link off the site, which names either one edition or the work behind several.
   *
   * `/source/…` is the edition page — what the site used to call `/comic/…` — and its id is
   * the one everything here is keyed by. `/title/…` names the work instead, which nothing can
   * open on its own, so it is turned into whichever of its editions the reader reads.
   */
  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const link = /\/(source|comic|title|series)\/([^/?#]+)/i.exec(url);
    const kind = link?.[1]?.toLowerCase();
    const linkedId = link?.[2];
    if (!kind || !linkedId) return null;

    try {
      await this.applyMirror();
      const contentId =
        kind === "title" || kind === "series" ? await this.editionOf(linkedId) : linkedId;
      if (!contentId) return null;

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

  /**
   * Which edition of a work to open: a live one in the reader's language, longest run breaking
   * a tie — or another language's, when the reader's has none.
   */
  private async editionOf(titleId: string): Promise<string | undefined> {
    const [data, languages] = await Promise.all([
      this.api.query<TitleNodeResponse>(TITLE_COMICS_QUERY, { id: titleId }),
      this.preferences.strings(PreferenceID.Languages),
    ]);
    const editions = (data.get_title_titleNode?.comicNodes ?? []).map((node) => node.data);
    return rankEditions(editions, languages)[0]?.id;
  }
}

/** At most `limit` tasks running at once; the rest wait their turn in order. */
class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.free = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
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
