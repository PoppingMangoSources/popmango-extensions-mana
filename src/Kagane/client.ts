/* SPDX-License-Identifier: GPL-3.0-or-later */

import { Body, CloudflareError, HttpClient, type HttpResponse } from "@mana-app/types";

import {
  TimedCache,
  UrlBuilder,
  challengedUrl,
  isCloudflareChallenge,
  withChallengeRetry,
  withDefaults,
} from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  DEFAULT_CACHE_URL,
  MIRRORS,
  isTrustedHost,
  type JsonObject,
  type ChallengeResponse,
  type BookIndexResponse,
  type ChapterBook,
  type DetailsResponse,
  type GenreEntry,
  type IntegrityResponse,
  type ManifestPage,
  type SearchResponse,
  type UploadSource,
  type SourcesResponse,
  type TagEntry,
  type TrackerResponse,
  type TrendingResponse,
  type SimilarOptions,
} from "./model.ts";

import { parseBookIndex, readerExpiry } from "./parsers.ts";

// The site says "your token is stale" with these, not "no". Only the status may
// decide: a successful challenge body contains "access_token", so sniffing it for
// the word "token" reads every good response as a rejection.
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MIRROR_TTL_MS = 5_000;
const BOOK_INDEX_TTL_MS = 2 * 60 * 1000;
const READER_SESSION_LIMIT = 40;

/**
 * `url` moved onto the reader's chosen mirror. Only the default address is rewritten: the
 * mirrors share one API, so a URL built for kagane.cx is answered the same on any of them,
 * and a host that is not the site's — the image CDN — is left where it is.
 */
export function onMirror(url: string, mirror: string): string {
  if (mirror === MIRRORS[0] || !MIRRORS.includes(mirror)) return url;
  return url.replace(/^https:\/\/(?:www\.)?kagane\.cx(?=[/?#]|$)/i, `https://${mirror}`);
}

/** A `cache_url` the reader token may be sent to, or the site itself when it is not one. */
function trustedCacheUrl(value: string | null | undefined): string {
  const host = /^https:\/\/([^/?#:]+)(?::443)?(?:[/?#]|$)/i.exec(value ?? "")?.[1];
  return value && host && !hasControlCharacter(value) && isTrustedHost(host)
    ? value
    : DEFAULT_CACHE_URL;
}

// A control character can survive the host check and be normalised away by the network
// stack afterwards, so a URL carrying one is not trusted at all.
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// A JSON 403/503 is an expired token or a rate limit, not a challenge; only a real
// fingerprint counts, or every row prompts for a WebView that cannot help.
async function isChallenged(response: HttpResponse): Promise<boolean> {
  if (isCloudflareChallenge(response)) return true;
  if (response.status !== 403 && response.status !== 503) return false;

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) return false;

  const body = await response.text();
  const looksHtml = contentType.includes("text/html") || /^\s*(?:<!doctype html|<html)/i.test(body);

  return (
    looksHtml &&
    /cf-browser-verification|cf-challenge|cf-chl-|_cf_chl_opt|Just a moment/i.test(body)
  );
}

export class KaganeApi {
  private client: HttpClient | undefined;

  constructor(private readonly mirrorSetting: () => Promise<string>) {}

  private mirror = { host: MIRRORS[0]!, at: 0 };

  /** The chosen mirror's front page — where a challenge has to be passed to clear it. */
  async siteUrl(): Promise<string> {
    return `https://${await this.mirrorHost()}`;
  }

  /** The mirror every request goes to, re-read every few seconds rather than per request. */
  async mirrorHost(): Promise<string> {
    if (Date.now() - this.mirror.at > MIRROR_TTL_MS) {
      const chosen = await this.mirrorSetting().catch(() => MIRRORS[0]!);
      this.mirror = { host: MIRRORS.includes(chosen) ? chosen : MIRRORS[0]!, at: Date.now() };
    }
    return this.mirror.host;
  }

  private integrityToken = "";
  private integrityExpiry = 0;
  private integrityRequest: Promise<string> | undefined;

  // The taxonomy changes by the week and the tag list alone is thousands of entries, so it
  // is kept on disk: the search form and a typed tag are both served without fetching it.
  private readonly genreList = new TimedCache<Record<string, string>>("kagane.genres", LIST_TTL_MS);
  private readonly tagList = new TimedCache<Record<string, string>>("kagane.tags", LIST_TTL_MS);
  private readonly sourceList = new TimedCache<UploadSource[]>("kagane.sources", LIST_TTL_MS);
  private readonly languageList = new TimedCache<string[]>("kagane.languages", LIST_TTL_MS);

  // A refresh fires every row at once and a retry repeats them; identical calls in flight
  // share one response rather than knocking on Cloudflare twice for the same page.
  private readonly searches = new Map<string, Promise<SearchResponse>>();

  private readonly readerSessions = new Map<
    string,
    { challenge: ChallengeResponse; expiry: number }
  >();
  private readonly readerRequests = new Map<string, Promise<ChallengeResponse>>();
  private readonly chapterLists = new Map<string, Promise<ChapterBook[]>>();
  // Kept briefly so a chapter opened from the list can be checked against the page count
  // the list gave for it, without asking for the list a second time.
  private readonly bookIndexes = new Map<string, { at: number; books: ChapterBook[] }>();

  private get http(): HttpClient {
    this.client ??= new HttpClient()
      .setRateLimit(3, 1000)
      .addRequestInterceptor(async (request) => {
        const mirror = await this.mirrorHost();
        request.url = onMirror(request.url, mirror);
        withDefaults(request.headers, {
          // No user-agent: the app's own matches the connection it makes, and a
          // hand-written one is inconsistent enough to get challenged.
          accept: "application/json",
          "content-type": "application/json",
          origin: `https://${mirror}`,
          referer: `https://${mirror}/`,
        });
        return request;
      })
      .addResponseInterceptor(async (response) => {
        // The challenged URL is what the app opens for the reader; Cloudflare answers it
        // with the interstitial, and the clearance it mints covers the whole domain.
        if (await isChallenged(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      });
    return this.client;
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return withChallengeRetry(await this.siteUrl(), async () => {
      const response = await this.http.get(url, headers ? { headers } : undefined);
      return parseJson<T>(response);
    });
  }

  private async postJson<T>(
    url: string,
    body: JsonObject | undefined,
    headers?: Record<string, string>,
  ): Promise<T> {
    return withChallengeRetry(await this.siteUrl(), async () => {
      const response = await this.http.post(
        url,
        body === undefined ? undefined : Body.json(body),
        headers ? { headers } : undefined,
      );
      return parseJson<T>(response);
    });
  }

  async fetchSearch(
    body: JsonObject,
    page: number,
    size: number,
    sort: string,
    exactMatch = false,
  ): Promise<SearchResponse> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("search")
      .addPathComponent("series")
      // The API pages from zero.
      .setQueryItem("page", String(Math.max(0, page - 1)))
      .setQueryItem("size", String(size));

    if (exactMatch) url.setQueryItem("exact_match", "true");

    // Relevance is the default and is asked for by leaving the parameter off entirely.
    if (sort) url.setQueryItem("sort", sort);

    const target = url.build();
    const key = `${target}|${JSON.stringify(body)}`;

    const inFlight = this.searches.get(key);
    if (inFlight) return inFlight;

    const request = this.postJson<SearchResponse>(target, body).finally(() => {
      if (this.searches.get(key) === request) this.searches.delete(key);
    });

    this.searches.set(key, request);
    return request;
  }

  async fetchSeries(seriesId: string): Promise<DetailsResponse> {
    return this.fetchJson<DetailsResponse>(
      new UrlBuilder(API_URL).addPathComponent("series").addPathComponent(seriesId).build(),
    );
  }

  async fetchBooks(seriesId: string): Promise<ChapterBook[]> {
    const running = this.chapterLists.get(seriesId);
    if (running) return running;
    const request = this.fetchJson<BookIndexResponse>(
      new UrlBuilder(API_URL)
        .addPathComponent("series")
        .addPathComponent(seriesId)
        .addPathComponent("books")
        .addPathComponent("index")
        .setQueryItem("fields", "List")
        .build(),
    )
      .then((books) => {
        const index = parseBookIndex(books);
        this.bookIndexes.set(seriesId, { at: Date.now(), books: index });
        if (this.bookIndexes.size > 20)
          this.bookIndexes.delete(this.bookIndexes.keys().next().value!);
        return index;
      })
      .finally(() => this.chapterLists.delete(seriesId));
    this.chapterLists.set(seriesId, request);
    return request;
  }

  async fetchTrending(body: JsonObject, limit: number): Promise<TrendingResponse> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("series")
      .addPathComponent("trending")
      .setQueryItem("limit", limit)
      .setQueryItem("age_rating", (body["age_rating"] as string[]).join(","));
    const languages = (body["content_lang"] ?? []) as string[];
    // The chart accepts at most five language codes; longer selections are checked on
    // its returned language labels without replacing the chart with a popularity list.
    if (languages.length && languages.length <= 5) url.setQueryItem("lang", languages.join(","));
    for (const flag of ["is_pornographic", "is_disturbing"]) {
      if (typeof body[flag] === "boolean") url.setQueryItem(flag, body[flag]);
    }
    return this.fetchJson<TrendingResponse>(url.build());
  }

  async resolvePersonOrGroup(kind: "staff" | "groups", name: string): Promise<string> {
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)) return name;
    const candidates =
      kind === "staff"
        ? (
            await this.postJson<{ content: { staff_id: string; name: string }[] }>(
              `${API_URL}/search/staff?size=8`,
              { name },
            )
          ).content.map((person) => ({ id: person.staff_id, name: person.name }))
        : (
            await this.fetchJson<{ items: { group_id: string; title: string }[] }>(
              new UrlBuilder(API_URL)
                .addPathComponent("groups")
                .addPathComponent("search")
                .setQueryItem("q", name)
                .setQueryItem("limit", 8)
                .build(),
            )
          ).items.map((group) => ({ id: group.group_id, name: group.title }));
    const exact = candidates.filter(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    const selected = exact.length ? exact : candidates;
    if (selected.length === 1) return selected[0]!.id;
    throw new Error(
      selected.length
        ? `Several matches for ${name}. Enter the full name or ID.`
        : `No matches for ${name}.`,
    );
  }

  async fetchRelated(trackerId: string): Promise<TrackerResponse> {
    return this.fetchJson<TrackerResponse>(
      new UrlBuilder(API_URL)
        .addPathComponent("trackers")
        .addPathComponent(trackerId)
        .addPathComponent("series")
        .build(),
    );
  }

  async fetchSimilar(seriesId: string, options: SimilarOptions): Promise<SearchResponse> {
    const url = new UrlBuilder(BASE_URL)
      .addPathComponent("api/v1/rec/series")
      .addPathComponent(seriesId)
      .addPathComponent("similar")
      .setQueryItem("kind", "similar")
      .setQueryItem("limit", 10)
      .setQueryItem(
        "age_rating",
        [
          ...new Set(
            options.ratings.map((rating) =>
              rating === "Safe" ? "Safe" : rating === "Suggestive" ? "FifteenPlus" : "EighteenPlus",
            ),
          ),
        ].join(","),
      )
      // Recommendations use visibility toggles, not the catalogue's exact-match flags.
      .setQueryItem("is_pornographic", options.ratings.includes("Pornographic"))
      .setQueryItem("is_disturbing", !options.hideDisturbing);
    if (options.languages.length) url.setQueryItem("lang", options.languages.join(","));
    if (options.uploadSource !== "all")
      url.setQueryItem(
        "source_type",
        options.uploadSource === "official" ? "Official" : "Unofficial,Mixed",
      );
    return this.fetchJson<SearchResponse>(url.build());
  }

  /** The chapter list fetched in the last few minutes, if there was one; never fetches. */
  recentBooks(seriesId: string): ChapterBook[] | undefined {
    const entry = this.bookIndexes.get(seriesId);
    return entry && Date.now() - entry.at < BOOK_INDEX_TTL_MS ? entry.books : undefined;
  }

  imageUrl(imageId: string): string {
    return new UrlBuilder(API_URL).addPathComponent("image").addPathComponent(imageId).build();
  }

  async fetchGenreNames(): Promise<Record<string, string>> {
    return this.genreList
      .get(async () => {
        const entries = await this.fetchJson<GenreEntry[]>(`${API_URL}/genres/list`);
        // An empty answer is a bad request, not a site with no genres. Throwing keeps a
        // blank list out of the cache, where it would outlast the failure that caused it.
        if (entries.length === 0) throw new Error("Kagane returned no genres");
        return Object.fromEntries(entries.map((genre) => [genre.id, genre.genre_name]));
      })
      .catch(() => ({}));
  }

  async fetchContentLanguages(): Promise<string[]> {
    return this.languageList.get(async () => {
      // Language choices come from catalogue facets, including uploader language codes
      // outside the site's smaller original/translated-language menu.
      const response = await this.postJson<SearchResponse>(
        `${API_URL}/search/series?page=0&size=1&facets=true`,
        {},
      );
      const languages = response.facets?.content_lang?.map((entry) => entry.value) ?? [];
      if (!languages.length) throw new Error("Kagane returned no language choices");
      return [...new Set(languages.map((language) => language.toLowerCase()))];
    });
  }

  async fetchTagNames(): Promise<Record<string, string>> {
    return this.tagList
      .get(async () => {
        const entries = await this.fetchJson<TagEntry[]>(`${API_URL}/tags/list`);
        if (entries.length === 0) throw new Error("Kagane returned no tags");
        return Object.fromEntries(entries.map((tag) => [tag.id, tag.tag_name]));
      })
      .catch(() => ({}));
  }

  async fetchUploadSources(): Promise<UploadSource[]> {
    return this.sourceList
      .get(async () => {
        const body = await this.postJson<SourcesResponse>(`${API_URL}/sources/list`, {
          source_types: null,
        });
        const sources = body.sources ?? [];
        if (sources.length === 0) throw new Error("Kagane returned no upload sources");
        return sources;
      })
      .catch(() => []);
  }

  private async fetchIntegrityToken(force = false): Promise<string> {
    if (!force && this.integrityToken && Date.now() < this.integrityExpiry) {
      return this.integrityToken;
    }
    if (this.integrityRequest) return this.integrityRequest;

    const request = (async (): Promise<string> => {
      // The site hands out its cookies here, so this warms the session the token is
      // minted against — including the clearance a challenge just wrote.
      await this.http.get(`${BASE_URL}/`).catch(() => undefined);

      const integrity = await this.postJson<IntegrityResponse>(
        `${BASE_URL}/api/integrity`,
        undefined,
      );
      this.integrityToken = integrity.token;
      this.integrityExpiry = integrity.exp * 1000;
      return this.integrityToken;
    })();

    this.integrityRequest = request;
    try {
      return await request;
    } catch (error) {
      // A token minted before a challenge belongs to the session the challenge replaced,
      // so it is dropped rather than replayed. Keeping it is what left the reader stuck
      // until the source was closed and its cache cleared by hand.
      this.forgetTokens();
      throw error;
    } finally {
      this.integrityRequest = undefined;
    }
  }

  /** Expired sessions go first; past the limit, the oldest goes too. */
  private rememberSession(
    key: string,
    session: { challenge: ChallengeResponse; expiry: number },
  ): void {
    const now = Date.now();
    for (const [entry, { expiry }] of this.readerSessions)
      if (expiry <= now) this.readerSessions.delete(entry);
    this.readerSessions.delete(key);
    this.readerSessions.set(key, session);
    while (this.readerSessions.size > READER_SESSION_LIMIT)
      this.readerSessions.delete(this.readerSessions.keys().next().value!);
  }

  private forgetTokens(): void {
    this.integrityToken = "";
    this.integrityExpiry = 0;
    this.readerSessions.clear();
  }

  fetchChallenge(chapterId: string, dataSaver: boolean): Promise<ChallengeResponse> {
    const key = `${chapterId}:${dataSaver}`;
    const running = this.readerRequests.get(key);
    if (running) return running;
    const request = this.loadChallenge(chapterId, dataSaver).finally(() =>
      this.readerRequests.delete(key),
    );
    this.readerRequests.set(key, request);
    return request;
  }

  private async loadChallenge(chapterId: string, dataSaver: boolean): Promise<ChallengeResponse> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("books")
      .addPathComponent(chapterId)
      .setQueryItem("is_datasaver", String(dataSaver))
      .build();

    for (const force of [false, true]) {
      const token = await this.fetchIntegrityToken(force);
      const response = await withChallengeRetry(await this.siteUrl(), () =>
        this.http.post(url, Body.json({}), { headers: { "x-integrity-token": token } }),
      ).catch((error: unknown) => {
        // A challenge here replaces the session both tokens were minted against, so
        // neither survives it; the next open mints them afresh rather than reusing them.
        if (error instanceof CloudflareError) this.forgetTokens();
        throw error;
      });

      if (STALE_TOKEN_STATUSES.has(response.status)) {
        if (!force) continue;
        throw new Error("Kagane rejected the reader token. Try again in a moment.");
      }

      const challenge = await parseJson<ChallengeResponse>(response);
      if (!challenge.access_token || !challenge.manifest?.pages?.length)
        throw new Error("Kagane returned an incomplete reader session. Reopen the chapter.");
      checkManifest(challenge.manifest.pages);
      const session = {
        challenge: { ...challenge, cache_url: trustedCacheUrl(challenge.cache_url) },
        expiry: readerExpiry(challenge.access_token),
      };
      this.rememberSession(`${chapterId}:${dataSaver}`, session);
      return session.challenge;
    }

    throw new Error("Could not obtain a reader token for this chapter");
  }

  pageUrl(
    cacheUrl: string,
    chapterId: string,
    fileName: string,
    token: string,
    dataSaver: boolean,
  ): string {
    const builder = new UrlBuilder(trustedCacheUrl(cacheUrl))
      .addPathComponent("api")
      .addPathComponent("v2")
      .addPathComponent("books")
      .addPathComponent("page");

    return builder
      .addPathComponent(chapterId)
      .addPathComponent(fileName)
      .setQueryItem("token", token)
      .setQueryItem("is_datasaver", dataSaver)
      .build();
  }

  async refreshPageUrl(imageUrl: string, dataSaver: boolean): Promise<string> {
    const match = /\/api\/v2\/books\/page\/(?:datasaver\/)?([^/?#]+)\/([^/?#]+)/.exec(imageUrl);
    if (!match) return imageUrl;

    const [, chapterId, fileName] = match;
    if (!chapterId || !fileName) return imageUrl;

    // Issued pages keep their original quality mode until the chapter is reopened.
    const quality = /[?&]is_datasaver=(true|false)(?:&|$)/.exec(imageUrl)?.[1];
    const mode = quality === undefined ? dataSaver : quality === "true";
    let session = this.readerSessions.get(`${chapterId}:${mode}`);
    if (!session || Date.now() >= session.expiry) {
      await this.fetchChallenge(chapterId, mode);
      session = this.readerSessions.get(`${chapterId}:${mode}`);
    }
    const challenge = session?.challenge;
    const page = challenge?.manifest?.pages?.find(
      (entry) => `${entry.page_id}.${entry.ext ?? "jxl"}` === fileName,
    );
    if (!challenge || !page)
      throw new Error("Kagane chapter pages changed. Reopen the chapter to reload them.");
    return this.pageUrl(
      challenge.cache_url || DEFAULT_CACHE_URL,
      chapterId,
      fileName,
      challenge.access_token,
      mode,
    );
  }
}

// Every status reaches here, so the stale-token retry above can see one and the API's own
// error message is the one reported. The URL stays out of it: the reader sees this message,
// and a request URL can carry a token.
async function parseJson<T>(response: HttpResponse): Promise<T> {
  const body = await response.text();
  if (response.status >= 400) {
    throw new Error(`${errorMessage(body)} (HTTP ${response.status})`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Kagane returned a response that could not be read.");
  }
}

/**
 * Page ids and extensions go into the page URL, so anything but plain characters is
 * refused; and a run of page numbers with a gap or a repeat is a chapter half delivered.
 */
function checkManifest(pages: readonly ManifestPage[]): void {
  const ids = new Set<string>();
  const numbers: number[] = [];
  for (const page of pages) {
    if (
      !Number.isInteger(page.page_no) ||
      typeof page.page_id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(page.page_id) ||
      (page.ext != null && !/^[A-Za-z0-9]+$/.test(page.ext)) ||
      ids.has(page.page_id)
    )
      throw new Error("Kagane returned an invalid page list. Reopen the chapter.");
    ids.add(page.page_id);
    numbers.push(page.page_no);
  }
  numbers.sort((left, right) => left - right);
  const first = numbers[0] ?? 0;
  if (numbers.some((number, position) => number !== first + position))
    throw new Error("Kagane returned an incomplete chapter. Try again in a moment.");
}

function errorMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record["message"] === "string") return record["message"];
      if (typeof record["error"] === "string") return record["error"];
    }
  } catch {}
  return "The server rejected the request";
}
