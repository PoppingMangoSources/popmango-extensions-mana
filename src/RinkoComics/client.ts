/* SPDX-License-Identifier: GPL-3.0-or-later */

import { buildClient, withQuery } from "../common/index.ts";
import { AJAX_PATH, BASE_URL, SortID } from "./model.ts";

export type BrowseQuery = {
  page: number;
  search?: string | undefined;
  sort?: string | undefined;
  genres?: readonly string[] | undefined;
};

/** The envelope the load-more action answers with. */
type AjaxResponse = { success?: boolean; data?: { html?: string | null } | null };

export class RinkoComicsApi {
  private client: NetworkClient | undefined;
  // The four home rows all read the same document; identical calls in flight share one
  // response, so opening the page costs a single request rather than four.
  private readonly inFlight = new Map<string, Promise<string>>();

  private get http(): NetworkClient {
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 3, interval: 1 });
    return this.client;
  }

  private get(url: string): Promise<string> {
    const running = this.inFlight.get(url);
    if (running) return running;

    const request = this.http
      .get(url)
      .then((response) => response.data ?? "")
      .finally(() => {
        if (this.inFlight.get(url) === request) this.inFlight.delete(url);
      });

    this.inFlight.set(url, request);
    return request;
  }

  fetchHome(): Promise<string> {
    return this.get(`${BASE_URL}/`);
  }

  browseUrl(query: BrowseQuery): string {
    // The theme pages by path and keeps everything else in the query string.
    const path = query.page > 1 ? `/comic/page/${query.page}/` : "/comic/";
    const base = withQuery(`${BASE_URL}${path}`, {
      post_type: "comic",
      s: query.search,
      // `newest` is the site's own default, and omitting it keeps the URL honest.
      sort: query.sort === SortID.Newest ? undefined : query.sort,
    });

    const genres = (query.genres ?? []).filter(Boolean);
    if (genres.length === 0) return base;

    // A repeated key is how the theme expresses a multi-select, and `withQuery` writes one
    // value per key, so the repeats are appended here.
    const repeated = genres.map((genre) => `genres%5B%5D=${encodeURIComponent(genre)}`).join("&");
    return `${base}${base.includes("?") ? "&" : "?"}${repeated}`;
  }

  fetchBrowse(query: BrowseQuery): Promise<string> {
    return this.get(this.browseUrl(query));
  }

  /** The genre checkboxes live on the browse page rather than in a form of their own. */
  fetchGenrePage(): Promise<string> {
    return this.get(`${BASE_URL}/comic/`);
  }

  fetchPage(path: string): Promise<string> {
    return this.get(`${BASE_URL}/${path.replace(/^\/+/, "")}`);
  }

  /**
   * One batch of the chapter list past the first.
   *
   * The body is handed over as an object: the host serialises it according to the request's
   * own content type, and pre-encoding it would have the server receive a quoted string
   * where it expects a form.
   */
  async fetchChapterBatch(
    comicId: string,
    nonce: string,
    offset: number,
  ): Promise<string | undefined> {
    const response = await this.http.post(`${BASE_URL}${AJAX_PATH}`, {
      body: {
        action: "load_more_chapters",
        nonce,
        comic_id: comicId,
        offset: String(offset),
      },
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
    });

    let parsed: AjaxResponse;
    try {
      parsed = JSON.parse(response.data ?? "") as AjaxResponse;
    } catch {
      return undefined;
    }

    if (parsed.success !== true) return undefined;
    const html = parsed.data?.html ?? "";
    return html.trim() ? html : undefined;
  }
}
