/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchToggle,
  type Chapter,
  type ChapterData,
  type Content,
  type ContentSource,
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
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { FlameComicsApi } from "./client.ts";
import {
  BASE_URL,
  DISCOVER_SECTIONS,
  FilterID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  SORT_OPTIONS,
  SectionID,
  SortID,
  type ChapterReaderResponse,
  type HomepageResponse,
  type SearchCriteria,
  type SeriesDetailResponse,
  type SeriesListItem,
} from "./model.ts";
import {
  buildPageUrl,
  parseChapters,
  parseContent,
  parseFilterOptions,
  parseHighlight,
  seriesUrl,
} from "./parsers.ts";
import { filterSeries, sortSeries } from "./search.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "flamecomics",
  name: "FlameComics",
  version: "1.0.0",
  description: "Manhwa, manhua and manga from flamecomics.xyz.",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "FlameComics.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["flamecomics.xyz"],
};

class FlameComicsSource
  implements ContentSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly api = new FlameComicsApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    const { series } = (await this.api.fetchBrowse()).pageProps;
    const options = parseFilterOptions(series);

    return buildSearchForm({
      header: "Filters",
      footer: "Everything here is applied to the site's full catalogue, which is fetched once.",
      fields: [
        SearchMultiPicker({ id: FilterID.Types, title: "Type", options: options.types }),
        SearchMultiPicker({ id: FilterID.Status, title: "Status", options: options.status }),
        SearchPicker({ id: FilterID.Language, title: "Language", options: options.languages }),
        SearchPicker({ id: FilterID.Country, title: "Country", options: options.countries }),
        SearchMultiPickerSheet({ id: FilterID.Year, title: "Year", options: options.years }),
        SearchToggle({
          id: FilterID.MatchAllCategories,
          title: "Match All Categories",
          subtitle: "Require every selected category rather than any of them",
        }),
        SearchGroup({
          id: "credits",
          title: "Credits",
          children: [
            SearchExcludableMultiPickerSheet({
              id: FilterID.Publisher,
              title: "Publisher",
              options: options.publishers,
            }),
            SearchExcludableMultiPickerSheet({
              id: FilterID.Author,
              title: "Author",
              options: options.authors,
            }),
            SearchExcludableMultiPickerSheet({
              id: FilterID.Artist,
              title: "Artist",
              options: options.artists,
            }),
          ],
        }),
      ],
      tags: SearchExcludableMultiPicker({
        id: FilterID.Categories,
        title: "Categories",
        options: options.categories,
      }),
      tagsHeader: "Categories",
      sortHeader: "Sort",
    });
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, buildSettingsSections());
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.preferences.flag(sectionPreferenceKey(section.id))),
    );

    return toPageSections(DISCOVER_SECTIONS.filter((_, position) => enabled[position]));
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };
    return { items: await this.sectionItems(sectionID) };
  }

  /** Every row is served from the one homepage payload, so the page costs a single request. */
  private async sectionItems(sectionID: string): Promise<Highlight[]> {
    const { pageProps } = await this.api.fetchHome();

    const container: keyof HomepageResponse["pageProps"] =
      sectionID === SectionID.Popular
        ? "popularEntries"
        : sectionID === SectionID.StaffPicks
          ? "staffPicks"
          : "latestEntries";

    // A container holds one or more named blocks; the row shows all of them in order.
    const seen = new Set<number>();
    const items: Highlight[] = [];

    for (const block of pageProps[container]?.blocks ?? []) {
      for (const entry of block.series ?? []) {
        if (seen.has(entry.series_id)) continue;
        seen.add(entry.series_id);
        items.push(parseHighlight(entry));
      }
    }

    return items;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      const items = await this.sectionItems(request.listId);
      return { results: items, isLastPage: true };
    }

    const { series } = (await this.api.fetchBrowse()).pageProps;
    const criteria = this.readCriteria(request);

    const matched = sortSeries(filterSeries(series, criteria), criteria.sort);

    // The catalogue arrives whole, so paging is done here rather than by the server.
    const page = pageOf(request);
    const start = (page - 1) * PAGE_SIZE;
    const window = matched.slice(start, start + PAGE_SIZE);

    return {
      results: window.map((item: SeriesListItem) => parseHighlight(item)),
      isLastPage: start + window.length >= matched.length,
    };
  }

  private readCriteria(request: SearchRequest): SearchCriteria {
    const filters = new FilterReader(request);
    const categories = filters.excludable(FilterID.Categories);
    const publishers = filters.excludable(FilterID.Publisher);
    const authors = filters.excludable(FilterID.Author);
    const artists = filters.excludable(FilterID.Artist);

    return {
      query: request.query?.trim() ?? "",
      includedCategories: categories.included,
      excludedCategories: categories.excluded,
      matchAllCategories: filters.toggle(FilterID.MatchAllCategories),
      types: filters.options(FilterID.Types),
      status: filters.options(FilterID.Status),
      includedPublishers: publishers.included,
      excludedPublishers: publishers.excluded,
      includedAuthors: authors.included,
      excludedAuthors: authors.excluded,
      includedArtists: artists.included,
      excludedArtists: artists.excluded,
      years: filters.options(FilterID.Year),
      language: filters.option(FilterID.Language),
      country: filters.option(FilterID.Country),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const response = await this.api.fetchSeries<SeriesDetailResponse>(contentId);
    return parseContent(contentId, response.pageProps.series);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    // One payload carries the series and its chapters.
    const response = await this.api.fetchSeries<SeriesDetailResponse>(contentId);
    return parseChapters(response.pageProps.chapters ?? []);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const [seriesId, token] = chapterId.split(":");
    if (!seriesId || !token) throw new Error(`Unrecognised chapter id: ${chapterId}`);

    const response = await this.api.fetchChapter<ChapterReaderResponse>(seriesId, token);
    const chapter = response.pageProps.chapter;

    // `images` is keyed by page index as a string, so it is sorted numerically.
    const pages = Object.entries(chapter.images ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, image]) => ({
        url: buildPageUrl(chapter.series_id, chapter.token, image.name),
      }));

    if (pages.length === 0) throw new Error(`Flame Comics returned no pages for ${chapterId}`);
    return { pages };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const seriesId = /\/series\/(\d+)/i.exec(url)?.[1];
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
}

export class Target extends FlameComicsSource {}
