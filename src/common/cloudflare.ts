/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

// The page itself may take a while to answer; the challenge on it is judged separately.
const PAGE_TIMEOUT_SECONDS = 30;
// A cold challenge measures 15-20 seconds. Under that gives up while it is still working,
// which reads as the bypass doing nothing; far over it just delays the manual prompt.
const CHALLENGE_BUDGET_MS = 20_000;
// Fast enough that a challenge which clears in a few hundred milliseconds is noticed at
// once. The probe is a `querySelector` against an already-parsed document, so it is cheap.
const POLL_INTERVAL_MS = 25;

// Two, so a request that raced the clearance cookie being written still gets a turn.
const RETRY_ATTEMPTS = 2;

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
    page = await factory.create({ timeout: PAGE_TIMEOUT_SECONDS });
    // The challenge runs before the document is finished, so waiting on `load` only
    // delays the first probe — and on a challenge page `load` may never arrive at all.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_SECONDS });

    const deadline = Date.now() + CHALLENGE_BUDGET_MS;
    while (Date.now() < deadline) {
      const state = await page.evaluateScript<string>(PROBE, [siteSelector]).catch(() => "waiting");

      if (state === "site") return true;
      // A challenge that has asked for a person will not finish on its own; handing it
      // straight over beats making the reader wait out the whole budget first.
      if (state === "interactive") break;
      await delay(POLL_INTERVAL_MS);
    }
  } catch {
    // A WebView that will not open or navigate is not something a retry here can fix;
    // the reader is handed the challenge instead.
  } finally {
    await page?.close().catch(() => undefined);
  }

  return false;
}

/**
 * Loads the site in the auxiliary WebView and waits for a JavaScript-only challenge to
 * run itself out, which is what mints the clearance cookie.
 *
 * Concurrent callers share one attempt — a home page of nine rows meets the same
 * challenge nine times over and needs only one WebView to answer it. There is no
 * cooldown beyond that: a screen opened after an earlier failure gets its own attempt,
 * because the challenge it met is a new one and may well be the kind that self-solves.
 */
async function passChallenge(url: string, siteSelector = SITE_LOADED): Promise<boolean> {
  if (inFlight) return inFlight;

  const attempt = runAttempt(url, siteSelector);
  inFlight = attempt.finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Runs `request`, and on a challenge clears it before letting the error through.
 *
 * The retry loop is what keeps a solved challenge from stranding the screen that raised
 * it: a clearance minted by the WebView here, by another row, or by the reader answering
 * the app's own prompt all land in the same cookie store, so the request is simply asked
 * again rather than surfacing a failure the reader has to back out of to escape.
 */
export async function withChallengeRetry<T>(
  resolutionUrl: string,
  request: () => Promise<T>,
  siteSelector?: string,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof CloudflareError)) throw error;
      if (attempt >= RETRY_ATTEMPTS) throw error;
      if (!(await passChallenge(resolutionUrl, siteSelector))) throw error;
    }
  }
}
