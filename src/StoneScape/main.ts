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
  type ChapterSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type ImageRequestHandler,
  type NetworkRequest,
  type Option,
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
import { StoneScapeApi } from "./client.ts";
import {
  BASE_URL,
  BUNDLED_GENRES,
  DISCOVER_SECTIONS,
  FilterID,
  GENRE_LIFETIME_MS,
  isHeroSection,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SECTION_PERIODS,
  SECTION_SUBTITLES,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  type Series,
  type SeriesResponse,
} from "./model.ts";
import {
  parseChapters,
  parseContent,
  parsePages,
  parseRating,
  toHighlight,
  seriesUrl,
  type SubtitleStyle,
  slugFromUrl,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "stonescape",
  name: "StoneScape",
  version: "1.0.7",
  description: "Manhwa, manhua and manga from stonescape.xyz.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "StoneScape.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["stonescape.xyz"],
};

class StoneScapeSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new StoneScapeApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // The genre list is the same for every reader and changes when the site adds one, so it
  // is kept on disk rather than fetched each time the filter form opens.
  private readonly genreCache = new TimedCache<Option[]>("stonescape.genres", GENRE_LIFETIME_MS);

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  /**
   * The site's own genre list. A failed read falls back to the bundled one and is not
   * stored, so the next form open asks again rather than remembering the failure.
   */
  private genres(): Promise<Option[]> {
    return this.genreCache
      .get(async () => {
        const response = await this.api.fetchGenres();
        const genres = (response.genres ?? [])
          .filter((genre) => genre.slug && genre.label)
          .map((genre) => ({ id: genre.slug, title: genre.label }));

        // An empty list is a bad response, not a site with no genres. Throwing keeps it
        // out of the cache so the bundled list stands in for this open only.
        if (genres.length === 0) throw new Error("StoneScape listed no genres");
        return genres;
      })
      .catch(() => BUNDLED_GENRES);
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the site's own defaults.",
      fields: [SearchPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS })],
      // A tags section is always inline chips and ignores a sheet builder, which suits the
      // forty-odd genres the site lists.
      tags: SearchExcludableMultiPicker({
        id: FilterID.Genres,
        title: "Genres",
        options: await this.genres(),
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
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };
    const { results } = await this.loadSection(sectionID, 1, link.context);
    return { items: results };
  }

  /** Every row is one request, so opening the home page costs one per row and no more. */
  private async loadSection(
    sectionID: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const allowed = context?.allowedContentRatings;
    // A hero card carries no info rows, so it is told which row it is. Reading that off
    // the style keeps the two in step if the rows are ever rearranged.
    const hero = isHeroSection(sectionID);
    const subtitle = SECTION_SUBTITLES[sectionID];

    if (sectionID === SectionID.Featured) {
      // The site hand-picks this set and it arrives whole, so it is shown as given.
      const banner = await this.api.fetchBanner();
      const featured = this.permitted(banner.featuredSeries ?? [], allowed);
      return {
        results: featured.map((entry) => toHighlight(entry, hero, subtitle)),
        isLastPage: true,
      };
    }

    const period = SECTION_PERIODS[sectionID];
    if (period) {
      // The popular endpoint pages, so its row shares the listing the "more" link opens.
      const response = await this.api.fetchPopular(period, PAGE_SIZE, page);
      return this.toResults(response, page, allowed, hero, subtitle);
    }

    const response = await this.api.fetchSeries({ page, limit: PAGE_SIZE });
    return this.toResults(response, page, allowed, hero, subtitle);
  }

  private toResults(
    response: SeriesResponse,
    page: number,
    allowed: readonly ContentRating[] | undefined,
    hero = false,
    subtitle?: SubtitleStyle,
  ): PagedSearchResult {
    const series = response.data ?? [];
    const totalPages = response.pagination?.totalPages ?? undefined;

    return {
      results: this.permitted(series, allowed).map((entry) => toHighlight(entry, hero, subtitle)),
      // Paging follows what the server reported, not what survived the rating policy — a
      // page emptied by it is still a page, and stopping here would end the list early.
      isLastPage: totalPages == null ? series.length < PAGE_SIZE : page >= totalPages,
    };
  }

  /**
   * The API exposes no content-rating parameter and its genre filter only includes, so a
   * host policy cannot be pushed down into the request and is applied to the rows instead.
   */
  private permitted(
    series: readonly Series[],
    allowed: readonly ContentRating[] | undefined,
  ): Series[] {
    if (!allowed) return [...series];
    const permitted = new Set(allowed);
    return series.filter((entry) => permitted.has(parseRating(entry.genres)));
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    const query = request.query?.trim() ?? "";

    // A pasted series link is the title itself rather than words to search for.
    const slug = slugFromUrl(query);
    if (slug) {
      const series = await this.api.fetchSeriesDetails(slug).catch(() => undefined);
      return { results: series ? [toHighlight(series, false)] : [], isLastPage: true };
    }

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const page = pageOf(request);

    const response = await this.api.fetchSeries({
      page,
      limit: PAGE_SIZE,
      ...(query ? { search: query } : {}),
      ...(genres.included.length > 0 ? { genres: genres.included } : {}),
      ...(filters.has(FilterID.Status) ? { status: filters.option(FilterID.Status) } : {}),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
    });

    const results = this.toResults(response, page, request.context?.allowedContentRatings);
    if (genres.excluded.length === 0) return results;

    // The server includes genres but cannot exclude them, so an exclusion is applied to
    // the rows. Paging still follows the server's own count, so the list runs to its end.
    const excluded = new Set(genres.excluded.map((genre) => genre.toLowerCase()));
    return {
      ...results,
      results: results.results.filter((item) => !this.hasExcludedGenre(response, item, excluded)),
    };
  }

  private hasExcludedGenre(
    response: SeriesResponse,
    item: Highlight,
    excluded: ReadonlySet<string>,
  ): boolean {
    const series = (response.data ?? []).find((entry) => entry.slug === item.id);
    return (series?.genres ?? []).some((genre) => excluded.has(genre.trim().toLowerCase()));
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await this.api.fetchSeriesDetails(contentId));
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [response, showLocked] = await Promise.all([
      this.api.fetchChapters(contentId),
      this.preferences.flag(PreferenceID.ShowLockedChapters),
    ]);

    return parseChapters(response.chapters ?? [], showLocked);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const response = await this.api.fetchChapterPages(chapterId);
    const pages = parsePages(response);

    // A locked chapter answers with no pages rather than an error, so the reason a reader
    // would otherwise have to guess at is spelled out here.
    if (pages.length === 0) {
      throw new Error(
        "StoneScape returned no pages for this chapter. Paid chapters have to be unlocked on the website before they can be read.",
      );
    }

    return { pages: pages.map((url) => ({ url })) };
  }

  /**
   * Covers and pages are served from the site itself, behind the same Cloudflare, and it
   * refuses an image asked for without a referer of its own.
   */
  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    return {
      url: imageURL,
      headers: {
        referer: `${BASE_URL}/`,
        origin: BASE_URL,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const slug = slugFromUrl(url);
    if (!slug) return null;

    try {
      const content = await this.getContent(slug);
      return {
        content: {
          id: slug,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          webUrl: seriesUrl(slug),
        },
      };
    } catch {
      return null;
    }
  }
}

export class Target extends StoneScapeSource {}
