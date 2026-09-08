/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPickerSheet,
  SearchPicker,
  type Chapter,
  type ChapterData,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Form,
  type ImageRequestHandler,
  type NetworkRequest,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchListItem,
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
  TimedCache,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { RokariComicsApi } from "./client.ts";
import {
  BASE_URL,
  DIRECTORY_PATH,
  DISCOVER_SECTIONS,
  FilterID,
  HOME_CACHE_MS,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SECTION_SUBTITLES,
  SORT_OPTIONS,
  SortID,
  TAXONOMY_LIFETIME_MS,
  type Card,
} from "./model.ts";
import {
  chapterIsLocked,
  chapterPath,
  contentUrl,
  parseBrowse,
  parseChapterRows,
  parseContent,
  parseFilters,
  parseHome,
  parsePages,
  pathOf,
  toChapters,
  toHighlight,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "rokaricomics",
  name: "RokariComics",
  version: "1.0.3",
  description: "Comics from rokaricomics.com.",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "RokariComics.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["rokaricomics.com"],
};

class RokariComicsSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new RokariComicsApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // The theme's filter lists change only when the site adds a genre, so they are kept on
  // disk rather than read out of a whole directory page each time the form opens.
  private readonly filters = new TimedCache<Record<string, Option[]>>(
    "rokaricomics.filters",
    TAXONOMY_LIFETIME_MS,
  );

  // The front page, held just long enough for every row on it to be drawn from one read.
  private home: { at: number; sections: Record<string, Card[]> } | undefined;
  private homeRequest: Promise<Record<string, Card[]>> | undefined;

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  /**
   * The theme's own filter lists, off its directory page. A failed read is not stored, so
   * the next open asks again rather than remembering the failure.
   */
  private filterOptions(): Promise<Record<string, Option[]>> {
    return this.filters
      .get(async () => {
        const parsed = parseFilters(await this.api.fetchDirectory());
        // An empty list is a bad response, not a site with no genres.
        if ((parsed["genres"] ?? []).length === 0) throw new Error("RokariComics listed no genres");
        return parsed;
      })
      .catch(() => ({}));
  }

  async getSearchForm(): Promise<SearchForm> {
    const options = await this.filterOptions();
    const genres = options["genres"] ?? [];
    const statuses = options["status"] ?? [];
    const kinds = options["type"] ?? [];

    const fields: SearchListItem[] = [];

    // The theme takes one status and one type, but any number of genres — and it excludes
    // a genre by the same parameter, so that field includes and excludes.
    if (statuses.length > 0) {
      fields.push(
        SearchPicker({
          id: FilterID.Status,
          title: "Status",
          // A picker cannot be cleared once set, so it opens with its own "any" row.
          options: [{ id: "", title: "Any" }, ...statuses],
        }),
      );
    }
    if (kinds.length > 0) {
      fields.push(
        SearchPicker({
          id: FilterID.Type,
          title: "Type",
          options: [{ id: "", title: "Any" }, ...kinds],
        }),
      );
    }

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the site's own defaults.",
      fields,
      // The list comes off the site, so it takes a sheet rather than however many inline
      // rows the site happens to publish. A read that failed offers no field at all,
      // which is honester than an empty one.
      ...(genres.length > 0
        ? {
            tags: SearchExcludableMultiPickerSheet({
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
    return buildPreferenceMenu(this.preferences, buildSettingsSections());
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.preferences.flag(sectionPreferenceKey(section.id))),
    );

    return toPageSections(DISCOVER_SECTIONS.filter((_, position) => enabled[position]));
  }

  /**
   * The front page, read and parsed once for every row on it.
   *
   * Sharing a request that is in flight is not enough: the app resolves the rows one after
   * another, so by the time the second asks, the first has finished and the sharing window
   * has closed — seven fetches and seven parses of a whole rendered page. Holding the
   * result for a few seconds collapses that to one of each, while still being short enough
   * that a deliberate refresh gets a fresh page.
   */
  private async homeSections(): Promise<Record<string, Card[]>> {
    const cached = this.home;
    if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.sections;

    this.homeRequest ??= this.api
      .fetchHome()
      .then((html) => {
        const sections = parseHome(html);
        this.home = { at: Date.now(), sections };
        return sections;
      })
      .finally(() => {
        this.homeRequest = undefined;
      });

    return this.homeRequest;
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };

    const cards = (await this.homeSections())[sectionID] ?? [];
    const style = SECTION_SUBTITLES[sectionID] ?? "chapter";
    return { items: cards.map((card) => toHighlight(card, style)) };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const query = request.query?.trim() ?? "";

    // A pasted link is the title itself rather than words to search for.
    const linked = this.contentIdFromUrl(query);
    if (linked) {
      const content = await this.getContent(linked).catch(() => undefined);
      return {
        results: content
          ? [
              {
                id: linked,
                title: content.title,
                cover: content.cover,
                ...(content.contentRating === undefined
                  ? {}
                  : { contentRating: content.contentRating }),
                webUrl: contentUrl(linked),
              },
            ]
          : [],
        isLastPage: true,
      };
    }

    const filters = new FilterReader(request);
    // The site's own unsorted order is no `order` parameter at all, which is what its own
    // menu sends for that entry.
    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Default);

    const { results, isLastPage } = parseBrowse(
      await this.api.fetchBrowse({
        page: pageOf(request),
        ...(query ? { search: query } : {}),
        ...(sort && sort !== SortID.Default ? { sort } : {}),
        ...(filters.has(FilterID.Status) ? { status: filters.option(FilterID.Status) } : {}),
        ...(filters.has(FilterID.Type) ? { type: filters.option(FilterID.Type) } : {}),
        genres: filters.excludable(FilterID.Genres),
      }),
    );

    return { results: results.map((card) => toHighlight(card, "chapter")), isLastPage };
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await this.api.fetchTitle(contentId), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [html, hideLocked] = await Promise.all([
      this.api.fetchTitle(contentId),
      this.preferences.flag(PreferenceID.HideLockedChapters),
    ]);

    return toChapters(parseChapterRows(html), hideLocked);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    if (chapterIsLocked(chapterId)) {
      throw new Error(
        "This chapter is locked. It has to be unlocked on the website before it can be read.",
      );
    }

    // The chapter's id is its own path, so this is one request rather than a lookup back
    // through the title's page for the link.
    const pages = parsePages(await this.api.fetchChapter(chapterPath(chapterId)));

    if (pages.length === 0) {
      throw new Error(
        "RokariComics returned no pages for this chapter. It may have been taken down, or be readable only on the website.",
      );
    }

    return { pages: pages.map((url) => ({ url })) };
  }

  /** The theme serves its artwork from the site itself, behind a referer check. */
  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    return {
      url: imageURL,
      headers: {
        referer: `${BASE_URL}/`,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    };
  }

  private contentIdFromUrl(value: string): string | undefined {
    if (!/^https?:\/\/(?:www\.)?rokaricomics\.com\//i.test(value.trim())) return undefined;

    const path = pathOf(value);
    // Only a title's own page, not a chapter or a listing.
    const match = new RegExp(`^${DIRECTORY_PATH}/([^/]+)$`, "i").exec(path);
    return match?.[1];
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = this.contentIdFromUrl(url);
    if (!contentId) return null;

    try {
      const content = await this.getContent(contentId);
      return {
        content: {
          id: contentId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          webUrl: contentUrl(contentId),
        },
      };
    } catch {
      return null;
    }
  }
}

export class Target extends RokariComicsSource {}
