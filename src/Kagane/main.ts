/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  AdditionalInfoType,
  CatalogRating,
  DefinedLanguages,
  HttpClient,
  RequestOrigin,
  additionalInfo,
  SearchExcludableMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchListSection,
  SearchSortSection,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchTagsSection,
  SearchTextField,
  SearchToggle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type Content,
  type ChapterSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type CoverRequestHandler,
  type ImageRequest,
  type PageRequestHandler,
  type Option,
  type Pair,
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
  pageOf,
  sectionById,
  toPageSections,
  relativeTime,
  type PreferenceValue,
  isMigration,
  withDefaults,
} from "../common/index.ts";
import { KaganeApi } from "./client.ts";
import {
  BASE_URL,
  type JsonObject,
  CONTENT_RATING_OPTIONS,
  CONTENT_RATINGS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  languageOption,
  FilterID,
  PAGE_SIZE,
  RANGE_FIELDS,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionLayout,
  SortID,
  type SectionLayoutKind,
  type DiscoverSection,
  type SeriesSummary,
  type SearchResponse,
  type DetailsResponse,
} from "./model.ts";
import {
  formatDescriptor,
  formatTitle,
  buildInfoRows,
  parseLatestChapterDate,
  formatLatestChapter,
  seriesUrl,
  parseChapters,
  parseContent,
  parseContentRating,
  parseHighlight,
  contentRatingId,
  type TitleOptions,
} from "./parsers.ts";
import {
  buildSearchBody,
  buildSortParameter,
  selectedContentRatings,
  ratingsForAges,
  readTagSelection,
  matchesTagGroups,
  type SearchBodyOptions,
} from "./search.ts";
import { EXCLUDED_TAG_KEYS, groupTags, tagFilterId, tagIdsOf } from "./tag-groups.ts";
import { buildSettingsSections } from "./settings.ts";

const info: SourceInfo = {
  id: "kagane",
  name: "Kagane",
  version: "1.1.14",
  description: "Manga, manhwa, manhua and comics from kagane.org.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.KOREAN,
    DefinedLanguages.JAPANESE,
    DefinedLanguages.FRENCH,
    DefinedLanguages.CHINESE,
    DefinedLanguages.SPANISH,
    DefinedLanguages.PORTUGUESE,
  ],
  thumbnail: "Kagane.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["kagane.org"],
};

const DETAIL_CACHE_MS = 60_000;
type TagSearchPage = { response: SearchResponse; nextPage: number };

class KaganeSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    CoverRequestHandler,
    PageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new KaganeApi();
  // A page's token outlives neither its reader session nor a quality switch, so each page
  // is re-signed as it is asked for — here, because the transport hooks cannot wait.
  private readonly images = new HttpClient().addRequestInterceptor(async (request, context) => {
    if (context.origin === RequestOrigin.General) return request;
    if (request.url.includes("token=")) {
      const dataSaver = await this.preferences.flag(PreferenceID.DataSaver);
      request.url = await this.api.refreshPageUrl(request.url, dataSaver);
    }
    withDefaults(request.headers, { referer: `${BASE_URL}/`, origin: BASE_URL });
    return request;
  });
  // The store answers only for keys it has a default for, and the hide-lists are one key
  // per tag group, so those are declared here alongside the fixed ones.
  private readonly preferences = new PreferenceStore(info.id, {
    ...(PREFERENCE_DEFAULTS as Record<string, PreferenceValue>),
    ...Object.fromEntries(EXCLUDED_TAG_KEYS.map((key) => [key, [] as string[]])),
  });

  private readonly tagSearchPages = new Map<
    string,
    {
      at: number;
      pages: Map<number, Promise<TagSearchPage>>;
    }
  >();

  private detailCache:
    | { seriesId: string; details: Promise<DetailsResponse>; at: number }
    | undefined;

  private async bodyOptions(query?: string, context?: SourceContext): Promise<SearchBodyOptions> {
    const [
      uploadSource,
      contentRatings,
      contentLanguages,
      excludedGenreIds,
      excludedTagIds,
      originalLanguages,
      translatedLanguages,
    ] = await Promise.all([
      this.preferences.text(PreferenceID.UploadSource, "all"),
      this.contentRatings(),
      this.preferences.strings(PreferenceID.ContentLanguages),
      this.preferences.strings(PreferenceID.ExcludedGenres),
      this.hiddenTags(),
      this.preferences.strings(PreferenceID.OriginalLanguages),
      this.preferences.strings(PreferenceID.TranslatedLanguages),
    ]);

    return {
      ...(query ? { query } : {}),
      uploadSource,
      contentRatings,
      contentLanguages,
      originalLanguages,
      translatedLanguages,
      excludedGenreIds,
      excludedTagIds,
      hideDisturbing: await this.preferences.flag(PreferenceID.HideDisturbing),
      ...(context?.allowedContentRatings === undefined
        ? {}
        : { allowedRatings: context.allowedContentRatings }),
    };
  }

  private async contentRatings(): Promise<string[]> {
    const [saved, ages, legacy, pornography] = await Promise.all([
      this.preferences.strings(PreferenceID.NormalizedRatings),
      this.preferences.strings(PreferenceID.AgeRating),
      this.preferences.strings(PreferenceID.ContentRating),
      this.preferences.flag(PreferenceID.ShowPornographic),
    ]);
    if (saved.length) return saved;
    const ratings = ages.length ? ratingsForAges(ages, pornography) : legacy;
    await this.preferences.set(PreferenceID.NormalizedRatings, ratings);
    return ratings;
  }

  /**
   * Every tag the reader has hidden. They are stored a group at a time, and the key the
   * one ungrouped list used is read as well so a hide-list made before the groups existed
   * still applies.
   */
  private async hiddenTags(): Promise<string[]> {
    const lists = await Promise.all(EXCLUDED_TAG_KEYS.map((key) => this.preferences.strings(key)));
    return [...new Set(lists.flat())];
  }

  private async titleOptions(): Promise<TitleOptions> {
    const [cleanTitle, showSource, showEdition] = await Promise.all([
      this.preferences.flag(PreferenceID.CleanTitle),
      this.preferences.flag(PreferenceID.ShowSourceInTitle),
      this.preferences.flag(PreferenceID.ShowEditionInTitle),
    ]);

    const sources = showSource ? await this.api.fetchUploadSources() : [];

    return {
      cleanTitle,
      showSource,
      showEdition,
      sources: Object.fromEntries(sources.map((source) => [source.source_id, source.title])),
    };
  }

  private async genreOptions(): Promise<Option[]> {
    return buildOptions(await this.api.fetchGenreNames());
  }

  private async tagOptions(): Promise<Option[]> {
    return buildOptions(await this.api.fetchTagNames());
  }

  private async sourceOptions(): Promise<Option[]> {
    const sources = await this.api.fetchUploadSources();

    return sources
      .map((source) => ({ id: source.source_id, title: source.title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  private async languageOptions(): Promise<Option[]> {
    return this.api
      .fetchContentLanguages()
      .then((languages) => languages.map(languageOption))
      .catch(() => LANGUAGE_OPTIONS);
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    const [genres, tags, sources, hideDisturbing] = await Promise.all([
      this.genreOptions(),
      this.tagOptions(),
      this.sourceOptions(),
      this.preferences.flag(PreferenceID.HideDisturbing),
    ]);

    return {
      sections: [
        ...(genres.length
          ? [
              SearchTagsSection({
                header: "Genres",
                footer:
                  "Tap to include, tap again to exclude. Included genres match All (AND) by default.",
                field: SearchExcludableMultiPicker({
                  id: FilterID.Genres,
                  title: "Genres",
                  options: genres,
                }),
              }),
            ]
          : []),
        SearchTagsSection({
          header: "Format",
          field: SearchMultiPicker({
            id: FilterID.Format,
            title: "Format",
            options: FORMAT_OPTIONS,
          }),
        }),
        SearchTagsSection({
          header: "Publication status",
          field: SearchMultiPicker({
            id: FilterID.PublicationStatus,
            title: "Publication status",
            options: STATUS_OPTIONS,
          }),
        }),
        SearchTagsSection({
          header: "Content rating",
          footer: "Uses your source settings unless you select ratings here.",
          field: SearchMultiPicker({
            id: FilterID.ContentRating,
            title: "Content rating",
            options: CONTENT_RATING_OPTIONS,
          }),
        }),
        SearchListSection({
          header: "Content options",
          children: [
            SearchMenuPicker({
              id: FilterID.Disturbing,
              title: "Disturbing content",
              subtitle: `Your setting (default): ${hideDisturbing ? "Leave out" : "Include"}`,
              options: [
                { id: "default", title: "Your setting" },
                { id: "any", title: "Include" },
                { id: "exclude", title: "Leave out" },
              ],
            }),
          ],
        }),
        ...RANGE_FIELDS.map(({ id, title, lower, upper }) =>
          SearchListSection({
            header: title,
            children: [
              ...(id === FilterID.Chapters
                ? [
                    SearchMenuPicker({
                      id: FilterID.ChapterRange,
                      title: "Chapter count",
                      options: [
                        { id: "", title: "Any" },
                        { id: "1-20", title: "1–20" },
                        { id: "21-100", title: "21–100" },
                        { id: "101+", title: "101+" },
                      ],
                    }),
                  ]
                : []),
              SearchTextField({ id: `${id}_min`, title: lower, placeholder: lower }),
              SearchTextField({ id: `${id}_max`, title: upper, placeholder: upper }),
            ],
            footer:
              id === FilterID.Chapters
                ? "Min and Max override the chapter preset. Leave either blank for an open range."
                : "Leave either field blank for an open range.",
          }),
        ),
        SearchListSection({
          header: "Authors, Artists & Groups",
          footer: "Enter one full author, artist or scanlation group name to find their series.",
          children: [
            SearchTextField({
              id: FilterID.Staff,
              title: "Author or artist name",
              placeholder: "Author or artist (e.g. Naoki Urasawa)",
            }),
            SearchTextField({
              id: FilterID.Groups,
              title: "Scanlation group name",
              placeholder: "Full scanlation group name",
            }),
          ],
        }),
        SearchListSection({
          header: "Upload sources",
          children: [
            SearchMultiPicker({
              id: FilterID.SourceType,
              title: "Source type",
              options: [
                { id: "Official", title: "Official" },
                { id: "Unofficial", title: "Fan translation" },
                { id: "Mixed", title: "Mixed" },
              ],
            }),
            ...(sources.length
              ? [
                  SearchMultiPickerSheet({
                    id: FilterID.Sources,
                    title: "Sources",
                    options: sources,
                  }),
                ]
              : []),
            SearchMultiPicker({
              id: FilterID.Status,
              title: "Upload status",
              options: STATUS_OPTIONS,
            }),
          ],
        }),
        ...(tags.length
          ? [
              SearchListSection({
                header: "Tags",
                children: [
                  // Thousands of tags as one list cannot be read, so each group opens as a
                  // sheet of its own; a pick in any of them means the same to the search.
                  ...groupTags(tags).map(({ group, options }) =>
                    SearchExcludableMultiPickerSheet({
                      id: tagFilterId(group.id),
                      title: group.title,
                      options,
                    }),
                  ),
                  SearchTextField({
                    id: FilterID.TagQuery,
                    title: "Tag names",
                    placeholder: "Tag names: time travel, -tragedy",
                  }),
                ],
                footer: "Separate names with commas; prefix a name with - to exclude it.",
              }),
            ]
          : []),
        SearchListSection({
          header: "Matching options",
          children: [
            SearchMenuPicker({
              id: FilterID.MatchAllGenres,
              title: "Match included genres",
              subtitle: "All (AND) by default",
              options: [
                { id: "all", title: "All (AND)" },
                { id: "any", title: "Any (OR)" },
              ],
            }),
            SearchMenuPicker({
              id: FilterID.MatchAllTags,
              title: "Match included tags",
              subtitle: "All (AND) by default",
              options: [
                { id: "all", title: "All (AND)" },
                { id: "any", title: "Any (OR)" },
              ],
            }),
            SearchToggle({ id: FilterID.ExactMatch, title: "Exact title match" }),
          ],
        }),
        SearchSortSection({ header: "Sort" }),
      ],
    };
  }

  async getPreferenceMenu(): Promise<Form> {
    await this.contentRatings();
    return buildPreferenceMenu(
      this.preferences,
      await buildSettingsSections({
        genres: () => this.genreOptions(),
        tags: () => this.tagOptions(),
        languages: () => this.languageOptions(),
        resetContentFilters: async () => {
          await this.preferences.reset(PreferenceID.ExcludedGenres);
          for (const key of EXCLUDED_TAG_KEYS) await this.preferences.reset(key);
          await this.preferences.reset(PreferenceID.NormalizedRatings);
          await this.preferences.reset(PreferenceID.ContentRating);
          await this.preferences.reset(PreferenceID.AgeRating);
          await this.preferences.reset(PreferenceID.ShowPornographic);
        },
        resetAll: async () => {
          for (const key of Object.keys(PREFERENCE_DEFAULTS)) {
            await this.preferences.reset(key);
          }
        },
      }),
    );
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(DISCOVER_SECTIONS);
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(DISCOVER_SECTIONS, sectionID);
    if (!spec) return { items: [] };

    const { results } = await this.loadSection(
      spec,
      1,
      link.context,
      spec.id === "weekly_chart" ? 5 : 20,
    );
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const spec = sectionById(DISCOVER_SECTIONS, request.listId);
    if (spec) return this.loadSection(spec, pageOf(request), request.context);

    const filters = new FilterReader(request);
    const options = await this.bodyOptions(request.query, request.context);

    const searchOptions = filters.text(FilterID.TagQuery)
      ? { ...options, tagNames: await this.api.fetchTagNames() }
      : options;
    const tags = readTagSelection(filters, searchOptions.tagNames);
    const body = buildSearchBody(searchOptions, filters, tags);

    for (const [id, kind] of [
      [FilterID.Staff, "staff"],
      [FilterID.Groups, "groups"],
    ] as const) {
      const name = filters.text(id).trim();
      if (name) body[id] = { values: [await this.api.resolvePersonOrGroup(kind, name)] };
    }

    const requestedSort = request.sort?.id ?? "";
    const sortId = SORT_OPTIONS.some((option) => option.id === requestedSort)
      ? requestedSort
      : SortID.Relevance;

    return this.runSearch(
      body,
      pageOf(request),
      PAGE_SIZE,
      buildSortParameter(
        sortId,
        SORT_OPTIONS.find((option) => option.id === sortId)?.isOrderable === true &&
          request.sort?.ascending === true,
      ),
      SectionLayout.Simple,
      filters.toggle(FilterID.ExactMatch),
      selectedContentRatings(options, filters),
      request.context,
      tags.matchAll && tags.included.length > 1 && tags.included.some((group) => group.length > 1)
        ? tags.included
        : undefined,
    );
  }

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
    if (context?.allowedContentRatings?.length === 0)
      throw new Error("This title is excluded by Mana’s content-rating settings.");
    const [details, titleOptions, showSpoilerTags] = await Promise.all([
      this.fetchDetails(contentId),
      this.titleOptions(),
      this.preferences.flag(PreferenceID.ShowSpoilerTags),
    ]);

    const content = parseContent(
      contentId,
      details,
      { ...titleOptions, showSpoilerTags },
      (imageId) => this.api.imageUrl(imageId),
    );

    if (
      context?.allowedContentRatings &&
      !context.allowedContentRatings.includes(content.contentRating!)
    ) {
      throw new Error("This title is excluded by Mana’s content-rating settings.");
    }

    // A migration needs only matching metadata, not the enrichment requests below.
    if (isMigration(context)) return content;

    const related = details.tracker_id
      ? await this.api
          .fetchRelated(details.tracker_id)
          .then((response) => response.book_series ?? [])
          .catch(() => [])
      : [];

    let others = related
      .filter(
        (entry) =>
          entry.id !== contentId &&
          !!entry.cover_image_id?.trim() &&
          (context?.allowedContentRatings === undefined ||
            context.allowedContentRatings.includes(parseContentRating(entry)!)),
      )
      .slice(0, 10);
    const similar = others.length === 0;
    if (similar) {
      const options = await this.bodyOptions(undefined, context);
      const ratings = selectedContentRatings(options);
      if (!ratings.length) return content;
      const response = await this.api
        .fetchSimilar(contentId, {
          ratings,
          languages: options.contentLanguages,
          uploadSource: options.uploadSource,
          hideDisturbing: options.hideDisturbing,
        })
        .catch(() => ({ content: [] }));
      const hiddenGenres = new Set(options.excludedGenreIds);
      const hiddenTags = new Set(options.excludedTagIds.flatMap(tagIdsOf));
      const languages = new Set(options.contentLanguages.map((language) => language.toLowerCase()));
      const seen = new Set([contentId]);
      others = (response.content ?? [])
        .filter((entry) => {
          if (
            seen.has(entry.series_id) ||
            !entry.cover_image_id?.trim() ||
            entry.hidden_by_filter ||
            !ratings.includes(contentRatingId(entry) ?? "Erotica") ||
            (options.hideDisturbing && entry.is_disturbing) ||
            (languages.size && !languages.has(entry.translated_language?.toLowerCase() ?? "")) ||
            entry.genres?.some((id) => hiddenGenres.has(id)) ||
            entry.tags?.some((id) => hiddenTags.has(id))
          )
            return false;
          seen.add(entry.series_id);
          return true;
        })
        .map((entry) => ({ ...entry, id: entry.series_id }));
    }
    if (others.length === 0) return content;

    return {
      ...content,
      additionalInfo: [
        ...(content.additionalInfo ?? []),
        additionalInfo.highlights.section({
          id: similar ? "similar" : "related",
          title: similar ? "More like this" : "Related Editions",
          hasMore: false,
          items: others.map((entry) =>
            additionalInfo.highlights.item({
              type: AdditionalInfoType.Highlights,
              id: entry.id,
              title: formatTitle(entry.title, titleOptions, entry.source_id),
              cover: entry.cover_image_id ? this.api.imageUrl(entry.cover_image_id) : "",
              // An edition carries its own rating, which need not be the one being read.
              contentRating: parseContentRating(entry),
              webUrl: seriesUrl(entry.id),
            }),
          ),
        }),
      ],
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [details, sources, chapterTitle] = await Promise.all([
      this.fetchDetails(contentId),
      this.api.fetchUploadSources(),
      this.preferences.text(PreferenceID.ChapterTitle, "auto"),
    ]);

    const source = details.source_id
      ? sources.find((entry) => entry.source_id === details.source_id)
      : undefined;

    const books = await this.api.fetchBooks(contentId);

    return parseChapters(
      contentId,
      { ...details, series_books: books },
      {
        chapterTitle,
        ...(source === undefined
          ? {}
          : { sourceName: source.title, official: /^official$/i.test(source.source_type) }),
      },
    );
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const dataSaver = await this.preferences.flag(PreferenceID.DataSaver);
    const challenge = await this.api.fetchChallenge(chapterId, dataSaver);

    const manifest = challenge.manifest?.pages ?? [];
    if (manifest.length === 0) throw new Error(`Kagane returned no pages for chapter ${chapterId}`);

    const cacheUrl = challenge.cache_url || BASE_URL;

    const pages: ChapterPage[] = [...manifest]
      .sort((left, right) => left.page_no - right.page_no)
      .map((page) => ({
        url: this.api.pageUrl(
          cacheUrl,
          chapterId,
          `${page.page_id}.${page.ext ?? "jxl"}`,
          challenge.access_token,
          dataSaver,
        ),
      }));

    return { pages };
  }

  getCoverTransport(_request: ImageRequest): HttpClient {
    return this.images;
  }

  getPageTransport(_request: ImageRequest): HttpClient {
    return this.images;
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const seriesId =
      /^https?:\/\/(?:www\.)?kagane\.org\/series\/(?:[^/?#]*-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i.exec(
        url,
      )?.[1];
    if (!seriesId) return null;

    try {
      const content = await this.getContent(seriesId);
      return {
        content: {
          id: seriesId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          webUrl: seriesUrl(seriesId),
        },
      };
    } catch {
      return null;
    }
  }

  private async fetchDetails(seriesId: string): ReturnType<KaganeApi["fetchSeries"]> {
    const cached = this.detailCache;
    if (cached && cached.seriesId === seriesId && Date.now() - cached.at < DETAIL_CACHE_MS) {
      return cached.details;
    }

    const details = this.api.fetchSeries(seriesId).catch((error: unknown) => {
      if (this.detailCache?.details === details) this.detailCache = undefined;
      throw error;
    });
    this.detailCache = { seriesId, details, at: Date.now() };
    return details;
  }

  private async loadSection(
    spec: DiscoverSection,
    page: number,
    context?: SourceContext,
    size = PAGE_SIZE,
  ): Promise<PagedSearchResult> {
    const options = await this.bodyOptions(undefined, context);
    const ratings = selectedContentRatings(options);
    if (!ratings.length) return { results: [], isLastPage: true };
    if (spec.id === "weekly_chart") {
      return page > 1
        ? { results: [], isLastPage: true }
        : this.loadTrending(options, ratings, size, context);
    }
    const body = buildSearchBody(options);
    return this.runSearch(
      body,
      page,
      size,
      buildSortParameter(spec.sort),
      spec.layout,
      false,
      ratings,
      context,
    );
  }

  private async loadTrending(
    options: SearchBodyOptions,
    ratings: string[],
    limit: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const body = buildSearchBody({
      ...options,
      contentRatings: ratings,
      uploadSource: "all",
      excludedGenreIds: [],
      excludedTagIds: [],
    });
    const [chart, titleOptions] = await Promise.all([
      this.api.fetchTrending(body, limit),
      this.titleOptions(),
    ]);
    const languages = new Set(options.contentLanguages.map((language) => language.toLowerCase()));
    return {
      isLastPage: true,
      results: chart.items
        .filter(
          (entry) =>
            !entry.hidden_by_filter &&
            ratings.includes(contentRatingId(entry.series) ?? "Erotica") &&
            (languages.size <= 5 ||
              languages.has(entry.series.translated_language?.toLowerCase() ?? "")),
        )
        .map((entry) => {
          const book = entry.series;
          const info: Pair[] = [{ key: "Rank", value: String(entry.position) }];
          if (entry.is_new) info.push({ key: "Movement", value: "New" });
          else if (entry.delta)
            info.push({
              key: "Movement",
              value: `${entry.delta > 0 ? "Up" : "Down"} ${Math.abs(entry.delta)}`,
            });
          if (entry.lift > 1)
            info.push({ key: "Weekly growth", value: `+${Math.round((entry.lift - 1) * 100)}%` });
          const subtitle = [
            book.format,
            book.current_books === undefined ? undefined : `${book.current_books} chapters`,
            book.genres?.slice(0, 2).join(", "),
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            ...parseHighlight(book, titleOptions, (imageId) => this.api.imageUrl(imageId), {
              subtitle,
              info,
            }),
            ...(context ? { context } : {}),
          };
        }),
    };
  }

  private async runSearch(
    body: JsonObject,
    page: number,
    size: number,
    sort: string,
    layout: SectionLayoutKind = SectionLayout.Simple,
    exactMatch = false,
    ratings: string[] = CONTENT_RATINGS,
    context?: SourceContext,
    tagGroups?: string[][],
  ): Promise<PagedSearchResult> {
    if (!ratings.length) return { results: [], isLastPage: true };
    const [response, titleOptions] = await Promise.all([
      tagGroups
        ? this.searchTagGroups(body, page, size, sort, exactMatch, tagGroups)
        : this.api.fetchSearch(body, page, size, sort, exactMatch),
      this.titleOptions(),
    ]);

    const results: Highlight[] = (response.content ?? [])
      .filter((book) => ratings.includes(contentRatingId(book) ?? "Erotica"))
      .map((book) => ({
        ...parseHighlight(book, titleOptions, (imageId) => this.api.imageUrl(imageId), {
          ...this.buildTileExtras(book, layout),
        }),
        ...(context ? { context } : {}),
      }));

    return { results, isLastPage: response.last !== false };
  }

  private async searchTagGroups(
    body: JsonObject,
    page: number,
    size: number,
    sort: string,
    exactMatch: boolean,
    groups: string[][],
  ): Promise<SearchResponse> {
    const key = JSON.stringify([body, size, sort, exactMatch, groups]);
    let cached = this.tagSearchPages.get(key);
    if (!cached || Date.now() - cached.at > 30_000) {
      if (this.tagSearchPages.size >= 25)
        this.tagSearchPages.delete(this.tagSearchPages.keys().next().value!);
      cached = { at: Date.now(), pages: new Map() };
      this.tagSearchPages.set(key, cached);
    }
    const pages = cached.pages;
    const load = (logicalPage: number): Promise<TagSearchPage> => {
      const existing = pages.get(logicalPage);
      if (existing) return existing;
      const request = (async (): Promise<TagSearchPage> => {
        const previous = logicalPage > 1 ? await load(logicalPage - 1) : undefined;
        if (previous?.response.last === true)
          return { response: { content: [], last: true }, nextPage: previous.nextPage };
        let rawPage = previous?.nextPage ?? 1;
        for (let attempt = 0; attempt < 20; attempt++, rawPage++) {
          const response = await this.api.fetchSearch(body, rawPage, size, sort, exactMatch);
          const content = (response.content ?? []).filter((book) =>
            matchesTagGroups(book.tags, groups),
          );
          if (content.length || response.last !== false)
            return { response: { ...response, content }, nextPage: rawPage + 1 };
        }
        throw new Error(
          "Too many Kagane pages did not match all selected tags. Narrow your search.",
        );
      })().catch((error: unknown) => {
        pages.delete(logicalPage);
        throw error;
      });
      pages.set(logicalPage, request);
      return request;
    };
    return (await load(page)).response;
  }

  private buildTileExtras(
    book: SeriesSummary,
    layout: SectionLayoutKind,
  ): { subtitle?: string; info?: Pair[] } {
    switch (layout) {
      case SectionLayout.Detailed: {
        const subtitle = formatDescriptor(book);
        return { ...(subtitle ? { subtitle } : {}), info: buildInfoRows(book) };
      }

      case SectionLayout.ChapterUpdates: {
        const chapter = formatLatestChapter(book);
        if (!chapter) {
          const subtitle = formatDescriptor(book);
          return { ...(subtitle ? { subtitle } : {}), info: buildInfoRows(book) };
        }
        return {
          subtitle: chapter,
          info: [
            { key: chapter, value: relativeTime(parseLatestChapterDate(book)) },
            ...buildInfoRows(book).filter((row) => row.key !== "Chapters"),
          ].slice(0, 4),
        };
      }

      case SectionLayout.Hero: {
        const subtitle = formatDescriptor(book);
        return subtitle ? { subtitle } : {};
      }

      default: {
        const chapter = formatLatestChapter(book);
        return chapter ? { subtitle: chapter } : {};
      }
    }
  }
}

function buildOptions(map: Record<string, string> | undefined): Option[] {
  return Object.entries(map ?? {})
    .map(([id, title]) => ({ id, title }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export class Target extends KaganeSource {}
