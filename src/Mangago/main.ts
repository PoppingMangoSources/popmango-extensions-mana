/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  CatalogRating,
  ContentRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchMultiPicker,
  SectionStyle,
  type BooleanState,
  type CGSize,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type Content,
  type ContentSource,
  type DeepLinkContext,
  type Form,
  type Highlight,
  type ImageRedrawHandler,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type Pair,
  type RedrawInstruction,
  type RedrawWithSizeCommand,
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
  relativeTime,
  resolveSortId,
  sectionById,
  toPageSections,
  type PreferenceValue,
} from "../common/index.ts";
import { buildMangagoClient } from "./client.ts";
import {
  CONTENT_TYPE_OPTIONS,
  DISCOVER_SECTIONS,
  DOMAIN,
  FilterID,
  GENRE_OPTIONS,
  PreferenceID,
  PREFERENCE_DEFAULTS,
  SECTION_ALIASES,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SortID,
  genreIdFromTitle,
  genreTitle,
  sortValue,
  type MangagoListing,
  type DiscoverSection,
} from "./model.ts";
import {
  absoluteUrl,
  buildGenreBrowseUrl,
  buildLatestUrl,
  buildSearchUrl,
  genresAboveRatingPolicy,
  ratingForGenres,
  FEATURED_CONTAINER,
  hasNextPage,
  parseChapters,
  parseContent,
  parseGenrePanel,
  parseLatestUpdates,
  parseListings,
  parseRelated,
} from "./parsers.ts";
import {
  buildTemplatePageUrl,
  canonicalReaderUrl,
  decodeImgsrcs,
  deriveDescramblingKeys,
  parseChapterJsUrl,
  parseCurlTemplate,
  parseDescrambleCols,
  parseImgsrcs,
  parsePcurlTemplate,
  parseTotalPages,
  parseHexEncodedVariable,
  isUsableChapterJs,
  buildNumericChapterUrls,
  parseDescrambleKey,
  resolveChapterJsUrl,
  sojsonV4Decode,
  type DescrambleKey,
  type ReaderCrypto,
} from "./reader.ts";
import { buildSettingsSections, sectionPreferenceKey } from "./settings.ts";
import { decodeHex } from "../common/aes.ts";

const info: SourceInfo = {
  id: "mangago",
  name: "Mangago",
  version: "1.0.4",
  description: "Manga, manhwa and doujinshi from mangago.me.",
  website: DOMAIN,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Mangago.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const DETAIL_CACHE_MS = 60_000;

const HOME_CACHE_MS = 60_000;

const REDRAW_GATE_TIMEOUT_MS = 3_000;

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: DOMAIN,
  owningLinks: ["mangago.me", "www.mangago.me", "mangago.zone", "youhim.me"],
};

class MangagoSource
  implements
    ContentSource,
    SearchProvider,
    PageLinkResolver,
    SourcePreferenceProvider,
    ImageRedrawHandler
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private readonly preferences = new PreferenceStore(
    info.id,
    PREFERENCE_DEFAULTS as Record<string, PreferenceValue>,
  );

  private readonly scriptCache = new Map<string, string>();
  private readonly pageCache = new Map<string, ChapterPage[]>();
  private readonly descrambleKeys = new Map<string, DescrambleKey>();
  private genreOptions: Option[] | undefined;
  private detailCache: { contentId: string; html: string; at: number } | undefined;
  private homeCache: { html: string; at: number } | undefined;
  private pendingRedraw: DescrambleKey | undefined;
  // The app calls the redraw pair concurrently per image and only the first call
  // carries the URL, so the handshake is serialised rather than held in a field.
  private redrawQueue: Promise<void> = Promise.resolve();
  private releaseRedraw: (() => void) | undefined;

  private get http(): NetworkClient {
    this.client ??= buildMangagoClient();
    return this.client;
  }

  private async fetchHtml(url: string, headers?: Record<string, string>): Promise<string> {
    const response = await this.http.get(url, headers ? { headers } : undefined);
    return response.data;
  }

  private async hiddenGenreTitles(): Promise<string[]> {
    return (await this.preferences.strings(PreferenceID.HiddenGenres)).map(genreTitle);
  }

  private async contentType(): Promise<string> {
    return this.preferences.text(PreferenceID.ContentType, "all");
  }

  private async settingsExcludedGenres(context?: SourceContext): Promise<string[]> {
    const excluded = await this.hiddenGenreTitles();
    if ((await this.contentType()) === "manga") excluded.push("Webtoons");
    excluded.push(...genresAboveRatingPolicy(context?.allowedContentRatings));
    return excluded;
  }

  private async sectionEnabled(sectionId: string): Promise<boolean> {
    return this.preferences.flag(sectionPreferenceKey(sectionId));
  }

  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;
    try {
      const titles = parseGenrePanel(await this.fetchHtml(`${DOMAIN}/genre/all/`));
      if (titles.length > 0) {
        this.genreOptions = titles.map((title) => ({ id: genreIdFromTitle(title), title }));
        return this.genreOptions;
      }
    } catch {}
    this.genreOptions = GENRE_OPTIONS;
    return this.genreOptions;
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      footer: "Filters apply to browsing. A text search is served by the site unfiltered.",
      fields: [
        SearchMultiPicker({
          id: FilterID.Statuses,
          title: "Status",
          options: STATUS_OPTIONS,
        }),
      ],
      tags: SearchExcludableMultiPicker({
        id: FilterID.Genres,
        title: "Genres",
        options: await this.genres(),
      }),
      tagsHeader: "Genres",
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
      DISCOVER_SECTIONS.map((section) => this.sectionEnabled(section.id)),
    );

    return toPageSections(DISCOVER_SECTIONS.filter((_, position) => enabled[position]));
  }

  async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const id = SECTION_ALIASES[sectionID] ?? sectionID;
    const spec = sectionById(DISCOVER_SECTIONS, id);
    const { results } = await this.loadSection(id, spec, 1, true, link.context);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const listId = request.listId ? (SECTION_ALIASES[request.listId] ?? request.listId) : undefined;
    if (listId) {
      const spec = sectionById(DISCOVER_SECTIONS, listId);
      if (spec) return this.loadSection(listId, spec, pageOf(request), false, request.context);
    }

    const page = pageOf(request);
    const query = request.query?.trim() ?? "";

    if (query) {
      const html = await this.fetchHtml(buildSearchUrl(query, page));
      return {
        results: await this.toHighlights(parseListings(html)),
        isLastPage: !hasNextPage(html),
      };
    }

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const included = genres.included.map((id) => genreTitle(id));
    const excluded = genres.excluded.map((id) => genreTitle(id));

    if ((await this.contentType()) === "webtoons" && !included.includes("Webtoons")) {
      included.push("Webtoons");
    }

    const statuses = filters.options(FilterID.Statuses);

    const html = await this.fetchHtml(
      buildGenreBrowseUrl({
        included,
        excluded: [...excluded, ...(await this.settingsExcludedGenres(request.context))],
        page,
        sort: sortValue(resolveSortId(SORT_OPTIONS, request, SortID.Views)),
        ...(statuses.length > 0 ? { statuses } : {}),
      }),
    );

    return {
      results: await this.toHighlights(parseListings(html)),
      isLastPage: !hasNextPage(html),
    };
  }

  private async fetchDetail(contentId: string): Promise<string> {
    const cached = this.detailCache;
    if (cached && cached.contentId === contentId && Date.now() - cached.at < DETAIL_CACHE_MS) {
      return cached.html;
    }

    const html = await this.fetchHtml(absoluteUrl(contentId));
    this.detailCache = { contentId, html, at: Date.now() };
    return html;
  }

  async getContent(contentId: string): Promise<Content> {
    const html = await this.fetchDetail(contentId);
    const removeTitleVersion =
      (await this.preferences.get(PreferenceID.RemoveTitleVersion)) === true;

    const content = parseContent(html, contentId, { removeTitleVersion });
    const related = parseRelated(html);

    if (related.length === 0) return content;

    return {
      ...content,
      additionalInfo: [
        ...(content.additionalInfo ?? []),
        {
          type: 2 as const,
          id: "related",
          title: "You Might Also Like",
          hasMore: false,
          items: related.slice(0, 10).map((item) => ({
            type: 2 as const,
            id: item.id,
            title: item.title,
            cover: item.cover,
          })),
        },
      ],
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const html = await this.fetchDetail(contentId);
    const hideRaws = (await this.preferences.get(PreferenceID.HideRaws)) === true;
    return parseChapters(html, { hideRaws });
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const readerUrl = canonicalReaderUrl(absoluteUrl(chapterId));

    const cached = this.pageCache.get(readerUrl);
    if (cached && cached.length > 0) return { pages: cached };

    const pages = await this.loadChapterPages(readerUrl);
    if (pages.length === 0) throw new Error(`No pages found for chapter "${chapterId}"`);

    this.pageCache.set(readerUrl, pages);
    return { pages };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const match = /\/read-manga\/([^/?#]+)/i.exec(url);
    if (!match?.[1]) return null;

    const contentId = `/read-manga/${match[1]}/`;
    try {
      const content = await this.getContent(contentId);
      return {
        content: {
          id: contentId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          webUrl: absoluteUrl(contentId),
        },
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return null;
    }
  }

  async shouldRedrawImage(url: string): Promise<BooleanState> {
    const key = this.descrambleKeys.get(stripFragment(url));
    if (!key) return { state: false };

    let release!: () => void;
    const ours = new Promise<void>((resolve) => {
      release = resolve;
      const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown })
        .setTimeout;
      timer?.(resolve, REDRAW_GATE_TIMEOUT_MS);
    });

    const ahead = this.redrawQueue;
    this.redrawQueue = ahead.then(() => ours);
    await ahead;

    this.pendingRedraw = key;
    this.releaseRedraw = release;
    return { state: true };
  }

  async redrawImageWithSize(size: CGSize): Promise<RedrawWithSizeCommand> {
    const key = this.pendingRedraw;
    this.pendingRedraw = undefined;
    this.releaseRedraw?.();
    this.releaseRedraw = undefined;

    if (!key) return { size, commands: [] };

    const cols = key.cols;
    const unitWidth = Math.floor(size.width / cols);
    const unitHeight = Math.floor(size.height / cols);
    if (unitWidth <= 0 || unitHeight <= 0) return { size, commands: [] };

    const commands: RedrawInstruction[] = [];
    for (let index = 0; index < cols * cols; index++) {
      const destinationIndex = key.order[index] ?? 0;

      const sourceRow = Math.floor(index / cols);
      const sourceColumn = index - sourceRow * cols;
      const destinationRow = Math.floor(destinationIndex / cols);
      const destinationColumn = destinationIndex - destinationRow * cols;

      commands.push({
        source: {
          origin: { x: sourceColumn * unitWidth, y: sourceRow * unitHeight },
          size: { width: unitWidth, height: unitHeight },
        },
        destination: {
          origin: { x: destinationColumn * unitWidth, y: destinationRow * unitHeight },
          size: { width: unitWidth, height: unitHeight },
        },
      });
    }

    return { size, commands };
  }

  private async fetchHome(): Promise<string> {
    const cached = this.homeCache;
    if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.html;

    const html = await this.fetchHtml(`${DOMAIN}/`);
    this.homeCache = { html, at: Date.now() };
    return html;
  }

  private sectionUrl(sectionId: string, page: number, sort: string, excluded: string[]): string {
    if (sectionId === "new_chapters") return buildLatestUrl(page);

    const included = sectionId.startsWith("top_")
      ? [genreTitle(sectionId.slice("top_".length))]
      : [];

    return buildGenreBrowseUrl({ included, excluded, page, sort });
  }

  private async loadSection(
    sectionId: string,
    spec: DiscoverSection | undefined,
    page: number,
    capped = true,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const limit = capped ? spec?.limit : undefined;

    if (sectionId === "featured_manga") {
      const featured = parseListings(await this.fetchHome(), FEATURED_CONTAINER);
      const limited = limit === undefined ? featured : featured.slice(0, limit);
      return { results: await this.toHighlights(limited), isLastPage: true };
    }

    const excluded = await this.settingsExcludedGenres(context);
    const isTop = sectionId.startsWith("top_");
    const sort = sectionId === "popular_manga" || isTop ? "comment_count" : "view";

    const html = await this.fetchHtml(this.sectionUrl(sectionId, page, sort, excluded));

    const listings =
      sectionId === "new_chapters"
        ? await this.filterNewChapters(parseLatestUpdates(html), context)
        : parseListings(html);

    const limited = limit === undefined ? listings : listings.slice(0, limit);

    const sectionRating = isTop
      ? ratingForGenres([genreTitle(sectionId.slice("top_".length))])
      : undefined;

    const results = await this.toHighlights(limited, sectionRating, spec?.style);

    return {
      results,
      isLastPage: limit !== undefined || !hasNextPage(html),
    };
  }

  private async filterNewChapters(
    items: MangagoListing[],
    context?: SourceContext,
  ): Promise<MangagoListing[]> {
    const hidden = new Set(
      (await this.settingsExcludedGenres(context)).map((g) => g.toLowerCase()),
    );
    const webtoonsOnly = (await this.contentType()) === "webtoons";
    if (hidden.size === 0 && !webtoonsOnly) return items;

    return items.filter((item) => {
      const genres = (item.genres ?? []).map((genre) => genre.trim().toLowerCase());
      if (genres.some((genre) => hidden.has(genre))) return false;
      if (webtoonsOnly && !genres.includes("webtoons")) return false;
      return true;
    });
  }

  private async toHighlights(
    items: MangagoListing[],
    fallbackRating?: ContentRating,
    style?: SectionStyle,
  ): Promise<Highlight[]> {
    const grouped =
      style === SectionStyle.DetailedVerticalListGrouped ||
      style === SectionStyle.DetailedVerticalList;

    return items.map((item) => {
      const rating = item.genres?.length
        ? ratingForGenres(item.genres)
        : (fallbackRating ?? ContentRating.SAFE);

      const info: Pair[] = [];
      if (grouped && item.subtitle) {
        info.push({ key: item.subtitle, value: relativeTime(item.publishDate) });
      }

      return {
        id: item.id,
        title: item.title,
        cover: item.cover,
        ...(item.subtitle === undefined ? {} : { subtitle: item.subtitle }),
        ...(info.length > 0 ? { info } : {}),
        contentRating: rating,
        webUrl: absoluteUrl(item.id),
      };
    });
  }

  private async resolveReaderPage(
    chapterUrl: string,
  ): Promise<{ html: string; loadedUrl: string }> {
    const canonical = canonicalReaderUrl(chapterUrl);
    const candidates = [canonical, ...buildNumericChapterUrls(canonical)].filter(
      (candidate, index, all) => all.indexOf(candidate) === index,
    );

    let cloudflare: unknown;
    for (const candidate of candidates) {
      try {
        const html = await this.fetchHtml(candidate);
        if (html.includes("imgsrcs")) return { html, loadedUrl: candidate };
      } catch (error) {
        if (error instanceof CloudflareError) cloudflare = error;
      }
    }

    if (cloudflare) throw cloudflare;
    throw new Error("No usable reader page for this chapter");
  }

  private async loadCrypto(html: string, loadedUrl: string): Promise<ReaderCrypto> {
    const src = parseChapterJsUrl(html);
    if (!src) throw new Error("Could not find chapter.js");

    const scriptUrl = resolveChapterJsUrl(src, loadedUrl);

    let script = this.scriptCache.get(scriptUrl);
    if (!script) {
      script = sojsonV4Decode(await this.fetchHtml(scriptUrl));
      if (isUsableChapterJs(script)) this.scriptCache.set(scriptUrl, script);
    }

    const keyHex = parseHexEncodedVariable(script, "key");
    const ivHex = parseHexEncodedVariable(script, "iv");
    if (!keyHex) throw new Error("Could not find the AES key");
    if (!ivHex) throw new Error("Could not find the AES IV");

    return {
      script,
      key: decodeHex(keyHex),
      iv: decodeHex(ivHex),
      cols: parseDescrambleCols(script),
    };
  }

  private async loadChapterPages(chapterUrl: string): Promise<ChapterPage[]> {
    const { html, loadedUrl } = await this.resolveReaderPage(chapterUrl);

    const blob = parseImgsrcs(html);
    if (!blob) throw new Error("Could not read the chapter's image list");

    const crypto = await this.loadCrypto(html, loadedUrl);
    const first = decodeImgsrcs(blob, crypto, true);
    const totalPages = parseTotalPages(html);

    const complete =
      first.length > 0 &&
      first.every((entry) => entry !== "") &&
      (totalPages === 0 || first.length >= totalPages);

    if (complete) return this.toPages(first, crypto);

    const template = parseCurlTemplate(html) ?? parsePcurlTemplate(html);
    if (totalPages <= 0 || !template) return this.toPages(first.filter(Boolean), crypto);

    const slots: string[] = Array.from({ length: totalPages }, () => "");
    const fill = (images: string[]): void => {
      for (let i = 0; i < images.length && i < totalPages; i++) {
        const url = images[i]?.trim();
        if (url && !slots[i]) slots[i] = url;
      }
    };
    fill(first);

    const windowSize = Math.max(1, first.filter(Boolean).length);
    for (let page = 1; page <= totalPages; page += windowSize) {
      if (slots[page - 1]) continue;
      try {
        const pageHtml = await this.fetchHtml(buildTemplatePageUrl(template, loadedUrl, page));
        const pageBlob = parseImgsrcs(pageHtml);
        if (pageBlob) fill(decodeImgsrcs(pageBlob, crypto, true));
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
      }
    }

    for (let page = 1; page <= totalPages; page++) {
      if (slots[page - 1]) continue;
      try {
        const pageHtml = await this.fetchHtml(buildTemplatePageUrl(template, loadedUrl, page));
        const pageBlob = parseImgsrcs(pageHtml);
        if (pageBlob) fill(decodeImgsrcs(pageBlob, crypto, true));
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
      }
    }

    return this.toPages(slots.filter(Boolean), crypto);
  }

  private async toPages(images: string[], crypto: ReaderCrypto): Promise<ChapterPage[]> {
    const resolved = images.map((image) => absoluteUrl(image));
    const scrambled = resolved.filter((url) => url.includes("cspiclink"));

    if (scrambled.length > 0 && crypto.cols > 0) {
      try {
        const keys = await deriveDescramblingKeys(crypto.script, scrambled);
        for (const [url, raw] of keys) {
          const key = parseDescrambleKey(raw, crypto.cols);
          if (key) this.descrambleKeys.set(stripFragment(url), key);
        }
      } catch {}
    }

    return resolved.map((url) => ({ url }));
  }
}

function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash >= 0 ? url.slice(0, hash) : url;
}

export { CONTENT_TYPE_OPTIONS };

export class Target extends MangagoSource {}
