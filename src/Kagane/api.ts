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

import { ACCEPT_LANGUAGE, JSON_ACCEPT, USER_AGENT, UrlBuilder } from "../common/index.ts";
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
          accept: JSON_ACCEPT,
          "accept-language": ACCEPT_LANGUAGE,
          "user-agent": USER_AGENT,
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // A stale token is handled by the caller, so it must survive the
        // interceptor rather than being turned into a Cloudflare error here.
        if (STALE_TOKEN_STATUSES.has(response.status)) return response;
        if (response.status === 503) throw new CloudflareError(BASE_URL);
        return response;
      })
      .build();
    return this.client;
  }

  private async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.http.get(url, headers ? { headers } : undefined);
    return parseJson<T>(response, url);
  }

  private async postJson<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await this.http.post(url, {
      body: JSON.stringify(body ?? {}),
      headers: { "content-type": "application/json", ...headers },
    });
    return parseJson<T>(response, url);
  }

  // ── catalog ──────────────────────────────────────────────────────────────

  /**
   * The search endpoint backs browsing as well as searching — a home row is
   * this call with a sort and no title.
   */
  async search(body: unknown, page: number, size: number, sort: string): Promise<SearchDto> {
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

      const integrity = await this.postJson<IntegrityDto>(`${BASE_URL}/api/integrity`, {});
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
        body: "{}",
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
