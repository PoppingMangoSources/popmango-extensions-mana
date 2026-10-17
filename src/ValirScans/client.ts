/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { HttpClient } from "@mana-app/types";

import { buildClient, withChallengeRetry, withQuery } from "../common/index.ts";
import {
  BASE_URL,
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  ORIGIN_OPTIONS,
  PAGE_CACHE_MS,
  SESSION_PATH,
} from "./model.ts";

export type BrowseQuery = {
  page: number;
  search?: string | undefined;
  sort?: string | undefined;
  genres?: { included: string[]; excluded: string[] };
  tags?: { included: string[]; excluded: string[] };
  types?: { included: string[]; excluded: string[] };
  statuses?: { included: string[]; excluded: string[] };
  origins?: { included: string[]; excluded: string[] };
  minChapters?: string | undefined;
  maxChapters?: string | undefined;
};

export class ValirScansApi {
  private client: HttpClient | undefined;
  private readonly inFlight = new Map<string, Promise<string>>();

  /**
   * Pages already read, held briefly.
   *
   * Sharing a request that is in flight only helps callers that overlap, and the ones here
   * mostly do not: the app asks for a title's details and then, separately, its chapters,
   * and both are cut from the same rendered page. Without this the site is asked for the
   * same document twice over, and a Next.js page carries its whole payload inline.
   */
  private readonly pages = new Map<string, { at: number; body: string }>();

  private get http(): HttpClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 4,
      interval: 1,
      // A 5xx reaches the source so a failing origin can be reported as what it is rather
      // than as a bare "request failed"; 403 and 503 are left to the shared client, which
      // turns those into the challenge the app knows how to answer.
      statusValidator: (status) =>
        (status >= 200 && status < 400) || (status >= 500 && status < 600),
    });
    return this.client;
  }

  private get(url: string, headers?: Record<string, string>): Promise<string> {
    const cached = this.pages.get(url);
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return Promise.resolve(cached.body);

    const running = this.inFlight.get(url);
    if (running) return running;

    const request = withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.get(url, headers === undefined ? undefined : { headers });
      if (response.status >= 500) {
        throw new Error(
          `ValirScans' server did not answer (HTTP ${response.status}). The site is up but its origin is not responding — try again in a few minutes.`,
        );
      }
      const body = await response.text();
      this.pages.set(url, { at: Date.now(), body });
      return body;
    }).finally(() => {
      if (this.inFlight.get(url) === request) this.inFlight.delete(url);
    });

    this.inFlight.set(url, request);
    return request;
  }

  /** Everything read once the account changed was read as somebody else. */
  forgetCachedPages(): void {
    this.pages.clear();
  }

  fetchHome(): Promise<string> {
    return this.get(`${BASE_URL}/`);
  }

  fetchPage(contentId: string, page = 1): Promise<string> {
    const path = `${BASE_URL}/series/${contentId.replace(/^\/+/, "")}`;
    return this.get(page > 1 ? withQuery(path, { page }) : path);
  }

  /**
   * The reader route serves its data as a React flight stream. Asking for it with the
   * `rsc` header returns that stream on its own instead of the whole HTML shell around it.
   */
  fetchChapter(contentId: string, chapterId: string): Promise<string> {
    return this.get(`${BASE_URL}/series/${contentId}/chapter/${chapterId}`, { rsc: "1" });
  }

  fetchSession(): Promise<string> {
    return this.get(`${BASE_URL}${SESSION_PATH}`);
  }

  fetchFacets(): Promise<string> {
    return this.get(`${BASE_URL}/api/series/facets`);
  }

  fetchBrowse(query: BrowseQuery): Promise<string> {
    const params: Record<string, string | number | undefined> = {
      page: query.page,
      limit: 24,
      mode: "comics",
      q: query.search?.trim() || undefined,
      ch_min: query.minChapters,
      ch_max: query.maxChapters,
      ...(query.sort ? { sort: query.sort, order: "desc" } : {}),
    };
    for (const [name, state] of [
      ["genre", query.genres],
      ["tag", query.tags],
    ] as const) {
      if (state?.included.length) params[name] = state.included.join(",");
      if (state?.excluded.length) params[`ex${name}`] = state.excluded.join(",");
    }
    for (const [name, state, options] of [
      ["type", query.types, TYPE_OPTIONS],
      ["status", query.statuses, STATUS_OPTIONS],
      ["origin", query.origins, ORIGIN_OPTIONS],
    ] as const) {
      if (!state?.included.length && !state?.excluded.length) continue;
      const selected = (
        state.included.length ? state.included : options.map((option) => option.id)
      ).filter((id) => !state.excluded.includes(id));
      if (!selected.length) return Promise.resolve('{"data":[],"meta":{"hasMore":false}}');
      params[name] = selected.join(",");
    }
    return this.get(withQuery(`${BASE_URL}/api/series`, params));
  }
}
