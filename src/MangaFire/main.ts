/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchStepper,
  SearchTextField,
  type Chapter,
  type ChapterData,
  type ChapterSource,
  type Content,
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
import { MangaFireApi } from "./client.ts";
import {
  BASE_URL,
  CONTENT_RATINGS,
  DEMOGRAPHIC_OPTIONS,
  DISCOVER_SECTIONS,
  FilterID,
  GENRE_MODE_OPTIONS,
  GENRE_OPTIONS,
  MAX_CHAPTER_PAGES,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SECTION_ORDERS,
  SECTION_SUBTITLES,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SectionID,
  SortID,
  THEME_OPTIONS,
  TYPE_OPTIONS,
  type ChapterItem,
  type SubtitleStyle,
} from "./model.ts";
import {
  hidFromId,
  hidFromUrl,
  parseChapters,
  parseContent,
  parseHighlights,
  parsePages,
  titleUrl,
} from "./parsers.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";
import type { QueryParam } from "./vrf.ts";

const info: SourceInfo = {
  id: "mangafire",
  name: "MangaFire",
  version: "1.0.0",
  description: "Manga, manhwa and manhua from mangafire.to.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [
    DefinedLanguages.ENGLISH,
    DefinedLanguages.SPANISH,
    DefinedLanguages.FRENCH,
    DefinedLanguages.JAPANESE,
    DefinedLanguages.PORTUGUESE,
  ],
  thumbnail: "MangaFire.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["mangafire.to"],
};

/** The site grades a title on the same four-step scale the host asks in. */
const RATING_CODES: Record<string, string> = {
  [ContentRating.SAFE]: "safe",
  [ContentRating.SUGGESTIVE]: "suggestive",
  [ContentRating.MATURE]: "erotica",
  [ContentRating.EXPLICIT]: "pornographic",
};

class MangaFireSource
  implements
    ChapterSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private readonly api = new MangaFireApi();
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Anything left empty falls back to the site's own defaults.",
      fields: [
        SearchMultiPicker({ id: FilterID.Types, title: "Type", options: TYPE_OPTIONS }),
        SearchMultiPicker({ id: FilterID.Statuses, title: "Status", options: STATUS_OPTIONS }),
        SearchMultiPicker({
          id: FilterID.Demographics,
          title: "Demographic",
          options: DEMOGRAPHIC_OPTIONS,
        }),
        // Nearly forty themes is past what a reader wants to scroll inline.
        SearchMultiPickerSheet({ id: FilterID.Themes, title: "Themes", options: THEME_OPTIONS }),
        SearchPicker({
          id: FilterID.GenreMode,
          title: "Genre & Theme Match",
          options: GENRE_MODE_OPTIONS,
        }),
        SearchTextField({ id: FilterID.Author, title: "Author or Artist", placeholder: "Name" }),
        SearchTextField({ id: FilterID.YearFrom, title: "Year From", placeholder: "1990" }),
        SearchTextField({ id: FilterID.YearTo, title: "Year To", placeholder: "2026" }),
        SearchStepper({
          id: FilterID.MinChapters,
          title: "Minimum Chapters",
          lowerBound: 0,
          upperBound: 500,
          step: 10,
        }),
      ],
      // A tags section is always inline chips, which is what the site's fifty-odd genres are.
      tags: SearchExcludableMultiPicker({
        id: FilterID.Genres,
        title: "Genres",
        options: GENRE_OPTIONS,
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
    const subtitle: SubtitleStyle = SECTION_SUBTITLES[sectionID] ?? "chapter";

    if (sectionID === SectionID.Trending) {
      // The site publishes this run whole and pages nothing, so it is shown as given.
      const response = await this.api.fetchTrending(PAGE_SIZE);
      return { results: parseHighlights(response.items, subtitle), isLastPage: true };
    }

    const response = await this.api.fetchTitles({
      page,
      order: SECTION_ORDERS[sectionID],
      params: this.ratingParams(context),
    });

    return {
      results: parseHighlights(response.items, subtitle),
      isLastPage: response.meta?.hasNext !== true,
    };
  }

  /**
   * The host's rating policy, pushed into the request rather than applied to what came back.
   *
   * The API grades every title itself, so asking for only the permitted grades gives full
   * pages. Filtering the rows here instead would leave each one short and ragged, and a
   * listing carries no genres to grade it by in the first place.
   */
  private ratingParams(context: SourceContext | undefined): QueryParam[] {
    const allowed = context?.allowedContentRatings;
    if (!allowed || allowed.length === 0) return [];

    const codes = allowed
      .map((rating) => RATING_CODES[rating])
      .filter((code): code is string => code !== undefined);

    // Every grade permitted is the same as stating no policy, and a shorter URL to sign.
    if (codes.length === 0 || codes.length === CONTENT_RATINGS.length) return [];
    return codes.map((code) => ["content_rating[]", code] as QueryParam);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request), request.context);
    }

    const query = request.query?.trim() ?? "";

    // A pasted title link is the title itself rather than words to search for.
    const linked = hidFromUrl(query);
    if (linked) {
      const details = await this.api.fetchDetails(linked).catch(() => undefined);
      const title = details?.data;
      return {
        results: title ? parseHighlights([title], "kind") : [],
        isLastPage: true,
      };
    }

    const filters = new FilterReader(request);
    const params: QueryParam[] = [...this.ratingParams(request.context)];

    const genres = filters.excludable(FilterID.Genres);
    for (const genre of genres.included) params.push(["genres_in[]", genre]);
    for (const genre of genres.excluded) params.push(["genres_ex[]", genre]);
    for (const theme of filters.options(FilterID.Themes)) params.push(["theme_ids[]", theme]);
    for (const type of filters.options(FilterID.Types)) params.push(["types[]", type]);
    for (const status of filters.options(FilterID.Statuses)) params.push(["statuses[]", status]);
    // The site files demographics among its themes, under ids of their own.
    for (const group of filters.options(FilterID.Demographics)) params.push(["theme_ids[]", group]);

    // The site matches genres and themes on one mode, so the single control sets both.
    if (filters.has(FilterID.GenreMode)) {
      const mode = filters.option(FilterID.GenreMode, "and");
      params.push(["genres_mode", mode], ["theme_mode", mode]);
    }

    for (const [id, key] of [
      [FilterID.YearFrom, "year_from"],
      [FilterID.YearTo, "year_to"],
    ] as const) {
      const year = Number.parseInt(filters.text(id) ?? "", 10);
      if (Number.isFinite(year) && year > 0) params.push([key, String(year)]);
    }

    const minChapters = filters.number(FilterID.MinChapters);
    if (Number.isFinite(minChapters) && minChapters > 0) {
      params.push(["min_chap", String(Math.floor(minChapters))]);
    }

    const author = (filters.text(FilterID.Author) ?? "").trim();
    if (author) {
      const id = await this.authorId(author);
      // A name the site does not know matches nothing, which is the honest answer — not
      // the whole catalogue with the filter quietly dropped.
      if (!id) return { results: [], isLastPage: true };
      params.push(["authors[]", id]);
    }

    const page = pageOf(request);
    const response = await this.api.fetchTitles({
      page,
      keyword: query || undefined,
      order: resolveSortId(SORT_OPTIONS, request, SortID.Relevance),
      params,
    });

    return {
      results: parseHighlights(response.items, "kind"),
      isLastPage: response.meta?.hasNext !== true,
    };
  }

  /** The site addresses a creator by id, so a typed name is looked up before it is used. */
  private async authorId(name: string): Promise<string | undefined> {
    const response = await this.api.fetchTags(name).catch(() => undefined);
    const tags = (response?.data ?? []).filter(
      (tag) => tag.type === "author" || tag.type === "artist",
    );

    const exact = tags.find((tag) => (tag.name ?? "").toLowerCase() === name.toLowerCase());
    const id = (exact ?? tags[0])?.id;
    return id == null ? undefined : String(id);
  }

  async getContent(contentId: string): Promise<Content> {
    const response = await this.api.fetchDetails(hidFromId(contentId));
    const details = response.data;
    if (!details) throw new Error(`MangaFire returned no title for ${contentId}`);
    return parseContent(details);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const hid = hidFromId(contentId);
    const [languages, officialFirst] = await Promise.all([
      this.preferences.strings(PreferenceID.Languages),
      this.preferences.flag(PreferenceID.OfficialFirst),
    ]);

    const wanted = languages.length > 0 ? languages : ["en"];
    const lists = await Promise.all(
      wanted.map((language) => this.chaptersInLanguage(hid, language, officialFirst)),
    );

    // One language is already indexed. Two are each indexed from zero, so a merged list has
    // to be indexed again — otherwise both claim index 0 and the app resumes in whichever
    // it meets first.
    if (lists.length === 1) return lists[0] ?? [];

    return lists
      .flat()
      .sort((left, right) => left.number - right.number)
      .map((chapter, index) => ({ ...chapter, index }))
      .reverse();
  }

  private async chaptersInLanguage(
    hid: string,
    language: string,
    officialFirst: boolean,
  ): Promise<Chapter[]> {
    const items: ChapterItem[] = [];

    // The first page reports how many there are, so the rest are asked for together rather
    // than one after another — a long series is otherwise a dozen round trips deep.
    const first = await this.api.fetchChapters(hid, language, 1);
    items.push(...(first.items ?? []));

    const lastPage = Math.min(first.meta?.lastPage ?? 1, MAX_CHAPTER_PAGES);
    if (lastPage > 1) {
      const rest = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, offset) =>
          this.api.fetchChapters(hid, language, offset + 2),
        ),
      );
      for (const page of rest) items.push(...(page.items ?? []));
    }

    return parseChapters(items, language, officialFirst);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const pages = parsePages(await this.api.fetchPages(chapterId));

    if (pages.length === 0) {
      throw new Error(
        "MangaFire returned no pages for this chapter. It may have been taken down, or be readable only on the website.",
      );
    }

    return { pages: pages.map((url) => ({ url })) };
  }

  /** The image CDN refuses a request that does not carry a referer from the site itself. */
  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    return {
      url: imageURL,
      headers: {
        referer: `${BASE_URL}/`,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const hid = hidFromUrl(url);
    if (!hid) return null;

    try {
      const content = await this.getContent(hid);
      return {
        content: {
          id: hid,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          webUrl: titleUrl(hid),
        },
      };
    } catch {
      return null;
    }
  }
}

export class Target extends MangaFireSource {}
