/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchMultiPicker,
  SearchToggle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type Content,
  type ContentSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type ImageRequestHandler,
  type NetworkRequest,
  type Option,
  type Pair,
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
  type PreferenceValue,
} from "../common/index.ts";
import { KaganeApi } from "./api.ts";
import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  FilterID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionLayout,
  SortID,
  type SectionLayoutKind,
  type SectionSpecOption,
  type SeriesSummaryDto,
} from "./model.ts";
import {
  descriptorOf,
  displayTitle,
  infoRowsOf,
  latestChapterDate,
  latestChapterLabel,
  seriesUrl,
  toChapters,
  toContent,
  toHighlight,
  type TitleOptions,
} from "./parsers.ts";
import { buildSearchBody, sortParameter, type SearchBodyOptions } from "./search.ts";
import { buildSettingsSections } from "./settings.ts";

const info: SourceInfo = {
  id: "kagane",
  name: "Kagane",
  version: "1.2.1",
  description: "Manga, manhwa, manhua and comics from kagane.to.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Kagane.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["kagane.to"],
};

/** How long a series' details are reused across the calls that need them. */
const DETAIL_CACHE_MS = 60_000;

class KaganeSource
  implements
    ContentSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new KaganeApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  /** The details document shared by `getContent` and `getChapters`. */
  private detailCache: { seriesId: string; details: unknown; at: number } | undefined;

  // ── preferences ──────────────────────────────────────────────────────────

  private async strings(key: string): Promise<string[]> {
    const value = await this.preferences.get(key);
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  private async text(key: string, fallback: string): Promise<string> {
    const value = await this.preferences.get(key);
    return typeof value === "string" && value ? value : fallback;
  }

  private async flag(key: string): Promise<boolean> {
    return (await this.preferences.get(key)) === true;
  }

  /** Everything the search body needs, read in one pass. */
  private async bodyOptions(query?: string): Promise<SearchBodyOptions> {
    const [uploadSource, contentRatings, contentLanguages, excludedGenreIds, excludedTagIds] =
      await Promise.all([
        this.text(PreferenceID.UploadSource, "all"),
        this.strings(PreferenceID.ContentRating),
        this.strings(PreferenceID.ContentLanguages),
        this.strings(PreferenceID.ExcludedGenres),
        this.strings(PreferenceID.ExcludedTags),
      ]);

    return {
      ...(query ? { query } : {}),
      uploadSource,
      contentRatings,
      contentLanguages: contentLanguages.length > 0 ? contentLanguages : ["en"],
      excludedGenreIds,
      excludedTagIds,
    };
  }

  private async titleOptions(): Promise<TitleOptions> {
    const [cleanTitle, showSource, showEdition, metadata] = await Promise.all([
      this.flag(PreferenceID.CleanTitle),
      this.flag(PreferenceID.ShowSourceInTitle),
      this.flag(PreferenceID.ShowEditionInTitle),
      this.api.getMetadata().catch(() => undefined),
    ]);

    return {
      cleanTitle,
      showSource,
      showEdition,
      sources: Object.fromEntries(
        (metadata?.sources ?? []).map((source) => [source.source_id, source.title]),
      ),
    };
  }

  private async genreOptions(): Promise<Option[]> {
    const metadata = await this.api.getMetadata().catch(() => undefined);
    return toOptions(metadata?.genres);
  }

  private async tagOptions(): Promise<Option[]> {
    const metadata = await this.api.getMetadata().catch(() => undefined);
    return toOptions(metadata?.tags);
  }

  private async sourceOptions(): Promise<Option[]> {
    const metadata = await this.api.getMetadata().catch(() => undefined);
    const uploadSource = await this.text(PreferenceID.UploadSource, "all");

    return (metadata?.sources ?? [])
      .filter((source) =>
        uploadSource === "official"
          ? /^official$/i.test(source.source_type)
          : uploadSource === "scanlations"
            ? !/^official$/i.test(source.source_type)
            : true,
      )
      .map((source) => ({ id: source.source_id, title: source.title }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  // ── source intents ───────────────────────────────────────────────────────

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    const [genres, tags, sources] = await Promise.all([
      this.genreOptions(),
      this.tagOptions(),
      this.sourceOptions(),
    ]);

    return buildSearchForm({
      header: "Filters",
      footer: "Leave a filter empty to use the defaults from Settings.",
      fields: [
        SearchMultiPicker({
          id: FilterID.ContentRating,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({ id: FilterID.Format, title: "Format", options: FORMAT_OPTIONS }),
        SearchMultiPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
        ...(sources.length > 0
          ? [SearchMultiPicker({ id: FilterID.Sources, title: "Sources", options: sources })]
          : []),
        SearchToggle({
          id: FilterID.MatchAllGenres,
          title: "Match All Genres",
          subtitle: "Require every selected genre rather than any of them",
        }),
        ...(tags.length > 0
          ? [
              SearchToggle({
                id: FilterID.MatchAllTags,
                title: "Match All Tags",
                subtitle: "Require every selected tag rather than any of them",
              }),
              SearchExcludableMultiPicker({ id: FilterID.Tags, title: "Tags", options: tags }),
            ]
          : []),
      ],
      ...(genres.length > 0
        ? {
            tags: SearchExcludableMultiPicker({
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
    return buildPreferenceMenu(
      this.preferences,
      buildSettingsSections({
        genres: () => this.genreOptions(),
        tags: () => this.tagOptions(),
        resetContentFilters: async () => {
          await this.preferences.reset(PreferenceID.ExcludedGenres);
          await this.preferences.reset(PreferenceID.ExcludedTags);
          await this.preferences.reset(PreferenceID.ContentRating);
        },
        resetAll: async () => {
          for (const key of Object.keys(PREFERENCE_DEFAULTS)) {
            await this.preferences.reset(key);
          }
        },
      }),
    );
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return DISCOVER_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.subtitle === undefined ? {} : { subtitle: section.subtitle }),
      style: section.style,
      viewMoreLink: { request: { page: 1, listId: section.id } },
    }));
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = DISCOVER_SECTIONS.find((section) => section.id === sectionID);
    if (!spec) return { items: [] };

    const { results } = await this.loadSection(spec, 1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const spec = request.listId
      ? DISCOVER_SECTIONS.find((section) => section.id === request.listId)
      : undefined;
    if (spec) return this.loadSection(spec, pageOf(request));

    const filters = new FilterReader(request);
    const body = buildSearchBody(await this.bodyOptions(request.query), filters);

    const requestedSort = request.sort?.id ?? "";
    const sortId = SORT_OPTIONS.some((option) => option.id === requestedSort)
      ? requestedSort
      : SortID.Relevance;

    return this.runSearch(
      body,
      pageOf(request),
      PAGE_SIZE,
      sortParameter(sortId, request.sort?.ascending),
    );
  }

  async getContent(contentId: string): Promise<Content> {
    const [details, titleOptions, showSpoilerTags] = await Promise.all([
      this.fetchDetails(contentId),
      this.titleOptions(),
      this.flag(PreferenceID.ShowSpoilerTags),
    ]);

    const content = toContent(contentId, details, { ...titleOptions, showSpoilerTags }, (imageId) =>
      this.api.imageUrl(imageId),
    );

    // Other entries the site groups under the same tracker — different
    // editions, translations, or a colour release of the same series.
    const trackerId = details.tracker_id;
    if (!trackerId) return content;

    const related = await this.api
      .related(trackerId)
      .then((response) => response.book_series ?? [])
      .catch(() => []);

    const others = related.filter((entry) => entry.id !== contentId).slice(0, 10);
    if (others.length === 0) return content;

    return {
      ...content,
      additionalInfo: [
        ...(content.additionalInfo ?? []),
        {
          type: 2 as const,
          id: "related",
          title: "Related Editions",
          hasMore: false,
          items: others.map((entry) => ({
            type: 2 as const,
            id: entry.id,
            title: displayTitle(entry.title, titleOptions, entry.source_id),
            cover: entry.cover_image_id ? this.api.imageUrl(entry.cover_image_id) : "",
          })),
        },
      ],
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [details, chapterTitleMode, languages] = await Promise.all([
      this.fetchDetails(contentId),
      this.text(PreferenceID.ChapterTitleMode, "optional"),
      this.strings(PreferenceID.ContentLanguages),
    ]);

    return toChapters(contentId, details, {
      chapterTitleMode,
      language: languages[0] ?? DefinedLanguages.ENGLISH,
    });
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const dataSaver = await this.flag(PreferenceID.DataSaver);
    const challenge = await this.api.getChallenge(chapterId, dataSaver);

    const manifest = challenge.manifest?.pages ?? [];
    if (manifest.length === 0) throw new Error(`Kagane returned no pages for chapter ${chapterId}`);

    const cacheUrl = challenge.cache_url || BASE_URL;

    const pages: ChapterPage[] = [...manifest]
      .sort((left, right) => left.page_no - right.page_no)
      .map((page) => ({
        url: this.api.pageUrl(
          cacheUrl,
          chapterId,
          `${page.page_id}.${page.ext ?? "jxl"}`,
          challenge.access_token,
          dataSaver,
        ),
      }));

    return { pages };
  }

  /**
   * Page URLs carry an access token that may have expired between the chapter
   * being opened and an image actually being fetched, so it is re-minted here.
   */
  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    const dataSaver = await this.flag(PreferenceID.DataSaver);
    const url = imageURL.includes("token=")
      ? await this.api.refreshPageUrl(imageURL, dataSaver).catch(() => imageURL)
      : imageURL;

    return { url, headers: { referer: `${BASE_URL}/`, origin: BASE_URL } };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const seriesId = /\/series\/([^/?#]+)/i.exec(url)?.[1];
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

  // ── internals ────────────────────────────────────────────────────────────

  private async fetchDetails(seriesId: string): ReturnType<KaganeApi["series"]> {
    const cached = this.detailCache;
    if (cached && cached.seriesId === seriesId && Date.now() - cached.at < DETAIL_CACHE_MS) {
      return cached.details as Awaited<ReturnType<KaganeApi["series"]>>;
    }

    const details = await this.api.series(seriesId);
    this.detailCache = { seriesId, details, at: Date.now() };
    return details;
  }

  /**
   * A home row is the search endpoint with a sort and no title, so it costs
   * exactly one request — the same one its "view more" page uses.
   */
  private async loadSection(spec: SectionSpecOption, page: number): Promise<PagedSearchResult> {
    const body = buildSearchBody(await this.bodyOptions());

    return this.runSearch(
      body,
      page,
      spec.limit ?? PAGE_SIZE,
      sortParameter(spec.sort, false),
      spec.layout,
    );
  }

  private async runSearch(
    body: Record<string, unknown>,
    page: number,
    size: number,
    sort: string,
    layout: SectionLayoutKind = SectionLayout.Simple,
  ): Promise<PagedSearchResult> {
    const [response, titleOptions, metadata] = await Promise.all([
      this.api.search(body, page, size, sort),
      this.titleOptions(),
      this.api.getMetadata().catch(() => undefined),
    ]);

    const genreNames = metadata?.genres ?? {};

    const results: Highlight[] = (response.content ?? []).map((book) =>
      toHighlight(book, titleOptions, (imageId) => this.api.imageUrl(imageId), {
        ...this.tileExtras(book, layout, genreNames),
      }),
    );

    return { results, isLastPage: response.last !== false || results.length === 0 };
  }

  /**
   * What a tile shows beneath its title, per layout.
   *
   * Everything here comes out of the listing the row already fetched, so a
   * richer-looking row costs no extra requests.
   */
  private tileExtras(
    book: SeriesSummaryDto,
    layout: SectionLayoutKind,
    genreNames: Record<string, string>,
  ): { subtitle?: string; info?: Pair[] } {
    switch (layout) {
      case SectionLayout.Detailed: {
        const subtitle = descriptorOf(book);
        return {
          ...(subtitle ? { subtitle } : {}),
          info: infoRowsOf(book, genreNames),
        };
      }

      case SectionLayout.ChapterUpdates: {
        const chapter = latestChapterLabel(book);
        if (!chapter) {
          const subtitle = descriptorOf(book);
          return subtitle ? { subtitle } : {};
        }
        return {
          subtitle: chapter,
          info: [{ key: chapter, value: relativeTime(latestChapterDate(book)) }],
        };
      }

      case SectionLayout.Hero: {
        const subtitle = descriptorOf(book);
        return subtitle ? { subtitle } : {};
      }

      default: {
        const chapter = latestChapterLabel(book);
        return chapter ? { subtitle: chapter } : {};
      }
    }
  }
}

/** "3 hours ago", for the update column of a chapter-updates row. */
function relativeTime(date: Date | undefined): string {
  if (!date) return "";

  const elapsed = Date.now() - date.getTime();
  if (elapsed < 0) return "";
  if (elapsed < 60_000) return "just now";

  const units: [number, string][] = [
    [60_000, "minute"],
    [3_600_000, "hour"],
    [86_400_000, "day"],
    [604_800_000, "week"],
    [2_592_000_000, "month"],
    [31_536_000_000, "year"],
  ];

  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i]!;
    if (elapsed >= size) {
      const count = Math.floor(elapsed / size);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "";
}

function toOptions(map: Record<string, string> | undefined): Option[] {
  return Object.entries(map ?? {})
    .map(([id, title]) => ({ id, title }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export class Target extends KaganeSource {}
