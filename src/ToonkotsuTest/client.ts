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
import { ReaderSigner } from "./signing.ts";

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
  private signer: Promise<ReaderSigner> | undefined;
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
   * unless it refuses. Signed reads use a cached key first; only a failure there needs the
   * site's loader, which can recover after a change to its signing configuration.
   */
  async chapter(id: number): Promise<ChapterAnswer> {
    const url = `${BASE_URL}/api/manga/chapter/${id}`;
    let answer = await this.get(url);

    // The reader refuses a visitor with no guest session, which this call alone hands out.
    if (answer.status === 401 || answer.status === 403) {
      await this.get(`${BASE_URL}/api/auth/me`).catch(() => undefined);
      answer = await this.get(url);
    }

    const direct = answer.body as { wrap?: string } | undefined;
    if (answer.status >= 200 && answer.status < 300 && direct && !direct.wrap) {
      return { body: answer.body };
    }

    const path = `/api/manga/chapter/${id}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const refused = refusal(answer);
      if (refused) return { refused };
      if (!this.signer) {
        const key = await this.share("reader-key", () => this.get(`${BASE_URL}/api/manga/key`));
        const blocked = refusal(key);
        if (blocked) return { refused: blocked };
        if (key.status < 200 || key.status >= 300) return {};
        this.signer ??= Promise.resolve().then(() => ReaderSigner.from(key.body));
      }
      const pending = this.signer;
      let signer: ReaderSigner;
      try {
        signer = await pending;
      } catch (error) {
        if (this.signer === pending) this.signer = undefined;
        throw error;
      }
      answer = await this.get(url, { "x-sig": signer.header(path) });
      if (answer.status >= 200 && answer.status < 300) {
        return { body: signer.unwrap(answer.body) };
      }
      const limit = answer.body as SiteFailure["data"];
      if (answer.status === 401 || answer.status === 403 || limit?.resign) {
        // Only discard the key this read used; a parallel read may have refreshed it already.
        if (this.signer === pending) this.signer = undefined;
        continue;
      }
      break;
    }
    return { refused: refusal(answer) };
  }

  resetReader(): void {
    this.signer = undefined;
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

function refusal(answer: ApiResult): ReaderResult | undefined {
  if (answer.status !== 429) return undefined;
  const data = answer.body as SiteFailure["data"];
  if (data?.code !== "manga-limit" || data.resign) return undefined;
  return {
    gate: data.transient ? "transient" : data.reason || "verify",
    retryAfter: data.retryAfterSec,
  };
}
