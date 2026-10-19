/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchExcludableMultiPickerSheet,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchStepper,
  SearchTextField,
  SearchToggle,
  SearchTagsSection,
  CloudflareError,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Form,
  type CoverRequestHandler,
  type HttpClient,
  type Highlight,
  type ImageRequest,
  type PageRequestHandler,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SortSelection,
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
  delay,
  isDetailedStyle,
  isMigration,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  withCovers,
} from "../common/index.ts";
import { ToonkotsuApi, catalogueUrl, type ChapterAnswer } from "./client.ts";
import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  EARLIEST_YEAR,
  FACETS_LIFETIME_MS,
  FilterID,
  HUMAN_CHECK_SECONDS,
  LATEST_PAGE_READS,
  LATEST_PAGE_TITLES,
  MATCH_MODE_OPTIONS,
  COUNTRY_OPTIONS,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  READER_TIMEOUT,
  SORT_OPTIONS,
  SORT_VALUES,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  TAG_GROUPS,
  TRANSIENT_RETRIES,
  TRANSIENT_WAIT_LIMIT,
  TYPE_OPTIONS,
  latestYear,
  type CatalogueParams,
  type FacetsResponse,
  type LatestResponse,
  type ReaderResult,
  type Series,
  type SeriesListResponse,
  type SeriesResponse,
} from "./model.ts";
import {
  contentIdOf,
  parseChapters,
  parseContent,
  parseContentIdFromUrl,
  parseHighlights,
  parseLatestHighlights,
  parseTagGroups,
  ratingIdOf,
} from "./parsers.ts";
import { chapterPage, imageClient, pagesIn } from "./pages.ts";
import { readChapterInPage, waitForUnlock } from "./reader.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "toonkotsu",
  name: "Toonkotsu",
  version: "1.0.34",
  description: "Manga, manhwa and manhua from toonkotsu.com.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Toonkotsu.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["toonkotsu.com"],
};

class ToonkotsuSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    CoverRequestHandler,
    PageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new ToonkotsuApi();
  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);
  private series: { id: string; expires: number; response: Promise<SeriesResponse> } | undefined;

  // Every filter form and every home row needs the tag list, and the site changes it
  // rarely, so it is kept on disk rather than fetched per screen.
  private readonly facetsCache = new TimedCache<FacetsResponse>(
    "toonkotsu.facets",
    FACETS_LIFETIME_MS,
  );
  // Recently-read cursors for the uploads feed, which repeats a title across pages.
  // Where each page of Latest Updates picks up: the site's page to read next, and the titles
  // already drawn, since one page here can read several of the site's.
  private readonly latestCursor = new Map<number, { sitePage: number; seen: string[] }>();
  private humanCheck: Promise<boolean> | undefined;
  private humanCheckPassedAt = 0;

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  private facets(): Promise<FacetsResponse> {
    // A failed read is not stored, so the next form open asks again rather than
    // remembering that the list could not be had.
    return this.facetsCache
      .get(() => this.api.json<FacetsResponse>(catalogueUrl("cdn/v1/facets", { sfw: false })))
      .catch(() => ({}) as FacetsResponse);
  }

  async getSearchForm(): Promise<SearchForm> {
    const groups = parseTagGroups(await this.facets());

    const form = buildSearchForm({
      header: "Advanced Search",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        SearchGroup({
          id: "publication",
          title: "Year",
          children: [
            SearchStepper({
              id: FilterID.YearFrom,
              title: "Year From",
              lowerBound: EARLIEST_YEAR,
              upperBound: latestYear(),
              step: 1,
            }),
            SearchStepper({
              id: FilterID.YearTo,
              title: "Year To",
              lowerBound: EARLIEST_YEAR,
              upperBound: latestYear(),
              step: 1,
            }),
          ],
        }),
        SearchGroup({
          id: "chapter_count",
          title: "Chapters",
          children: [
            SearchStepper({
              id: FilterID.ChaptersMin,
              title: "Chapters From",
              lowerBound: 0,
              upperBound: 2000,
              step: 10,
            }),
            SearchStepper({
              id: FilterID.ChaptersMax,
              title: "Chapters To",
              lowerBound: 0,
              upperBound: 2000,
              step: 10,
            }),
            SearchToggle({ id: FilterID.HasChapters, title: "Has Chapters" }),
          ],
        }),
        SearchMultiPicker({
          id: FilterID.Statuses,
          title: "Status",
          options: STATUS_OPTIONS.map(({ id, title }) => ({ id, title })),
        }),
        SearchMultiPicker({
          id: FilterID.ContentRatings,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographic",
          options: DEMOGRAPHIC_OPTIONS,
        }),
        SearchMultiPickerSheet({
          id: FilterID.Languages,
          title: "Country",
          options: COUNTRY_OPTIONS,
        }),
        SearchGroup({
          id: "tags",
          title: "Tags",
          // The site's tag lists run to hundreds, so each category opens as a sheet.
          children: groups
            .filter((group) => group.id !== FilterID.Genres)
            .map((group) =>
              SearchExcludableMultiPickerSheet({
                id: group.id,
                title: group.title,
                options: group.options,
              }),
            ),
        }),
        SearchGroup({
          id: "tag_matching",
          title: "Tag Modes",
          children: [
            SearchPicker({
              id: FilterID.IncludeMode,
              title: "Tag Inclusion Mode",
              subtitle: "Default: AND",
              options: MATCH_MODE_OPTIONS.map((option) => ({
                ...option,
                title: option.id === "all" ? "AND (Default)" : option.title,
              })),
            }),
            SearchPicker({
              id: FilterID.ExcludeMode,
              title: "Tag Exclusion Mode",
              subtitle: "Default: OR",
              options: [...MATCH_MODE_OPTIONS].reverse().map((option) => ({
                ...option,
                title: option.id === "any" ? "OR (Default)" : option.title,
              })),
            }),
          ],
        }),
        SearchTextField({ id: FilterID.Author, title: "Author", placeholder: "e.g. ONE" }),
      ],
    });
    return {
      sections: [
        SearchTagsSection({
          header: "Genre",
          field: SearchExcludableMultiPicker({
            id: FilterID.Genres,
            title: "Genre",
            options: groups.find((group) => group.id === FilterID.Genres)?.options ?? [],
          }),
        }),
        ...form.sections,
      ],
    };
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(
      this.preferences,
      buildSettingsSections(async () => {
        const groups = parseTagGroups(await this.facets());
        return groups
          .flatMap((group) => group.options)
          .sort((left, right) => left.title.localeCompare(right.title));
      }),
    );
  }

  async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    if (link.id !== "home") return [];

    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.preferences.flag(sectionPreferenceKey(section.id))),
    );
    return toPageSections(DISCOVER_SECTIONS.filter((_, index) => enabled[index]));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (!sectionById(DISCOVER_SECTIONS, sectionID)) return { items: [] };

    const { results } = await this.loadSection(sectionID, 1, link.context);
    return { items: results };
  }

  private async loadSection(
    sectionId: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    // A row that draws each tile's info rows draws no pill over its cover.
    const detailed = isDetailedStyle(sectionById(DISCOVER_SECTIONS, sectionId)?.style);
    const [ratings, params] = await Promise.all([
      this.contentRatings(context),
      this.catalogueParams(context),
    ]);
    const allowed = (series: Series) => ratings.includes(ratingIdOf(series));

    if (sectionId === SectionID.Latest) {
      // The feed lists every new release, and the site shows a title once at its newest —
      // so a later page has to know what the earlier ones already drew, and a page of one
      // title's releases is read past rather than drawn as one row.
      const cursor = page > 1 ? this.latestCursor.get(page) : undefined;
      const seen = new Set(cursor?.seen ?? []);
      let sitePage = cursor?.sitePage ?? page;
      let more = true;
      const found: Highlight[] = [];

      for (
        let reads = 0;
        reads < LATEST_PAGE_READS && more && found.length < LATEST_PAGE_TITLES;
        reads++
      ) {
        const data = await this.api.json<LatestResponse>(
          catalogueUrl("cdn/v1/latest", { ...params, page: sitePage, limit: PAGE_SIZE }),
        );
        found.push(
          ...parseLatestHighlights(
            (data.items ?? []).filter(({ series }) => allowed(series)),
            seen,
            { detailed },
          ),
        );
        more = data.hasNextPage === true;
        sitePage++;
      }
      this.latestCursor.set(page + 1, { sitePage, seen: [...seen] });

      return { results: withCovers(found), isLastPage: !more };
    }

    const data = await this.sectionData(sectionId, page, params);
    const items = (data.items ?? []).filter(allowed);
    const rankAt = (index: number) => (page - 1) * PAGE_SIZE + index + 1;

    return {
      results: withCovers(
        // A rank is the site's own position, so a title the settings hid leaves its number
        // unused rather than letting the one below it move up.
        items.flatMap((series, index) =>
          contentIdOf(series)
            ? parseHighlights([series], {
                detailed,
                ...(sectionId === SectionID.Trending ? { card: "trending" as const } : {}),
                ...(sectionId === SectionID.MostRead ? { rank: rankAt(index) } : {}),
              })
            : [],
        ),
      ),
      isLastPage: !hasNextPage(data, page),
    };
  }

  private sectionData(
    sectionId: string,
    page: number,
    params: CatalogueParams,
  ): Promise<SeriesListResponse> {
    switch (sectionId) {
      // Rankings built from this site's own readers are served by the site rather than the
      // catalogue, and the two halves of it are asked differently: a reading count with a
      // query string, a discovery ranking posted as the browse parameters.
      case SectionID.MostRead:
        return this.api.json(catalogueUrl("api/v1/rankings", { ...params, metric: "views", page }));
      case SectionID.Trending:
        return this.api.json(
          catalogueUrl("api/v1/rankings", { ...params, metric: "trending", page }),
        );
      case SectionID.HiddenGems:
        return this.api.post(`${BASE_URL}/api/v1/rankings`, {
          params: { limit: PAGE_SIZE, ...params, discovery: "gems", metric: "gems", page },
        });
      case SectionID.RecentlyAdded:
        return this.browse({ ...params, sort: "new", order: "desc", page });
      case SectionID.ThisSeason:
        return this.browse({ ...params, discovery: "seasonal", page });
      case SectionID.Completed:
        return this.browse({ ...params, discovery: "completed", page });
      default:
        return Promise.resolve({ items: [] });
    }
  }

  private browse(params: CatalogueParams): Promise<SeriesListResponse> {
    return this.api.json(catalogueUrl("cdn/v1/browse", { limit: PAGE_SIZE, ...params }));
  }

  private async contentRatings(context?: SourceContext): Promise<string[]> {
    const chosen = await this.preferences.strings(PreferenceID.ContentRatings);

    // A host policy that bars explicit content narrows the ratings for that request, and it
    // narrows what the site is asked for rather than what is thrown away afterwards.
    const allowed = context?.allowedContentRatings;
    if (allowed && !allowed.includes(ContentRating.EXPLICIT)) {
      return chosen.filter((rating) => rating === "safe" || rating === "suggestive");
    }
    return chosen.length > 0 ? chosen : ["safe"];
  }

  /**
   * What every catalogue request carries from the reader's settings.
   *
   * The types are a choice of original languages, since that is what the catalogue files a
   * series by; asking for all of them is the same as asking for none, so the parameter is
   * left off entirely then.
   */
  private async catalogueParams(context?: SourceContext): Promise<CatalogueParams> {
    const [ratings, types, hidden] = await Promise.all([
      this.contentRatings(context),
      this.preferences.strings(PreferenceID.Types),
      this.preferences.strings(PreferenceID.HiddenTags),
    ]);

    const languages =
      types.length > 0 && types.length < TYPE_OPTIONS.length
        ? TYPE_OPTIONS.filter(({ id }) => types.includes(id)).flatMap(({ languages }) => languages)
        : [];

    return {
      sfw: !ratings.includes("pornographic"),
      ...(languages.length > 0 ? { originalLanguage: languages.join(",") } : {}),
      ...(hidden.length > 0 ? { exclude: hidden.join(",") } : {}),
    };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    const word = request.query?.trim() ?? "";

    // A pasted link is the title it names rather than a phrase to look for.
    const linked = parseContentIdFromUrl(word);
    if (linked) {
      const found = await this.linkedResult(linked, request.context);
      if (found) return { results: [found], isLastPage: true };
    }

    const filters = new FilterReader(request);
    const page = pageOf(request);
    const chosenRatings = filters.options(FilterID.ContentRatings);
    const ratings =
      chosenRatings.length > 0 ? chosenRatings : await this.contentRatings(request.context);

    // Saved searches from the earlier category split still carry cast and setting IDs.
    const tags = [...TAG_GROUPS.map((group) => group.id), FilterID.Cast, FilterID.Setting].map(
      (id) => filters.excludable(id),
    );
    const included = tags.flatMap(({ included }) => included);
    const excluded = tags.flatMap(({ excluded }) => excluded);

    // Best Match ranks against the typed word, so asking for it without one would order by
    // nothing; the site's own Uploaded Date stands in.
    const asked = resolveSortId(SORT_OPTIONS, request, SortID.LastUploadedChapterAt);
    const sortId = asked === SortID.Relevance && !word ? SortID.LastUploadedChapterAt : asked;
    const { sort, order } = sortOrder(sortId, request.sort);

    const params = await this.catalogueParams(request.context);
    const statuses = filters
      .options(FilterID.Statuses)
      .map((id) => STATUS_OPTIONS.find((option) => option.id === id)?.value ?? id);
    const languages = filters.options(FilterID.Languages);

    const data = await this.browse({
      ...params,
      sfw: !ratings.includes("pornographic"),
      ...(word ? { q: word } : {}),
      ...(languages.length > 0 ? { originalLanguage: languages.join(",") } : {}),
      ...(included.length > 0 ? { genres: included.join(",") } : {}),
      ...(excluded.length > 0
        ? {
            exclude: [...new Set([...excluded, ...String(params.exclude ?? "").split(",")])]
              .filter(Boolean)
              .join(","),
          }
        : {}),
      genreMode: filters.option(FilterID.IncludeMode) || "all",
      excludeMode: filters.option(FilterID.ExcludeMode) || "any",
      ...(filters.options(FilterID.Demographics).length > 0
        ? { demographic: filters.options(FilterID.Demographics).join(",") }
        : {}),
      ...(statuses.length > 0 ? { status: statuses.join(",") } : {}),
      ...(filters.text(FilterID.Author) ? { author: filters.text(FilterID.Author) } : {}),
      ...stepped(filters, FilterID.YearFrom, "yearFrom", EARLIEST_YEAR),
      ...stepped(filters, FilterID.YearTo, "yearTo", EARLIEST_YEAR),
      ...stepped(filters, FilterID.ChaptersMin, "chaptersMin", 0),
      ...stepped(filters, FilterID.ChaptersMax, "chaptersMax", 0),
      // Spelled out: the site reads this one as the word, where its other flags are `1`.
      ...(filters.toggle(FilterID.HasChapters) ? { hasChapters: "true" } : {}),
      sort,
      order,
      page,
    });

    return {
      results: withCovers(
        parseHighlights(
          (data.items ?? []).filter((series) => ratings.includes(ratingIdOf(series))),
        ),
      ),
      isLastPage: !hasNextPage(data, page),
    };
  }

  /** A link looked up is worth one request; a link to nothing falls back to searching. */
  private async linkedResult(
    contentId: string,
    context?: SourceContext,
  ): Promise<Highlight | undefined> {
    try {
      const content = await this.getContent(contentId, context);
      return {
        id: contentId,
        title: content.title,
        cover: content.cover,
        ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
        ...(content.webUrl ? { webUrl: content.webUrl } : {}),
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
    const series = await this.loadSeries(contentId);

    // A migration reads the title's name and nothing else, so the tag list it would be
    // grouped under is not worth a second request per title.
    const facets = isMigration(context) ? {} : await this.facets();
    return parseContent(series, contentId, facets);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [series, mainOnly, showSize] = await Promise.all([
      this.loadSeries(contentId),
      this.preferences.flag(PreferenceID.DeduplicateChapters),
      this.preferences.flag(PreferenceID.ShowUploadSize),
    ]);
    return parseChapters(series, { mainOnly, showSize });
  }

  private loadSeries(contentId: string): Promise<SeriesResponse> {
    const cached = this.series;
    if (cached && cached.id === contentId && cached.expires > Date.now()) return cached.response;
    const response = this.api.json<SeriesResponse>(
      catalogueUrl(`cdn/v1/series/${encodeURIComponent(contentId)}`),
    );
    this.series = { id: contentId, expires: Date.now() + 30_000, response };
    response.catch(() => {
      if (this.series?.response === response) this.series = undefined;
    });
    return response;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const id = Number.parseInt(chapterId, 10);
    if (!Number.isFinite(id)) throw new Error(`"${chapterId}" is not a Toonkotsu chapter id`);

    const url = `${contentUrl(contentId)}/${id}`;
    let result = await this.readChapter(url, id);
    let retries = 0;
    let checked = false;

    for (;;) {
      if (result.gate === "transient") {
        if (retries++ === TRANSIENT_RETRIES) {
          throw new Error("Toonkotsu is limiting reads right now. Try again in a moment.");
        }
        const seconds = Math.min(Math.max(result.retryAfter ?? 2, 1), TRANSIENT_WAIT_LIMIT);
        await delay(seconds * 1000);
      } else if (result.gate === "wait") {
        const minutes = Math.max(1, Math.ceil((result.retryAfter ?? 600) / 60));
        throw new Error(`Toonkotsu is rate limiting this device. Try again in ${minutes} min.`);
      } else if (result.gate) {
        // Only a check that will not pass on its own is handed to the reader, as a challenge
        // on the chapter's own page, where the site runs it.
        if (checked) throw new CloudflareError(url);
        checked = true;
        if (!(await this.passHumanCheck(url))) throw new CloudflareError(url);
      } else {
        break;
      }
      result = await this.readChapter(url, id);
    }

    if (result.error) throw new Error(`Toonkotsu reader failed for chapter ${id}: ${result.error}`);

    const pages: ChapterPage[] = [];
    for (const page of pagesIn(result.body)) {
      const entry = chapterPage(page);
      if (entry) pages.push(entry);
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${id} of "${contentId}"`);
    }

    return { pages };
  }

  private async readChapter(url: string, id: number): Promise<ReaderResult> {
    // The keys are served to an unsigned request, so a document is only needed when the
    // site refuses one — and a challenge here is the API's, which the WebView may already
    // hold the clearance for.
    const asked = await this.api.chapter(id).catch((): ChapterAnswer => ({}));
    if (asked.refused) return asked.refused;
    if (asked.body !== undefined) return { body: asked.body };

    if (typeof WebViewPage === "undefined") {
      throw new Error("This version of Mana cannot open Toonkotsu chapters (no WebView support).");
    }

    const hint = await this.preferences.get(PreferenceID.ReaderLoader);

    // Both ways in — the API asked directly, and the site's own loader — are reached from any
    // document on the site's origin, and `/robots.txt` is one that brings no application
    // bundle and no ads. Only finding the loader needs the chapter's own page, which is worth
    // waiting on just when the API has refused and the loader is not where it was last seen.
    let result = await this.readIn(`${BASE_URL}/robots.txt`, id, hint);
    if (result.missingLoader) result = await this.readIn(url, id, hint);

    if (result.loader && result.loader !== hint) {
      await this.preferences.set(PreferenceID.ReaderLoader, result.loader);
    }
    return result;
  }

  /**
   * Gives the site's human check a chance to pass on its own, once for every chapter waiting.
   *
   * One pass unlocks the whole guest session, so the chapters the reader preloads alongside
   * the one opened wait on the same attempt rather than each opening a page of their own.
   */
  private passHumanCheck(url: string): Promise<boolean> {
    // A read refused just before the check passed is answered just after it; it is asked
    // again rather than given a check of its own.
    if (Date.now() - this.humanCheckPassedAt < HUMAN_CHECK_SECONDS * 1000) {
      return Promise.resolve(true);
    }
    this.humanCheck ??= this.runHumanCheck(url)
      .then((passed) => {
        if (passed) {
          this.humanCheckPassedAt = Date.now();
          this.api.resetReader();
        }
        return passed;
      })
      .finally(() => {
        this.humanCheck = undefined;
      });
    return this.humanCheck;
  }

  /** Opens the chapter in the site's own reader and gives its human check time to pass. */
  private async runHumanCheck(url: string): Promise<boolean> {
    if (typeof WebViewPage === "undefined") return false;

    const page = await WebViewPage.create({ timeout: READER_TIMEOUT });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return await page.evaluate(waitForUnlock, HUMAN_CHECK_SECONDS * 1000);
    } catch {
      return false;
    } finally {
      await page.close();
    }
  }

  private async readIn(url: string, id: number, hint: string): Promise<ReaderResult> {
    const page = await WebViewPage.create({ timeout: READER_TIMEOUT });
    try {
      await page.goto(url, { waitUntil: "load" });
      return await page.evaluate(readChapterInPage, id, hint);
    } finally {
      await page.close();
    }
  }

  getCoverTransport(_request: ImageRequest): HttpClient {
    return imageClient();
  }

  getPageTransport(_request: ImageRequest): HttpClient {
    return imageClient();
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = parseContentIdFromUrl(url);
    if (!contentId) return null;

    try {
      const content = await this.getContent(contentId);
      return {
        content: {
          id: contentId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          ...(content.webUrl ? { webUrl: content.webUrl } : {}),
        },
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return null;
    }
  }
}

/**
 * The catalogue's own name for a sort, and the direction to ask it in.
 *
 * The direction the reader chose only counts for the sort they chose it on: when an empty
 * Best Match stands in for Uploaded Date, Best Match had no direction to carry over, and
 * Uploaded Date opens the way the site opens it.
 */
function sortOrder(
  sortId: string,
  selection: SortSelection | undefined,
): { sort: string; order: "asc" | "desc" } {
  const option = SORT_OPTIONS.find((candidate) => candidate.id === sortId);
  const chosen = selection?.id === sortId ? selection.ascending : undefined;
  const ascending =
    option?.isOrderable === true && (chosen ?? option.defaultAscending ?? true) === true;
  return { sort: SORT_VALUES[sortId] ?? "latest", order: ascending ? "asc" : "desc" };
}

/** A stepper left at its bound is one the reader never set, so it asks for nothing. */
function stepped(filters: FilterReader, id: string, param: string, unset: number): CatalogueParams {
  const value = filters.number(id);
  return Number.isFinite(value) && value !== unset ? { [param]: Math.floor(value) } : {};
}

/**
 * Whether another page follows, as the site reports it.
 *
 * It answers `hasNextPage` on some endpoints and a total on others; a full page with
 * neither is taken as "probably more", since stopping early loses titles and asking once
 * too often only costs the one empty request.
 */
function hasNextPage(data: SeriesListResponse, page: number): boolean {
  if (typeof data.hasNextPage === "boolean") return data.hasNextPage;
  const items = data.items ?? [];
  if (typeof data.total === "number") return page * (data.limit ?? PAGE_SIZE) < data.total;
  return items.length >= PAGE_SIZE;
}

function contentUrl(contentId: string, slug?: string): string {
  const path = slug ? `${contentId}-${slug}` : contentId;
  return `${BASE_URL}/title/${encodeURIComponent(path)}`;
}

export class Target extends ToonkotsuSource {}
