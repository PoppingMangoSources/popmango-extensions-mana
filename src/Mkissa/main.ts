/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchPicker,
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
  relativeTime,
  resolveSortId,
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { MkissaApi } from "./client.ts";
import {
  BASE_URL,
  CHAPTERS_QUERY,
  COUNTRY_OPTIONS,
  DETAILS_QUERY,
  DISCOVER_SECTIONS,
  FilterID,
  GENRE_NAME_BY_ID,
  GENRE_OPTIONS,
  LATEST_QUERY,
  PAGE_SIZE,
  POPULAR_QUERY,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  RANDOM_QUERY,
  SEARCH_QUERY,
  SORT_OPTIONS,
  SectionID,
  SortID,
  type ChaptersResponse,
  type DetailsResponse,
  type MangaCard,
  type PopularResponse,
  type RandomResponse,
  type SearchBodyOptions,
  type SearchResponse,
} from "./model.ts";
import {
  formatCount,
  parseChapters,
  parseContent,
  parseDateParts,
  parseHighlight,
  parsePageUrls,
  seriesUrl,
} from "./parsers.ts";
import { fetchPagesFromReader } from "./reader.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "mkissa",
  name: "Mkissa",
  version: "1.0.0",
  description: "Manga, manhwa and manhua from mkissa.to.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Mkissa.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mkissa.to", "allmanga.to"],
};

const DATE_RANGE = {
  [SectionID.Popular]: 0,
  [SectionID.PopularWeek]: 7,
  [SectionID.PopularMonth]: 30,
};

class MkissaSource
  implements ContentSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly api = new MkissaApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  private async showAdult(context?: SourceContext): Promise<boolean> {
    const allowed = context?.allowedContentRatings;
    // A host policy that bars explicit content overrides the preference for that request.
    if (allowed && !allowed.includes(ContentRating.EXPLICIT)) return false;
    return this.preferences.flag(PreferenceID.ShowAdult);
  }

  private ratingFor(showAdult: boolean): ContentRating {
    return showAdult ? ContentRating.EXPLICIT : ContentRating.MATURE;
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Country narrows results to one origin. Genres can be required or excluded.",
      fields: [SearchPicker({ id: FilterID.Country, title: "Country", options: COUNTRY_OPTIONS })],
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

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.preferences.flag(sectionPreferenceKey(section.id))),
    );

    return toPageSections(DISCOVER_SECTIONS.filter((_, position) => enabled[position]));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(DISCOVER_SECTIONS, sectionID);
    if (!spec) return { items: [] };

    const { results } = await this.loadSection(sectionID, spec.limit, 1, link.context);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, undefined, pageOf(request), request.context);
    }

    const query = request.query?.trim() ?? "";
    const pasted = await this.resolvePastedLink(query);
    if (pasted) return pasted;

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const showAdult = await this.showAdult(request.context);

    const data = await this.api.fetchGraphQL<SearchResponse>(
      SEARCH_QUERY,
      this.searchVariables(
        {
          ...(query ? { query } : {}),
          sort: resolveSortId(SORT_OPTIONS, request, SortID.Update),
          country: filters.option(FilterID.Country) || "ALL",
          includedGenres: genres.included,
          excludedGenres: genres.excluded,
          showAdult,
        },
        pageOf(request),
      ),
    );

    const rating = this.ratingFor(showAdult);
    return {
      results: data.mangas.edges.map((card) => parseHighlight(card, rating)),
      isLastPage: data.mangas.edges.length < PAGE_SIZE,
    };
  }

  private searchVariables(options: SearchBodyOptions, page: number): Record<string, unknown> {
    const names = (ids: string[]) => ids.map((id) => GENRE_NAME_BY_ID[id] ?? id.replace(/_/g, " "));
    const included = names(options.includedGenres);
    const excluded = names(options.excludedGenres);

    return {
      search: {
        query: options.query ?? null,
        // The API sorts by update when given no explicit order.
        sortBy: options.sort && options.sort !== SortID.Update ? options.sort : null,
        genres: included.length > 0 ? included : null,
        excludeGenres: excluded.length > 0 ? excluded : null,
        isManga: true,
        allowAdult: options.showAdult,
        allowUnknown: false,
      },
      size: PAGE_SIZE,
      page,
      translationType: "sub",
      countryOrigin: options.country,
    };
  }

  private async resolvePastedLink(query: string): Promise<PagedSearchResult | undefined> {
    const seriesId = parsePastedSeriesId(query);
    if (!seriesId) return undefined;

    try {
      const content = await this.getContent(seriesId);
      return {
        results: [
          {
            id: seriesId,
            title: content.title,
            cover: content.cover,
            ...(content.contentRating === undefined
              ? {}
              : { contentRating: content.contentRating }),
            webUrl: seriesUrl(seriesId),
          },
        ],
        isLastPage: true,
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  private async loadSection(
    sectionId: string,
    limit: number | undefined,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const showAdult = await this.showAdult(context);
    const rating = this.ratingFor(showAdult);

    if (sectionId === SectionID.Recommended) {
      const data = await this.api.fetchGraphQL<RandomResponse>(RANDOM_QUERY, {
        format: "manga",
        allowAdult: showAdult,
      });
      const cards = data.queryRandomRecommendation ?? [];
      return {
        results: cards.map((card) => parseHighlight(card, rating)),
        isLastPage: true,
      };
    }

    if (sectionId === SectionID.Latest) {
      const data = await this.api.fetchGraphQL<SearchResponse>(
        LATEST_QUERY,
        this.searchVariables(
          { country: "ALL", includedGenres: [], excludedGenres: [], showAdult },
          page,
        ),
      );

      const results = data.mangas.edges.flatMap((card): Highlight[] => {
        const latest = card.availableChaptersDetail?.sub?.[0];
        if (!latest) return [];
        return [
          {
            ...parseHighlight(card, rating),
            subtitle: `Chapter ${latest}`,
            info: [{ key: `Chapter ${latest}`, value: relativeUpload(card) }],
          },
        ];
      });

      return { results, isLastPage: data.mangas.edges.length < PAGE_SIZE };
    }

    const data = await this.api.fetchGraphQL<PopularResponse>(POPULAR_QUERY, {
      type: "manga",
      size: limit ?? PAGE_SIZE,
      dateRange: DATE_RANGE[sectionId as keyof typeof DATE_RANGE] ?? 0,
      page,
      allowAdult: showAdult,
      allowUnknown: false,
    });

    const recommendations = data.queryPopular.recommendations;
    const results = recommendations.flatMap((entry): Highlight[] => {
      const card = entry.anyCard;
      if (!card) return [];
      return [
        {
          ...parseHighlight(card, rating),
          ...(card.score == null ? {} : { subtitle: `★ ${card.score.toFixed(1)}` }),
          info: buildPopularInfo(card, entry.pageStatus?.views),
        },
      ];
    });

    return { results, isLastPage: recommendations.length < (limit ?? PAGE_SIZE) };
  }

  async getContent(contentId: string): Promise<Content> {
    const data = await this.api.fetchGraphQL<DetailsResponse>(DETAILS_QUERY, { id: contentId });
    return parseContent(contentId, data.manga);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const data = await this.api.fetchGraphQL<ChaptersResponse>(CHAPTERS_QUERY, {
      id: contentId,
      showId: `manga@${contentId}`,
    });
    return parseChapters(data, contentId);
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const quality = await this.preferences.text(PreferenceID.ImageQuality, "original");

    const data = await fetchPagesFromReader(contentId, chapterId);
    const pages = data ? parsePageUrls(data, quality) : [];

    if (pages.length === 0) {
      throw new Error(
        `Mkissa returned no pages for chapter ${chapterId}. The site serves its page list ` +
          "to the reader only, so try again in a moment.",
      );
    }

    return { pages: pages.map((url) => ({ url })) };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const seriesId = parsePastedSeriesId(url);
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

function parsePastedSeriesId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const fromUrl = /^https?:\/\/[^/]*(?:mkissa\.to|allmanga\.to)\/manga\/([^/?#]+)/i.exec(trimmed);
  if (fromUrl?.[1]) return decodeURIComponent(fromUrl[1]);

  // The site's own ids are opaque, so `id:` lets one be pasted directly.
  if (/^id:/i.test(trimmed)) return trimmed.slice(3).trim() || undefined;
  return undefined;
}

function relativeUpload(card: MangaCard): string {
  const date = parseDateParts(card.lastChapterDate?.sub);
  return date ? relativeTime(date) : "";
}

function buildPopularInfo(card: MangaCard, views: string | null | undefined) {
  const info: { key: string; value: string }[] = [];
  const chapters = card.availableChapters?.sub;
  if (chapters != null) info.push({ key: "Chapters", value: String(chapters) });
  if (card.score != null) info.push({ key: "Score", value: card.score.toFixed(1) });
  if (views) info.push({ key: "Views", value: formatCount(views) });
  return info;
}

export class Target extends MkissaSource {}
