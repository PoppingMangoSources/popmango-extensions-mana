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
  CHAPTERS_PER_PAGE,
  MAX_CHAPTER_PAGES,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  HOME_CACHE_MS,
  SORT_OPTIONS,
  SortID,
  type Card,
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
  parseHome,
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
  version: "1.0.5",
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

  // The front page, held just long enough for every row on it to be drawn from one read.
  private home: { at: number; sections: Record<string, Card[]> } | undefined;
  private homeRequest: Promise<Record<string, Card[]>> | undefined;

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
   * The front page, read and parsed once for every row on it.
   *
   * Sharing a request that is in flight is not enough: the app resolves the rows one after
   * another, so by the time the second asks, the first has finished and the sharing window
   * has closed — three fetches and three parses of a whole rendered page, which is what
   * made the page slow to open. Holding the result for a few seconds collapses that to one
   * of each, while still being short enough that a deliberate refresh gets a fresh page.
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
    const [html, hideLocked] = await Promise.all([
      this.api.fetchPage(contentId),
      this.preferences.flag(PreferenceID.HideLockedChapters),
    ]);

    const rows = [...parseChapterRows(html), ...(await this.remainingChapters(html))];
    return toChapters(rows, hideLocked);
  }

  /**
   * The rest of the list, behind the theme's own load-more action.
   *
   * Each batch has to be asked for before the next offset is known, so these are sequential
   * by necessity rather than by choice — hence the page cap. Asking for several at once
   * would guess at offsets that may not exist, and this origin answers Cloudflare with a
   * timeout under load often enough that spending requests on a guess is the wrong trade.
   * What was actually costing time here was reading the same page three times over, which
   * the client now holds instead.
   */
  private async remainingChapters(html: string): Promise<ChapterRow[]> {
    const { comicId, offset } = parseLoadMore(html);
    const nonce = parseNonce(html);
    if (!comicId || !nonce) return [];

    const rows: ChapterRow[] = [];
    const inline = parseChapterRows(html).length;

    // The button states where the inline rows end, but it has been seen saying nothing, or
    // saying more than the page actually holds. Either would start the walk past chapters
    // that were never read, so it is only trusted as far as the page bears out.
    const stated = offset ?? 0;
    let next = stated > 0 && stated <= inline ? stated : inline;

    for (let page = 0; page < MAX_CHAPTER_PAGES; page++) {
      const fragment = await this.api
        .fetchChapterBatch(comicId, nonce, next)
        .catch(() => undefined);
      if (!fragment) break;

      const batch = parseChapterRows(fragment);
      if (batch.length === 0) break;

      rows.push(...batch);
      // The offset steps by the run the endpoint hands over, not by how many rows came
      // back: a batch that parsed short would otherwise walk back over itself, and one
      // that parsed long would step over chapters that were never asked for.
      next += CHAPTERS_PER_PAGE;
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
