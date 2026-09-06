/* SPDX-License-Identifier: GPL-3.0-or-later */

import { buildClient, withQuery } from "../common/index.ts";
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

export class StoneScapeApi {
  private client: NetworkClient | undefined;
  // The home page fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    // The API answers JSON, so `json` lets the client surface the site's own error text
    // rather than a bare status code.
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 5, interval: 1, json: true });
    return this.client;
  }

  private async get<T>(url: string): Promise<T> {
    const running = this.inFlight.get(url) as Promise<T> | undefined;
    if (running) return running;

    const request = (async () => {
      const response = await this.http.get(url);
      try {
        return JSON.parse(response.data) as T;
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
