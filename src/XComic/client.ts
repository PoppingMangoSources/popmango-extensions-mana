/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { withChallengeRetry } from "../common/index.ts";
import { API_URL, BASE_URL, type GraphQLResponse } from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

export class XComicApi {
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
          accept: "application/json",
          "content-type": "application/json",
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        // The API host cannot render the interstitial, so the challenge points at the site.
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
        return response;
      })
      .build();
    return this.client;
  }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const key = `${query}|${JSON.stringify(variables)}`;
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const request = this.run<T>(query, variables).finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return request;
  }

  private async run<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    return withChallengeRetry(BASE_URL, async () => {
      const response = await this.http.post(API_URL, { body: { query, variables } });

      if (response.status === 403 || response.status === 503) {
        throw new CloudflareError(BASE_URL);
      }
      if (response.status >= 400) {
        throw new Error(`XComic rejected the request (HTTP ${response.status})`);
      }

      let parsed: GraphQLResponse<T>;
      try {
        parsed = JSON.parse(response.data) as GraphQLResponse<T>;
      } catch {
        throw new Error("XComic returned a response that was not JSON");
      }

      if (parsed.errors?.length) {
        throw new Error(parsed.errors.map((error) => error.message).join("\n"));
      }
      if (!parsed.data) throw new Error("XComic returned no data");

      return parsed.data;
    });
  }
}
