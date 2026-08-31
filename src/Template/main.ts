/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A starting point for a Mana content source.
 *
 * This directory is deliberately not built into the catalog: the discovery
 * scan looks for a class declaration named `Target`, and the export at the
 * bottom of this file avoids that shape on purpose. `npm run new-source`
 * rewrites it into the real one when it copies this folder.
 *
 * Remember that method presence is the feature flag — the app offers only the
 * features whose methods exist on the instance. Delete the ones the site
 * cannot back with real data rather than leaving them returning nothing.
 */

import { load, type CheerioAPI } from "cheerio";
import {
  CatalogRating,
  DefinedLanguages,
  SectionStyle,
  type Chapter,
  type ChapterData,
  type Content,
  type ContentSource,
  type Form,
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
  listResults,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  withQuery,
  type PreferenceSection,
  type QueryParams,
  type SectionSpec,
} from "../common/index.ts";
import { buildTemplateClient } from "./client.ts";
import {
  BASE_URL,
  FilterID,
  LANGUAGE_OPTIONS,
  ListID,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  SortID,
  TAG_FIELD,
} from "./model.ts";
import {
  chapterUrl,
  contentUrl,
  hasMore,
  parseChapters,
  parseContent,
  parseHighlights,
  parsePages,
} from "./parsers.ts";

const info: SourceInfo = {
  id: "template",
  name: "Template",
  version: "1.0.0",
  description: "Starting point for a Mana content source",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["example.com"],
};

class TemplateSource
  implements ContentSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);

  /**
   * Lazy on purpose. `onEnvironmentLoaded` is not awaited before the first
   * method call, so anything assigned there can still be undefined when the
   * app asks for the home page.
   */
  private get http(): NetworkClient {
    this.client ??= buildTemplateClient();
    return this.client;
  }

  private async fetchHtml(url: string, params?: QueryParams): Promise<CheerioAPI> {
    const response = await this.http.get(withQuery(url, params));
    return load(response.data);
  }

  /**
   * One entry per home row. `load` backs both the row and its "view more"
   * page, so the two can never drift apart.
   *
   * Keep a section to one request: enriching tiles from their detail pages
   * puts a round trip per tile in front of the first thing the reader sees.
   */
  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.SimpleHero,
        load: (page) => this.listing(SortID.Popular, page),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        subtitle: "Your daily dose of the latest updates",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.listing(SortID.Latest, page),
      },
    ];
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Content",
        footer: "Applies to search results and browsing.",
        fields: [
          {
            type: "select",
            key: PreferenceID.PreferredLanguage,
            title: "Preferred Language",
            options: LANGUAGE_OPTIONS,
          },
          { type: "toggle", key: PreferenceID.ShowAdult, title: "Show Adult Titles" },
        ],
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: TAG_FIELD,
      tagsHeader: "Genre",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, this.preferenceSections());
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(this.sections(), sectionID);
    if (!spec) return { items: [] };

    const { results } = await spec.load(1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    // A "view more" tap arrives as a search carrying the section's listId.
    const list = listResults(this.sections(), request);
    if (list) return list;

    // Filters hand back a different type per field, so read them through this
    // rather than casting — `filters[id] as string` silently yields undefined.
    const filters = new FilterReader(request);

    const $ = await this.fetchHtml(`${BASE_URL}/search`, {
      q: request.query?.trim() ?? "",
      page: pageOf(request),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      status: filters.option(FilterID.Status),
      author: filters.text(FilterID.Author),
      genre: filters.options(FilterID.Genre).join(","),
      year: filters.has(FilterID.Year) ? filters.number(FilterID.Year) : undefined,
      adult: filters.toggle(FilterID.AdultContent) ? "1" : undefined,
    });

    const html = $.html();
    return { results: parseHighlights(html), isLastPage: !hasMore(html) };
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.fetchHtml(contentUrl(contentId));
    return parseContent($.html(), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchHtml(contentUrl(contentId));
    return parseChapters($.html());
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchHtml(chapterUrl(contentId, chapterId));
    return { pages: parsePages($, chapterId).map((url) => ({ url })) };
  }

  private async listing(sort: string, page: number): Promise<PagedSearchResult> {
    const $ = await this.fetchHtml(`${BASE_URL}/browse`, { sort, page });
    const html = $.html();
    return { results: parseHighlights(html), isLastPage: !hasMore(html) };
  }
}

// `new-source` turns this into the class declaration the build scans for. Left
// as a re-export here so the template itself is never published as a source.
export { TemplateSource as Target };
