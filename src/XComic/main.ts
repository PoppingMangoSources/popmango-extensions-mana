/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchTextField,
  SearchToggle,
  type Chapter,
  type ChapterData as ChapterPages,
  type Content,
  type ContentSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
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
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { XComicApi } from "./client.ts";
import {
  BASE_URL,
  BROWSE_QUERY,
  CHAPTERS_QUERY,
  CHAPTER_PAGES_QUERY,
  CHAPTER_PAGE_SIZE,
  COMIC_QUERY,
  CONTENT_RATING_OPTIONS,
  CHAPTER_COUNT_OPTIONS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  FilterID,
  LANGUAGE_OPTIONS,
  LATEST_UPLOADS_QUERY,
  ORIGINAL_STATUS_OPTIONS,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  RECENTLY_ADDED_QUERY,
  RECENTLY_ADDED_SIZE,
  SORT_OPTIONS,
  SectionID,
  SortID,
  TYPE_OPTIONS,
  type BrowseResponse,
  type BrowseSelect,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type ComicData,
  type ComicNodeResponse,
  type LatestUploadsResponse,
  type RecentlyAddedResponse,
} from "./model.ts";
import {
  parseChapters,
  parseContent,
  parseHighlight,
  parseLanguage,
  parsePageUrls,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";

const info: SourceInfo = {
  id: "xcomic",
  name: "XComic",
  version: "1.0.0",
  description: "Manga, manhwa, manhua and comics from xcomic.me.",
  website: BASE_URL,
  rating: CatalogRating.EXPLICIT,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "XComic.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["xcomic.me"],
};

class XComicSource
  implements ContentSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly api = new XComicApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  private genreOptions: Option[] | undefined;

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  /** The site publishes no genre list, so it is gathered from a page of browse results. */
  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;

    try {
      const data = await this.api.query<BrowseResponse>(BROWSE_QUERY, {
        select: this.browseSelect({ page: 1, size: PAGE_SIZE, sort: SortID.Score }),
      });

      const seen = new Set<string>();
      for (const comic of data.get_comic_browse_items?.data ?? []) {
        for (const genre of comic.genres ?? []) {
          const name = genre.trim();
          if (name) seen.add(name);
        }
      }

      if (seen.size > 0) {
        this.genreOptions = [...seen]
          .sort((left, right) => left.localeCompare(right))
          .map((title) => ({ id: title.toLowerCase(), title }));
        return this.genreOptions;
      }
    } catch {}

    this.genreOptions = [];
    return this.genreOptions;
  }

  async getSearchForm(): Promise<SearchForm> {
    const genres = await this.genres();

    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the defaults in Settings.",
      fields: [
        SearchMultiPicker({ id: FilterID.Types, title: "Types", options: TYPE_OPTIONS }),
        SearchMultiPicker({
          id: FilterID.ContentRatings,
          title: "Content Ratings",
          options: CONTENT_RATING_OPTIONS,
        }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographics",
          options: DEMOGRAPHIC_OPTIONS,
        }),
        SearchToggle({
          id: FilterID.MatchAllGenres,
          title: "Match All Genres",
          subtitle: "Require every selected genre rather than any of them",
        }),
        SearchGroup({
          id: "status",
          title: "Status",
          children: [
            SearchPicker({
              id: FilterID.OriginalStatus,
              title: "Original Work",
              options: ORIGINAL_STATUS_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.UploadStatus,
              title: "Uploads",
              options: ORIGINAL_STATUS_OPTIONS,
            }),
            SearchPicker({
              id: FilterID.ChapterCount,
              title: "Chapter Count",
              options: CHAPTER_COUNT_OPTIONS,
            }),
            SearchTextField({
              id: FilterID.Year,
              title: "Year",
              placeholder: "2015, or 2005-2009",
            }),
          ],
        }),
        SearchGroup({
          id: "languages",
          title: "Languages",
          children: [
            SearchMultiPickerSheet({
              id: FilterID.OriginalLanguages,
              title: "Original",
              options: LANGUAGE_OPTIONS,
            }),
            SearchMultiPickerSheet({
              id: FilterID.TranslatedLanguages,
              title: "Translated",
              options: LANGUAGE_OPTIONS,
            }),
          ],
        }),
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
      buildSettingsSections(() => this.genres()),
    );
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

  private async loadSection(
    sectionId: string,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    if (sectionId === SectionID.LatestUploads) {
      const data = await this.api.query<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
        select: { page, size: PAGE_SIZE },
      });

      const results = (data.get_comic_latestUploads?.items ?? []).flatMap((entry): Highlight[] => {
        const comic = entry.comic?.data;
        if (!comic) return [];
        return [parseHighlight(comic, entry.chapters?.[0]?.data)];
      });

      return { results, isLastPage: results.length < PAGE_SIZE };
    }

    if (sectionId === SectionID.RecentlyAdded) {
      const data = await this.api.query<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
        select: { page, size: RECENTLY_ADDED_SIZE },
      });

      const results = (data.get_comic_recentlyAdded?.items ?? []).flatMap((entry): Highlight[] =>
        entry.data ? [parseHighlight(entry.data)] : [],
      );

      return { results, isLastPage: results.length < RECENTLY_ADDED_SIZE };
    }

    const spec = sectionById(DISCOVER_SECTIONS, sectionId);
    return this.browse(
      this.browseSelect({
        page,
        size: PAGE_SIZE,
        sort: spec?.sort ?? SortID.Score,
        ...(await this.preferenceDefaults(context)),
      }),
    );
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const defaults = await this.preferenceDefaults(request.context);
    const [yearMin, yearMax] = parseYearRange(filters.text(FilterID.Year));

    const chosenTypes = filters.options(FilterID.Types);
    const chosenRatings = filters.options(FilterID.ContentRatings);
    const chosenLanguages = filters.options(FilterID.TranslatedLanguages);

    return this.browse(
      this.browseSelect({
        page: pageOf(request),
        size: PAGE_SIZE,
        sort: resolveSortId(SORT_OPTIONS, request, SortID.Score),
        word: request.query?.trim() ?? "",
        incTypes: chosenTypes.length > 0 ? chosenTypes : defaults.incTypes,
        incContentRatings: chosenRatings.length > 0 ? chosenRatings : defaults.incContentRatings,
        incTLangs: chosenLanguages.length > 0 ? chosenLanguages : defaults.incTLangs,
        incOLangs: filters.options(FilterID.OriginalLanguages),
        incDemographics: filters.options(FilterID.Demographics),
        incGenres: genres.included,
        excGenres: [...new Set([...genres.excluded, ...defaults.excGenres])],
        incGenresMode: filters.toggle(FilterID.MatchAllGenres) ? "and" : "or",
        origStatus: filters.option(FilterID.OriginalStatus) || null,
        siteStatus: filters.option(FilterID.UploadStatus) || null,
        chapCount: filters.option(FilterID.ChapterCount) || null,
        releaseYearMin: yearMin,
        releaseYearMax: yearMax,
      }),
    );
  }

  /** Settings stand in for anything the search form leaves blank. */
  private async preferenceDefaults(context?: SourceContext): Promise<{
    incTypes: string[];
    incContentRatings: string[];
    incTLangs: string[];
    excGenres: string[];
  }> {
    const [types, ratings, languages, excluded] = await Promise.all([
      this.preferences.strings(PreferenceID.ContentTypes),
      this.preferences.strings(PreferenceID.ContentRatings),
      this.preferences.strings(PreferenceID.Languages),
      this.preferences.strings(PreferenceID.ExcludedGenres),
    ]);

    // A host policy that bars explicit content narrows the ratings for that request.
    const allowed = context?.allowedContentRatings;
    const permitted =
      allowed && !allowed.includes(ContentRating.EXPLICIT)
        ? ratings.filter((rating) => rating === "safe" || rating === "suggestive")
        : ratings;

    return {
      incTypes: types,
      incContentRatings: permitted.length > 0 ? permitted : ["safe"],
      incTLangs: languages,
      excGenres: excluded,
    };
  }

  private browseSelect(overrides: Partial<BrowseSelect> & { sort: string }): BrowseSelect {
    const { sort, ...rest } = overrides;

    return {
      where: "browse",
      page: 1,
      size: PAGE_SIZE,
      init: 0,
      sortby: sort,
      word: "",
      incOLangs: [],
      incTLangs: [],
      incGenres: [],
      excGenres: [],
      incGenresMode: "or",
      excGenresMode: "or",
      incTypes: [],
      incDemographics: [],
      incContentRatings: [],
      releaseYearMin: null,
      releaseYearMax: null,
      origStatus: null,
      siteStatus: null,
      chapCount: null,
      // The site applies its own account-level filters unless told to stand aside.
      ignoreGlobalULangs: true,
      ignoreGlobalGenres: true,
      ignoreGlobalBlocks: true,
      ...rest,
    };
  }

  private async browse(select: BrowseSelect): Promise<PagedSearchResult> {
    const data = await this.api.query<BrowseResponse>(BROWSE_QUERY, { select });
    const comics = data.get_comic_browse_items?.data ?? [];

    return {
      results: comics.map((comic: ComicData) => parseHighlight(comic)),
      isLastPage: comics.length < select.size,
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const data = await this.api.query<ComicNodeResponse>(COMIC_QUERY, { id: contentId });
    const comic = data.get_comicNode?.data;
    if (!comic) throw new Error(`XComic has no title with id ${contentId}`);

    return parseContent(comic);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [comic, chapters] = await Promise.all([
      this.api.query<ComicNodeResponse>(COMIC_QUERY, { id: contentId }),
      this.api.query<ChapterListResponse>(CHAPTERS_QUERY, {
        select: {
          comicId: contentId,
          page: 1,
          size: CHAPTER_PAGE_SIZE,
          chapNumRange: [null, null],
        },
      }),
    ]);

    const language = parseLanguage(comic.get_comicNode?.data?.translatedLanguage);
    const entries = (chapters.get_comic_chapterList_uniqList?.items ?? []).map((item) => item.data);

    return parseChapters(entries, language);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterPages> {
    const data = await this.api.query<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, {
      id: chapterId,
    });

    const pages = parsePageUrls(data.get_chapterNode?.data?.imageUrls ?? []);
    if (pages.length === 0) throw new Error(`XComic returned no pages for chapter ${chapterId}`);

    return { pages: pages.map((url) => ({ url })) };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = /\/(?:comic|title|series)\/([^/?#]+)/i.exec(url)?.[1];
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
    } catch {
      return null;
    }
  }
}

/** Accepts a single year or a `2005-2009` range, as the site's own field does. */
function parseYearRange(value: string): [number | null, number | null] {
  const trimmed = value.trim();
  if (!trimmed) return [null, null];

  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(trimmed);
  if (range) return [Number(range[1]), Number(range[2])];

  const single = /^(\d{4})$/.exec(trimmed);
  return single ? [Number(single[1]), Number(single[1])] : [null, null];
}

export class Target extends XComicSource {}
