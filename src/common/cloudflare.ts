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

// Two, so a request that raced the clearance cookie being written still gets a turn.
const RETRY_ATTEMPTS = 2;

// One WebView may be active per source, so a home page of many rows shares one attempt.
let inFlight: Promise<boolean> | undefined;
let lastFailureAt = 0;

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

      if (state === "site") {
        noteChallengeCleared();
        return true;
      }
      // A challenge that has asked for a person will not finish on its own; handing it
      // straight over beats making the reader wait out the whole budget first.
      if (state === "interactive") break;
      await delay(POLL_INTERVAL_MS);
    }
  } catch {}

  // Only a failure earns the cooldown. Arming it after a win left it standing whenever
  // the retry that followed did not itself succeed, which sent the next screen — the
  // reader, most visibly — straight to the manual prompt with no attempt of its own.
  lastFailureAt = Date.now();
  await page?.close().catch(() => undefined);
  return false;
}

/**
 * Records that the site is answering again — the WebView cleared the challenge, the
 * reader solved the prompt by hand, or it simply lapsed — so the next one to appear gets
 * an attempt of its own instead of waiting out a cooldown earned by an older failure.
 */
function noteChallengeCleared(): void {
  lastFailureAt = 0;
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
  if (Date.now() - lastFailureAt < COOLDOWN_MS) return false;

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
      const result = await request();
      noteChallengeCleared();
      return result;
    } catch (error) {
      if (!(error instanceof CloudflareError)) throw error;
      if (attempt >= RETRY_ATTEMPTS) throw error;
      if (!(await passChallenge(resolutionUrl, siteSelector))) throw error;
    }
  }
}
