/* SPDX-License-Identifier: GPL-3.0-or-later */
import { assertRatingPolicy } from "./ContentRatingPolicy";
import {
  CatalogRating,
  Chapter,
  ChapterData,
  Content,
  ContentSource,
  DeepLinkContext,
  Form,
  CoverRequestHandler,
  HighlightsSection,
  HttpClient,
  ImageRequest,
  Option,
  PageRequestHandler,
  RequestOrigin,
  PagedSearchResult,
  PageLink,
  PageLinkResolver,
  PageSection,
  ResolvedPageSection,
  SearchExcludableMultiPickerSheet,
  SearchForm,
  SearchGroup,
  SearchListSection,
  SearchMenuPicker,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchRequest,
  SearchSortSection,
  SearchStepper,
  SearchTextField,
  SearchToggle,
  SectionStyle,
  SortOption,
  SourceContext,
  SourceContextOrigin,
  SourceInfo,
  SourcePreferenceProvider,
  UIButton,
  UIListSection,
  UIMultiPicker,
  UIPicker,
  UIToggle,
} from "@mana-app/types";
import { KaganeApi } from "./KaganeApi";
import { chapterLanguage } from "./KaganeLanguage";
import {
  Challenge,
  CHAPTER_PRESETS,
  CHART,
  DISTURBING_OPTIONS,
  Detail,
  DOMAIN,
  Filters,
  FORMATS,
  LANGUAGES,
  ManifestPage,
  MIRRORS,
  options,
  origin as siteOrigin,
  PAGE_SIZE,
  parseURL,
  Rating,
  RATINGS,
  SECTIONS,
  setMirror,
  SETTING_KEYS,
  Settings,
  SORTS,
  SOURCE_TYPES,
  STATUSES,
  strictUUID,
  trustedHost,
  UPLOADS,
  UploadSource,
  uploadTypes,
  validId,
} from "./KaganeModels";
import {
  allowed,
  available,
  chartHighlight,
  classify,
  chapters,
  content,
  editionSection,
  highlight,
  readerExpiry,
  similarSection,
  uploadAllowed,
  visibleDetailTags,
} from "./KaganeParsers";
import {
  hasHidden,
  hostRatingKey,
  includedTagGroups,
  matchesTagGroups,
  needsTagTaxonomy,
  readNumericRanges,
  selectedOptions,
  searchBody,
  selectedRatings,
  visibleRow,
} from "./KaganeSearch";
import { groupTags, tagFilterId } from "./tag-groups";

type ReaderSession = { challenge: Challenge; expiry: number };
type ReaderPageContext = {
  seriesId: string;
  chapterId: string;
  page: ManifestPage;
  settingsKey: string;
};
type SearchPage = { result: PagedSearchResult; next: number; seenIDs: string[] };

export class Target
  implements
    ContentSource,
    PageLinkResolver,
    CoverRequestHandler,
    PageRequestHandler,
    SourcePreferenceProvider
{
  readonly info: SourceInfo = {
    id: "kagane-test",
    version: "1.0.16",
    name: "KaganeTest",
    description:
      "Kagane with current API support, grouped tags and global four-category content settings.",
    thumbnail: "Kagane.png",
    rating: CatalogRating.MIXED,
    website: DOMAIN,
    // Every language the site's own picker offers: Mana only lists a source to a reader when one
    // of these is among their content languages.
    supportedLanguages: [
      "en_US",
      "ja_JP",
      "ko_KR",
      "zh-CN",
      "zh-TW",
      "es_ES",
      "es_419",
      "fr_FR",
      "de_DE",
      "it_IT",
      "pt_PT",
      "pt_BR",
      "ru_RU",
      "pl_PL",
      "tr_TR",
      "ar_SA",
      "id_ID",
      "th_TH",
      "vi_VN",
      "hi_IN",
    ],
    badges: ["Manga", "Manhwa", "Manhua", "Comic"],
    developers: [
      { name: "Lucifers Circle", github: "https://github.com/LucifersCircle" },
      { name: "PoppingMango Sources", github: "https://github.com/PoppingMangoSources" },
    ],
  };
  readonly config = { cloudflareResolutionURL: `${DOMAIN}/`, owningLinks: MIRRORS };
  private readonly api = new KaganeApi();
  private readonly coverClient = this.imageTransport(RequestOrigin.Cover);
  private readonly pageClient = this.imageTransport(RequestOrigin.Page);
  private settingsRevision = 0;
  private settingsKey = "";
  private preferenceWrite: Promise<void> = Promise.resolve();
  private readonly searchPages = new Map<
    string,
    { at: number; pages: Map<number, Promise<SearchPage>> }
  >();
  private readonly readerImages = new Map<string, ReaderPageContext>();
  private readonly readerSessions = new Map<string, ReaderSession>();

  private async settings(): Promise<Settings> {
    await this.preferenceWrite;
    const values = await Promise.all(SETTING_KEYS.map((key) => ObjectStore.get(`Kagane.${key}`)));
    const [
      contentRatings,
      showSource,
      showEdition,
      cleanTitle,
      showSpoilers,
      dataSaver,
      uploadSource,
      languages,
      excludedGenres,
      excludedTags,
      chapterTitle,
      hideDisturbing,
      mirror,
    ] = values;
    const stringArray = (value: unknown, fallback: string[]): string[] =>
      Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
    const settings: Settings = {
      contentRatings: Array.isArray(contentRatings)
        ? RATINGS.filter((rating) => contentRatings.includes(rating))
        : [...RATINGS],
      showSource: showSource === true,
      showEdition: showEdition === true,
      cleanTitle: cleanTitle === true,
      showSpoilers: showSpoilers === true,
      dataSaver: dataSaver === true,
      uploadSource: UPLOADS.some((option) => option.id === uploadSource)
        ? (uploadSource as string)
        : "all",
      languages: stringArray(languages, ["en"]),
      excludedGenres: stringArray(excludedGenres, []),
      excludedTags: stringArray(excludedTags, []),
      chapterTitle: ["optional", "always", "vol_chapter", "original"].includes(
        chapterTitle as string,
      )
        ? (chapterTitle as string)
        : "always",
      hideDisturbing: hideDisturbing === true,
      mirror: setMirror(mirror),
    };
    const key = JSON.stringify(settings);
    if (key !== this.settingsKey) {
      this.settingsKey = key;
      this.settingsRevision += 1;
      this.searchPages.clear();
      this.readerImages.clear();
      this.readerSessions.clear();
      this.api.invalidate();
    }
    return settings;
  }

  private async write(task: () => Promise<void>): Promise<void> {
    this.settingsRevision += 1;
    this.searchPages.clear();
    this.readerImages.clear();
    this.readerSessions.clear();
    this.api.invalidate();
    this.preferenceWrite = this.preferenceWrite.catch(() => undefined).then(task);
    await this.preferenceWrite;
  }

  private save(key: string, value: boolean | string | string[]): Promise<void> {
    return this.write(() => ObjectStore.set(`Kagane.${key}`, value));
  }

  private reset(keys: readonly string[]): Promise<void> {
    return this.write(async () => {
      for (const key of keys) await ObjectStore.remove(`Kagane.${key}`);
    });
  }

  private async withSettings<T>(operation: (settings: Settings) => Promise<T>): Promise<T> {
    const settings = await this.settings();
    const revision = this.settingsRevision;
    const result = await operation(settings);
    await this.settings();
    if (revision !== this.settingsRevision)
      throw new Error("Kagane settings changed during this request; refresh to continue");
    return result;
  }

  async getPreferenceMenu(): Promise<Form> {
    const settings = await this.settings();
    const [genres, tags, languages] = await Promise.all([
      this.api.genres().catch(() => []),
      this.api.tags().catch(() => []),
      this.languageOptions().catch(() => LANGUAGES),
    ]);
    return {
      sections: [
        UIListSection({
          header: "Content safety",
          footer:
            "Native Mana rating policy controls visibility when supplied. All source categories are available by default; an explicitly saved source selection remains an additional filter. Selecting none hides all titles. Unclassified rating metadata uses a Suggestive compatibility fallback with a details note. Applied locally to browsing, searches, details, chapters and reading because API filters can be ignored. Other Editions cannot be shown while hidden genres or tags are active because provider edition metadata lacks them. Site labels are not a guarantee of image content.",
          children: [
            UIMultiPicker({
              id: "contentRatings",
              title: "Content categories to show",
              options: options(RATINGS),
              value: settings.contentRatings,
              didChange: (value) => this.save("contentRatings", value),
            }),
            UIMultiPicker({
              id: "excludedGenres",
              title: "Hidden genres",
              options: genres.map((genre) => ({ id: genre.id, title: genre.genre_name })),
              value: settings.excludedGenres,
              didChange: (value) => this.save("excludedGenres", value),
            }),
            UIToggle({
              id: "hideDisturbing",
              title: "Hide disturbing content",
              value: settings.hideDisturbing,
              didChange: (value) => this.save("hideDisturbing", value),
            }),
          ],
        }),
        UIListSection({
          header: "Site",
          footer: "All mirrors serve the same library; switch if one of them is unreachable.",
          children: [
            UIPicker({
              id: "mirror",
              title: "Preferred Mirror",
              options: options(MIRRORS),
              value: settings.mirror,
              didChange: (value) => this.save("mirror", value),
            }),
          ],
        }),
        UIListSection({
          header: "Catalog",
          footer:
            "No languages selected means all languages. Upload filters and hidden tags apply globally. Kagane allows at most 50 hidden genres and 50 hidden tags, and a grouped tag can stand for several.",
          children: [
            UIPicker({
              id: "uploadSource",
              title: "Uploads",
              options: UPLOADS,
              value: settings.uploadSource,
              didChange: (value) => this.save("uploadSource", value),
            }),
            UIMultiPicker({
              id: "languages",
              title: "Languages",
              options: languages,
              value: settings.languages,
              didChange: (value) => this.save("languages", value),
            }),
          ],
        }),
        ...groupTags(tags.map((tag) => ({ id: tag.id, title: tag.tag_name }))).map(
          ({ group, options }) =>
            UIListSection({
              header: `Hidden tags: ${group.title}`,
              children: [
                UIMultiPicker({
                  id: `excludedTags:${group.id}`,
                  title: group.title,
                  options,
                  value: settings.excludedTags.filter((id) =>
                    options.some((option) => option.id === id),
                  ),
                  didChange: async (value) => {
                    const current = await this.settings();
                    await this.save("excludedTags", [
                      ...current.excludedTags.filter(
                        (id) => !options.some((option) => option.id === id),
                      ),
                      ...value,
                    ]);
                  },
                }),
              ],
            }),
        ),
        UIListSection({
          header: "Titles and reader",
          children: [
            ...(
              [
                ["showSource", "Show upload source in titles"],
                ["showEdition", "Show edition in titles"],
                ["cleanTitle", "Clean trailing title labels"],
                ["showSpoilers", "Show spoiler tags"],
                ["dataSaver", "Data saver"],
              ] as const
            ).map(([key, title]) =>
              UIToggle({
                id: key,
                title,
                value: settings[key],
                didChange: (value) => this.save(key, value),
              }),
            ),
            UIPicker({
              id: "chapterTitle",
              title: "Chapter titles",
              options: [
                { id: "always", title: "Ch.X + Title" },
                { id: "vol_chapter", title: "Vol.X Ch.Y + Title" },
                { id: "optional", title: "Title only" },
                { id: "original", title: "Original website title" },
              ],
              value: settings.chapterTitle,
              didChange: (value) => this.save("chapterTitle", value),
            }),
          ],
        }),
        UIListSection({
          footer:
            "Reset returns the content settings and hidden lists, or every setting, to their defaults.",
          children: [
            UIButton({
              id: "resetContentFilters",
              title: "Reset Content Filters",
              isDestructive: true,
              action: () =>
                this.reset(["contentRatings", "excludedGenres", "excludedTags", "hideDisturbing"]),
            }),
            UIButton({
              id: "resetAll",
              title: "Reset All Settings",
              isDestructive: true,
              action: () => this.reset(SETTING_KEYS),
            }),
          ],
        }),
      ],
    };
  }

  async getSearchForm(): Promise<SearchForm> {
    return this.withSettings(async (settings) => {
      const [genres, tags, sources, languages] = await Promise.all([
        this.api.genres(),
        this.api.tags(),
        this.api.sources(),
        this.languageOptions(),
      ]);
      const sides = [
        ["min", "From"],
        ["max", "To"],
      ] as const;
      const stepperFields = (field: string, title: string, upperBound: number, step: number) =>
        sides.map(([side, label]) =>
          SearchStepper({
            id: `${field}_${side}`,
            title: `${title} ${label}`,
            lowerBound: 0,
            upperBound,
            step,
          }),
        );
      const yearFields = (field: string, title: string) =>
        sides.map(([side, label]) =>
          SearchTextField({
            id: `${field}_${side}`,
            title: `${title} ${label}`,
            placeholder: label,
          }),
        );
      return {
        sections: [
          SearchListSection({
            header: "Filters",
            children: [
              SearchMultiPicker({
                id: "content_rating",
                title: "Content rating",
                options: options(settings.contentRatings),
              }),
              SearchMultiPicker({ id: "format", title: "Format", options: FORMATS }),
              SearchMultiPicker({
                id: "publication_status",
                title: "Publication Status",
                options: STATUSES,
              }),
              SearchMultiPickerSheet({
                id: "upload_status",
                title: "Upload Status",
                options: STATUSES,
              }),
              // Saved settings bound what a search can show, since titles outside them cannot be opened.
              ...(settings.hideDisturbing
                ? []
                : [
                    SearchMenuPicker({
                      id: "is_disturbing",
                      title: "Disturbing content",
                      subtitle: "None uses your setting: Include",
                      options: DISTURBING_OPTIONS,
                    }),
                  ]),
              SearchMultiPicker({
                id: "source_type",
                title: "Source type",
                options: SOURCE_TYPES.filter((type) =>
                  uploadTypes(settings.uploadSource).includes(type.id),
                ),
              }),
              SearchMultiPickerSheet({
                id: "source_id",
                title: "Upload sources",
                options: sources
                  .filter((source) => uploadAllowed(settings, [source], source.source_id))
                  .map((source) => ({ id: source.source_id, title: source.title })),
              }),
              SearchToggle({ id: "exact_match", title: "Exact title match" }),
              SearchExcludableMultiPickerSheet({
                id: "genres",
                title: "Genres",
                options: genres.map((genre) => ({ id: genre.id, title: genre.genre_name })),
              }),
              SearchToggle({ id: "match_all_genres", title: "Match all genres" }),
            ],
          }),
          SearchListSection({
            header: "Advanced Search",
            footer:
              "Chapter count means uploaded Kagane chapter entries, not the highest chapter number. A stepper left at 0 is not applied, and Chapters From or To replaces the chapter count choice. Leave a year blank to leave that end open.",
            children: [
              SearchGroup({
                id: "chapters",
                title: "Chapters",
                children: [
                  SearchMenuPicker({
                    id: "chapter_range",
                    title: "Chapter count",
                    options: CHAPTER_PRESETS,
                  }),
                  ...stepperFields("current_books", "Chapters", 5000, 10),
                ],
              }),
              SearchGroup({
                id: "volumes",
                title: "Volumes",
                children: stepperFields("current_volumes", "Volumes", 300, 1),
              }),
              SearchGroup({
                id: "start_year",
                title: "Year Started",
                children: yearFields("start_year", "Started"),
              }),
              SearchGroup({
                id: "end_year",
                title: "Year Ended",
                children: yearFields("end_year", "Ended"),
              }),
            ],
          }),
          SearchListSection({
            header: "Languages",
            footer: "Reading languages replace the languages in Settings for this search.",
            children: [
              SearchMultiPickerSheet({
                id: "content_lang",
                title: "Reading languages",
                options: languages,
              }),
              SearchMultiPickerSheet({
                id: "original_language",
                title: "Original language",
                options: LANGUAGES,
              }),
              SearchMultiPickerSheet({
                id: "translated_language",
                title: "Translated into",
                options: LANGUAGES,
              }),
            ],
          }),
          SearchListSection({
            header: "Authors, Artists & Groups",
            footer: "Enter one full name to find their series.",
            children: [
              SearchTextField({
                id: "staff",
                title: "Author or artist",
                placeholder: "Full author or artist name",
              }),
              SearchTextField({
                id: "groups",
                title: "Scanlation group",
                placeholder: "Full scanlation group name",
              }),
            ],
          }),
          SearchListSection({
            header: "Tags",
            footer:
              "Match All Tags is off by default. Comma-separated tag names can be prefixed with - to exclude them.",
            children: [
              SearchTextField({
                id: "tag_query",
                title: "Find tags by name",
                placeholder: "Tag, -excluded tag",
              }),
              SearchToggle({ id: "match_all_tags", title: "Match All Tags" }),
              ...groupTags(tags.map((tag) => ({ id: tag.id, title: tag.tag_name }))).map(
                ({ group, options }) =>
                  SearchExcludableMultiPickerSheet({
                    id: tagFilterId(group.id),
                    title: group.title,
                    options,
                  }),
              ),
            ],
          }),
          SearchSortSection({ header: "Sort" }),
        ],
      };
    });
  }

  // Keeps the site menu's names where facet codes overlap.
  private async languageOptions(): Promise<Option[]> {
    return (await this.api.languages()).map(
      (code) =>
        LANGUAGES.find((option) => option.id.toLowerCase() === code.toLowerCase()) ?? {
          id: code,
          title: code,
        },
    );
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORTS;
  }

  async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
    assertRatingPolicy(request.context);
    return this.withSettings(async (settings) => {
      const page = request.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
        throw new Error("Invalid Kagane page");
      const section = request.listId
        ? SECTIONS.find((entry) => entry.id === request.listId)
        : undefined;
      if (request.listId && !section) throw new Error("Unknown Kagane discovery list");
      const requestedSort =
        section?.sort ?? (request.sort == null ? "relevance" : request.sort?.id);
      if (typeof requestedSort !== "string")
        throw new Error("Unknown Kagane sort; choose another sort");
      if (/^series_name(?:,|$)/.test(requestedSort))
        throw new Error("Kagane no longer supports By Name; choose another sort");
      if (
        !section &&
        request.sort?.ascending !== undefined &&
        typeof request.sort.ascending !== "boolean"
      )
        throw new Error("Invalid Kagane sort direction; choose another sort");
      // Only known saved count IDs migrate; an explicit suffix owns direction.
      const legacyCount = /^books_count(?:,(asc|desc))?$/.exec(requestedSort);
      const sort = legacyCount ? "current_books" : requestedSort;
      const option = SORTS.find((option) => option.id === sort);
      if (!option) throw new Error("Unknown Kagane sort; choose another sort");
      // Discovery owns its descending route. Popularity and Relevance keep
      // their established semantics, without advertising native direction.
      const ascending =
        !section &&
        option.isOrderable === true &&
        (legacyCount?.[1] ? legacyCount[1] === "asc" : request.sort?.ascending === true);
      const sortParameter = sort === "relevance" ? "" : `${sort},${ascending ? "asc" : "desc"}`;
      // Validate original inputs even when discovery owns the final query body.
      readNumericRanges(request.filters);
      const ratings = selectedRatings(request, settings);
      const explicitSourceRatings = selectedOptions(request.filters, "content_rating");
      if (!ratings.length) return { results: [], isLastPage: true };
      if (section?.id === CHART)
        return page > 1
          ? { results: [], isLastPage: true }
          : this.chart(settings, ratings, request.context);
      const tags = needsTagTaxonomy(request.filters, settings.excludedTags)
        ? await this.api.tags()
        : [];
      // Validate the original tag inputs even when discovery keeps its own body.
      const filteredBody = searchBody(request, settings, tags);
      const conceptualTags = includedTagGroups(request.filters, tags);
      const body = section
        ? searchBody({ ...request, query: undefined, filters: undefined }, settings, tags)
        : filteredBody;
      if (!section) {
        for (const kind of ["staff", "groups"] as const) {
          const value = request.filters?.[kind];
          const name = typeof value === "string" ? value.trim() : "";
          if (name) body[kind] = { values: [await this.api.resolvePerson(kind, name)] };
        }
      }
      const exact = request.filters?.exact_match === true;
      // These layouts draw info rows and no cover pill.
      const detailed =
        section?.style === SectionStyle.DetailedTripleRowPaged ||
        section?.style === SectionStyle.DetailedVerticalListGrouped;
      const showUpdated = section?.id === "latest_updates";
      const key = `${JSON.stringify(settings)}:${JSON.stringify(body)}:${sortParameter}:${exact}:${section?.id ?? ""}:${JSON.stringify(conceptualTags)}:${request.filters?.match_all_tags === true}:${hostRatingKey(request.context?.allowedContentRatings)}`;
      let cached = this.searchPages.get(key);
      if (!cached || Date.now() - cached.at > 30_000) {
        if (this.searchPages.size >= 25)
          this.searchPages.delete(this.searchPages.keys().next().value as string);
        cached = { at: Date.now(), pages: new Map() };
        this.searchPages.set(key, cached);
      }
      const session = cached.pages;
      const loadPage = (logicalPage: number): Promise<SearchPage> => {
        const existing = session.get(logicalPage);
        if (existing) return existing;
        const promise = (async (): Promise<SearchPage> => {
          const previous = logicalPage > 1 ? await loadPage(logicalPage - 1) : undefined;
          if (previous?.result.isLastPage)
            return {
              result: { results: [], isLastPage: true },
              next: previous.next,
              seenIDs: previous.seenIDs,
            };
          let rawPage = previous?.next ?? 1;
          const seenIDs = new Set<string>(previous?.seenIDs ?? []);
          for (let attempt = 0; attempt < 20; attempt += 1, rawPage += 1) {
            if (rawPage > 1000)
              throw new Error("Kagane pagination exceeded its bounded page limit; refresh");
            const response = await this.api.search(body, rawPage, PAGE_SIZE, sortParameter, exact);
            const visible = response.content.filter((item) => {
              if (
                !item ||
                typeof item.series_id !== "string" ||
                typeof item.title !== "string" ||
                !item.title.trim()
              )
                throw new Error("Kagane search contains invalid titles");
              validId(item.series_id);
              if (seenIDs.has(item.series_id)) return false;
              seenIDs.add(item.series_id);
              if (seenIDs.size > 10000)
                throw new Error("Kagane pagination exceeded its bounded title limit; refresh");
              if (!classify(item) && explicitSourceRatings.length) return false;
              return (
                matchesTagGroups(
                  item.tags,
                  conceptualTags,
                  request.filters?.match_all_tags === true,
                ) &&
                allowed(item, settings, ratings, request.context?.allowedContentRatings) &&
                !!item.cover_image_id?.trim() &&
                !hasHidden(item.genres, settings.excludedGenres) &&
                !hasHidden(item.tags, settings.excludedTags) &&
                !(body.is_disturbing === false && item.is_disturbing === true)
              );
            });
            if (visible.length || response.last) {
              const sources = settings.showSource ? await this.api.sources() : [];
              return {
                result: {
                  results: visible.map((item) =>
                    highlight(item, settings, sources, detailed, showUpdated),
                  ),
                  isLastPage: response.last,
                },
                next: rawPage + 1,
                seenIDs: [...seenIDs],
              };
            }
          }
          throw new Error(
            "Kagane returned too many repeated or filtered-out pages; narrow your search",
          );
        })().catch((error: unknown) => {
          session.delete(logicalPage);
          throw error;
        });
        session.set(logicalPage, promise);
        return promise;
      };
      const result = (await loadPage(page)).result;
      // Only policy-filtered metadata is cached; origin and other native
      // context belong to the current request, including cache hits.
      return {
        ...result,
        results: result.results.map((item) => ({ ...item, context: request.context })),
      };
    });
  }

  private async chart(
    settings: Settings,
    ratings: Rating[],
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const [entries, sources] = await Promise.all([
      this.api.trending(ratings, settings.languages, settings.hideDisturbing),
      settings.showSource || settings.uploadSource !== "all"
        ? this.api.sources()
        : Promise.resolve([]),
    ]);
    const languages =
      settings.languages.length > 5 ? new Set(settings.languages.map(chapterLanguage)) : undefined;
    const results = entries.filter(
      ({ hidden_by_filter: hidden, series }) =>
        !hidden &&
        visibleRow(series, settings, ratings, sources, context) &&
        (!languages || languages.has(chapterLanguage(series.translated_language))),
    );
    return {
      results: results
        .slice(0, 5)
        .map((entry) => ({ ...chartHighlight(entry, settings, sources), context })),
      isLastPage: true,
    };
  }

  private async requireAllowed(
    id: string,
    settings: Settings,
    context?: SourceContext,
  ): Promise<Detail> {
    validId(id);
    if (!settings.contentRatings.length || context?.allowedContentRatings?.length === 0)
      throw new Error("This title is excluded by Kagane or Mana content-rating policy");
    const details = await this.api.series(id);
    if (
      !allowed(details, settings, undefined, context?.allowedContentRatings) ||
      hasHidden(
        details.genres?.map((genre) => genre.genre_id ?? ""),
        settings.excludedGenres,
      ) ||
      hasHidden(
        details.tags?.map((tag) => tag.tag_id ?? ""),
        settings.excludedTags,
      ) ||
      (settings.hideDisturbing && details.is_disturbing === true)
    )
      throw new Error(
        "This title is excluded by Kagane content settings or its rating cannot be verified",
      );
    if (
      !uploadAllowed(
        settings,
        settings.uploadSource === "all" ? [] : await this.api.sources(),
        details.source_id,
      )
    )
      throw new Error("This title is excluded by Kagane upload-source settings");
    return details;
  }

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
    assertRatingPolicy(context);
    return this.withSettings(async (settings) => {
      // A migration only needs metadata.
      const migrating = context?.origin === SourceContextOrigin.MIGRATION;
      // More like this is the slowest request on the page and needs nothing from the
      // details, so it starts alongside them instead of after the editions come back.
      const similarRows = migrating ? undefined : this.similarRows(contentId, settings, context);
      const details = await this.requireAllowed(contentId, settings, context);
      const tracker = strictUUID(details.tracker_id);
      const [sources, rows, tags] = await Promise.all([
        this.api.sources(),
        tracker && !migrating && !settings.excludedGenres.length && !settings.excludedTags.length
          ? this.api.trackerSeries(tracker)
          : Promise.resolve([]),
        visibleDetailTags(details, settings).length ? this.api.tags() : Promise.resolve([]),
      ]);
      const result = content(contentId, details, settings, sources, tags);
      const editions = similarRows
        ? (editionSection(rows, contentId, settings, context?.allowedContentRatings) ??
          this.similar(contentId, await similarRows, settings, sources, context))
        : undefined;
      return editions
        ? { ...result, additionalInfo: [...(result.additionalInfo ?? []), editions] }
        : result;
    });
  }

  // Never rejects: it can be left unawaited when the title turns out to be excluded.
  private similarRows(
    id: string,
    settings: Settings,
    context?: SourceContext,
  ): ReturnType<KaganeApi["similar"]> {
    const ratings = selectedRatings({ page: 1, context }, settings);
    if (!ratings.length) return Promise.resolve([]);
    return this.api
      .similar(id, ratings, settings.languages, settings.uploadSource, settings.hideDisturbing)
      .catch(() => []);
  }

  private similar(
    id: string,
    rows: Awaited<ReturnType<KaganeApi["similar"]>>,
    settings: Settings,
    sources: UploadSource[],
    context?: SourceContext,
  ): HighlightsSection | undefined {
    const ratings = selectedRatings({ page: 1, context }, settings);
    if (!ratings.length) return undefined;
    const seen = new Set([id]);
    return similarSection(
      rows.filter((row) => {
        if (
          seen.has(row.series_id) ||
          row.hidden_by_filter ||
          !visibleRow(row, settings, ratings, sources, context)
        )
          return false;
        seen.add(row.series_id);
        return true;
      }),
      settings,
      sources,
    );
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return this.withSettings(async (settings) => {
      const details = await this.requireAllowed(contentId, settings);
      const [books, sources] = await Promise.all([this.api.books(contentId), this.api.sources()]);
      return chapters(contentId, books, details, settings, sources);
    });
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    return this.withSettings(async (settings) => {
      validId(chapterId);
      // Asked for together: a chapter opened from history would otherwise wait on the
      // details and the whole chapter list before the reader is even asked for its pages.
      // Each is still checked before a page is returned.
      // The reader's own failure waits for the checks, so an unavailable chapter still says so.
      const reader = this.api.challenge(chapterId, settings.dataSaver).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const [, books] = await Promise.all([
        this.requireAllowed(contentId, settings),
        this.api.books(contentId),
      ]);
      const book = books.find((entry) => entry.book_id === chapterId);
      if (!book || !available(book))
        throw new Error("Kagane chapter is unavailable or does not belong to this series");
      const answer = await reader;
      if ("error" in answer) throw answer.error;
      const challenge = answer.value;
      if (
        Number.isSafeInteger(book.page_count) &&
        (book.page_count ?? 0) > 0 &&
        challenge.manifest?.pages?.length !== book.page_count
      )
        throw new Error("Kagane reader returned an incomplete chapter manifest");
      const pages = [...(challenge.manifest?.pages ?? [])]
        .sort((left, right) => left.page_no - right.page_no)
        .map((page) => ({ url: this.api.pageURL(challenge, chapterId, page, settings.dataSaver) }));
      // Retain page identity so an expired provider token can be renewed safely.
      if (this.readerImages.size > 3000) {
        this.readerImages.clear();
        this.readerSessions.clear();
      }
      this.readerSessions.set(`${contentId}:${chapterId}`, {
        challenge,
        expiry: readerExpiry(challenge.access_token),
      });
      for (const page of challenge.manifest?.pages ?? []) {
        const url = this.api.pageURL(challenge, chapterId, page, settings.dataSaver);
        this.readerImages.set(url, {
          seriesId: contentId,
          chapterId,
          page,
          settingsKey: JSON.stringify(settings),
        });
      }
      return { pages };
    });
  }

  async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    assertRatingPolicy(link.context);
    this.home(link);
    return SECTIONS.map(({ id, title, subtitle, style }) => ({ id, title, subtitle, style }));
  }

  async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
    assertRatingPolicy(link.context);
    this.home(link);
    const request = { page: 1, listId: sectionId, context: link.context };
    const result = await this.search(request);
    return { items: result.results, viewMoreLink: result.isLastPage ? undefined : { request } };
  }

  private home(link: PageLink): void {
    if (link.id !== "home") throw new Error("Unknown Kagane page");
  }

  async handleURL(value: string): Promise<DeepLinkContext | null> {
    const match = /^https?:\/\/(?:www\.)?([a-z.]+)\/series\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(
      value,
    );
    const [, host, id] = match ?? [];
    if (!host || !id || !MIRRORS.includes(host.toLowerCase())) return null;
    const result = await this.getContent(id);
    return {
      content: {
        id,
        title: result.title,
        cover: result.cover,
        contentRating: result.contentRating,
        webUrl: result.webUrl,
      },
    };
  }

  getCoverTransport(request: ImageRequest): HttpClient {
    if (request.origin !== RequestOrigin.Cover) throw new Error("Invalid Kagane image origin");
    return this.coverClient;
  }

  getPageTransport(request: ImageRequest): HttpClient {
    if (request.origin !== RequestOrigin.Page) throw new Error("Invalid Kagane image origin");
    return this.pageClient;
  }

  private imageTransport(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
    // Reuse one client per image origin. Provider token renewal belongs to
    // dispatch, not factory creation; the returned bytes need no second
    // metadata lookup or independent response-time permission ledger.
    return new HttpClient().addRequestInterceptor(async (request, context) => {
      if (context.origin !== origin) throw new Error("Invalid Kagane image origin");
      const url = await this.authorizedImageURL(request.url, origin);
      return {
        ...request,
        url,
        headers: request.headers.setAll({
          Referer: `${siteOrigin()}/`,
          Origin: siteOrigin(),
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
        }),
      };
    });
  }

  private async authorizedImageURL(
    url: string,
    origin: RequestOrigin.Cover | RequestOrigin.Page,
  ): Promise<string> {
    const target = parseURL(url);
    if (!target || !trustedHost(target.hostname)) throw new Error("Untrusted Kagane image URL");
    const path = origin === RequestOrigin.Cover ? "/api/v2/image/" : "/api/v2/books/page/";
    if (!target.pathname.startsWith(path))
      throw new Error("Invalid Kagane image URL for this origin");
    let resolvedURL = url;
    if (target.pathname.startsWith("/api/v2/books/page/")) {
      await this.withSettings(async (settings) => {
        const authorization = this.readerImages.get(url);
        if (!authorization || authorization.settingsKey !== this.settingsKey)
          throw new Error("Kagane reader settings changed; reopen the chapter");
        await this.requireAllowed(authorization.seriesId, settings);
        const key = `${authorization.seriesId}:${authorization.chapterId}`;
        let session = this.readerSessions.get(key);
        if (!session || Date.now() >= session.expiry) {
          const challenge = await this.api.challenge(authorization.chapterId, settings.dataSaver);
          session = { challenge, expiry: readerExpiry(challenge.access_token) };
          this.readerSessions.set(key, session);
        }
        const samePage = session.challenge.manifest?.pages?.find(
          (page) =>
            page.page_id === authorization.page.page_id &&
            page.page_no === authorization.page.page_no &&
            (page.ext || "jxl") === (authorization.page.ext || "jxl"),
        );
        if (!samePage) throw new Error("Kagane chapter pages changed; reopen the chapter");
        resolvedURL = this.api.pageURL(
          session.challenge,
          authorization.chapterId,
          samePage,
          settings.dataSaver,
        );
      });
    }
    return resolvedURL;
  }
}
