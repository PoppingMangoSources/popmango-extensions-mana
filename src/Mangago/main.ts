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
  type PreferenceValue,
} from "../common/index.ts";
import { buildMangagoClient } from "./client.ts";
import {
  CONTENT_TYPE_OPTIONS,
  DISCOVER_SECTIONS,
  DOMAIN,
  FEATURED_HERO_LIMIT,
  FilterID,
  GENRE_OPTIONS,
  MANHWA_TOP_SECTION_IDS,
  PreferenceID,
  PREFERENCE_DEFAULTS,
  SECTION_ALIASES,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SortID,
  genreIdFromTitle,
  getGenreTitle,
  sortValueFor,
  type MangagoListing,
  type SectionSpecOption,
} from "./model.ts";
import {
  absoluteUrl,
  buildGenreBrowseUrl,
  buildLatestUrl,
  buildSearchUrl,
  contentRatingForGenres,
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
  extractChapterJsUrl,
  extractCurlTemplate,
  extractDescrambleCols,
  extractImgsrcs,
  extractPcurlTemplate,
  extractTotalPages,
  findHexEncodedVariable,
  isUsableChapterJs,
  numericChapterCandidates,
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
  version: "1.1.1",
  description: "Manga, manhwa and doujinshi from mangago.me.",
  website: DOMAIN,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

/** How long the details page is reused across `getContent` and `getChapters`. */
const DETAIL_CACHE_MS = 60_000;

/** Ceiling on how long one image may hold the redraw gate. */
const REDRAW_GATE_TIMEOUT_MS = 10_000;

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

  /** Deobfuscated chapter.js, keyed by its versioned URL. */
  private readonly scriptCache = new Map<string, string>();
  /** Decoded page lists, keyed by the reader URL that produced them. */
  private readonly pageCache = new Map<string, ChapterPage[]>();
  /** Tile permutations for the images of chapters opened this session. */
  private readonly descrambleKeys = new Map<string, DescrambleKey>();
  /** Genres advertised by the site, fetched once per session. */
  private genreOptions: Option[] | undefined;
  /** The details page shared by `getContent` and `getChapters`. */
  private detailCache: { contentId: string; html: string; at: number } | undefined;
  /** The image the app most recently asked about, for the redraw handler. */
  private pendingRedraw: DescrambleKey | undefined;
  /** Serialises the redraw handshake, so pairs cannot interleave. */
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

  // ── preferences ──────────────────────────────────────────────────────────

  private async hiddenGenreTitles(): Promise<string[]> {
    const ids = await this.preferences.get(PreferenceID.HiddenGenres);
    return Array.isArray(ids) ? ids.map((id) => getGenreTitle(String(id))) : [];
  }

  private async contentType(): Promise<string> {
    const value = await this.preferences.get(PreferenceID.ContentType);
    return typeof value === "string" ? value : "all";
  }

  /** Genres excluded by settings; "Manga only" also hides Webtoons. */
  private async settingsExcludedGenres(): Promise<string[]> {
    const excluded = await this.hiddenGenreTitles();
    if ((await this.contentType()) === "manga") excluded.push("Webtoons");
    return excluded;
  }

  private async sectionEnabled(sectionId: string): Promise<boolean> {
    return (await this.preferences.get(sectionPreferenceKey(sectionId))) === true;
  }

  /**
   * The genre list the site currently advertises, falling back to the built-in
   * one so the search form and settings still render when the fetch fails.
   */
  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;
    try {
      const titles = parseGenrePanel(await this.fetchHtml(`${DOMAIN}/genre/all/`));
      if (titles.length > 0) {
        this.genreOptions = titles.map((title) => ({ id: genreIdFromTitle(title), title }));
        return this.genreOptions;
      }
    } catch {
      // Fall through to the built-in list.
    }
    this.genreOptions = GENRE_OPTIONS;
    return this.genreOptions;
  }

  // ── source intents ───────────────────────────────────────────────────────

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
    // Read every switch at once — this runs before the home page can render
    // anything, so fourteen sequential store reads are fourteen stalls.
    const enabled = await Promise.all(
      DISCOVER_SECTIONS.map((section) => this.sectionEnabled(section.id)),
    );

    return DISCOVER_SECTIONS.filter((_, position) => enabled[position]).map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.subtitle === undefined ? {} : { subtitle: section.subtitle }),
      style: section.style,
      // A capped "Top N" row has nothing more to show.
      ...(section.limit === undefined
        ? { viewMoreLink: { request: { page: 1, listId: section.id } } }
        : {}),
    }));
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const id = SECTION_ALIASES[sectionID] ?? sectionID;
    const spec = DISCOVER_SECTIONS.find((section) => section.id === id);
    const { results } = await this.loadSection(id, spec, 1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const listId = request.listId ? (SECTION_ALIASES[request.listId] ?? request.listId) : undefined;
    if (listId) {
      const spec = DISCOVER_SECTIONS.find((section) => section.id === listId);
      if (spec) return this.loadSection(listId, spec, pageOf(request));
    }

    const page = pageOf(request);
    const query = request.query?.trim() ?? "";

    // The site cannot combine free text with the genre filter, so a text
    // search takes the search endpoint and everything else browses /genre/.
    if (query) {
      const html = await this.fetchHtml(buildSearchUrl(query, page));
      return {
        results: await this.toHighlights(parseListings(html)),
        isLastPage: !hasNextPage(html),
      };
    }

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const included = genres.included.map((id) => getGenreTitle(id));
    const excluded = genres.excluded.map((id) => getGenreTitle(id));

    if ((await this.contentType()) === "webtoons" && !included.includes("Webtoons")) {
      included.push("Webtoons");
    }

    const statuses = filters.options(FilterID.Statuses);

    const html = await this.fetchHtml(
      buildGenreBrowseUrl({
        included,
        excluded: [...excluded, ...(await this.settingsExcludedGenres())],
        page,
        sort: sortValueFor(resolveSortId(SORT_OPTIONS, request, SortID.Views)),
        ...(statuses.length > 0 ? { statuses } : {}),
      }),
    );

    return {
      results: await this.toHighlights(parseListings(html)),
      isLastPage: !hasNextPage(html),
    };
  }

  /**
   * The details page and the chapter list are the same document, and the app
   * asks for them one after the other. Holding the last one briefly turns
   * opening a title from two identical requests into one.
   */
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
    } catch {
      return null;
    }
  }

  // ── image descrambling ───────────────────────────────────────────────────

  /**
   * The site serves tiled images whose pieces are shuffled by a per-image key,
   * worked out when the chapter was opened. This is a lookup; the app does the
   * pixel work itself through {@link redrawImageWithSize}.
   *
   * That second call carries the image's size but not its URL, so the key has
   * to be handed over through a field. A reader decoding several pages at once
   * would then have each image redrawn with another image's key — which looks
   * exactly like a failed descramble — so the pair is serialised here.
   */
  async shouldRedrawImage(url: string): Promise<BooleanState> {
    const key = this.descrambleKeys.get(stripFragment(url));
    if (!key) return { state: false };

    // Take a ticket, then wait for the holder ahead of us. The queue tail is
    // reassigned before the first await, so callers that arrive while we are
    // suspended line up behind us instead of all waking on the same promise.
    let release!: () => void;
    const ours = new Promise<void>((resolve) => {
      release = resolve;
      // A "yes" the app never follows up on must not stall every later image.
      // Timers are not guaranteed in this runtime, hence the lookup.
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

  // ── discover ─────────────────────────────────────────────────────────────

  private sectionUrl(sectionId: string, page: number, sort: string, excluded: string[]): string {
    if (sectionId === "new_chapters") return buildLatestUrl(page);

    const isTop = sectionId.startsWith("top_");
    const included: string[] = [];
    if (isTop) {
      included.push(getGenreTitle(sectionId.slice("top_".length)));
      if (MANHWA_TOP_SECTION_IDS.has(sectionId)) included.push("Webtoons");
    }

    return buildGenreBrowseUrl({ included, excluded, page, sort });
  }

  private async loadSection(
    sectionId: string,
    spec: SectionSpecOption | undefined,
    page: number,
  ): Promise<PagedSearchResult> {
    const excluded = await this.settingsExcludedGenres();
    const isTop = sectionId.startsWith("top_");
    // Popular and the genre tops rank by comment count; everything else by views.
    const sort = sectionId === "popular_manga" || isTop ? "comment_count" : "view";

    const html = await this.fetchHtml(this.sectionUrl(sectionId, page, sort, excluded));

    const listings =
      sectionId === "new_chapters"
        ? await this.filterNewChapters(parseLatestUpdates(html))
        : parseListings(html);

    const limited = spec?.limit === undefined ? listings : listings.slice(0, spec.limit);

    const sectionRating = isTop
      ? contentRatingForGenres([getGenreTitle(sectionId.slice("top_".length))])
      : undefined;

    const results =
      sectionId === "featured_manga"
        ? await this.toFeaturedHighlights(limited)
        : await this.toHighlights(limited, sectionRating, spec?.style);

    return {
      results,
      // Capped rows and the single-page carousels stop after one page.
      isLastPage: spec?.limit !== undefined || !hasNextPage(html),
    };
  }

  /**
   * The latest-updates page has no exclusion parameter, so the genre settings
   * are applied to each row's own genre list instead.
   */
  private async filterNewChapters(items: MangagoListing[]): Promise<MangagoListing[]> {
    const hidden = new Set((await this.settingsExcludedGenres()).map((g) => g.toLowerCase()));
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
        ? contentRatingForGenres(item.genres)
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

  /**
   * The hero row is built from the listing alone.
   *
   * Rating, status and chapter count only exist on a title's own detail page,
   * and fetching eight of those put eight extra round trips in front of the
   * first thing the reader sees. The row now costs exactly one request.
   */
  private async toFeaturedHighlights(items: MangagoListing[]): Promise<Highlight[]> {
    return this.toHighlights(items.slice(0, FEATURED_HERO_LIMIT));
  }

  // ── reader ───────────────────────────────────────────────────────────────

  /** Fetches the first reader page that actually carries an image list. */
  private async resolveReaderPage(
    chapterUrl: string,
  ): Promise<{ html: string; loadedUrl: string }> {
    const canonical = canonicalReaderUrl(chapterUrl);
    const candidates = [canonical, ...numericChapterCandidates(canonical)].filter(
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
    const src = extractChapterJsUrl(html);
    if (!src) throw new Error("Could not find chapter.js");

    const scriptUrl = resolveChapterJsUrl(src, loadedUrl);

    let script = this.scriptCache.get(scriptUrl);
    if (!script) {
      script = sojsonV4Decode(await this.fetchHtml(scriptUrl));
      // Only a script carrying every marker is worth keeping; a bad decode
      // must not be frozen in for the rest of the session.
      if (isUsableChapterJs(script)) this.scriptCache.set(scriptUrl, script);
    }

    const keyHex = findHexEncodedVariable(script, "key");
    const ivHex = findHexEncodedVariable(script, "iv");
    if (!keyHex) throw new Error("Could not find the AES key");
    if (!ivHex) throw new Error("Could not find the AES IV");

    return {
      script,
      key: decodeHex(keyHex),
      iv: decodeHex(ivHex),
      cols: extractDescrambleCols(script),
    };
  }

  /**
   * Walks a chapter's reader pages into a complete image list.
   *
   * The desktop reader usually returns every image on the first page. The
   * numeric mirror instead serves a window at a time, positioned so that image
   * N lands in slot N-1, so the gaps are filled by fetching one page per
   * window rather than one per image.
   */
  private async loadChapterPages(chapterUrl: string): Promise<ChapterPage[]> {
    const { html, loadedUrl } = await this.resolveReaderPage(chapterUrl);

    const blob = extractImgsrcs(html);
    if (!blob) throw new Error("Could not read the chapter's image list");

    const crypto = await this.loadCrypto(html, loadedUrl);
    const first = decodeImgsrcs(blob, crypto, true);
    const totalPages = extractTotalPages(html);

    const complete =
      first.length > 0 &&
      first.every((entry) => entry !== "") &&
      (totalPages === 0 || first.length >= totalPages);

    if (complete) return this.toPages(first, crypto);

    const template = extractCurlTemplate(html) ?? extractPcurlTemplate(html);
    if (totalPages <= 0 || !template) return this.toPages(first.filter(Boolean), crypto);

    const slots: string[] = Array.from({ length: totalPages }, () => "");
    const fill = (images: string[]): void => {
      for (let i = 0; i < images.length && i < totalPages; i++) {
        const url = images[i]?.trim();
        if (url && !slots[i]) slots[i] = url;
      }
    };
    fill(first);

    // One fetch per window, not per page: the window size is however many
    // images the first page actually carried.
    const windowSize = Math.max(1, first.filter(Boolean).length);
    for (let page = 1; page <= totalPages; page += windowSize) {
      if (slots[page - 1]) continue;
      try {
        const pageHtml = await this.fetchHtml(buildTemplatePageUrl(template, loadedUrl, page));
        const pageBlob = extractImgsrcs(pageHtml);
        if (pageBlob) fill(decodeImgsrcs(pageBlob, crypto, true));
      } catch {
        // Leave the slot empty; a gap is better than an aborted chapter.
      }
    }

    // A window can still leave holes if the site shifted its boundaries, so
    // sweep whatever is left one page at a time.
    for (let page = 1; page <= totalPages; page++) {
      if (slots[page - 1]) continue;
      try {
        const pageHtml = await this.fetchHtml(buildTemplatePageUrl(template, loadedUrl, page));
        const pageBlob = extractImgsrcs(pageHtml);
        if (pageBlob) fill(decodeImgsrcs(pageBlob, crypto, true));
      } catch {
        // Same as above.
      }
    }

    return this.toPages(slots.filter(Boolean), crypto);
  }

  /** Resolves each image URL and records the tile key for the scrambled ones. */
  private async toPages(images: string[], crypto: ReaderCrypto): Promise<ChapterPage[]> {
    const resolved = images.map((image) => absoluteUrl(image));
    const scrambled = resolved.filter((url) => url.includes("cspiclink"));

    if (scrambled.length > 0 && crypto.cols > 0) {
      const keys = await deriveDescramblingKeys(crypto.script, scrambled);
      for (const [url, raw] of keys) {
        const key = parseDescrambleKey(raw, crypto.cols);
        if (key) this.descrambleKeys.set(stripFragment(url), key);
      }
    }

    return resolved.map((url) => ({ url }));
  }
}

function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash >= 0 ? url.slice(0, hash) : url;
}

/** "3 hours ago" for the update column of the chapter-updates rows. */
function relativeTime(date: Date | undefined): string {
  if (!date) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 0) return "";

  const units: [number, string][] = [
    [60_000, "minute"],
    [3_600_000, "hour"],
    [86_400_000, "day"],
    [604_800_000, "week"],
    [2_592_000_000, "month"],
    [31_536_000_000, "year"],
  ];

  if (elapsed < 60_000) return "just now";

  let label = "";
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i]!;
    if (elapsed >= size) {
      const count = Math.floor(elapsed / size);
      label = `${count} ${name}${count === 1 ? "" : "s"} ago`;
      break;
    }
  }
  return label;
}

export { CONTENT_TYPE_OPTIONS };

export class Target extends MangagoSource {}
