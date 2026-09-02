/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { UrlBuilder, withChallengeRetry } from "../common/index.ts";
import {
  BASE_URL,
  BUILD_ID_TTL_MS,
  FALLBACK_BUILD_ID,
  PAYLOAD_TTL_MS,
  type BrowseResponse,
  type HomepageResponse,
} from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

type Cached<T> = { value: Promise<T>; at: number };

export class FlameComicsApi {
  private client: NetworkClient | undefined;

  private buildId: string | undefined;
  private buildIdAt = 0;

  private home: Cached<HomepageResponse> | undefined;
  private browse: Cached<BrowseResponse> | undefined;

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      // 403 and 503 have to reach us, or a challenge cannot be told from a real error.
      .setStatusValidator(
        (status) => (status >= 200 && status < 400) || status === 403 || status === 503,
      )
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: { referer: `${BASE_URL}/`, ...request.headers },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
        return response;
      })
      .build();
    return this.client;
  }

  private async fetchText(url: string): Promise<string> {
    return withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.get(url);
      if (response.status === 403 || response.status === 503) {
        throw new CloudflareError(BASE_URL);
      }
      if (response.status >= 400) {
        throw new Error(`Flame Comics rejected the request (HTTP ${response.status})`);
      }
      return response.data;
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
}
