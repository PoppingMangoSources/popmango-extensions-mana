/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchMultiPickerSheet,
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
import { RinkoComicsApi } from "./client.ts";
import {
  BASE_URL,
  DISCOVER_SECTIONS,
  FilterID,
  GENRE_LIFETIME_MS,
  MAX_CHAPTER_PAGES,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SORT_OPTIONS,
  SortID,
  type ChapterRow,
} from "./model.ts";
import {
  chapterIsLocked,
  chapterPath,
  contentUrl,
  isProseChapter,
  parseBrowse,
  parseChapterRows,
  parseContent,
  parseGenres,
  parseHomeSection,
  parseLoadMore,
  parseNonce,
  parsePages,
  pathOf,
  toChapters,
  toHighlight,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "rinkocomics",
  name: "RinkoComics",
  version: "1.0.1",
  description: "Comics from rinkocomics.com.",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "RinkoComics.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["rinkocomics.com"],
};

class RinkoComicsSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new RinkoComicsApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // The genre list is the same for every reader and changes only when the site adds one,
  // so it is kept on disk rather than read each time the filter form opens.
  private readonly genreCache = new TimedCache<Option[]>("rinkocomics.genres", GENRE_LIFETIME_MS);

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  /**
   * The site's own genre list, off the browse page. A failed read is not stored, so the
   * next open asks again rather than remembering the failure.
   */
  private genres(): Promise<Option[]> {
    return this.genreCache
      .get(async () => {
        const genres = parseGenres(await this.api.fetchGenrePage());
        // An empty list is a bad response, not a site with no genres. Throwing keeps it
        // out of the cache.
        if (genres.length === 0) throw new Error("RinkoComics listed no genres");
        return genres;
      })
      .catch(() => []);
  }

  async getSearchForm(): Promise<SearchForm> {
    const genres = await this.genres();

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the site's own defaults.",
      fields: [],
      // The list comes off the site, so it takes a sheet rather than however many inline
      // rows the site happens to publish. A read that failed offers no field at all,
      // which is honester than an empty one.
      ...(genres.length > 0
        ? {
            tags: SearchMultiPickerSheet({
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
   * Every row is cut from the same document. The client shares a request that is already
   * in flight, so the four rows resolving at once cost one fetch between them.
   */
  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };

    const cards = parseHomeSection(await this.api.fetchHome(), sectionID);
    return { items: cards.map((card) => toHighlight(card, sectionID)) };
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
    const page = pageOf(request);

    const html = await this.api.fetchBrowse({
      page,
      search: query || undefined,
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Newest),
      genres: filters.options(FilterID.Genres),
    });

    const { results, isLastPage } = parseBrowse(html);
    return { results: results.map((card) => toHighlight(card, "")), isLastPage };
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await this.api.fetchPage(contentId), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [html, showLocked] = await Promise.all([
      this.api.fetchPage(contentId),
      this.preferences.flag(PreferenceID.ShowLockedChapters),
    ]);

    const rows = [...parseChapterRows(html), ...(await this.remainingChapters(html))];
    return toChapters(rows, showLocked);
  }

  /**
   * The rest of the list, behind the theme's own load-more action.
   *
   * Each batch has to be asked for before the next offset is known, so these are sequential
   * by necessity rather than by choice — hence the page cap.
   */
  private async remainingChapters(html: string): Promise<ChapterRow[]> {
    const { comicId, offset } = parseLoadMore(html);
    const nonce = parseNonce(html);
    if (!comicId || !nonce) return [];

    const rows: ChapterRow[] = [];
    let next = offset ?? parseChapterRows(html).length;

    for (let page = 0; page < MAX_CHAPTER_PAGES; page++) {
      const fragment = await this.api
        .fetchChapterBatch(comicId, nonce, next)
        .catch(() => undefined);
      if (!fragment) break;

      const batch = parseChapterRows(fragment);
      if (batch.length === 0) break;

      rows.push(...batch);
      next += batch.length;
    }

    return rows;
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    if (chapterIsLocked(chapterId)) {
      throw new Error(
        "This chapter is locked. It has to be unlocked on the website before it can be read.",
      );
    }

    const html = await this.api.fetchPage(chapterPath(chapterId));
    const pages = parsePages(html);

    if (pages.length === 0) {
      // A novel chapter is prose, and a Mana chapter is a list of images with no text form.
      // Saying so beats a blank reader the reader cannot act on.
      throw new Error(
        isProseChapter(html)
          ? "This is a novel chapter, which is text rather than images and cannot be shown here."
          : "RinkoComics returned no pages for this chapter. It may have been taken down, or be readable only on the website.",
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
    if (!/^https?:\/\/(?:www\.)?rinkocomics\.com\//i.test(value.trim())) return undefined;
    const path = pathOf(value);
    // Only a title's own page, not a chapter or a listing.
    return /^(?:comic|novel)\/[^/]+$/i.test(path) ? path : undefined;
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

export class Target extends RinkoComicsSource {}
