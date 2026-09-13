/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkResponse } from "@mana-app/types";

import { ACCEPT_LANGUAGE, withQuery, type QueryParams } from "../common/index.ts";
import { API_URL, BASE_URL } from "./model.ts";

/**
 * What the API says went wrong, which is more use than the status on its own.
 *
 * Every error answer carries an `errors` array; the detail is the sentence a person can
 * act on ("Invalid limit") where the title is the class of fault.
 */
function errorMessage(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  const errors = (parsed as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) return undefined;

  const messages = errors
    .map((error) => {
      const entry = error as { detail?: unknown; title?: unknown };
      const detail = typeof entry.detail === "string" ? entry.detail : "";
      const title = typeof entry.title === "string" ? entry.title : "";
      return detail || title;
    })
    .filter(Boolean);

  return messages.length > 0 ? [...new Set(messages)].join("; ") : undefined;
}

export class MangaDexApi {
  private client: NetworkClient | undefined;
  // The home page fires six rows at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      // The API asks for five a second across a client and answers 429 above it. Four
      // leaves room for the cover requests the app makes on its own alongside these.
      .setRateLimit(4, 1)
      // Every status has to reach us: the API writes its reason into the body, and a 404
      // from `/manga/{id}` is an answer rather than a failure.
      .setStatusValidator(() => true)
      .addHeader("accept", "application/json")
      .addHeader("accept-language", ACCEPT_LANGUAGE)
      // No user-agent of our own: the API sits behind Cloudflare, which scores a written
      // one against the connection making the request and refuses the mismatch.
      .addHeader("referer", `${BASE_URL}/`)
      .build();
    return this.client;
  }

  /** A GET against the API, shared with any identical one already in flight. */
  async get<T>(path: string, params?: QueryParams): Promise<T> {
    const url = withQuery(`${API_URL}${path}`, params);
    return this.share(url, () => this.run<T>(url));
  }

  /** The same, for a host the API pointed us at rather than the API itself. */
  async getAbsolute<T>(url: string): Promise<T> {
    return this.share(url, () => this.run<T>(url));
  }

  private async run<T>(url: string): Promise<T> {
    const response: NetworkResponse = await this.http.get(url);
    const body = response.data ?? "";

    if (response.status >= 400) {
      const stated = errorMessage(body);
      throw new Error(
        stated
          ? `MangaDex: ${stated} (HTTP ${response.status})`
          : `MangaDex rejected the request (HTTP ${response.status})`,
      );
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error("MangaDex returned a response that was not JSON");
    }
  }

  private share<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const promise = run().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}
