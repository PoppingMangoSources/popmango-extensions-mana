/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The site's JSON API, plus the two tokens that guard the reader.
 *
 * Reading a chapter needs a short-lived *integrity* token, which buys a
 * per-chapter *challenge* carrying an access token and the CDN host to fetch
 * pages from. Both expire, and both are re-fetched on demand rather than on a
 * schedule — the app has no background pass to refresh them in.
 */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { UrlBuilder } from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  DEFAULT_CACHE_URL,
  type ChallengeDto,
  type DetailsDto,
  type GenreDto,
  type IntegrityDto,
  type KaganeMetadata,
  type SearchDto,
  type SourcesDto,
  type TagDto,
  type TrackerDto,
} from "./model.ts";

/** Statuses the site uses to say "your token is stale", not "no". */
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

function isStaleTokenBody(body: string): boolean {
  return /integrity|token|unauthorized|forbidden/i.test(body.slice(0, 2048));
}

/** Header names vary in case between hosts, so look one up without assuming. */
function headerOf(response: NetworkResponse, name: string): string {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? "" : String(headers[key] ?? "");
}

/**
 * Whether a response is genuinely a Cloudflare challenge.
 *
 * The API answers with an ordinary JSON 403 or 503 for an expired reader
 * token, a rate limit, or an outage. Treating those as a challenge puts a
 * "resolve this in a WebView" prompt in front of the reader for something a
 * WebView cannot fix, so a challenge has to look like one: the `cf-mitigated`
 * header, or an HTML body carrying Cloudflare's own markers.
 */
function isCloudflareChallenge(response: NetworkResponse): boolean {
  if (headerOf(response, "cf-mitigated").toLowerCase() === "challenge") return true;
  if (response.status !== 403 && response.status !== 503) return false;

  const contentType = headerOf(response, "content-type").toLowerCase();
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
  /** In-flight integrity fetch, so a burst of pages asks for one token. */
  private integrityRequest: Promise<string> | undefined;

  private metadata: KaganeMetadata | undefined;
  private metadataRequest: Promise<KaganeMetadata> | undefined;

  /** The newest access token, reused until the CDN rejects it. */
  accessToken = "";

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          ...request.headers,
        },
        // Deliberately no user-agent. The app sends one that matches the
        // connection it actually makes; overriding it with a hand-written
        // string makes the request look inconsistent and is what gets it
        // challenged by Cloudflare in the first place.
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
        // A stale token is the caller's to handle, so it has to survive the
        // interceptor rather than being turned into an error here.
        return response;
      })
      .build();
    return this.client;
  }

  private async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.http.get(url, headers ? { headers } : undefined);
    return parseJson<T>(response, url);
  }

  /**
   * `body` is handed over as an object, not a string.
   *
   * The host serialises it according to the content type; pre-encoding it with
   * `JSON.stringify` makes the host encode that string in turn, so the server
   * receives a quoted JSON string where it expects an object and answers 400.
   * Pass `undefined` for the endpoints that want no body at all.
   */
  private async postJson<T>(
    url: string,
    body: Record<string, unknown> | undefined,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await this.http.post(url, {
      ...(body === undefined ? {} : { body }),
      headers: { "content-type": "application/json", ...headers },
    });
    return parseJson<T>(response, url);
  }

  // ── catalog ──────────────────────────────────────────────────────────────

  /**
   * The search endpoint backs browsing as well as searching — a home row is
   * this call with a sort and no title.
   */
  async search(
    body: Record<string, unknown>,
    page: number,
    size: number,
    sort: string,
  ): Promise<SearchDto> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("search")
      .addPathComponent("series")
      // The API pages from zero.
      .setQueryItem("page", String(Math.max(0, page - 1)))
      .setQueryItem("size", String(size))
      .setQueryItem("sort", sort)
      .build();

    return this.postJson<SearchDto>(url, body);
  }

  async series(seriesId: string): Promise<DetailsDto> {
    return this.getJson<DetailsDto>(
      new UrlBuilder(API_URL).addPathComponent("series").addPathComponent(seriesId).build(),
    );
  }

  async related(trackerId: string): Promise<TrackerDto> {
    return this.getJson<TrackerDto>(
      new UrlBuilder(API_URL)
        .addPathComponent("trackers")
        .addPathComponent(trackerId)
        .addPathComponent("series")
        .build(),
    );
  }

  /** Cover and page images are addressed by id under the API's image route. */
  imageUrl(imageId: string): string {
    return new UrlBuilder(API_URL).addPathComponent("image").addPathComponent(imageId).build();
  }

  /**
   * Genres, tags and sources, fetched once and shared.
   *
   * The three are needed together to render the search form, so a failure in
   * any one of them yields empty lists rather than an unusable form.
   */
  async getMetadata(): Promise<KaganeMetadata> {
    if (this.metadata) return this.metadata;
    if (this.metadataRequest) return this.metadataRequest;

    const request = (async (): Promise<KaganeMetadata> => {
      const [genres, tags, sources] = await Promise.all([
        this.getJson<GenreDto[]>(`${API_URL}/genres/list`).catch(() => [] as GenreDto[]),
        this.getJson<TagDto[]>(`${API_URL}/tags/list`).catch(() => [] as TagDto[]),
        this.postJson<SourcesDto>(`${API_URL}/sources/list`, { source_types: null }).catch(
          () => ({}) as SourcesDto,
        ),
      ]);

      return {
        genres: Object.fromEntries(
          (Array.isArray(genres) ? genres : []).map((genre) => [genre.id, genre.genre_name]),
        ),
        tags: Object.fromEntries(
          (Array.isArray(tags) ? tags : []).map((tag) => [tag.id, tag.tag_name]),
        ),
        sources: sources.sources ?? [],
      };
    })();

    this.metadataRequest = request;
    try {
      this.metadata = await request;
      return this.metadata;
    } finally {
      this.metadataRequest = undefined;
    }
  }

  // ── reader tokens ────────────────────────────────────────────────────────

  /**
   * The integrity token, refreshed when it has expired.
   *
   * The site issues it only to a client that has loaded the site itself, so
   * the homepage is fetched first to pick up whatever cookies that sets.
   */
  private async getIntegrityToken(force = false): Promise<string> {
    if (!force && this.integrityToken && Date.now() < this.integrityExpiry) {
      return this.integrityToken;
    }
    if (this.integrityRequest) return this.integrityRequest;

    const request = (async (): Promise<string> => {
      await this.http.get(`${BASE_URL}/`).catch(() => undefined);

      const integrity = await this.postJson<IntegrityDto>(`${BASE_URL}/api/integrity`, undefined);
      this.integrityToken = integrity.token;
      this.integrityExpiry = integrity.exp * 1000;
      return this.integrityToken;
    })();

    this.integrityRequest = request;
    try {
      return await request;
    } finally {
      this.integrityRequest = undefined;
    }
  }

  /**
   * The per-chapter challenge: an access token, the CDN host, and the page
   * manifest. A rejected integrity token is retried once with a fresh one.
   */
  async getChallenge(chapterId: string, dataSaver: boolean): Promise<ChallengeDto> {
    const url = new UrlBuilder(API_URL)
      .addPathComponent("books")
      .addPathComponent(chapterId)
      .setQueryItem("is_datasaver", String(dataSaver))
      .build();

    for (const force of [false, true]) {
      const token = await this.getIntegrityToken(force);
      const response = await this.http.post(url, {
        body: {},
        headers: { "content-type": "application/json", "x-integrity-token": token },
      });

      if (STALE_TOKEN_STATUSES.has(response.status) || isStaleTokenBody(response.data)) {
        if (!force) continue;
        throw new Error("Kagane rejected the reader token. Try again in a moment.");
      }

      const challenge = parseJson<ChallengeDto>(response, url);
      this.accessToken = challenge.access_token;
      return challenge;
    }

    throw new Error("Could not obtain a reader token for this chapter");
  }

  /** The page URL for one image of a chapter, carrying the current token. */
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

    if (dataSaver) builder.addPathComponent("datasaver");

    return builder
      .addPathComponent(chapterId)
      .addPathComponent(fileName)
      .setQueryItem("token", token)
      .build();
  }

  /**
   * Re-mints the token on a page URL.
   *
   * Page URLs are handed to the app once and fetched much later, by which time
   * the token they carry may have expired; this rebuilds one from the chapter
   * id embedded in its own path.
   */
  async refreshPageUrl(imageUrl: string, dataSaver: boolean): Promise<string> {
    const match = /\/api\/v2\/books\/page\/(?:datasaver\/)?([^/?#]+)\/([^/?#]+)/.exec(imageUrl);
    if (!match) return imageUrl;

    const [, chapterId, fileName] = match;
    if (!chapterId || !fileName) return imageUrl;

    const origin = /^https?:\/\/[^/?#]+/i.exec(imageUrl)?.[0] ?? DEFAULT_CACHE_URL;
    const token = this.accessToken || (await this.getChallenge(chapterId, dataSaver)).access_token;

    return this.pageUrl(origin, chapterId, fileName, token, dataSaver);
  }
}

function parseJson<T>(response: NetworkResponse, url: string): T {
  if (response.status >= 400) {
    throw new Error(`${describeError(response.data)} (HTTP ${response.status} for ${url})`);
  }

  try {
    return JSON.parse(response.data) as T;
  } catch {
    throw new Error(`Kagane returned a response that was not JSON (${url})`);
  }
}

function describeError(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record["message"] === "string") return record["message"];
      if (typeof record["error"] === "string") return record["error"];
    }
  } catch {
    // Fall through to the generic message.
  }
  return "The server rejected the request";
}
