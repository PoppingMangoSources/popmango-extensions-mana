/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { withChallengeRetry } from "../common/index.ts";
import { API_URL, BASE_URL, type GraphQLResponse } from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

export class MkissaApi {
  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
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

  /** Runs a GraphQL operation over POST, which needs no signature. */
  async fetchGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    return withChallengeRetry(BASE_URL, () => this.runGraphQL<T>(query, variables));
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
