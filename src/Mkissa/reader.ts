/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

import { BASE_URL, type ChapterPageEdge, type PagesResponse } from "./model.ts";

/**
 * The browser globals `probeReadiness` uses.
 *
 * It does not run here — `evaluate` ships it into the loaded page, where a DOM exists. This
 * source's own runtime is bare V8 and has none, so the page's globals are reached through a
 * locally declared view of `globalThis` rather than by pulling the DOM library in.
 */
type PageGlobals = {
  document?: {
    title?: string;
    querySelector(selector: string): unknown;
  };
  _cf_chl_opt?: unknown;
};

/** A cold challenge in front of the site measures 15-20 seconds, so the budget clears that. */
const PAGE_TIMEOUT_SECONDS = 40;

/** How long to keep looking for the site's own scripts before giving up on the page. */
const READY_TIMEOUT_MS = 25_000;

/** How long to let the site fetch its own page list once the chapter has been opened. */
const PAGES_TIMEOUT_MS = 20_000;

/**
 * Fast enough that a challenge clearing in a few hundred milliseconds is noticed at once.
 * Each probe is a `querySelector` or a property read, so it is cheap.
 */
const POLL_INTERVAL_MS = 250;

/** Where the page leaves what it caught, read back one poll at a time. */
const STASH = "__mkissaPages";

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
 * Listens for the page list on the two paths the site's own code can deliver it by.
 *
 * Asking the API directly and awaiting the answer would be less machinery, but the value has
 * to cross the Mana bridge to be seen here and a pending promise does not survive that
 * crossing. So the answer is left on a global for a later poll to read back as a plain
 * string, which does.
 *
 * Both hooks are installed because either alone can miss: the site pins its own `JSON.parse`
 * through an iframe realm at boot, and reads some responses through `Response.json` instead.
 */
const INSTALL_HOOKS = `(function () {
  var page = globalThis;
  if (page.${STASH} !== undefined) return "already installed";
  page.${STASH} = "";

  var keep = function (raw) {
    if (!page.${STASH} && typeof raw === "string" && raw) page.${STASH} = raw;
  };
  var carriesPages = function (value) {
    return !!value && (!!value.chapterPages || (!!value.data && !!value.data.chapterPages));
  };

  try {
    var originalJson = Response.prototype.json;
    Response.prototype.json = function () {
      return originalJson.call(this).then(function (body) {
        if (carriesPages(body)) keep(JSON.stringify(body));
        return body;
      });
    };
  } catch (jsonHookUnavailable) {}

  try {
    var originalParse = JSON.parse;
    JSON.parse = function (text) {
      var parsed = originalParse.apply(this, arguments);
      if (carriesPages(parsed)) {
        keep(typeof text === "string" ? text : JSON.stringify(parsed));
      }
      return parsed;
    };
  } catch (parseHookUnavailable) {}

  return "installed";
})();`;

/**
 * Opens the chapter the way a reader would, so the site fetches its own page list.
 *
 * A click on an internal link is what hands the SPA to its router, and the router asks for
 * the list with whatever the site's own request carries. `[data-href]` is the site's mark on
 * its own links, so it appearing means the page has hydrated; the click goes out anyway once
 * that wait is spent, since an un-hydrated page still navigates.
 */
const OPEN_CHAPTER = `(function () {
  var path = args[0];

  var click = function () {
    var link = document.createElement("a");
    link.href = path;
    link.dataset.href = path;
    document.body.appendChild(link);
    link.click();
  };

  var attempts = 0;
  var waitForRouter = function () {
    if (document.querySelector("[data-href]") || attempts > 120) {
      click();
      return;
    }
    attempts++;
    setTimeout(waitForRouter, 50);
  };
  waitForRouter();

  return "opened";
})();`;

/** Reads the stash as a plain string, which is what the bridge can carry back. */
const READ_STASH = `(function () { return globalThis.${STASH} || ""; })();`;

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

/** Polls the page for what its own code fetched, until it has it or the budget runs out. */
async function waitForPages(page: WebViewPageInstance): Promise<string> {
  const deadline = Date.now() + PAGES_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const stash = await page.evaluateScript<string>(READ_STASH).catch(() => "");
    if (typeof stash === "string" && stash.length > 0) return stash;
    await delay(POLL_INTERVAL_MS);
  }

  return "";
}

/**
 * A chapter's page list, taken from the site as the site itself fetches it.
 *
 * The API hands this list to the site's own page and to nothing else, so the page is loaded,
 * the chapter is opened inside it, and what the site fetches on the way is read back out.
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
    // site serves in full, and the chapter is one in-app navigation away from it.
    const seriesPath = `${BASE_URL}/manga/${encodeURIComponent(seriesId)}?fromSearch=1`;
    await page.goto(seriesPath, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_SECONDS });
    await waitForSite(page);

    // Hooked before the chapter is opened, or the fetch it triggers goes by unseen.
    await page.evaluateScript(INSTALL_HOOKS);

    const chapterPath = `/manga/${encodeURIComponent(seriesId)}/chapter-${encodeURIComponent(chapterId)}-${translationType}`;
    await page.evaluateScript(OPEN_CHAPTER, [chapterPath]);

    const payload = await waitForPages(page);
    return payload ? parsePayload(payload) : undefined;
  } finally {
    await page.close().catch(() => undefined);
  }
}
