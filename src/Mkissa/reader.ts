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
 * The browser globals the two functions below use.
 *
 * They do not run here — `page.evaluate` ships them into the loaded page, where a DOM and
 * a `fetch` exist. This source's own runtime is bare V8 and has neither, so they are
 * reached through `globalThis` rather than by pulling the DOM library into the project.
 */
type PageGlobals = {
  document?: {
    title?: string;
    querySelector(selector: string): unknown;
  };
  fetch?: (url: string, init: Record<string, unknown>) => Promise<{ text(): Promise<string> }>;
  _cf_chl_opt?: unknown;
};

/** A cold challenge in front of the site measures 15-20 seconds, so the budget clears that. */
const PAGE_TIMEOUT_SECONDS = 40;

/** How long to keep looking for the site's own scripts before giving up on the page. */
const READY_TIMEOUT_MS = 25_000;

/**
 * Fast enough that a challenge clearing in a few hundred milliseconds is noticed at once.
 * The probe is a `querySelector` against an already-parsed document, so it is cheap.
 */
const POLL_INTERVAL_MS = 250;

/**
 * Whether the loaded page is the site, a challenge, or neither yet.
 *
 * The site's own bundle having loaded is the only positive proof the page is real; markers
 * merely being absent also describes a blank page or one that has not started. A challenge
 * asking for a person will not finish on its own, so it is handed over rather than waited
 * out.
 */
function probeReadiness(): { state: string } {
  const page = globalThis as PageGlobals;
  const document = page.document;
  if (!document) return { state: "waiting" };

  const markers: string[] = [];
  if (/^just a moment/i.test((document.title ?? "").trim())) markers.push("title");
  if (document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]')) markers.push("script");
  if (typeof page._cf_chl_opt !== "undefined") markers.push("options");

  if (document.querySelector('script[src*="/_next/"], script[src*="/static/"], #__next, #root')) {
    return { state: "site" };
  }
  return { state: markers.length > 0 ? "challenge" : "waiting" };
}

/**
 * Runs the site's own page query from inside its own page.
 *
 * This is the whole point of the WebView: the request goes out with the cookies, the
 * origin and the clearance the page already holds, which is what the API answers to. It is
 * one round trip, awaited — nothing is hooked, nothing is clicked, and there is nothing to
 * poll for afterwards.
 */
function runPagesQuery(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const request = (globalThis as PageGlobals).fetch;
  if (!request) return Promise.resolve("");

  return request(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json, text/plain, */*" },
    body: JSON.stringify({ query, variables }),
  }).then((response) => response.text());
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
 * A chapter's page list, asked for as the site's own page would ask for it.
 *
 * The API answers this query only to a caller carrying the site's own cookies and origin,
 * which a source's network client cannot produce — so the query is run inside the WebView
 * instead. Earlier this hooked `JSON.parse` and clicked a link to make the site fetch the
 * list itself; asking directly needs no router, no hook and no polling, and it fails with a
 * reason rather than a timeout.
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
    // The chapter's own page, so a request from it carries a referer the API expects.
    const path = `${BASE_URL}/manga/${encodeURIComponent(seriesId)}/chapter-${encodeURIComponent(chapterId)}-sub`;
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_SECONDS });
    await waitForSite(page);

    const payload = await page.evaluate(runPagesQuery, API_URL, PAGES_QUERY, {
      mangaId: seriesId,
      chapterString: chapterId,
      translationType,
      limit: 1,
      offset: 0,
    });

    return typeof payload === "string" ? parsePayload(payload) : undefined;
  } finally {
    await page.close().catch(() => undefined);
  }
}
