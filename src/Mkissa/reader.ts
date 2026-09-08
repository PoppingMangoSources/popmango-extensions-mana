/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { WebViewPageInstance } from "@mana-app/types";

import { BASE_URL, type ChapterPageEdge, type PagesResponse } from "./model.ts";

/**
 * The page's own globals, as the functions below reach them.
 *
 * None of them run here — `evaluate` serialises each one and runs it inside the loaded
 * page, where a DOM and a `Response` exist. This source's runtime is bare V8 and has
 * neither, so they are reached through a locally declared view of `globalThis` rather than
 * by pulling the DOM library into the project.
 *
 * A serialised function carries nothing from this module with it, so each one names the
 * stash in full rather than sharing a constant.
 */
type PageLink = {
  href: string;
  dataset: { href: string };
  click(): void;
};

type PageGlobals = {
  document?: {
    title?: string;
    querySelector(selector: string): unknown;
    createElement(tag: string): PageLink;
    body: { appendChild(node: PageLink): void };
  };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  Response?: { prototype: { json(): Promise<unknown> } };
  _cf_chl_opt?: unknown;
  __mkissaPages?: string;
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
 * Asking the API directly and awaiting the answer would be less machinery, but the value
 * has to cross the Mana bridge to be seen here, and a promise does not survive that
 * crossing. So the answer is parked on the page for a later poll to read back as a plain
 * string, which does.
 *
 * Both hooks are installed because either alone can miss: the site pins its own
 * `JSON.parse` through an iframe realm at boot, and reads some responses through
 * `Response.json` instead.
 */
function installHooks(): string {
  const page = globalThis as PageGlobals;
  if (page.__mkissaPages !== undefined) return "already installed";
  page.__mkissaPages = "";

  const keep = (raw: unknown): void => {
    if (!page.__mkissaPages && typeof raw === "string" && raw.length > 0) {
      page.__mkissaPages = raw;
    }
  };

  const carriesPages = (value: unknown): boolean => {
    const body = value as { chapterPages?: unknown; data?: { chapterPages?: unknown } } | null;
    if (!body) return false;
    return Boolean(body.chapterPages) || Boolean(body.data && body.data.chapterPages);
  };

  const response = page.Response;
  if (response) {
    const originalJson = response.prototype.json;
    response.prototype.json = function patchedJson(this: unknown): Promise<unknown> {
      return originalJson.call(this).then((body: unknown) => {
        if (carriesPages(body)) keep(JSON.stringify(body));
        return body;
      });
    };
  }

  const originalParse = JSON.parse;
  JSON.parse = function patchedParse(text: string): unknown {
    const parsed = originalParse(text);
    if (carriesPages(parsed)) keep(typeof text === "string" ? text : JSON.stringify(parsed));
    return parsed;
  } as typeof JSON.parse;

  return "installed";
}

/**
 * Opens the chapter the way a reader would, so the site fetches its own page list.
 *
 * A click on an internal link is what hands the SPA to its router, and the router asks for
 * the list with whatever the site's own request carries. `[data-href]` is the site's mark
 * on its own links, so it appearing means the page has hydrated; the click goes out anyway
 * once that wait is spent, since an un-hydrated page still navigates.
 */
function openChapter(path: string): string {
  const page = globalThis as PageGlobals;
  const document = page.document;
  if (!document) return "no document";

  const click = (): void => {
    const link = document.createElement("a");
    link.href = path;
    link.dataset.href = path;
    document.body.appendChild(link);
    link.click();
  };

  const timer = page.setTimeout;
  if (!timer) {
    click();
    return "opened";
  }

  let attempts = 0;
  const waitForRouter = (): void => {
    if (document.querySelector("[data-href]") || attempts > 120) {
      click();
      return;
    }
    attempts++;
    timer(waitForRouter, 50);
  };
  waitForRouter();

  return "opened";
}

/** Reads the stash as a plain string, which is what the bridge can carry back. */
function readStash(): string {
  return (globalThis as PageGlobals).__mkissaPages ?? "";
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
 * Polls the page for what its own code fetched, until it has it or the budget runs out.
 *
 * A read that throws is not swallowed: the page answering with an error is the whole
 * failure, and hiding it behind an empty string turns a broken reader into a slow one.
 */
async function waitForPages(page: WebViewPageInstance): Promise<string> {
  const deadline = Date.now() + PAGES_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const stash = await page.evaluate(readStash);
    if (typeof stash === "string" && stash.length > 0) return stash;
    await delay(POLL_INTERVAL_MS);
  }

  return "";
}

/**
 * A chapter's page list, taken from the site as the site itself fetches it.
 *
 * The API hands this list to the site's own page and to nothing else, so the page is
 * loaded, the chapter is opened inside it, and what the site fetches on the way is read
 * back out.
 *
 * Every step here uses `evaluate` rather than `evaluateScript`. The host hands a script its
 * arguments by declaring `args` in the page's own scope, and that declaration outlives the
 * evaluation — so a second `evaluateScript` on one WebView dies on "Cannot declare a const
 * variable twice: 'args'", and this reader evaluates several times over one page.
 * `evaluate` takes a function and declares nothing beside it.
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
    await page.evaluate(installHooks);

    const chapterPath = `/manga/${encodeURIComponent(seriesId)}/chapter-${encodeURIComponent(chapterId)}-${translationType}`;
    await page.evaluate(openChapter, chapterPath);

    const payload = await waitForPages(page);
    return payload ? parsePayload(payload) : undefined;
  } finally {
    await page.close().catch(() => undefined);
  }
}
