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
  // A refresh fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(5, 1)
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
