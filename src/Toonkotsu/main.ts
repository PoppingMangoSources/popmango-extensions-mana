/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPickerSheet,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchStepper,
  SearchTextField,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type ImageRequestHandler,
  type NetworkRequest,
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
  bytesToBase64,
  clean,
  isDetailedStyle,
  isMigration,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  withCovers,
  type PreferenceValue,
} from "../common/index.ts";
import { ToonkotsuApi, catalogueUrl } from "./client.ts";
import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  EARLIEST_YEAR,
  FACETS_LIFETIME_MS,
  FilterID,
  MATCH_MODE_OPTIONS,
  ORIGINAL_LANGUAGE_OPTIONS,
  PAGE_DOWNLOAD_CONCURRENCY,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  READER_BUILD,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  TAG_GROUPS,
  TYPE_OPTIONS,
  chapterUrl,
  latestYear,
  type CatalogueParams,
  type ChapterPagesResponse,
  type FacetsResponse,
  type LatestResponse,
  type ReaderLimit,
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
  type TagGroup,
} from "./parsers.ts";
import {
  decryptPage,
  deriveSession,
  pageCipher,
  parseReaderKey,
  signPath,
  type ReaderSession,
} from "./reader.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "toonkotsu",
  name: "Toonkotsu",
  version: "1.0.5",
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
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new ToonkotsuApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  // Every filter form and every home row needs the tag list, and the site changes it
  // rarely, so it is kept on disk rather than fetched per screen.
  private readonly facetsCache = new TimedCache<FacetsResponse>(
    "toonkotsu.facets",
    FACETS_LIFETIME_MS,
  );
  // Recently-read cursors for the uploads feed, which repeats a title across pages.
  private readonly seenByPage = new Map<number, string[]>();
  private session: Promise<ReaderSession> | undefined;
  private readonly chapterLoads = new Map<string, Promise<ChapterData>>();
  private build = READER_BUILD;

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

  private async tagGroups(): Promise<TagGroup[]> {
    const [facets, ratings] = await Promise.all([this.facets(), this.contentRatings()]);
    return parseTagGroups(facets, ratings);
  }

  async getSearchForm(): Promise<SearchForm> {
    const groups = await this.tagGroups();

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        // The tag lists are the site's own and run to hundreds, so each opens as a sheet
        // rather than wrapping across the form.
        ...groups.map((group) =>
          SearchExcludableMultiPickerSheet({
            id: group.id,
            title: group.title,
            options: group.options,
          }),
        ),
        SearchGroup({
          id: "tag_matching",
          title: "Tag Matching",
          children: [
            SearchPicker({
              id: FilterID.IncludeMode,
              title: "Included Tags Must Match",
              options: MATCH_MODE_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.ExcludeMode,
              title: "Excluded Tags Must Match",
              options: MATCH_MODE_OPTIONS,
            }),
          ],
        }),
        SearchGroup({
          id: "series",
          title: "Series",
          children: [
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
            SearchMultiPicker({
              id: FilterID.Statuses,
              title: "Publication Status",
              options: STATUS_OPTIONS.map(({ id, title }) => ({ id, title })),
            }),
            SearchMultiPickerSheet({
              id: FilterID.Languages,
              title: "Original Language",
              options: ORIGINAL_LANGUAGE_OPTIONS,
            }),
          ],
        }),
        // Numbers are stepped rather than typed: there is nothing to mistype, nothing to
        // validate, and a reader who never touches one leaves it at its bound, which is
        // read as "not asked for" rather than sent as a filter nobody set.
        SearchGroup({
          id: "publication",
          title: "Publication Year",
          children: [
            SearchStepper({
              id: FilterID.YearFrom,
              title: "From",
              lowerBound: EARLIEST_YEAR,
              upperBound: latestYear(),
              step: 1,
            }),
            SearchStepper({
              id: FilterID.YearTo,
              title: "To",
              lowerBound: EARLIEST_YEAR,
              upperBound: latestYear(),
              step: 1,
            }),
          ],
        }),
        SearchGroup({
          id: "chapter_count",
          title: "Chapter Count",
          children: [
            SearchStepper({
              id: FilterID.ChaptersMin,
              title: "Minimum",
              lowerBound: 0,
              upperBound: 2000,
              step: 10,
            }),
            SearchStepper({
              id: FilterID.ChaptersMax,
              title: "Maximum",
              lowerBound: 0,
              upperBound: 2000,
              step: 10,
            }),
          ],
        }),
        SearchGroup({
          id: "credits",
          title: "Credits",
          children: [
            SearchTextField({ id: FilterID.Author, title: "Author", placeholder: "e.g. ONE" }),
          ],
        }),
      ],
    });
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(
      this.preferences,
      buildSettingsSections(async () => {
        const groups = parseTagGroups(await this.facets(), ["pornographic"]);
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
      const data = await this.api.json<LatestResponse>(
        catalogueUrl("cdn/v1/latest", { ...params, page, limit: PAGE_SIZE }),
      );

      // The feed lists every new release, and the site shows a title once at its newest —
      // so a later page has to know what the earlier ones already drew.
      const seen = new Set(page > 1 ? (this.seenByPage.get(page) ?? []) : []);
      const results = withCovers(
        parseLatestHighlights(
          (data.items ?? []).filter(({ series }) => allowed(series)),
          seen,
          {
            detailed,
          },
        ),
      );
      this.seenByPage.set(page + 1, [...seen]);

      return { results, isLastPage: data.hasNextPage !== true || results.length === 0 };
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
      case SectionID.TopRated:
        return this.browse({ ...params, sort: "score", order: "desc", page });
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

    const tags = TAG_GROUPS.map((group) => filters.excludable(group.id));
    const included = tags.flatMap(({ included }) => included);
    const excluded = tags.flatMap(({ excluded }) => excluded);

    // Best Match ranks against the typed word, so asking for it without one would order by
    // nothing; the site's own newest-first stands in.
    const asked = resolveSortId(SORT_OPTIONS, request, SortID.LatestDesc);
    const sortId = asked === SortID.Relevance && !word ? SortID.LatestDesc : asked;
    const [sort = "latest", order = "desc"] = sortId.split("-");

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
    const series = await this.series(contentId);

    // A migration reads the title's name and nothing else, so the tag list it would be
    // grouped under is not worth a second request per title.
    const facets = isMigration(context) ? {} : await this.facets();
    return parseContent(series, contentId, facets);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return parseChapters(await this.series(contentId));
  }

  private series(contentId: string): Promise<SeriesResponse> {
    return this.api.json<SeriesResponse>(catalogueUrl(`cdn/v1/series/${contentId}`));
  }

  /**
   * The reader session, which every chapter read is signed with.
   *
   * One session covers the whole reading run, so it is held until a read is refused for its
   * signature; a failure clears it so the next read asks for a new one rather than retrying
   * with a key the site has stopped accepting.
   */
  private readerSession(): Promise<ReaderSession> {
    return (this.session ??= this.openSession().catch((error: unknown) => {
      this.session = undefined;
      throw error;
    }));
  }

  private async openSession(): Promise<ReaderSession> {
    const { status, body } = await this.api.get(`${BASE_URL}/api/manga/key`);
    if (status < 200 || status >= 300) {
      throw readerError(status, body as ReaderLimit | undefined, "");
    }

    const response = parseReaderKey(body);
    this.build = response.build;
    return deriveSession(response);
  }

  getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const running = this.chapterLoads.get(chapterId);
    if (running) return running;

    // A repeated open shares only work in flight, never a chapter's full image data
    // after it finishes. Keeping that data cached would retain megabytes per chapter.
    const request = this.loadChapter(chapterId).finally(() => {
      if (this.chapterLoads.get(chapterId) === request) this.chapterLoads.delete(chapterId);
    });
    this.chapterLoads.set(chapterId, request);
    return request;
  }

  private async loadChapter(chapterId: string): Promise<ChapterData> {
    const path = `/api/manga/chapter/${chapterId}`;

    // Two attempts: the first may be carrying a session the site has just expired, and a
    // fresh one is all that usually takes. A second refusal is the secret itself.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.readerSession();
      const { status, body } = await this.api.get(`${BASE_URL}${path}`, {
        "x-sig": signPath(session, path),
      });

      if (status >= 200 && status < 300) {
        return { pages: await this.chapterPages(body as ChapterPagesResponse, session) };
      }

      const limit = status === 429 ? (body as ReaderLimit | undefined) : undefined;
      const rejectedSignature = status === 401 || status === 403 || limit?.resign === true;
      if (attempt === 0 && rejectedSignature) {
        this.session = undefined;
        continue;
      }

      throw readerError(status, limit, chapterId, session.build !== this.build);
    }

    throw new Error(`Toonkotsu would not serve chapter ${chapterId}`);
  }

  /**
   * The pages of a chapter, decrypted where the site encrypted them.
   *
   * An unencrypted page is handed over as a URL for the app to fetch itself. An encrypted
   * one has to come through here — the bytes are AES-CTR ciphertext, and nothing downstream
   * has the key — so it is fetched, decrypted and passed on as the image itself. Workers
   * refill each free slot instead of waiting for the slowest image in a batch. The app
   * still needs the complete result before opening the chapter.
   */
  private async chapterPages(
    body: ChapterPagesResponse,
    session: ReaderSession,
  ): Promise<ChapterPage[]> {
    const wrap = body?.wrap;
    if (wrap != null && wrap !== "" && wrap !== "v1") {
      throw new Error("Toonkotsu's reader encryption has changed. The source needs an update.");
    }

    const listed = body?.chapter?.pages ?? [];
    if (!Array.isArray(listed) || listed.length === 0) {
      throw new Error("Toonkotsu listed no pages for this chapter");
    }

    // Validate the whole list before spending bandwidth on any images.
    const prepared = listed.map((page, index) => {
      const src = typeof page?.src === "string" ? clean(page.src) : "";
      if (!src) throw new Error(`Toonkotsu page ${index + 1} has no image`);

      const url = /^https?:\/\//i.test(src)
        ? src
        : `${BASE_URL}${src.startsWith("/") ? "" : "/"}${src}`;
      return { url, cipher: pageCipher(page, wrap, session) };
    });

    if (
      prepared.some(({ cipher }) => cipher) &&
      (await this.preferences.flag(PreferenceID.AcceleratedReader))
    ) {
      const accelerated = await this.api.browserPages(
        prepared.map(({ url, cipher }) => ({
          url,
          ...(cipher
            ? { key: bytesToBase64(cipher.key), counter: bytesToBase64(cipher.counter) }
            : {}),
        })),
      );
      if (accelerated) return accelerated;
    }

    const pages: ChapterPage[] = [];
    let cursor = 0;
    let failure: { error: unknown } | undefined;
    const worker = async (): Promise<void> => {
      while (cursor < prepared.length && !failure) {
        const index = cursor++;
        const { url, cipher } = prepared[index]!;
        try {
          pages[index] = cipher ? { raw: decryptPage(await this.api.image(url), cipher) } : { url };
        } catch (error) {
          failure ??= { error };
        }
      }
    };

    // Drain requests already started on failure, so a retry cannot overlap this load.
    await Promise.all(
      Array.from({ length: Math.min(PAGE_DOWNLOAD_CONCURRENCY, prepared.length) }, worker),
    );
    if (failure) throw failure.error;

    return pages;
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    return {
      url: imageURL,
      headers: {
        referer: `${BASE_URL}/`,
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      },
    };
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

/**
 * What a refused read means.
 *
 * Guests are asked to confirm they are human before reading on, and that check runs in the
 * site's own reader — so the chapter page is what the app opens, and the session it unlocks
 * covers the rest of the read. A limit the site says is temporary is just a wait.
 */
function readerError(
  status: number,
  limit: ReaderLimit | undefined,
  chapterId: string,
  readerChanged = false,
): Error {
  if (limit?.code === "manga-limit" && (limit.transient || limit.reason === "wait")) {
    const seconds = limit.retryAfterSec || (limit.reason === "wait" ? 600 : 10);
    return new Error(`Toonkotsu is limiting reads right now. Try again in ${seconds} seconds.`);
  }
  if (limit?.code === "manga-limit") {
    return new CloudflareError(chapterId ? chapterUrl(chapterId) : `${BASE_URL}/`);
  }

  const reason = readerChanged
    ? " The site's reader has been updated, so this source needs one too."
    : "";
  return new Error(
    `Toonkotsu would not serve this chapter (HTTP ${status}${limit?.error ? `: ${limit.error}` : ""}).${reason}`,
  );
}

export class Target extends ToonkotsuSource {}
