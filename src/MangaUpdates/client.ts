/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { withQuery, type QueryParams } from "../common/index.ts";
import { API_URL, MUTATION_INTERVAL_MS } from "./model.ts";
import { readToken } from "./session.ts";

type Method = "GET" | "POST" | "PUT" | "DELETE";

type CallOptions = {
  query?: QueryParams;
  body?: unknown;
  /** Reads that work signed out; anything else is refused before it leaves the device. */
  anonymous?: boolean;
  /** Signing in: a stale session must not travel alongside the credentials replacing it. */
  withoutSession?: boolean;
  /** A write, which the site rate limits far harder than reads. */
  mutation?: boolean;
  /**
   * What a body-less answer to this call means. The host reads a response before the
   * source is shown its status and fails the whole call when there is nothing to read,
   * so where the site answers with an empty body the meaning has to be named here:
   * "absent" for the 404 that says nothing is there, "refused" for the 401 that says
   * the credentials were not accepted.
   */
  emptyMeans?: "absent" | "refused";
};

/**
 * How the host reports a response it could not read.
 *
 * A status validator does not help: the body is deserialised before any status reaches
 * the source, so a body-less 404 fails here rather than arriving as a 404.
 */
const UNREADABLE = /could not be serialized|nil or zero length/i;

/** Read off the value rather than an `Error` shape: what the host throws is its own. */
function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : "";
}

/** The site's answer to a write sent inside its five-second window. */
class ThrottledError extends Error {
  constructor() {
    super("MangaUpdates is spacing out writes; try again in a moment.");
  }
}

/** The site answers a missing list entry with 404, which is an answer rather than a fault. */
export class NotFoundError extends Error {}

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
  private client: NetworkClient | undefined;

  // Writes are chained rather than fired together: the site allows one every five
  // seconds, and a rejected write silently loses the reader's progress.
  private mutations: Promise<unknown> = Promise.resolve();
  private lastMutationAt = 0;

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(5, 1)
      // The site answers 401, 404 and 412 with no body at all, and the host cannot
      // deserialise an empty response — it fails the whole request with "input data was
      // nil or zero length" before the source sees a status. So only the statuses that
      // come with a body are accepted, and the rest are read back off the error instead.
      .setStatusValidator((status) => (status >= 200 && status < 400) || status === 400)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: { accept: "application/json", ...request.headers },
      }))
      .build();
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
    if (options.body !== undefined) headers["content-type"] = "application/json";

    const response = await this.http
      .request({
        url,
        method,
        headers,
        // The host serialises the body; pre-encoding it sends the server a quoted string.
        ...(options.body === undefined ? {} : { body: options.body }),
      })
      .catch((error: unknown) => {
        // A refused status arrives as an error carrying the response it refused, which is
        // how the bodiless answers above still reach `parse`. Anything with no response
        // behind it is a real transport failure and stays one.
        if (error instanceof NetworkError && typeof error.res?.status === "number") {
          return error.res;
        }
        // An unreadable answer to one of those reads carries the meaning the 404 behind it
        // could not: the title is on none of the reader's lists, or carries no rating.
        if (options.emptyMeans && UNREADABLE.test(messageOf(error))) {
          if (options.emptyMeans === "refused") throw new UnauthorizedError();
          throw new NotFoundError(`MangaUpdates has nothing at ${url}`);
        }
        throw error;
      });

    return this.parse<T>(response, url);
  }

  private parse<T>(response: NetworkResponse, url: string): T {
    // Only 401 means the session is the problem. A 403 is the site — or something between
    // it and the reader — refusing the request, and calling that "sign in" misdirects.
    // A 404 is an answer: the title is simply not on any of the reader's lists.
    if (response.status === 401) throw new UnauthorizedError();
    if (response.status === 404) throw new NotFoundError(`MangaUpdates has nothing at ${url}`);
    if (response.status === 412) throw new ThrottledError();

    if (response.status >= 400) {
      throw new Error(`${reason(response.data)} (HTTP ${response.status})`);
    }

    // A few writes answer 200 with an empty body rather than a JSON envelope.
    const body = (response.data ?? "").trim();
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
