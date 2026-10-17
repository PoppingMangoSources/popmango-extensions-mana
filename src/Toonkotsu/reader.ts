/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { BrowserScope, ReaderResult, SiteFailure, SiteModule } from "./model.ts";

/**
 * Asks for one chapter inside a document on the site's origin, and hands back its answer.
 *
 * Only the keys come back from here: each page is fetched and decrypted by the source's own
 * page transport when the reader reaches it, rather than the whole chapter up front.
 *
 * Runs inside the browser through `evaluate`, so nothing outside this body is in scope.
 */
export async function readChapterInPage(chapterId: number, hint: string): Promise<ReaderResult> {
  const scope = globalThis as unknown as BrowserScope;
  const json = { credentials: "same-origin", headers: { accept: "application/json" } };

  // The site serves a chapter's page keys to an unsigned request, unmasked — and this document
  // runs none of the site's own code, so nothing here signs a request on our behalf either. That
  // makes the site's loader, and finding it, the fallback rather than the way in.
  const direct = async (): Promise<{ body?: unknown; refused?: ReaderResult }> => {
    const path = `/api/manga/chapter/${chapterId}`;
    let response = await scope.fetch(path, json);

    // The reader refuses a visitor with no guest session, which this call alone hands out.
    if (response.status === 401 || response.status === 403) {
      await scope.fetch("/api/auth/me", json).catch(() => undefined);
      response = await scope.fetch(path, json);
    }

    if (response.status === 429) {
      let data: SiteFailure["data"];
      try {
        data = JSON.parse(await response.text()) as SiteFailure["data"];
      } catch {
        data = undefined;
      }
      // A human check or a wait stands whichever way the chapter is asked for, so asking the
      // loader the same thing again only costs another page. Being asked for a signature is
      // the one refusal the loader can answer.
      if (data?.code === "manga-limit" && !data.resign) {
        const gate = data.transient ? "transient" : data.reason || "verify";
        return { refused: { gate, retryAfter: data.retryAfterSec } };
      }
      return {};
    }
    if (!response.ok) return {};

    let body: { wrap?: string } | undefined;
    try {
      body = JSON.parse(await response.text()) as { wrap?: string };
    } catch {
      return {};
    }
    // Masked keys are unmasked with the signing key, which only the site's loader holds.
    if (!body || body.wrap) return {};
    return { body };
  };

  const adopt = async (url: string): Promise<SiteModule | undefined> => {
    const loaded = (await import(url)) as Record<string, unknown>;
    for (const value of Object.values(loaded)) {
      if (typeof value !== "object" || value === null) continue;
      if (typeof (value as Partial<SiteModule>).chapter === "function") return value as SiteModule;
    }
    return undefined;
  };

  const throughLoader = async (): Promise<{
    body?: unknown;
    loader?: string;
    result?: ReaderResult;
  }> => {
    let site: SiteModule | undefined;
    let loader = "";
    if (hint) {
      try {
        site = await adopt(hint);
        if (site) loader = hint;
      } catch {
        site = undefined;
      }
    }

    if (!site) {
      const candidates = new Set<string>();
      const links = scope.document.querySelectorAll('link[rel="modulepreload"]');
      for (let i = 0; i < links.length; i++) {
        const href = links[i]?.href;
        if (href) candidates.add(href);
      }
      for (const entry of scope.performance.getEntriesByType("resource"))
        candidates.add(entry.name);

      // Fetch the chunks in parallel on a cache miss; the scan used to wait on each in turn.
      const urls = [...candidates].filter((url) => /\/_app\/immutable\/.+\.js$/.test(url));
      const sources = await Promise.all(
        urls.map((url) =>
          scope.fetch(url).then(
            (response) => response.text(),
            () => "",
          ),
        ),
      );

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url || !sources[i]?.includes("/manga/chapter/")) continue;
        site = await adopt(url);
        if (site) {
          loader = url;
          break;
        }
      }
    }
    if (!site) {
      return {
        result: { error: "the site's chapter loader was not found", missingLoader: true },
      };
    }

    try {
      return { body: await site.chapter(chapterId), loader };
    } catch (error) {
      const failure = (error ?? {}) as SiteFailure;
      if (failure.status === 429 && failure.data?.code === "manga-limit") {
        const gate = failure.data.transient ? "transient" : failure.data.reason || "verify";
        return { result: { gate, retryAfter: failure.data.retryAfterSec } };
      }
      return { result: { error: failure.data?.error || failure.message || String(error) } };
    }
  };

  const asked = await direct().catch((): { body?: unknown; refused?: ReaderResult } => ({}));
  if (asked.refused) return asked.refused;

  let body = asked.body;
  let loader: string | undefined;
  if (body === undefined) {
    const loaded = await throughLoader();
    if (loaded.result) return loaded.result;
    body = loaded.body;
    loader = loaded.loader;
  }

  return { body, loader };
}

/**
 * Waits on the site's own reader to pass its human check, which it often does without a tap.
 *
 * The page's record of its requests shows the unlock being posted without touching the page,
 * which the check's own scripts could notice. Runs inside the browser through `evaluate`.
 */
export function waitForUnlock(timeoutMs: number): Promise<boolean> {
  const scope = globalThis as unknown as {
    performance: { getEntriesByType(type: string): { name: string }[] };
    setTimeout(fn: () => void, ms: number): unknown;
  };
  const started = Date.now();

  return new Promise((resolve) => {
    const poll = (): void => {
      const entries = scope.performance.getEntriesByType("resource");
      if (entries.some((entry) => entry.name.includes("/api/manga/unlock"))) resolve(true);
      else if (Date.now() - started > timeoutMs) resolve(false);
      else scope.setTimeout(poll, 500);
    };
    poll();
  });
}
