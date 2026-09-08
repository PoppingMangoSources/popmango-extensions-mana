/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { withChallengeRetry } from "../common/index.ts";
import { API_URL, BASE_URL, type GraphQLResponse } from "./model.ts";

/** The API's own throttle message, which names how long it wants to be left alone. */
const RETRY_AFTER_REGEX = /again in (\d+)\s*second/i;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

export class MkissaApi {
  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      // One a second: the API answers a faster caller with "Too many requests, please try
      // again in N seconds" rather than with data.
      .setRateLimit(1, 1)
      // The API's own error text is more useful than a generic non-2xx throw.
      .setStatusValidator(() => true)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          accept: request.url.startsWith(API_URL)
            ? "application/json, text/plain, */*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          referer: `${BASE_URL}/`,
          origin: BASE_URL,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
        return response;
      })
      .build();
    return this.client;
  }

  /**
   * Runs a GraphQL operation over POST, waiting out the API's own throttle.
   *
   * Under load the API answers "Too many requests, please try again in N seconds" instead of
   * data, and it says how long to wait — so the wait is taken from the message rather than
   * guessed at, and the request is simply asked again.
   */
  async fetchGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    return withChallengeRetry(BASE_URL, async () => {
      let wait = RETRY_DELAY_MS;

      for (let attempt = 0; ; attempt++) {
        try {
          return await this.runGraphQL<T>(query, variables);
        } catch (error) {
          if (attempt >= MAX_RETRIES) throw error;

          const seconds = RETRY_AFTER_REGEX.exec(error instanceof Error ? error.message : "")?.[1];
          if (seconds === undefined) throw error;

          wait = Number(seconds) * 1000;
          await delay(wait);
        }
      }
    });
  }

  private async runGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.http.post(API_URL, {
      body: { query, variables },
      headers: { "content-type": "application/json" },
    });

    if (response.status >= 400) {
      throw new Error(`Mkissa rejected the request (HTTP ${response.status})`);
    }

    let parsed: GraphQLResponse<T>;
    try {
      parsed = JSON.parse(response.data) as GraphQLResponse<T>;
    } catch {
      throw new Error("Mkissa returned a response that was not JSON");
    }

    if (parsed.errors?.length) {
      throw new Error(parsed.errors.map((error) => error.message).join("\n"));
    }
    if (!parsed.data) throw new Error("Mkissa returned no data");

    return parsed.data;
  }
}
