/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { HTML_ACCEPT, isChallengePage, withChallengeRetry } from "../common/index.ts";
import { apiUrl, baseUrl, type GraphQLResponse } from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

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
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          origin: baseUrl(),
          referer: `${baseUrl()}/`,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // The API host cannot render the interstitial, so the challenge points at the site.
        if (isCloudflareChallenge(response)) throw new CloudflareError(baseUrl());
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
    return this.share(`GET ${url}`, () =>
      withChallengeRetry(baseUrl(), async () => {
        const response = await this.http.get(url, { headers: { accept: HTML_ACCEPT } });
        return this.body(response);
      }),
    );
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
      const response = await this.http.post(apiUrl(), {
        headers: { accept: "application/json", "content-type": "application/json" },
        body: { query, variables },
      });

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

  private body(response: NetworkResponse): string {
    const data = response.data ?? "";

    // A refusal is only a challenge when the interstitial itself comes back; the site
    // answers an ordinary block with the same status and no challenge markup.
    if ((response.status === 403 || response.status === 503) && isChallengePage(data)) {
      throw new CloudflareError(baseUrl());
    }
    if (response.status >= 400) {
      throw new Error(`XCOMIC rejected the request (HTTP ${response.status})`);
    }

    return data;
  }
}
