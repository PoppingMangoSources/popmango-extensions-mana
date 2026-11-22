/* SPDX-License-Identifier: GPL-3.0-or-later */

import { CloudflareError, HttpClient } from "@mana-app/types";

import { HTML_ACCEPT, isApiChallenge } from "./network.ts";

// Optional metadata may be missing; a challenge must still reach the app's handler.
export function fallbackUnlessCloudflare<T>(error: unknown, fallback: T): T {
  if (error instanceof CloudflareError) throw error;
  return fallback;
}

export function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

/** How long a passed probe is trusted before the next home page asks again. */
const CLEARANCE_TTL_MS = 10 * 60_000;

/**
 * A check, run before the home page hands over its rows, that the site is not asking for a
 * Cloudflare challenge.
 *
 * The app passes a challenge on its own only for calls like `getSectionsForPage`; a row
 * resolved lazily afterwards that meets one is not bypassed, since each row could name a
 * different path, and the reader is left to solve it by hand. Asking the site's front page
 * first surfaces the challenge where the automatic pass runs, and the rows then load on the
 * clearance it wrote.
 *
 * The probe is a plain top-level GET on its own client, as a browser opening the site would
 * send: cookies are shared across clients, so the clearance reaches the source's own. GET
 * rather than HEAD, because the runtime's check of a Cloudflare 403/503 reads the body. Only a
 * challenge is thrown; any other failure is left for the rows to report, and is not
 * remembered as a pass. Concurrent callers share one probe.
 */
export function createClearanceProbe(
  siteUrl: string | (() => string | Promise<string>),
): () => Promise<void> {
  let client: HttpClient | undefined;
  let passed = { url: "", at: 0 };
  let running: { url: string; promise: Promise<void> } | undefined;

  return async () => {
    const url = typeof siteUrl === "string" ? siteUrl : await siteUrl();
    if (passed.url === url && Date.now() - passed.at < CLEARANCE_TTL_MS) return;
    if (running?.url === url) return running.promise;

    const promise = (async () => {
      client ??= new HttpClient();
      try {
        const response = await client.get(url, { headers: { accept: HTML_ACCEPT } });
        if (await isApiChallenge(response)) throw new CloudflareError(url);
        if (response.status >= 200 && response.status < 400) passed = { url, at: Date.now() };
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
      }
    })();
    running = { url, promise };
    try {
      await promise;
    } finally {
      if (running?.promise === promise) running = undefined;
    }
  };
}
