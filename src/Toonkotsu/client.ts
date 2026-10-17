/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  Body,
  CloudflareError,
  HttpClient,
  type HttpResponse,
  type JsonValue,
} from "@mana-app/types";

import { challengedUrl, isCloudflareChallenge, withDefaults } from "../common/index.ts";
import { BASE_URL, type CatalogueParams, type ReaderResult, type SiteFailure } from "./model.ts";

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

/** What asking for a chapter's keys directly came to: its body, a refusal, or neither. */
export type ChapterAnswer = { body?: unknown; refused?: ReaderResult };

export class ToonkotsuApi {
  private client: HttpClient | undefined;
  // A refresh fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): HttpClient {
    this.client ??= new HttpClient()
      .setRateLimit(5, 1000)
      .addRequestInterceptor((request) => {
        withDefaults(request.headers, { origin: BASE_URL, referer: `${BASE_URL}/` });
        return request;
      })
      .addResponseInterceptor((response) => {
        // The API answers in JSON and cannot draw the interstitial, so the challenge points
        // at the site itself; the clearance it mints covers the whole domain.
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, BASE_URL));
        }
        return response;
      });
    return this.client;
  }

  /** A GET whose status is handed back, for the endpoints that answer with one. */
  async get(url: string, headers: Record<string, string> = {}): Promise<ApiResult> {
    const response = await this.http.get(url, {
      headers: { accept: "application/json", ...headers },
    });
    return { status: response.status, body: await parse(response, url) };
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
  async post<T>(url: string, body: JsonValue): Promise<T> {
    return this.share(`POST ${url} ${JSON.stringify(body)}`, async () => {
      const response = await this.http.post(url, Body.json(body), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Toonkotsu rejected the request (HTTP ${response.status}): ${url}`);
      }
      return (await parse(response, url)) as T;
    });
  }

  /**
   * A chapter's page list and keys, asked for without the site's loader.
   *
   * The site serves them to an unsigned request, unmasked, so no document is needed at all
   * unless it refuses — and then only the refusal it words as a request for a signature is
   * worth taking to the loader.
   */
  async chapter(id: number): Promise<ChapterAnswer> {
    const url = `${BASE_URL}/api/manga/chapter/${id}`;
    let answer = await this.get(url);

    // The reader refuses a visitor with no guest session, which this call alone hands out.
    if (answer.status === 401 || answer.status === 403) {
      await this.get(`${BASE_URL}/api/auth/me`).catch(() => undefined);
      answer = await this.get(url);
    }

    if (answer.status === 429) {
      const data = (answer.body as SiteFailure["data"]) ?? undefined;
      // A human check or a wait stands whichever way the chapter is asked for, so asking the
      // loader the same thing again only costs another page.
      if (data?.code === "manga-limit" && !data.resign) {
        return { refused: { gate: data.reason || "verify", retryAfter: data.retryAfterSec } };
      }
      return {};
    }
    if (answer.status < 200 || answer.status >= 300) return {};

    const body = answer.body as { wrap?: string } | undefined;
    // Masked keys are unmasked with the signing key, which only the site's loader holds.
    if (!body || body.wrap) return {};
    return { body };
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

async function parse(response: HttpResponse, url: string): Promise<unknown> {
  const body = await response.text();
  if (!body) return undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    // A refusal is often served as the site's own error page, and its status says more
    // about what happened than the markup does.
    if (!response.ok) return undefined;
    throw new Error(`Toonkotsu returned a response that was not JSON: ${url}`);
  }
}
