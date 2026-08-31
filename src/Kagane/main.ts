/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchMultiPicker,
  SearchToggle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type Content,
  type ContentSource,
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
} from "../common/index.ts";
import { KaganeApi } from "./client.ts";
import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
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
  parseHighlight,
  type TitleOptions,
} from "./parsers.ts";
import { buildSearchBody, buildSortParameter, type SearchBodyOptions } from "./search.ts";
import { buildSettingsSections } from "./settings.ts";

const info: SourceInfo = {
  id: "kagane",
  name: "Kagane",
  version: "1.0.12",
  description: "Manga, manhwa, manhua and comics from kagane.to.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Kagane.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["kagane.to"],
};

const DETAIL_CACHE_MS = 60_000;

class KaganeSource
  implements
    ContentSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new KaganeApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  private detailCache: { seriesId: string; details: unknown; at: number } | undefined;

  private async bodyOptions(query?: string): Promise<SearchBodyOptions> {
    const [uploadSource, contentRatings, contentLanguages, excludedGenreIds, excludedTagIds] =
      await Promise.all([
        this.preferences.text(PreferenceID.UploadSource, "all"),
        this.preferences.strings(PreferenceID.ContentRating),
        this.preferences.strings(PreferenceID.ContentLanguages),
        this.preferences.strings(PreferenceID.ExcludedGenres),
        this.preferences.strings(PreferenceID.ExcludedTags),
      ]);

    return {
      ...(query ? { query } : {}),
      uploadSource,
      contentRatings,
      contentLanguages: contentLanguages.length > 0 ? contentLanguages : ["en"],
      excludedGenreIds,
      excludedTagIds,
    };
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
    const [sources, uploadSource] = await Promise.all([
      this.api.fetchUploadSources(),
      this.preferences.text(PreferenceID.UploadSource, "all"),
    ]);

    return sources
      .filter((source) =>
        uploadSource === "official"
          ? /^official$/i.test(source.source_type)
          : uploadSource === "scanlations"
            ? !/^official$/i.test(source.source_type)
            : true,
      )
      .map((source) => ({ id: source.source_id, title: source.title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    const [genres, tags, sources] = await Promise.all([
      this.genreOptions(),
      this.tagOptions(),
      this.sourceOptions(),
    ]);

    return buildSearchForm({
      header: "Filters",
      footer: "Leave a filter empty to use the defaults from Settings.",
      fields: [
        SearchMultiPicker({
          id: FilterID.ContentRating,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({ id: FilterID.Format, title: "Format", options: FORMAT_OPTIONS }),
        SearchMultiPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
        ...(sources.length > 0
          ? [SearchMultiPicker({ id: FilterID.Sources, title: "Sources", options: sources })]
          : []),
        SearchToggle({
          id: FilterID.MatchAllGenres,
          title: "Match All Genres",
          subtitle: "Require every selected genre rather than any of them",
        }),
        ...(tags.length > 0
          ? [
              SearchToggle({
                id: FilterID.MatchAllTags,
                title: "Match All Tags",
                subtitle: "Require every selected tag rather than any of them",
              }),
              SearchExcludableMultiPicker({ id: FilterID.Tags, title: "Tags", options: tags }),
            ]
          : []),
      ],
      ...(genres.length > 0
        ? {
            tags: SearchExcludableMultiPicker({
              id: FilterID.Genres,
              title: "Genres",
              options: genres,
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
        genres: () => this.genreOptions(),
        tags: () => this.tagOptions(),
        resetContentFilters: async () => {
          await this.preferences.reset(PreferenceID.ExcludedGenres);
          await this.preferences.reset(PreferenceID.ExcludedTags);
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

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(DISCOVER_SECTIONS, sectionID);
    if (!spec) return { items: [] };

    const { results } = await this.loadSection(spec, 1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const spec = sectionById(DISCOVER_SECTIONS, request.listId);
    if (spec) return this.loadSection(spec, pageOf(request));

    const filters = new FilterReader(request);
    const body = buildSearchBody(await this.bodyOptions(request.query), filters);

    const requestedSort = request.sort?.id ?? "";
    const sortId = SORT_OPTIONS.some((option) => option.id === requestedSort)
      ? requestedSort
      : SortID.Relevance;

    return this.runSearch(
      body,
      pageOf(request),
      PAGE_SIZE,
      buildSortParameter(sortId, request.sort?.ascending),
    );
  }

  async getContent(contentId: string): Promise<Content> {
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

    const related = await this.api
      .fetchRelated(trackerId)
      .then((response) => response.book_series ?? [])
      .catch(() => []);

    const others = related.filter((entry) => entry.id !== contentId).slice(0, 10);
    if (others.length === 0) return content;

    return {
      ...content,
      additionalInfo: [
        ...(content.additionalInfo ?? []),
        {
          type: 2 as const,
          id: "related",
          title: "Related Editions",
          hasMore: false,
          items: others.map((entry) => ({
            type: 2 as const,
            id: entry.id,
            title: formatTitle(entry.title, titleOptions, entry.source_id),
            cover: entry.cover_image_id ? this.api.imageUrl(entry.cover_image_id) : "",
          })),
        },
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

    return parseChapters(contentId, details, {
      language: languages[0] ?? DefinedLanguages.ENGLISH,
      ...(source === undefined
        ? {}
        : { sourceName: source.title, official: /^official$/i.test(source.source_type) }),
    });
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
    const seriesId = /\/series\/([^/?#]+)/i.exec(url)?.[1];
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
      return cached.details as Awaited<ReturnType<KaganeApi["fetchSeries"]>>;
    }

    const details = await this.api.fetchSeries(seriesId);
    this.detailCache = { seriesId, details, at: Date.now() };
    return details;
  }

  private async loadSection(spec: DiscoverSection, page: number): Promise<PagedSearchResult> {
    const body = buildSearchBody(await this.bodyOptions());

    return this.runSearch(
      body,
      page,
      spec.limit ?? PAGE_SIZE,
      buildSortParameter(spec.sort, false),
      spec.layout,
    );
  }

  private async runSearch(
    body: Record<string, unknown>,
    page: number,
    size: number,
    sort: string,
    layout: SectionLayoutKind = SectionLayout.Simple,
  ): Promise<PagedSearchResult> {
    const [response, titleOptions, genreNames] = await Promise.all([
      this.api.fetchSearch(body, page, size, sort),
      this.titleOptions(),
      layout === SectionLayout.Detailed ? this.api.fetchGenreNames() : {},
    ]);

    const results: Highlight[] = (response.content ?? []).map((book) =>
      parseHighlight(book, titleOptions, (imageId) => this.api.imageUrl(imageId), {
        ...this.buildTileExtras(book, layout, genreNames),
      }),
    );

    return { results, isLastPage: response.last !== false || results.length === 0 };
  }

  private buildTileExtras(
    book: SeriesSummary,
    layout: SectionLayoutKind,
    genreNames: Record<string, string>,
  ): { subtitle?: string; info?: Pair[] } {
    switch (layout) {
      case SectionLayout.Detailed: {
        const subtitle = formatDescriptor(book);
        return {
          ...(subtitle ? { subtitle } : {}),
          info: buildInfoRows(book, genreNames),
        };
      }

      case SectionLayout.ChapterUpdates: {
        const chapter = formatLatestChapter(book);
        if (!chapter) {
          const subtitle = formatDescriptor(book);
          return subtitle ? { subtitle } : {};
        }
        return {
          subtitle: chapter,
          info: [{ key: chapter, value: relativeTime(parseLatestChapterDate(book)) }],
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
