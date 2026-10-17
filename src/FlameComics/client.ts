/* SPDX-License-Identifier: GPL-3.0-or-later */

import { CloudflareError, HttpClient } from "@mana-app/types";

import {
  UrlBuilder,
  challengedUrl,
  isCloudflareChallenge,
  withChallengeRetry,
  withDefaults,
} from "../common/index.ts";
import {
  BASE_URL,
  BUILD_ID_TTL_MS,
  FALLBACK_BUILD_ID,
  PAYLOAD_TTL_MS,
  type BrowseResponse,
  type HomepageResponse,
  type SeriesListItem,
} from "./model.ts";

type Cached<T> = { value: Promise<T>; at: number };

export class FlameComicsApi {
  private client: HttpClient | undefined;

  private buildId: string | undefined;
  private buildIdAt = 0;

  private home: Cached<HomepageResponse> | undefined;
  private browse: Cached<BrowseResponse> | undefined;

  private get http(): HttpClient {
    this.client ??= new HttpClient()
      .setRateLimit(3, 1000)
      .addRequestInterceptor((request) => {
        withDefaults(request.headers, { referer: `${BASE_URL}/` });
        return request;
      })
      .addResponseInterceptor((response) => {
        // The challenged URL is what the app opens for the reader; Cloudflare answers it
        // with the interstitial, and the clearance it mints covers the whole domain.
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      });
    return this.client;
  }

  private async fetchText(url: string): Promise<string> {
    return withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.get(url);
      if (response.status === 403 || response.status === 503) {
        throw new CloudflareError(challengedUrl(response, BASE_URL));
      }
      if (response.status >= 400) {
        throw new Error(`Flame Comics rejected the request (HTTP ${response.status})`);
      }
      return response.text();
    });
  }

  /** The build id sits in the homepage's own `__NEXT_DATA__`. */
  private async fetchBuildId(): Promise<string> {
    const now = Date.now();
    if (this.buildId && now - this.buildIdAt < BUILD_ID_TTL_MS) return this.buildId;

    const html = await this.fetchText(`${BASE_URL}/`).catch(() => "");
    this.buildId = /"buildId":"([^"]+)"/.exec(html)?.[1] ?? FALLBACK_BUILD_ID;
    this.buildIdAt = now;
    return this.buildId;
  }

  /**
   * Fetches a `/_next/data/<build id>/…` payload, retrying once with a fresh build id —
   * a redeploy rotates it and every stored id 404s at that moment.
   */
  private async fetchData<T>(segments: string[], query?: Record<string, string>): Promise<T> {
    const attempt = async (buildId: string): Promise<T> => {
      const url = new UrlBuilder(BASE_URL).addPathComponent("_next").addPathComponent("data");
      url.addPathComponent(buildId);
      for (const segment of segments) url.addPathComponent(segment);
      for (const [key, value] of Object.entries(query ?? {})) url.setQueryItem(key, value);

      return JSON.parse(await this.fetchText(url.build())) as T;
    };

    const current = await this.fetchBuildId();
    try {
      return await attempt(current);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;

      this.buildId = undefined;
      const refreshed = await this.fetchBuildId();
      if (refreshed === current) throw error;
      return attempt(refreshed);
    }
  }

  private cached<T>(slot: Cached<T> | undefined, load: () => Promise<T>): Cached<T> {
    if (slot && Date.now() - slot.at < PAYLOAD_TTL_MS) return slot;
    const value = load();
    return { value, at: Date.now() };
  }

  /** One payload carries every home row, so the whole page costs a single request. */
  async fetchHome(): Promise<HomepageResponse> {
    this.home = this.cached(this.home, () =>
      this.fetchData<HomepageResponse>(["index.json"]).catch((error: unknown) => {
        this.home = undefined;
        throw error;
      }),
    );
    return this.home.value;
  }

  /** The site has no search endpoint; browse returns every series and is filtered here. */
  async fetchBrowse(): Promise<BrowseResponse> {
    this.browse = this.cached(this.browse, () =>
      this.fetchData<BrowseResponse>(["browse.json"]).catch((error: unknown) => {
        this.browse = undefined;
        throw error;
      }),
    );
    return this.browse.value;
  }

  async fetchSeries<T>(seriesId: string): Promise<T> {
    return this.fetchData<T>(["series", `${seriesId}.json`], { id: seriesId });
  }

  async fetchChapter<T>(seriesId: string, token: string): Promise<T> {
    return this.fetchData<T>(["series", seriesId, `${token}.json`], { id: seriesId, token });
  }

  /**
   * The recommendations come from a plain API route rather than a page payload, so this one
   * carries no build id and survives a redeploy untouched.
   */
  async fetchSimilar(seriesId: string, limit: number): Promise<SeriesListItem[]> {
    const url = new UrlBuilder(BASE_URL)
      .addPathComponent("api")
      .addPathComponent("similar")
      .setQueryItem("id", seriesId)
      .setQueryItem("type", "series")
      .setQueryItem("limit", limit)
      .build();

    const parsed: unknown = JSON.parse(await this.fetchText(url));
    return Array.isArray(parsed) ? (parsed as SeriesListItem[]) : [];
  }
}
