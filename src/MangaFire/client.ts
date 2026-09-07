/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { ACCEPT_LANGUAGE, challengedUrl, isChallengePage } from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  CHAPTER_PAGE_SIZE,
  PAGE_SIZE,
  type ApiList,
  type ChapterItem,
  type DetailsResponse,
  type PagesResponse,
  type TagsResponse,
  type TitleItem,
  type VolumeItem,
} from "./model.ts";
import { canonicalise, sign, type QueryParam } from "./vrf.ts";

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cloudflare names a challenge in a header of its own and answers the interstitial with a
 * 403 as readily as a 200. Where neither that header nor the interstitial's markup is
 * present, the body shape decides: everything under `/api` answers JSON, so a refusal that
 * is not JSON was written at the edge rather than by the API.
 *
 * Without that last test the two cannot be told apart. Reporting every 403 as a challenge
 * sends a reader to a page with no puzzle on it when the API simply said no — and this API
 * says no for a stale signature, which is an ordinary error a WebView cannot help with.
 */
function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  if (key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge") return true;

  if (response.status !== 403 && response.status !== 503) return false;

  const body = response.data ?? "";
  return isChallengePage(body) || !isJson(body);
}

/** Surfaces the API's own error text instead of a bare status code. */
function errorMessage(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    for (const field of ["message", "error"]) {
      const value = record[field];
      if (typeof value === "string" && value) return value;
    }
  }
  return undefined;
}

export type TitleQuery = {
  page: number;
  keyword?: string | undefined;
  order?: string | undefined;
  params?: readonly QueryParam[] | undefined;
};

export class MangaFireApi {
  private client: NetworkClient | undefined;
  // The home page fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      // 403 and 503 have to reach us, or a challenge cannot be told from a real error.
      .setStatusValidator(
        (status) => (status >= 200 && status < 400) || status === 403 || status === 503,
      )
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          referer: `${BASE_URL}/`,
          accept: "application/json",
          "accept-language": ACCEPT_LANGUAGE,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      })
      .build();
    return this.client;
  }

  /**
   * Builds a signed API URL.
   *
   * The signature is taken over the parameters in sorted order, so the request has to carry
   * them in that same order — a server checking the signature rebuilds it from what it
   * received. `withQuery` cannot be used here for that reason: it preserves the caller's
   * order, and the sort is part of what is signed.
   */
  private url(path: string, params: readonly QueryParam[] = []): string {
    const sorted = [...params].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );

    const query = sorted
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    const vrf = `vrf=${sign(canonicalise(path, sorted))}`;
    return `${API_URL}${path}?${query ? `${query}&` : ""}${vrf}`;
  }

  private async get<T>(url: string): Promise<T> {
    const running = this.inFlight.get(url) as Promise<T> | undefined;
    if (running) return running;

    const request = (async () => {
      const response = await this.http.get(url);
      const body = response.data ?? "";

      if (response.status >= 400) {
        const stated = errorMessage(body);
        throw new Error(
          stated
            ? `MangaFire rejected the request: ${stated} (HTTP ${response.status})`
            : `MangaFire rejected the request (HTTP ${response.status})`,
        );
      }

      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`MangaFire returned a response that was not JSON: ${url}`);
      }
    })().finally(() => {
      if (this.inFlight.get(url) === request) this.inFlight.delete(url);
    });

    this.inFlight.set(url, request);
    return request;
  }

  fetchTitles(query: TitleQuery): Promise<ApiList<TitleItem>> {
    const params: QueryParam[] = [
      ["page", String(query.page)],
      ["limit", String(PAGE_SIZE)],
      ...(query.params ?? []),
    ];
    if (query.keyword) params.push(["keyword", query.keyword]);
    if (query.order) {
      const [key, direction] = query.order.split(":");
      params.push([`order[${key}]`, direction ?? "desc"]);
    }

    return this.get<ApiList<TitleItem>>(this.url("/titles", params));
  }

  /** The trending run the site's own home page shows: one page, no paging. */
  fetchTrending(limit: number): Promise<ApiList<TitleItem>> {
    return this.get<ApiList<TitleItem>>(
      this.url("/top-titles", [
        ["type", "trending"],
        ["days", "1"],
        ["limit", String(limit)],
      ]),
    );
  }

  fetchDetails(hid: string): Promise<DetailsResponse> {
    return this.get<DetailsResponse>(this.url(`/titles/${hid}`));
  }

  fetchChapters(hid: string, language: string, page: number): Promise<ApiList<ChapterItem>> {
    return this.get<ApiList<ChapterItem>>(
      this.url(`/titles/${hid}/chapters`, [
        ["language", language],
        ["sort", "number"],
        ["order", "desc"],
        ["page", String(page)],
        ["limit", String(CHAPTER_PAGE_SIZE)],
      ]),
    );
  }

  fetchVolumes(hid: string): Promise<ApiList<VolumeItem>> {
    return this.get<ApiList<VolumeItem>>(this.url(`/titles/${hid}/volumes`));
  }

  fetchPages(chapterId: string): Promise<PagesResponse> {
    return this.get<PagesResponse>(this.url(`/chapters/${chapterId}`));
  }

  fetchVolumePages(volumeId: string): Promise<PagesResponse> {
    return this.get<PagesResponse>(this.url(`/volumes/${volumeId}`));
  }

  /** Names are searched as tags; an author filter has to become an id before it is used. */
  fetchTags(keyword: string): Promise<TagsResponse> {
    return this.get<TagsResponse>(this.url("/tags", [["keyword", keyword]]));
  }
}
