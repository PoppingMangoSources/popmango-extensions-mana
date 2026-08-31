/* SPDX-License-Identifier: GPL-3.0-or-later */

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

// The site says "your token is stale" with these, not "no".
const STALE_TOKEN_STATUSES = new Set([401, 403, 507]);

function isStaleTokenBody(body: string): boolean {
  return /integrity|token|unauthorized|forbidden/i.test(body.slice(0, 2048));
}

function headerOf(response: NetworkResponse, name: string): string {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? "" : String(headers[key] ?? "");
}

// A JSON 403/503 is an expired token or a rate limit, not a challenge; only a real
// fingerprint counts, or every row prompts for a WebView that cannot help.
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
  private integrityRequest: Promise<string> | undefined;

  private metadata: KaganeMetadata | undefined;
  private metadataRequest: Promise<KaganeMetadata> | undefined;

  accessToken = "";

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
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
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
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
    body: Record<string, unknown> | undefined,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await this.http.post(url, {
      ...(body === undefined ? {} : { body }),
      // `body` stays an object — the host serialises it, and pre-encoding it here
      // means the server gets a quoted string and answers 400.
      headers: { "content-type": "application/json", ...headers },
    });
    return parseJson<T>(response, url);
  }

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

  imageUrl(imageId: string): string {
    return new UrlBuilder(API_URL).addPathComponent("image").addPathComponent(imageId).build();
  }

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
  } catch {}
  return "The server rejected the request";
}
