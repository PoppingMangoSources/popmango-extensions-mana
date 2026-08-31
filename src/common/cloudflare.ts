/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

const COOLDOWN_MS = 60_000;
const DEFAULT_TIMEOUT_SECONDS = 12;

/** Shared so a home page of thirteen rows spins one WebView, not thirteen. */
let inFlight: Promise<boolean> | undefined;
let lastAttemptAt = 0;

function host(target: string): {
  WebViewPage?: typeof WebViewPage;
  setTimeout?: (fn: () => void, ms: number) => unknown;
} {
  void target;
  return globalThis as never;
}

/**
 * Loads the site in the auxiliary WebView so a JavaScript-only challenge can
 * run itself out, which is what mints the clearance cookie.
 *
 * Returns false when there is no WebView, when one is already in use for this
 * source, or when the attempt runs out of time — the caller then surfaces the
 * challenge for the reader to solve by hand. A cooldown keeps a site that
 * challenges every request from opening a WebView for each one.
 */
export async function passChallenge(
  url: string,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
): Promise<boolean> {
  if (inFlight) return inFlight;
  if (Date.now() - lastAttemptAt < COOLDOWN_MS) return false;

  const { WebViewPage: factory, setTimeout: timer } = host(url);
  if (!factory || !timer) return false;

  const attempt = (async (): Promise<boolean> => {
    let page: WebViewPageInstance | undefined;
    try {
      page = await factory.create({ timeout: timeoutSeconds });
      const work = page.goto(url, { waitUntil: "load", timeout: timeoutSeconds }).then(() => true);
      const expired = new Promise<boolean>((resolve) => {
        timer(() => resolve(false), timeoutSeconds * 1000);
      });
      return await Promise.race([work, expired]);
    } catch {
      return false;
    } finally {
      lastAttemptAt = Date.now();
      await page?.close().catch(() => undefined);
    }
  })();

  inFlight = attempt.finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Runs `request`, and on a challenge gives the WebView one chance to clear it
 * before letting the error through to the reader.
 */
export async function withChallengeRetry<T>(
  resolutionUrl: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof CloudflareError)) throw error;
    if (!(await passChallenge(resolutionUrl))) throw error;
    return request();
  }
}
