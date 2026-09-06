/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { ACCEPT_LANGUAGE, challengedUrl, isChallengePage, withQuery } from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  CONTENT_TYPE,
  PAGE_SIZE,
  SortID,
  type BannerResponse,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type GenreResponse,
  type PopularPeriod,
  type Series,
  type SeriesQuery,
  type SeriesResponse,
} from "./model.ts";

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cloudflare names a challenge in a header of its own, and answers the interstitial with a
 * 403 as readily as a 200. Where neither the header nor the interstitial's markup is
 * present, the body shape decides: everything under `/api` answers JSON, so a refusal that
 * is not JSON was written at the edge rather than by the API.
 *
 * That last test is what keeps the two apart. Treating every 403 as a challenge sends a
 * reader to a page with no puzzle on it when the API simply said no; treating none of them
 * as one leaves a real block with no way to clear it.
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

export class StoneScapeApi {
  private client: NetworkClient | undefined;
  // The home page fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(5, 1)
      // 403 and 503 have to reach us, or a challenge cannot be told from a real error.
      .setStatusValidator(
        (status) => (status >= 200 && status < 400) || status === 403 || status === 503,
      )
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          accept: "application/json, text/plain, */*",
          "accept-language": ACCEPT_LANGUAGE,
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
            ? `StoneScape rejected the request: ${stated} (HTTP ${response.status})`
            : `StoneScape rejected the request (HTTP ${response.status})`,
        );
      }

      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`StoneScape returned a response that was not JSON: ${url}`);
      }
    })().finally(() => {
      if (this.inFlight.get(url) === request) this.inFlight.delete(url);
    });

    this.inFlight.set(url, request);
    return request;
  }

  seriesUrl(query: SeriesQuery): string {
    return withQuery(`${API_URL}/series`, {
      page: query.page,
      limit: query.limit ?? PAGE_SIZE,
      contentType: CONTENT_TYPE,
      genres: query.genres?.length ? query.genres.join(",") : undefined,
      status: query.status,
      search: query.search,
      // `latest` is the site's own default and it rejects nothing by omitting it.
      sort: query.sort === SortID.Latest ? undefined : query.sort,
    });
  }

  fetchSeries(query: SeriesQuery): Promise<SeriesResponse> {
    return this.get<SeriesResponse>(this.seriesUrl(query));
  }

  fetchPopular(period: PopularPeriod, limit: number, page = 1): Promise<SeriesResponse> {
    return this.get<SeriesResponse>(
      withQuery(`${API_URL}/series/popular`, {
        page,
        period,
        contentType: CONTENT_TYPE,
        limit,
      }),
    );
  }

  fetchBanner(): Promise<BannerResponse> {
    return this.get<BannerResponse>(`${API_URL}/banner-config`);
  }

  fetchGenres(): Promise<GenreResponse> {
    return this.get<GenreResponse>(`${API_URL}/genres`);
  }

  fetchSeriesDetails(slug: string): Promise<Series> {
    return this.get<Series>(`${API_URL}/series/by-slug/${encodeURIComponent(slug)}`);
  }

  fetchChapters(slug: string): Promise<ChapterListResponse> {
    return this.get<ChapterListResponse>(
      `${API_URL}/series/by-slug/${encodeURIComponent(slug)}/chapters`,
    );
  }

  fetchChapterPages(chapterId: string): Promise<ChapterPagesResponse> {
    return this.get<ChapterPagesResponse>(
      `${API_URL}/chapters/${encodeURIComponent(chapterId)}/pages`,
    );
  }
}
