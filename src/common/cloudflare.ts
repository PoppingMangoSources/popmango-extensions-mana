/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

// A cold challenge measures 15-20 seconds. Anything under that gives up while it is
// still working, which reads as the bypass doing nothing at all.
const BUDGET_SECONDS = 40;
const POLL_INTERVAL_MS = 500;
// Long enough that a site challenging everything does not spend the budget per request,
// short enough that the next screen the reader opens still gets an attempt of its own.
const COOLDOWN_MS = 15_000;

/** Most of these sites are Next.js apps, so their own bundle is the proof of a real page. */
const SITE_LOADED = 'script[src*="/_next/"], script[src*="/dist/"], script[src*="/static/"]';

/**
 * Classifies the loaded page as the site itself, a challenge that will need a person, a
 * challenge that may still finish on its own, or a page that has not settled yet.
 *
 * `goto` resolving is not the signal — it fires when the challenge page loads, which is
 * the start of the wait rather than the end.
 */
const PROBE = `(function () {
  var markers = [];
  if (/^just a moment/i.test((document.title || "").trim())) markers.push("title");
  if (document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')) markers.push("script");
  if (typeof globalThis._cf_chl_opt !== "undefined") markers.push("options");

  // These two only appear once the challenge wants a person, so there is nothing to wait for.
  if (document.querySelector('#challenge-error-title, #challenge-error-text, input[name="cf-turnstile-response"], .cf-turnstile, #cf-chl-widget')) {
    return "interactive";
  }

  // The site's own scripts having loaded is the only positive proof the page is real;
  // markers merely being absent also describes a blank or failed page.
  if (document.querySelector(args[0])) return "site";
  return markers.length > 0 ? "challenge" : "waiting";
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

async function runAttempt(url: string, siteSelector: string): Promise<boolean> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) return false;

  let page: WebViewPageInstance | undefined;
  try {
    page = await factory.create({ timeout: BUDGET_SECONDS });
    await page.goto(url, { waitUntil: "load", timeout: BUDGET_SECONDS });

    const deadline = Date.now() + BUDGET_SECONDS * 1000;
    while (Date.now() < deadline) {
      const state = await page.evaluateScript<string>(PROBE, [siteSelector]).catch(() => "waiting");

      if (state === "site") return true;
      // A challenge that has asked for a person will not finish on its own; handing it
      // straight over beats making the reader wait out the whole budget first.
      if (state === "interactive") return false;
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
 * Clears the cooldown, so the next challenge gets a fresh attempt.
 *
 * Called whenever a request succeeds: the clearance the reader just solved by hand — or
 * that a previous attempt won — means the failure the cooldown was throttling is over.
 * Without this, one failed attempt on the home page sent every later screen straight to
 * the manual prompt.
 */
function noteChallengeCleared(): void {
  lastAttemptAt = 0;
}

/**
 * Loads the site in the auxiliary WebView and waits for a JavaScript-only challenge to
 * run itself out, which is what mints the clearance cookie.
 *
 * Returns false when there is no WebView, when the challenge needs a person, or when the
 * attempt runs out of time — the caller then surfaces it for the reader to solve by hand.
 * A cooldown stops a site that challenges everything from spending the budget per request.
 */
async function passChallenge(url: string, siteSelector = SITE_LOADED): Promise<boolean> {
  if (inFlight) return inFlight;
  if (Date.now() - lastAttemptAt < COOLDOWN_MS) return false;

  const attempt = runAttempt(url, siteSelector);
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
  siteSelector?: string,
): Promise<T> {
  try {
    const result = await request();
    noteChallengeCleared();
    return result;
  } catch (error) {
    if (!(error instanceof CloudflareError)) throw error;
    if (!(await passChallenge(resolutionUrl, siteSelector))) throw error;

    const result = await request();
    noteChallengeCleared();
    return result;
  }
}
