/* SPDX-License-Identifier: GPL-3.0-or-later */

import { buildClient, withChallengeRetry, withQuery } from "../common/index.ts";
import { BASE_URL, DIRECTORY_PATH, PAGE_CACHE_MS } from "./model.ts";

export type BrowseQuery = {
  page: number;
  search?: string | undefined;
  sort?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  genres?: { included: string[]; excluded: string[] };
};

export class RokariComicsApi {
  private client: NetworkClient | undefined;
  private readonly inFlight = new Map<string, Promise<string>>();

  /**
   * Pages already read, held briefly.
   *
   * A title's page answers both its details and its chapter list, and the app asks for
   * those as two separate calls — so without this the same document is fetched twice for
   * every title opened.
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

  private get(url: string): Promise<string> {
    const cached = this.pages.get(url);
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return Promise.resolve(cached.body);

    const running = this.inFlight.get(url);
    if (running) return running;

    const request = withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.get(url);
      if (response.status >= 500) {
        throw new Error(
          `RokariComics' server did not answer (HTTP ${response.status}). The site is up but its origin is not responding — try again in a few minutes.`,
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

  fetchHome(): Promise<string> {
    return this.get(`${BASE_URL}/`);
  }

  /** A title's own page, which is where both its details and its chapter list live. */
  fetchTitle(contentId: string): Promise<string> {
    return this.get(`${BASE_URL}/${DIRECTORY_PATH}/${contentId.replace(/^\/+|\/+$/g, "")}/`);
  }

  /** A chapter is an ordinary post, so its id is the path the listing linked to. */
  fetchChapter(chapterId: string): Promise<string> {
    return this.get(`${BASE_URL}/${chapterId.replace(/^\/+|\/+$/g, "")}/`);
  }

  /** The directory page, which carries the theme's filter dropdowns as well as its rows. */
  fetchDirectory(): Promise<string> {
    return this.get(`${BASE_URL}/${DIRECTORY_PATH}/`);
  }

  fetchBrowse(query: BrowseQuery): Promise<string> {
    const genres = [
      ...(query.genres?.included ?? []),
      // The theme excludes a genre by the same parameter with a minus in front of it.
      ...(query.genres?.excluded ?? []).map((genre) => `-${genre}`),
    ];

    const filtered =
      genres.length > 0 || Boolean(query.status) || Boolean(query.type) || Boolean(query.sort);

    // Words on their own go to WordPress's own search, which the theme answers with the
    // same cards; a filtered search has to go through the directory, where the facets are
    // understood. Neither one is the site root: an empty `?s=` there is just the front
    // page, whose Latest box would then be read back as a page of results.
    if (query.search && !filtered) {
      const path = query.page > 1 ? `${BASE_URL}/page/${query.page}/` : `${BASE_URL}/`;
      return this.get(withQuery(path, { s: query.search }));
    }

    return this.get(
      withQuery(`${BASE_URL}/${DIRECTORY_PATH}/`, {
        ...(query.page > 1 ? { page: query.page } : {}),
        s: query.search,
        status: query.status,
        type: query.type,
        order: query.sort,
        "genre[]": genres,
      }),
    );
  }
}
