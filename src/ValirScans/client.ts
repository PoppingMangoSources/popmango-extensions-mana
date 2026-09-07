/* SPDX-License-Identifier: GPL-3.0-or-later */

import { buildClient, withChallengeRetry, withQuery } from "../common/index.ts";
import { BASE_URL, NOVEL_TYPE, PAGE_CACHE_MS, SESSION_PATH } from "./model.ts";

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
  private client: NetworkClient | undefined;
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

  private get http(): NetworkClient {
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
      const body = response.data ?? "";
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

  fetchBrowse(query: BrowseQuery): Promise<string> {
    const facets: [string, { included: string[]; excluded: string[] } | undefined][] = [
      ["genre", query.genres],
      ["tag", query.tags],
      ["type", query.types],
      ["status", query.statuses],
      ["origin", query.origins],
    ];

    const params: Record<string, string | number | readonly string[] | undefined> = {
      page: query.page,
      q: query.search,
      minChapters: query.minChapters,
      maxChapters: query.maxChapters,
    };

    // The site sorts one way and takes the direction separately, and every one of its own
    // menu entries is the descending end of its measure.
    if (query.sort) {
      params["sort"] = query.sort;
      params["order"] = "desc";
    }

    for (const [name, state] of facets) {
      if (state?.included.length) params[name] = state.included;
      // `genre` → `excludeGenre`, which is the spelling the site's own filter posts.
      const excluded = [...(state?.excluded ?? [])];
      // Prose is filtered out here, by the site, rather than by dropping rows afterwards:
      // a page that lost rows would run short of the count the site says it has.
      if (name === "type") excluded.push(NOVEL_TYPE);
      if (excluded.length)
        params[`exclude${name.charAt(0).toUpperCase()}${name.slice(1)}`] = excluded;
    }

    return this.get(withQuery(`${BASE_URL}/series`, params));
  }
}
