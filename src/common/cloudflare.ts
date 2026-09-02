/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

// A cold challenge measures 15-20 seconds. Anything under that gives up while it is
// still working, which reads as the bypass doing nothing at all.
const BUDGET_SECONDS = 40;
const POLL_INTERVAL_MS = 500;
const COOLDOWN_MS = 60_000;

/**
 * Reports whether the challenge is still on screen, using the markers the app's own
 * handler keys on. `goto` resolving is not the signal — it fires when the challenge
 * page loads, which is the beginning of the wait rather than the end of it.
 */
const PROBE = `(function () {
  if (/^just a moment/i.test((document.title || "").trim())) return "challenge";
  if (document.querySelector(
    '#challenge-error-title, #challenge-error-text, #challenge-running, #challenge-stage,' +
    'input[name="cf-turnstile-response"], .cf-turnstile, #cf-chl-widget'
  )) return "challenge";
  return "clear";
})();`;

// One WebView may be active per source, so a home page of many rows shares one attempt.
let inFlight: Promise<boolean> | undefined;
let lastAttemptAt = 0;

function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

async function runAttempt(url: string): Promise<boolean> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) return false;

  let page: WebViewPageInstance | undefined;
  try {
    page = await factory.create({ timeout: BUDGET_SECONDS });
    await page.goto(url, { waitUntil: "load", timeout: BUDGET_SECONDS });

    const deadline = Date.now() + BUDGET_SECONDS * 1000;
    while (Date.now() < deadline) {
      const state = await page.evaluateScript<string>(PROBE).catch(() => "challenge");
      if (state === "clear") return true;
      await delay(POLL_INTERVAL_MS);
    }

    return false;
  } catch {
    return false;
  } finally {
    lastAttemptAt = Date.now();
    await page?.close().catch(() => undefined);
  }
}

/**
 * Loads the site in the auxiliary WebView and waits for a JavaScript-only challenge to
 * run itself out, which is what mints the clearance cookie.
 *
 * Returns false when there is no WebView, when the challenge needs a person, or when the
 * attempt runs out of time — the caller then surfaces it for the reader to solve by hand.
 * A cooldown stops a site that challenges everything from spending the budget per request.
 */
export async function passChallenge(url: string): Promise<boolean> {
  if (inFlight) return inFlight;
  if (Date.now() - lastAttemptAt < COOLDOWN_MS) return false;

  const attempt = runAttempt(url);
  inFlight = attempt.finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Runs `request`, and on a challenge gives the WebView one chance to clear it before
 * letting the error through to the reader.
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
