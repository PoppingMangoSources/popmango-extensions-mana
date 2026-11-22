/* SPDX-License-Identifier: GPL-3.0-or-later */

import { Body, HttpClient, HttpMethod, type HttpResponse, type JsonValue } from "@mana-app/types";

import { withQuery, type QueryParams } from "../common/index.ts";
import { API_URL, MUTATION_INTERVAL_MS } from "./model.ts";
import { readToken } from "./session.ts";

type Method = "GET" | "POST" | "PUT" | "DELETE";

const METHODS: Record<Method, HttpMethod> = {
  GET: HttpMethod.Get,
  POST: HttpMethod.Post,
  PUT: HttpMethod.Put,
  DELETE: HttpMethod.Delete,
};

type CallOptions = {
  query?: QueryParams;
  body?: JsonValue;
  /** Reads that work signed out; anything else is refused before it leaves the device. */
  anonymous?: boolean;
  /** Signing in: a stale session must not travel alongside the credentials replacing it. */
  withoutSession?: boolean;
  /** A write, which the site rate limits far harder than reads. */
  mutation?: boolean;
};

/** The site's answer to a write sent inside its five-second window. */
class ThrottledError extends Error {
  constructor() {
    super("MangaUpdates is spacing out writes; try again in a moment.");
  }
}

class NotFoundError extends Error {}

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in to MangaUpdates from the source's settings to use tracking.");
  }
}

function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

export class MangaUpdatesApi {
  private client: HttpClient | undefined;

  // Writes are chained rather than fired together: the site allows one every five
  // seconds, and a rejected write silently loses the reader's progress.
  private mutations: Promise<unknown> = Promise.resolve();
  private lastMutationAt = 0;

  private get http(): HttpClient {
    this.client ??= new HttpClient().setRateLimit(5, 1000).addHeader("accept", "application/json");
    return this.client;
  }

  async call<T>(path: string, method: Method, options: CallOptions = {}): Promise<T> {
    if (!options.mutation) return this.run<T>(path, method, options);

    const run = this.mutations.then(async () => {
      const since = Date.now() - this.lastMutationAt;
      if (since < MUTATION_INTERVAL_MS) await delay(MUTATION_INTERVAL_MS - since);

      try {
        return await this.run<T>(path, method, options);
      } catch (error) {
        // 412 is the site saying the five seconds had not elapsed — its clock, not ours,
        // decides that, so the one honest response is to wait it out and send again.
        if (!(error instanceof ThrottledError)) throw error;
        await delay(MUTATION_INTERVAL_MS);
        return await this.run<T>(path, method, options);
      } finally {
        this.lastMutationAt = Date.now();
      }
    });

    // The chain must survive a failed write, or every later one inherits the rejection.
    this.mutations = run.catch(() => undefined);
    return run;
  }

  private async run<T>(path: string, method: Method, options: CallOptions): Promise<T> {
    const token = await readToken();
    if (!token && !options.anonymous) throw new UnauthorizedError();

    const url = withQuery(`${API_URL}${path}`, options.query);
    const headers: Record<string, string> = {};
    if (token && !options.withoutSession) headers.authorization = `Bearer ${token}`;

    const response = await this.http.request(
      {
        url,
        method: METHODS[method],
        ...(options.body === undefined ? {} : { body: Body.json(options.body) }),
      },
      { headers },
    );

    return this.parse<T>(response, url);
  }

  // The site answers 401, 404 and 412 with no body at all, so the status is read before
  // anything is asked of the body.
  private async parse<T>(response: HttpResponse, url: string): Promise<T> {
    // Only 401 means the session is the problem. A 403 is the site — or something between
    // it and the reader — refusing the request, and calling that "sign in" misdirects.
    // A 404 is an answer: the title is simply not on any of the reader's lists.
    if (response.status === 401) throw new UnauthorizedError();
    if (response.status === 404) throw new NotFoundError(`MangaUpdates has nothing at ${url}`);
    if (response.status === 412) throw new ThrottledError();

    if (response.status >= 400) {
      throw new Error(`${reason(await response.text())} (HTTP ${response.status})`);
    }

    // A few writes answer 200 with an empty body rather than a JSON envelope.
    const body = (await response.text()).trim();
    if (!body) return undefined as T;

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`MangaUpdates returned a response that was not JSON (${url})`);
    }
  }
}

function reason(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["reason", "error", "message"]) {
        const value = record[key];
        if (typeof value === "string" && value) return value;
      }
    }
  } catch {}
  return "MangaUpdates rejected the request";
}
