/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  AdditionalInfoType,
  CatalogRating,
  DefinedLanguages,
  additionalInfo,
  SearchExcludableMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchGroup,
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
  type ImageRequestHandler,
  type NetworkRequest,
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
  buildSearchForm,
  pageOf,
  sectionById,
  toPageSections,
  relativeTime,
  type PreferenceValue,
  isMigration,
} from "../common/index.ts";
import { KaganeApi } from "./client.ts";
import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  CONTENT_RATINGS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  languageOption,
  FilterID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionLayout,
  SortID,
  type SectionLayoutKind,
  type DiscoverSection,
  type SeriesSummary,
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
  type SearchBodyOptions,
} from "./search.ts";
import { EXCLUDED_TAG_KEYS, groupTags } from "./tag-groups.ts";
import { buildSettingsSections } from "./settings.ts";

const info: SourceInfo = {
  id: "kagane",
  name: "Kagane",
  version: "1.1.6",
  description: "Manga, manhwa, manhua and comics from kagane.org.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Kagane.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["kagane.org"],
};

const DETAIL_CACHE_MS = 60_000;

class KaganeSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new KaganeApi();
  // The store answers only for keys it has a default for, and the hide-lists are one key
  // per tag group, so those are declared here alongside the fixed ones.
  private readonly preferences = new PreferenceStore(info.id, {
    ...(PREFERENCE_DEFAULTS as Record<string, PreferenceValue>),
    ...Object.fromEntries(EXCLUDED_TAG_KEYS.map((key) => [key, [] as string[]])),
  });

  private detailCache:
    | { seriesId: string; details: Promise<DetailsResponse>; at: number }
    | undefined;

  private async bodyOptions(query?: string, context?: SourceContext): Promise<SearchBodyOptions> {
    const [uploadSource, contentRatings, contentLanguages, excludedGenreIds, excludedTagIds] =
      await Promise.all([
        this.preferences.text(PreferenceID.UploadSource, "all"),
        this.preferences.strings(PreferenceID.ContentRating),
        this.preferences.strings(PreferenceID.ContentLanguages),
        this.preferences.strings(PreferenceID.ExcludedGenres),
        this.hiddenTags(),
      ]);

    return {
      ...(query ? { query } : {}),
      uploadSource,
      contentRatings,
      contentLanguages,
      excludedGenreIds,
      excludedTagIds,
      hideDisturbing: await this.preferences.flag(PreferenceID.HideDisturbing),
      ...(context?.allowedContentRatings === undefined
        ? {}
        : { allowedRatings: context.allowedContentRatings }),
    };
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
    const [genres, tags, sources, languages] = await Promise.all([
      this.genreOptions(),
      this.tagOptions(),
      this.sourceOptions(),
      this.languageOptions(),
    ]);

    const form = buildSearchForm({
      header: "Search options",
      fields: [
        SearchMultiPickerSheet({
          id: FilterID.ContentLanguage,
          title: "Language",
          options: languages,
        }),
        SearchMenuPicker({
          id: FilterID.ChapterRange,
          title: "Chapters",
          options: [
            { id: "", title: "Any" },
            { id: "1-20", title: "1–20" },
            { id: "21-100", title: "21–100" },
            { id: "101+", title: "101+" },
          ],
        }),
        SearchTextField({
          id: FilterID.Chapters,
          title: "Custom chapter range",
          subtitle: "Overrides the Chapters preset",
          placeholder: "20, 1-20 or 100+",
        }),
        SearchTextField({
          id: FilterID.StartYear,
          title: "Started year",
          placeholder: "2020 or 2018-2022",
        }),
        ...(tags.length
          ? [
              SearchExcludableMultiPickerSheet({
                id: FilterID.Tags,
                title: "Tags",
                options: groupTags(tags)
                  .flatMap(({ options }) => options)
                  .sort((left, right) => left.title.localeCompare(right.title)),
              }),
              SearchTextField({
                id: FilterID.TagQuery,
                title: "Tag names",
                subtitle: "Separate names with commas; prefix a name with - to exclude it",
                placeholder: "time travel, -tragedy",
              }),
            ]
          : []),
        SearchGroup({
          id: "more-filters",
          title: "More filters",
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
            SearchMultiPickerSheet({
              id: FilterID.OriginalLanguage,
              title: "Original language",
              options: LANGUAGE_OPTIONS,
            }),
            SearchMultiPickerSheet({
              id: FilterID.TranslatedLanguage,
              title: "Translated into",
              options: LANGUAGE_OPTIONS,
            }),
            SearchTextField({ id: FilterID.Staff, title: "Person", placeholder: "Full name" }),
            SearchTextField({
              id: FilterID.Groups,
              title: "Group",
              placeholder: "Full group name",
            }),
            SearchTextField({
              id: FilterID.EndYear,
              title: "Ended year",
              placeholder: "2020 or 2018-2022",
            }),
            SearchTextField({
              id: FilterID.Volumes,
              title: "Volumes",
              placeholder: "5, 1-5 or 10+",
            }),
            SearchMenuPicker({
              id: FilterID.Disturbing,
              title: "Disturbing content",
              options: [
                { id: "default", title: "Use Settings" },
                { id: "any", title: "Include" },
                { id: "exclude", title: "Leave out" },
                { id: "only", title: "Only" },
              ],
            }),
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
            SearchToggle({
              id: FilterID.ExactMatch,
              title: "Exact title match",
            }),
          ],
        }),
      ],
      sortHeader: "Sort",
    });

    return {
      sections: [
        // A tags section keeps the choices inline even when they came from the server.
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
          header: "Status",
          field: SearchMultiPicker({
            id: FilterID.PublicationStatus,
            title: "Status",
            options: STATUS_OPTIONS,
          }),
        }),
        SearchTagsSection({
          header: "Content rating",
          field: SearchMultiPicker({
            id: FilterID.ContentRating,
            title: "Content rating",
            options: CONTENT_RATING_OPTIONS,
          }),
        }),
        ...form.sections,
      ],
    };
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(
      this.preferences,
      await buildSettingsSections({
        genres: () => this.genreOptions(),
        tags: () => this.tagOptions(),
        languages: () => this.languageOptions(),
        resetContentFilters: async () => {
          await this.preferences.reset(PreferenceID.ExcludedGenres);
          for (const key of EXCLUDED_TAG_KEYS) await this.preferences.reset(key);
          await this.preferences.reset(PreferenceID.ContentRating);
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

    const { results } = await this.loadSection(spec, 1, link.context, 20);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const spec = sectionById(DISCOVER_SECTIONS, request.listId);
    if (spec) return this.loadSection(spec, pageOf(request), request.context);

    const filters = new FilterReader(request);
    const options = await this.bodyOptions(request.query, request.context);

    // The tag list is only needed to turn a typed name into an id, so it is fetched when
    // one was typed rather than on every search.
    const body = buildSearchBody(
      filters.text(FilterID.TagQuery)
        ? { ...options, tagNames: await this.api.fetchTagNames() }
        : options,
      filters,
    );

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
    );
  }

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
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

    const trackerId = details.tracker_id;
    if (!trackerId) return content;

    // A migration walks a whole library through here and wants only enough to match a
    // title, so the extra request below is bought once per title and thrown away.
    if (isMigration(context)) return content;

    const related = await this.api
      .fetchRelated(trackerId)
      .then((response) => response.book_series ?? [])
      .catch(() => []);

    const others = related
      .filter(
        (entry) =>
          entry.id !== contentId &&
          (context?.allowedContentRatings === undefined ||
            context.allowedContentRatings.includes(parseContentRating(entry)!)),
      )
      .slice(0, 10);
    if (others.length === 0) return content;

    return {
      ...content,
      additionalInfo: [
        ...(content.additionalInfo ?? []),
        additionalInfo.highlights.section({
          id: "related",
          title: "Related Editions",
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
    const [details, languages, sources] = await Promise.all([
      this.fetchDetails(contentId),
      this.preferences.strings(PreferenceID.ContentLanguages),
      this.api.fetchUploadSources(),
    ]);

    const source = details.source_id
      ? sources.find((entry) => entry.source_id === details.source_id)
      : undefined;

    const books = details.series_books ?? (await this.api.fetchBooks(contentId));

    return parseChapters(
      contentId,
      { ...details, series_books: books },
      {
        language: details.translated_language ?? languages[0] ?? DefinedLanguages.ENGLISH,
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

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    const dataSaver = await this.preferences.flag(PreferenceID.DataSaver);
    const url = imageURL.includes("token=")
      ? await this.api.refreshPageUrl(imageURL, dataSaver).catch(() => imageURL)
      : imageURL;

    return { url, headers: { referer: `${BASE_URL}/`, origin: BASE_URL } };
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
    const body = buildSearchBody(options);
    return this.runSearch(
      body,
      page,
      size,
      buildSortParameter(spec.sort),
      spec.layout,
      false,
      ratings,
    );
  }

  private async runSearch(
    body: Record<string, unknown>,
    page: number,
    size: number,
    sort: string,
    layout: SectionLayoutKind = SectionLayout.Simple,
    exactMatch = false,
    ratings: string[] = CONTENT_RATINGS,
  ): Promise<PagedSearchResult> {
    if (!ratings.length) return { results: [], isLastPage: true };
    const [response, titleOptions] = await Promise.all([
      this.api.fetchSearch(body, page, size, sort, exactMatch),
      this.titleOptions(),
    ]);

    // A mixed selection such as Safe + Pornographic cannot be expressed by one age array
    // and one flag. Only that case needs a final check; pagination still follows the API.
    const mixed =
      ratings.includes("Pornographic") && !ratings.includes("Erotica") && ratings.length > 1;
    const results: Highlight[] = (response.content ?? [])
      .filter((book) => !mixed || ratings.includes(contentRatingId(book) ?? ""))
      .map((book) =>
        parseHighlight(book, titleOptions, (imageId) => this.api.imageUrl(imageId), {
          ...this.buildTileExtras(book, layout),
        }),
      );

    return { results, isLastPage: response.last !== false };
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
