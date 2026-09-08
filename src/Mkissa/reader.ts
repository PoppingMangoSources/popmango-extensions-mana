/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

import {
  API_URL,
  BASE_URL,
  PAGES_QUERY,
  type ChapterPageEdge,
  type PagesResponse,
} from "./model.ts";

/**
 * The page's own globals, as the functions below reach them.
 *
 * None of them run here — `evaluate` serialises each one and runs it inside the loaded page,
 * where a DOM and a `fetch` exist. This source's runtime is bare V8 and has neither, so they
 * are reached through a locally declared view of `globalThis` rather than by pulling the DOM
 * library into the project.
 *
 * A serialised function carries nothing from this module with it — not a constant, not a
 * helper — so each one names what it needs in full.
 */
type PageRequest = (
  url: string,
  init: Record<string, unknown>,
) => Promise<{ ok?: boolean; status?: number; text(): Promise<string> }>;

type PageGlobals = {
  document?: {
    title?: string;
    querySelector(selector: string): unknown;
  };
  fetch?: PageRequest;
  _cf_chl_opt?: unknown;
  __mkissaPages?: string;
  __mkissaError?: string;
};

/** A cold challenge in front of the site measures 15-20 seconds, so the budget clears that. */
const PAGE_TIMEOUT_SECONDS = 40;

/** How long to keep looking for the site's own scripts before giving up on the page. */
const READY_TIMEOUT_MS = 25_000;

/** How long to let the request the page makes on our behalf come back. */
const PAGES_TIMEOUT_MS = 20_000;

/**
 * Fast enough that a challenge clearing in a few hundred milliseconds is noticed at once.
 * Each probe is a `querySelector` or a property read, so it is cheap.
 */
const POLL_INTERVAL_MS = 250;

/**
 * Whether the loaded page is the site, a challenge, or neither yet.
 *
 * The site's own bundle having loaded is the only positive proof the page is real; markers
 * merely being absent also describes a blank page or one that has not started. A challenge
 * asking for a person will not finish on its own, so it is handed over rather than waited
 * out.
 *
 * The site is SvelteKit, which starts itself from a dynamic `import()` inside an inline
 * script and so ships no `<script src>` to look for — its preloaded stylesheets and the
 * attribute SvelteKit stamps on `<body>` are what a selector can actually reach. A Next.js
 * probe finds neither and spends the whole budget waiting for a page already on screen.
 */
function probeReadiness(): { state: string } {
  const page = globalThis as PageGlobals;
  const document = page.document;
  if (!document) return { state: "waiting" };

  const markers: string[] = [];
  if (/^just a moment/i.test((document.title ?? "").trim())) markers.push("title");
  if (document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')) markers.push("script");
  if (typeof page._cf_chl_opt !== "undefined") markers.push("options");

  if (
    document.querySelector(
      'link[href*="/_app/immutable/"], body[data-sveltekit-preload-data], script[src*="/_app/immutable/"]',
    )
  ) {
    return { state: "site" };
  }
  return { state: markers.length > 0 ? "challenge" : "waiting" };
}

/**
 * Asks the API for the page list, from inside the site's own page, and parks the answer.
 *
 * This is the whole reason a WebView is opened: the request goes out with the page's origin,
 * which is what the API answers to. It is not awaited here — a promise does not survive the
 * bridge back to the source, so what crosses is a string a later poll reads.
 *
 * Listening for the site's own request instead does not work on this site, whatever a
 * reference built for another app does: its first inline script pins a pristine `JSON.parse`
 * out of an iframe realm and parses through that, expressly so a hook installed later cannot
 * see it — and Mana can only run a function after the page's own scripts, never before them.
 */
function startPagesRequest(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): string {
  const page = globalThis as PageGlobals;
  page.__mkissaPages = "";
  page.__mkissaError = "";

  const request = page.fetch;
  if (!request) {
    page.__mkissaError = "the page has no fetch";
    return "unavailable";
  }

  try {
    request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/plain, */*" },
      body: JSON.stringify({ query: query, variables: variables }),
    })
      .then((response) => {
        const status = response.status ?? 0;
        return response.text().then((text) => {
          if (status >= 400) {
            page.__mkissaError = `the API answered ${status}`;
            return;
          }
          page.__mkissaPages = text;
        });
      })
      .catch((error: unknown) => {
        page.__mkissaError = String(error);
      });
  } catch (error) {
    page.__mkissaError = String(error);
  }

  return "started";
}

/** Reads what the page parked, as the plain strings the bridge can carry back. */
function readResult(): { pages: string; error: string } {
  const page = globalThis as PageGlobals;
  return { pages: page.__mkissaPages ?? "", error: page.__mkissaError ?? "" };
}

function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

function parsePayload(payload: string): PagesResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  const root = parsed as {
    chapterPages?: { edges?: ChapterPageEdge[] } | null;
    data?: { chapterPages?: { edges?: ChapterPageEdge[] } | null } | null;
  };
  const pages = root.chapterPages ?? root.data?.chapterPages;
  return pages?.edges?.length ? { chapterPages: { edges: pages.edges } } : undefined;
}

/**
 * Waits for the site itself to be on screen, and hands a challenge over at once.
 *
 * `goto` resolving is not the signal — it fires when a challenge page loads, which is the
 * start of the wait rather than the end.
 */
async function waitForSite(page: WebViewPageInstance): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const probe = await page.evaluate(probeReadiness).catch(() => undefined);
    if (probe?.state === "site") return;
    // The app's own prompt is what clears this; the source cannot.
    if (probe?.state === "challenge") throw new CloudflareError(BASE_URL);
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("Mkissa did not finish loading in the reader.");
}

/**
 * Polls the page until its request has landed, and reports why when it has not.
 *
 * The page's own words are carried out rather than swallowed: a CORS refusal, a status, a
 * missing `fetch`. A reader that fails should say which of those it was.
 */
async function waitForPages(page: WebViewPageInstance): Promise<string> {
  const deadline = Date.now() + PAGES_TIMEOUT_MS;
  let lastError = "";

  while (Date.now() < deadline) {
    const result = await page.evaluate(readResult);
    if (result.pages) return result.pages;
    if (result.error) lastError = result.error;
    await delay(POLL_INTERVAL_MS);
  }

  if (lastError) throw new Error(`Mkissa refused the page list: ${lastError}`);
  return "";
}

/**
 * A chapter's page list, asked for from inside the site's own page.
 *
 * Every step uses `evaluate` rather than `evaluateScript`. The host hands a script its
 * arguments by declaring `args` in the page's own scope, and that declaration outlives the
 * evaluation — so a second `evaluateScript` on one WebView dies on "Cannot declare a const
 * variable twice: 'args'", and this reader evaluates many times over one page. `evaluate`
 * takes a function and declares nothing beside it.
 */
export async function fetchPagesFromReader(
  seriesId: string,
  chapterId: string,
  translationType: string,
): Promise<PagesResponse | undefined> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) return undefined;

  const page = await factory.create({ timeout: PAGE_TIMEOUT_SECONDS });

  try {
    // The series page, with the query string the site's own links carry. It is the page the
    // site is known to serve in full, and any page on the origin gives the request its origin.
    const seriesPath = `${BASE_URL}/manga/${encodeURIComponent(seriesId)}?fromSearch=1`;
    await page.goto(seriesPath, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_SECONDS });
    await waitForSite(page);

    await page.evaluate(startPagesRequest, API_URL, PAGES_QUERY, {
      mangaId: seriesId,
      chapterString: chapterId,
      translationType,
      limit: 1,
      offset: 0,
    });

    const payload = await waitForPages(page);
    return payload ? parsePayload(payload) : undefined;
  } finally {
    await page.close().catch(() => undefined);
  }
}
