/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import {
  HTML_ACCEPT,
  challengedUrl,
  isChallengePage,
  withChallengeRetry,
} from "../common/index.ts";
import {
  baseUrl,
  mirrorCandidates,
  mirrorOrigin,
  setActiveBaseUrl,
  type GraphQLResponse,
} from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

/**
 * Statuses that mean this host is not serving right now, rather than an answer. Anything
 * the site authored — a 404, a rejected query — says the same thing on every mirror, so
 * only these are worth asking someone else.
 */
const UNAVAILABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

/** The API path, appended to whichever mirror is being tried. */
const API_PATH = "/query/";

export class XCOMICApi {
  private client: NetworkClient | undefined;
  // A refresh fires every row at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      .setStatusValidator(
        (status) => (status >= 200 && status < 400) || status === 403 || status === 503,
      )
      // Read off the request rather than off the active mirror: a request that fell
      // through to another host must not announce itself as coming from the first.
      .addRequestInterceptor(async (request: NetworkRequest) => {
        const origin = mirrorOrigin(request.url) ?? baseUrl();
        return {
          ...request,
          headers: { origin, referer: `${origin}/`, ...request.headers },
        };
      })
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // The API host cannot render the interstitial, so the challenge points at the site.
        // The challenged URL is what the app opens for the reader; Cloudflare answers it
        // with the interstitial, and the clearance it mints covers the whole domain.
        if (isCloudflareChallenge(response)) {
          throw new CloudflareError(challengedUrl(response, baseUrl()));
        }
        return response;
      })
      .build();
    return this.client;
  }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const key = `${baseUrl()}|${query}|${JSON.stringify(variables)}`;
    return this.share(key, () => this.runQuery<T>(query, variables));
  }

  /** The filter taxonomy lives in the search page's markup rather than the API. */
  async page(url: string): Promise<string> {
    const origin = mirrorOrigin(url);
    const path = origin === undefined ? url : url.slice(origin.length);

    return this.share(`GET ${path}`, () =>
      withChallengeRetry(baseUrl(), async () => {
        // A URL that belongs to no mirror is asked for as given; only the site's own pages
        // can be looked for somewhere else.
        const response =
          origin === undefined
            ? await this.http.get(url, { headers: { accept: HTML_ACCEPT } })
            : await this.send(path, (target) =>
                this.http.get(target, { headers: { accept: HTML_ACCEPT } }),
              );
        return this.body(response);
      }),
    );
  }

  /**
   * Runs a request against the mirrors in turn, stopping at the first that serves it, and
   * leaves that host as the active one. A challenge stops the walk: it is the reader's to
   * clear, and every mirror sits behind the same Cloudflare.
   */
  private async send(
    path: string,
    run: (url: string) => Promise<NetworkResponse>,
  ): Promise<NetworkResponse> {
    const candidates = mirrorCandidates();
    let unreachable: unknown;

    for (const [index, origin] of candidates.entries()) {
      const isLast = index === candidates.length - 1;

      try {
        const response = await run(`${origin}${path}`);

        // A refusal is only a challenge when the interstitial itself comes back; the site
        // answers an ordinary block with the same status and no challenge markup.
        if (
          (response.status === 403 || response.status === 503) &&
          isChallengePage(response.data ?? "")
        ) {
          throw new CloudflareError(challengedUrl(response, origin));
        }

        if (!isLast && UNAVAILABLE_STATUSES.has(response.status)) {
          unreachable = new Error(`XCOMIC rejected the request (HTTP ${response.status})`);
          continue;
        }

        setActiveBaseUrl(origin);
        return response;
      } catch (error) {
        if (error instanceof CloudflareError || isLast) throw error;

        // The statuses the client refuses arrive as a throw rather than a response, so the
        // walk has to look inside one: a host that answered 404 has answered, and asking
        // the others only repeats the question three more times.
        const status = error instanceof NetworkError ? error.res?.status : undefined;
        if (status !== undefined && !UNAVAILABLE_STATUSES.has(status)) throw error;

        unreachable = error;
      }
    }

    throw unreachable ?? new Error("XCOMIC answered on none of its mirrors");
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

  private async runQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    return withChallengeRetry(baseUrl(), async () => {
      const response = await this.send(API_PATH, (url) =>
        this.http.post(url, {
          headers: { accept: "application/json", "content-type": "application/json" },
          body: { query, variables },
        }),
      );

      const body = this.body(response);

      let parsed: GraphQLResponse<T>;
      try {
        parsed = JSON.parse(body) as GraphQLResponse<T>;
      } catch {
        throw new Error("XCOMIC returned a response that was not JSON");
      }

      if (parsed.errors?.length) {
        throw new Error(parsed.errors.map((error) => error.message).join("\n"));
      }
      if (!parsed.data) throw new Error("XCOMIC returned no data");

      return parsed.data;
    });
  }

  // A challenge is recognised while the mirrors are being walked, so by the time a
  // response reaches here it is the answer that host meant to give.
  private body(response: NetworkResponse): string {
    if (response.status >= 400) {
      throw new Error(`XCOMIC rejected the request (HTTP ${response.status})`);
    }

    return response.data ?? "";
  }
}
