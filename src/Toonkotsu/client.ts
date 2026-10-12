/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { challengedUrl } from "../common/index.ts";
import { BASE_URL, type CatalogueParams } from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

/** The site skips an empty or false parameter and sends `true` as `1`. */
export function catalogueUrl(path: string, params: CatalogueParams = {}): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "" && value !== false)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value === true ? "1" : String(value))}`,
    )
    .join("&");

  return `${BASE_URL}/${path.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

export type ApiResult = { status: number; body: unknown };

export class ToonkotsuApi {
  private client: NetworkClient | undefined;
  private pageClient: NetworkClient | undefined;
  // A refresh fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(5, 1)
      // The reader answers a read it is throttling with 429 and a body saying how to
      // recover, and a stale signature with 401 or 403. All three have to reach the source
      // or the recovery below never runs.
      .setStatusValidator(
        (status) => (status >= 200 && status < 400) || [401, 403, 429, 503].includes(status),
      )
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // The API answers in JSON and cannot draw the interstitial, so the challenge points
        // at the site itself; the clearance it mints covers the whole domain.
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      })
      .build();
    return this.client;
  }

  /** A GET whose status is handed back, for the endpoints that answer with one. */
  async get(url: string, headers: Record<string, string> = {}): Promise<ApiResult> {
    const response = await this.http.get(url, {
      headers: { accept: "application/json", ...headers },
    });
    return { status: response.status, body: parse(response, url) };
  }

  async json<T>(url: string): Promise<T> {
    return this.share(url, async () => {
      const { status, body } = await this.get(url);
      if (status < 200 || status >= 300) {
        throw new Error(`Toonkotsu rejected the request (HTTP ${status}): ${url}`);
      }
      return body as T;
    });
  }

  /** The discovery rankings are posted as the browse parameters rather than queried. */
  async post<T>(url: string, body: unknown): Promise<T> {
    return this.share(`POST ${url} ${JSON.stringify(body)}`, async () => {
      const response = await this.http.post(url, {
        headers: { accept: "application/json", "content-type": "application/json" },
        body,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Toonkotsu rejected the request (HTTP ${response.status}): ${url}`);
      }
      return parse(response, url) as T;
    });
  }

  /**
   * The client page images are fetched on, which is deliberately not the one above.
   *
   * The API's limit is there to be polite to the API. Pages come off a static CDN and there
   * are dozens of them in a chapter — one ran to sixty-three — so putting them behind the
   * same five-a-second counter spent twelve seconds asleep before a reader saw anything.
   * How many are in flight is bounded by the caller instead, which is what a browser does.
   */
  private get pageHttp(): NetworkClient {
    this.pageClient ??= new NetworkClientBuilder()
      .setStatusValidator((status) => (status >= 200 && status < 400) || status === 429)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: { referer: `${BASE_URL}/`, ...request.headers },
      }))
      .build();
    return this.pageClient;
  }

  /**
   * One page image, base64-encoded rather than decoded as text.
   *
   * An encrypted page is ciphertext, and text decoding would mangle every byte that is not
   * valid UTF-8. `responseEncoding` is what hands the bytes over intact; a host too old to
   * know the field answers text, which the cipher then refuses rather than drawing noise.
   */
  async image(url: string): Promise<string> {
    const response = await this.pageHttp.get(url, {
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8" },
      responseEncoding: "base64",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Toonkotsu would not serve a page image (HTTP ${response.status}): ${url}`);
    }
    return response.data ?? "";
  }

  private share<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const request = run().finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return request;
  }
}

function parse(response: NetworkResponse, url: string): unknown {
  const body = response.data ?? "";
  if (!body) return undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    // A refusal is often served as the site's own error page, and its status says more
    // about what happened than the markup does.
    if (response.status < 200 || response.status >= 300) return undefined;
    throw new Error(`Toonkotsu returned a response that was not JSON: ${url}`);
  }
}
