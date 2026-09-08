/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchTextField,
  type BasicURL,
  type BooleanState,
  type Chapter,
  type ChapterData,
  type ChapterSource,
  type Content,
  type ContentRating,
  type DeepLinkContext,
  type Form,
  type ImageRequestHandler,
  type NetworkRequest,
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
  type SourceContext,
  type SourceInfo,
  type SourcePreferenceProvider,
  type User,
  type WebViewAuthenticatable,
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
import { ValirScansApi, type BrowseQuery } from "./client.ts";
import {
  BASE_URL,
  BUNDLED_GENRES,
  DISCOVER_SECTIONS,
  FilterID,
  HOME_CACHE_MS,
  MAX_CHAPTER_PAGES,
  ORIGIN_OPTIONS,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SECTION_SUBTITLES,
  SESSION_COOKIE,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  TAXONOMY_LIFETIME_MS,
  TYPE_OPTIONS,
  type FilterTaxonomy,
  type HomeSections,
  type ValirChapterItem,
  type ValirSeries,
} from "./model.ts";
import {
  chapterIsLocked,
  chapterPath,
  contentUrl,
  parseAccount,
  parseBrowse,
  parseContent,
  parseHome,
  parseReader,
  parseSeriesPage,
  parseTaxonomy,
  permitted,
  toChapters,
  toHighlight,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "valirscans",
  name: "ValirScans",
  version: "1.0.6",
  description: "Comics from valirscans.org.",
  website: BASE_URL,
  // The catalogue runs from all-ages to adult, and the site grades each title itself.
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "ValirScans.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["valirscans.org"],
};

class ValirScansSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler,
    WebViewAuthenticatable
{
  readonly info = info;
  readonly config = config;

  private readonly api = new ValirScansApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // The genre and tag lists are the same for every reader and change only when the site
  // adds one, so they are kept on disk rather than read out of a whole browse page each
  // time the filter form opens.
  private readonly taxonomy = new TimedCache<FilterTaxonomy>(
    "valirscans.taxonomy",
    TAXONOMY_LIFETIME_MS,
  );

  // The front page, held just long enough for every row on it to be drawn from one read.
  private home: { at: number; sections: HomeSections } | undefined;
  private homeRequest: Promise<HomeSections> | undefined;

  /** Bumped whenever the account changes, so a read begun before it cannot be stored after. */
  private reader = 0;

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  // ========================= Signing in =========================

  /**
   * The site's own login page, opened in the app's WebView.
   *
   * There is nothing to intercept here: the sign-in is the site's, the credentials never
   * leave its page, and what the app keeps is the session cookie the site sets at the end
   * of it. That cookie is then carried by this source's own requests, which is what makes
   * a chapter the account has paid for open rather than report itself locked.
   */
  async getWebAuthRequestURL(): Promise<BasicURL> {
    return { url: `${BASE_URL}/login` };
  }

  /**
   * Whether the cookie just set is the one that means signed in.
   *
   * The app hands over each cookie's name as the WebView receives it and takes a `true`
   * as the signal to close the login. Answering `true` to any cookie at all would close
   * it on the first analytics cookie, before the reader has typed anything.
   */
  async didReceiveSessionCookieFromWebAuthResponse(name: string): Promise<BooleanState> {
    const matched = SESSION_COOKIE.test(name.trim());
    // Anything read while signed out was read as somebody else — a locked chapter list
    // most of all, which is the thing signing in was for.
    if (matched) this.forgetReaderState();
    return { state: matched };
  }

  async getAuthenticatedUser(): Promise<User | null> {
    // The site answers a signed-out session with an empty body rather than an error, so
    // there is nothing here to tell a refusal from a genuine absence — and this method has
    // only the two answers. A read that failed outright reports the same as signed out.
    const account = await this.api
      .fetchSession()
      .then(parseAccount)
      .catch(() => undefined);

    if (!account?.authenticated) return null;

    const handle = account.displayName ?? account.email ?? "";
    if (!handle) return null;

    return {
      handle,
      ...(account.displayName === undefined ? {} : { displayName: account.displayName }),
      ...(account.avatar === undefined ? {} : { avatar: account.avatar }),
      ...(account.email && account.email !== handle ? { info: [account.email] } : {}),
    };
  }

  /**
   * The app drops the cookies it is holding; what is left here is everything this source
   * read while they were still good.
   */
  async handleUserSignOut(): Promise<void> {
    this.forgetReaderState();
  }

  private forgetReaderState(): void {
    this.api.forgetCachedPages();
    this.home = undefined;
    // A read already in flight when the account changed would otherwise finish and store
    // itself afterwards, putting back the very page this was clearing.
    this.reader++;
  }

  // ========================= Browsing =========================

  private async filterTaxonomy(): Promise<FilterTaxonomy> {
    return this.taxonomy
      .get(async () => {
        const parsed = parseTaxonomy(await this.api.fetchBrowse({ page: 1 }));
        // An empty list is a bad response, not a site with no genres. Throwing keeps it
        // out of the cache so the next open asks again.
        if (parsed.genres.length === 0) throw new Error("ValirScans listed no genres");
        return parsed;
      })
      .catch(() => ({ genres: BUNDLED_GENRES, tags: [] }));
  }

  async getSearchForm(): Promise<SearchForm> {
    const { genres, tags } = await this.filterTaxonomy();

    const fields: SearchListItem[] = [
      // The site's own filter panel includes and excludes each facet, so each field here
      // does too. Genres and tags come off the site and are long, which takes a sheet —
      // the host no longer promotes a long list to one on its own.
      SearchExcludableMultiPickerSheet({ id: FilterID.Genres, title: "Genres", options: genres }),
      ...(tags.length > 0
        ? [SearchExcludableMultiPickerSheet({ id: FilterID.Tags, title: "Tags", options: tags })]
        : []),
      SearchExcludableMultiPicker({ id: FilterID.Types, title: "Type", options: TYPE_OPTIONS }),
      SearchExcludableMultiPicker({
        id: FilterID.Statuses,
        title: "Status",
        options: STATUS_OPTIONS,
      }),
      SearchExcludableMultiPicker({
        id: FilterID.Origins,
        title: "Origin",
        options: ORIGIN_OPTIONS,
      }),
      SearchTextField({ id: FilterID.MinChapters, title: "Chapters From", placeholder: "20" }),
      SearchTextField({ id: FilterID.MaxChapters, title: "Chapters To", placeholder: "100" }),
    ];

    return buildSearchForm({
      header: "Filters",
      footer:
        "Each list includes what you pick and excludes what you pick twice. Anything left empty falls back to the site's own defaults.",
      fields,
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
   * has closed — a fetch and a parse of a whole rendered page per row. Holding the result
   * for a few seconds collapses that to one of each, while still being short enough that a
   * deliberate refresh gets a fresh page.
   */
  private async homeSections(): Promise<HomeSections> {
    const cached = this.home;
    if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.sections;

    const reader = this.reader;
    this.homeRequest ??= this.api
      .fetchHome()
      .then((html) => {
        const sections = parseHome(html);
        if (reader === this.reader) this.home = { at: Date.now(), sections };
        return sections;
      })
      .finally(() => {
        this.homeRequest = undefined;
      });

    return this.homeRequest;
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };

    const allowed = link.context?.allowedContentRatings;
    const style = SECTION_SUBTITLES[sectionID] ?? "stats";

    if (sectionID === SectionID.NewSeries) {
      const { results } = await this.browse({ page: 1, sort: SortID.Newest }, allowed);
      return { items: results };
    }

    const home = await this.homeSections();
    const rows: Record<string, ValirSeries[]> = {
      [SectionID.Featured]: home.featured,
      [SectionID.MostPopular]: home.mostPopular,
      [SectionID.LatestComics]: home.latestUpdates,
      [SectionID.PopularToday]: home.popularToday,
      [SectionID.EditorsPicks]: home.editorsPicks,
    };

    const series = permitted(rows[sectionID] ?? [], allowed);
    return {
      // Only a ranked row numbers its tiles, and it is the site's own order that ranks
      // them — the cards arrive one per rank rather than carrying a rank of their own.
      items: series.map((entry, position) =>
        toHighlight(entry, style, sectionID === SectionID.MostPopular ? position + 1 : 0),
      ),
    };
  }

  private async browse(
    query: BrowseQuery,
    allowed: readonly ContentRating[] | undefined,
  ): Promise<PagedSearchResult> {
    const { series, hasMore } = parseBrowse(await this.api.fetchBrowse(query));
    return {
      results: permitted(series, allowed).map((entry) => toHighlight(entry, "stats")),
      // The site's own count decides where the list ends, so a page that lost a row to
      // the rating policy still runs on to the end rather than stopping short.
      isLastPage: !hasMore,
    };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const query = request.query?.trim() ?? "";
    const allowed = request.context?.allowedContentRatings;

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

    // The New Series row's "view more" opens the same listing it is cut from.
    if (request.listId === SectionID.NewSeries) {
      return this.browse({ page: pageOf(request), sort: SortID.Newest }, allowed);
    }

    const filters = new FilterReader(request);

    return this.browse(
      {
        page: pageOf(request),
        ...(query ? { search: query } : {}),
        sort: resolveSortId(SORT_OPTIONS, request, SortID.Updated),
        genres: filters.excludable(FilterID.Genres),
        tags: filters.excludable(FilterID.Tags),
        types: filters.excludable(FilterID.Types),
        statuses: filters.excludable(FilterID.Statuses),
        origins: filters.excludable(FilterID.Origins),
        ...(digits(filters.text(FilterID.MinChapters))
          ? { minChapters: digits(filters.text(FilterID.MinChapters)) }
          : {}),
        ...(digits(filters.text(FilterID.MaxChapters))
          ? { maxChapters: digits(filters.text(FilterID.MaxChapters)) }
          : {}),
      },
      allowed,
    );
  }

  // ========================= A title =========================

  async getContent(contentId: string, _context?: SourceContext): Promise<Content> {
    return parseContent(parseSeriesPage(await this.api.fetchPage(contentId)), contentId);
  }

  /**
   * The whole chapter list.
   *
   * The series page states how many pages its list runs to, so the rest are asked for at
   * once rather than walked one at a time — every offset is known up front, which is what
   * makes that safe here.
   */
  async getChapters(contentId: string): Promise<Chapter[]> {
    const [html, hideLocked] = await Promise.all([
      this.api.fetchPage(contentId),
      this.preferences.flag(PreferenceID.HideLockedChapters),
    ]);

    const first = parseSeriesPage(html);
    const stated = first.totalPages ?? 1;
    const pages = Number.isFinite(stated) ? Math.min(Math.max(stated, 1), MAX_CHAPTER_PAGES) : 1;

    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_unused, index) =>
        this.api
          .fetchPage(contentId, index + 2)
          .then(parseSeriesPage)
          // One page failing must not lose the ones that came back; the list is short by
          // that page rather than empty.
          .catch(() => undefined),
      ),
    );

    const items: ValirChapterItem[] = [first, ...rest].flatMap((page) => page?.chapters ?? []);
    return toChapters(items, contentId, hideLocked);
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    if (chapterIsLocked(chapterId)) {
      throw new Error(
        "This chapter is locked. Unlock it on the website, and sign in from the source's account screen so this app is reading as that account.",
      );
    }

    const reader = parseReader(await this.api.fetchChapter(contentId, chapterPath(chapterId)));

    if (reader.kind === "locked") {
      throw new Error(
        "ValirScans did not open this chapter for the account signed in here. It unlocks on the website.",
      );
    }
    if (reader.kind === "prose") {
      // A novel chapter is prose, and a Mana chapter is a list of images with no text form.
      throw new Error(
        "This is a novel chapter, which is text rather than images and cannot be shown here.",
      );
    }
    if (reader.pages.length === 0) {
      throw new Error(
        "ValirScans returned no pages for this chapter. It may have been taken down, or be readable only on the website.",
      );
    }

    return { pages: reader.pages.map((url) => ({ url })) };
  }

  /** The site serves its artwork from its own host, behind a referer check. */
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
    const target = value.trim();
    if (!/^https?:\/\/(?:www\.)?valirscans\.org\//i.test(target)) return undefined;

    const path = target
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/[?#].*$/, "")
      .replace(/^\/+|\/+$/g, "");

    // Only a title's own page, not a chapter or a listing.
    const match = /^series\/((?:comic|novel)\/[^/]+)$/i.exec(path);
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

/** The site's chapter-count filters take a plain count and nothing else. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export class Target extends ValirScansSource {}
