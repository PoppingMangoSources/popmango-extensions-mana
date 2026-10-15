/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { TimedCache, UrlBuilder, challengedUrl, withChallengeRetry } from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  DEFAULT_CACHE_URL,
  type ChallengeResponse,
  type BookIndexResponse,
  type ChapterBook,
  type DetailsResponse,
  type GenreEntry,
  type IntegrityResponse,
  type SearchResponse,
  type UploadSource,
  type SourcesResponse,
  type TagEntry,
  type TrackerResponse,
  type TrendingResponse,
} from "./model.ts";

import { parseBookIndex } from "./parsers.ts";

// The site says "your token is stale" with these, not "no". Only the status may
// decide: a successful challenge body contains "access_token", so sniffing it for
// the word "token" reads every good response as a rejection.
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

const LIST_TTL_MS = 24 * 60 * 60 * 1000;

function headerValue(response: NetworkResponse, name: string): string {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? "" : String(headers[key] ?? "");
}

// A JSON 403/503 is an expired token or a rate limit, not a challenge; only a real
// fingerprint counts, or every row prompts for a WebView that cannot help.
function isCloudflareChallenge(response: NetworkResponse): boolean {
  if (headerValue(response, "cf-mitigated").toLowerCase() === "challenge") return true;
  if (response.status !== 403 && response.status !== 503) return false;

  const contentType = headerValue(response, "content-type").toLowerCase();
  if (contentType.includes("application/json")) return false;

  const body = response.data ?? "";
  const looksHtml = contentType.includes("text/html") || /^\s*(?:<!doctype html|<html)/i.test(body);

  return (
    looksHtml &&
    /cf-browser-verification|cf-challenge|cf-chl-|_cf_chl_opt|Just a moment/i.test(body)
  );
}

export class KaganeApi {
  private client: NetworkClient | undefined;

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

  private readonly accessTokens = new Map<string, string>();
  private readonly chapterLists = new Map<string, Promise<ChapterBook[]>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      // Without this the host throws on any non-2xx before the caller sees the
      // response, which would make the stale-token retry below unreachable and
      // replace the API's own error message with a generic one.
      .setStatusValidator(() => true)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          // No user-agent: the app's own matches the connection it makes, and a
          // hand-written one is inconsistent enough to get challenged.
          accept: "application/json",
          "content-type": "application/json",
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // The challenged URL is what the app opens for the reader; Cloudflare answers it
        // with the interstitial, and the clearance it mints covers the whole domain.
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      })
      .build();
    return this.client;
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.get(url, headers ? { headers } : undefined);
      return parseJson<T>(response, url);
    });
  }

  private async postJson<T>(
    url: string,
    body: Record<string, unknown> | undefined,
    headers?: Record<string, string>,
  ): Promise<T> {
    return withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.post(url, {
        ...(body === undefined ? {} : { body }),
        // `body` stays an object — the host serialises it, and pre-encoding it here
        // means the server gets a quoted string and answers 400.
        headers: { "content-type": "application/json", ...headers },
      });
      return parseJson<T>(response, url);
    });
  }

  async fetchSearch(
    body: Record<string, unknown>,
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
      .then(parseBookIndex)
      .finally(() => this.chapterLists.delete(seriesId));
    this.chapterLists.set(seriesId, request);
    return request;
  }

  async fetchTrending(body: Record<string, unknown>, limit: number): Promise<TrendingResponse> {
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

  private forgetTokens(): void {
    this.integrityToken = "";
    this.integrityExpiry = 0;
    this.accessTokens.clear();
  }

  async fetchChallenge(chapterId: string, dataSaver: boolean): Promise<ChallengeResponse> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("books")
      .addPathComponent(chapterId)
      .setQueryItem("is_datasaver", String(dataSaver))
      .build();

    for (const force of [false, true]) {
      const token = await this.fetchIntegrityToken(force);
      const response = await withChallengeRetry(BASE_URL, () =>
        this.http.post(url, {
          body: {},
          headers: { "content-type": "application/json", "x-integrity-token": token },
        }),
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

      const challenge = parseJson<ChallengeResponse>(response, url);
      this.accessTokens.set(`${chapterId}:${dataSaver}`, challenge.access_token);
      return challenge;
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
    const builder = new UrlBuilder(cacheUrl || DEFAULT_CACHE_URL)
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

    const origin = /^https?:\/\/[^/?#]+/i.exec(imageUrl)?.[0] ?? DEFAULT_CACHE_URL;
    const token = this.accessTokens.get(`${chapterId}:${dataSaver}`);
    if (!token) return imageUrl;

    return this.pageUrl(origin, chapterId, fileName, token, dataSaver);
  }
}

function parseJson<T>(response: NetworkResponse, url: string): T {
  if (response.status >= 400) {
    throw new Error(`${errorMessage(response.data)} (HTTP ${response.status} for ${url})`);
  }

  try {
    return JSON.parse(response.data) as T;
  } catch {
    throw new Error(`Kagane returned a response that was not JSON (${url})`);
  }
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
