/* SPDX-License-Identifier: GPL-3.0-or-later */

import { BASE_URL, type ChapterPageEdge, type PagesResponse } from "./model.ts";

// A cold Cloudflare challenge in front of the reader measures 15-20 seconds, so the
// budget has to clear that or the page list is abandoned before it ever arrives.
const PAGE_TIMEOUT_SECONDS = 40;
const POLL_INTERVAL_MS = 400;
const NAVIGATION_ATTEMPTS = 3;

/**
 * Claims `JSON.parse` and `Response.json` and parks the first body that carries a page
 * list. Installed after the series page has loaded but before the chapter is asked for,
 * which is the only ordering that matters.
 */
const INSTALL_HOOK = `(function () {
  if (window.__mkissaHooked) return true;
  window.__mkissaHooked = true;
  window.__mkissaPages = "";

  function capture(parsed, raw) {
    try {
      if (!window.__mkissaPages && parsed && (parsed.chapterPages || (parsed.data && parsed.data.chapterPages))) {
        window.__mkissaPages = typeof raw === "string" ? raw : JSON.stringify(parsed);
      }
    } catch (error) {}
  }

  var parse = JSON.parse;
  JSON.parse = new Proxy(parse, {
    apply: function (target, self, args) {
      var result = Reflect.apply(target, self, args);
      capture(result, args[0]);
      return result;
    },
  });

  var json = Response.prototype.json;
  Response.prototype.json = function () {
    return json.call(this).then(function (data) {
      capture(data, undefined);
      return data;
    });
  };

  // An iframe would hand the page a clean realm with an unhooked JSON.parse.
  function deny(element) {
    if (element && element.tagName && element.tagName.toUpperCase() === "IFRAME") {
      try {
        Object.defineProperty(element, "contentWindow", {
          get: function () { return null; },
          configurable: false,
        });
      } catch (error) {}
    }
    return element;
  }

  ["createElement", "createElementNS"].forEach(function (name) {
    var original = Document.prototype[name];
    Document.prototype[name] = function () {
      return deny(original.apply(this, arguments));
    };
  });

  return true;
})();`;

/** Routes to the chapter within the page rather than reloading, which would drop the hook. */
const NAVIGATE = `(function () {
  var path = args[0];
  var link = document.createElement("a");
  link.href = path;
  link.dataset.href = path;
  document.body.appendChild(link);
  link.click();
  return true;
})();`;

const READ_CAPTURED = `window.__mkissaPages || "";`;

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
 * Reads a chapter's page list out of the site's own reader.
 *
 * The list is only ever delivered to the page's JavaScript, so it is taken where it lands
 * rather than requested: load the series, hook the parser, then route to the chapter.
 */
export async function fetchPagesFromReader(
  seriesId: string,
  chapterId: string,
): Promise<PagesResponse | undefined> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) return undefined;

  const page = await factory.create({ timeout: PAGE_TIMEOUT_SECONDS });

  try {
    await page.goto(`${BASE_URL}/manga/${seriesId}`, { waitUntil: "load" });
    await page.evaluateScript(INSTALL_HOOK);

    const path = `/manga/${encodeURIComponent(seriesId)}/chapter-${encodeURIComponent(chapterId)}-sub`;
    const deadline = Date.now() + PAGE_TIMEOUT_SECONDS * 1000;
    let attempts = 0;

    while (Date.now() < deadline) {
      // The router may not be listening yet on the first click, so it is offered again
      // while nothing has been captured.
      if (attempts < NAVIGATION_ATTEMPTS) {
        attempts++;
        await page.evaluateScript(NAVIGATE, [path]).catch(() => undefined);
      }

      await delay(POLL_INTERVAL_MS);

      const captured = await page.evaluateScript<string>(READ_CAPTURED).catch(() => "");
      if (captured) return parsePayload(captured);
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    await page.close().catch(() => undefined);
  }
}
