/* SPDX-License-Identifier: GPL-3.0-or-later */

import { HttpClient } from "@mana-app/types";

import { ACCEPT_LANGUAGE, withQuery, type QueryParams } from "../common/index.ts";
import { SignedOutError, accessToken } from "./auth.ts";
import { API_URL, BASE_URL, USER_AGENT } from "./model.ts";

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

class UnauthorizedError extends Error {}

export class MangaDexApi {
  private client: HttpClient | undefined;
  private imageClient: HttpClient | undefined;
  // The home page fires six rows at once; identical calls in flight share one response.
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private get http(): HttpClient {
    this.client ??= new HttpClient()
      // The API asks for five a second across a client and answers 429 above it. Four
      // leaves room for the cover requests the app makes on its own alongside these.
      .setRateLimit(4, 1000)
      .addHeaders({
        accept: "application/json",
        "accept-language": ACCEPT_LANGUAGE,
        "user-agent": USER_AGENT,
        referer: `${BASE_URL}/`,
      });
    return this.client;
  }

  /**
   * Covers and pages, which refuse the app's own user-agent as the API does. Their own
   * client, so the API's limit does not pace a chapter's pages.
   */
  get images(): HttpClient {
    this.imageClient ??= new HttpClient().addHeaders({
      "user-agent": USER_AGENT,
      referer: `${BASE_URL}/`,
    });
    return this.imageClient;
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

  /**
   * A GET on the reader's own account. A token the server has revoked can still look
   * current, so a 401 refreshes once and asks again before calling the reader signed out.
   */
  async getSigned<T>(path: string, params?: QueryParams): Promise<T> {
    const url = withQuery(`${API_URL}${path}`, params);
    return this.share(`signed ${url}`, async () => {
      for (const force of [false, true]) {
        const token = await accessToken(force);
        if (!token) throw new SignedOutError("Sign in to MangaDex to see this.");
        try {
          return await this.run<T>(url, { authorization: `Bearer ${token}` });
        } catch (error) {
          if (!(error instanceof UnauthorizedError) || force) throw error;
        }
      }
      throw new SignedOutError("Sign in to MangaDex to see this.");
    });
  }

  private async run<T>(url: string, headers?: Record<string, string>): Promise<T> {
    // The API writes its reason into the body, and a 404 from `/manga/{id}` is an answer
    // rather than a failure, so every status is read here.
    const response = await this.http.get(url, headers ? { headers } : undefined);
    const body = await response.text();

    if (response.status === 401 && headers) throw new UnauthorizedError();

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
