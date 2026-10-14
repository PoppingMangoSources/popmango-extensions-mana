/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { BrowserScope, ReaderResult, SiteFailure, SiteModule, SitePage } from "./model.ts";

/**
 * Reads one chapter inside a document on the site's origin, and hands back its pages.
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
        return { refused: { gate: data.reason || "verify", retryAfter: data.retryAfterSec } };
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
        return {
          result: { gate: failure.data.reason || "verify", retryAfter: failure.data.retryAfterSec },
        };
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

  let found: SitePage[] = [];
  const pending: unknown[] = [body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== "object" || node === null) continue;
    if (Array.isArray(node)) {
      const first = node[0] as SitePage | undefined;
      if (first && typeof first === "object" && typeof first.src === "string") {
        if (node.length > found.length) found = node as SitePage[];
        continue;
      }
    }
    for (const value of Object.values(node)) pending.push(value);
  }
  if (found.length === 0) return { error: "the chapter response listed no pages" };

  const decode = (value: string): Uint8Array => {
    const text = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = scope.atob(text + "=".repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const encode = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return scope.btoa(binary);
  };

  const pages: { url?: string; raw?: string }[] = Array.from({ length: found.length }, () => ({}));
  let cursor = 0;
  let failure = "";

  const worker = async (): Promise<void> => {
    while (cursor < found.length && !failure) {
      const index = cursor++;
      const page = found[index];
      if (!page?.src) continue;

      const url = new scope.URL(page.src, scope.location.href).href;
      if (!page.k || !page.n) {
        pages[index] = { url };
        continue;
      }

      try {
        const response = await scope.fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const key = await scope.crypto.subtle.importKey(
          "raw",
          decode(page.k),
          { name: "AES-CTR" },
          false,
          ["decrypt"],
        );
        const counter = new Uint8Array(16);
        counter.set(decode(page.n).subarray(0, 8), 0);
        const image = await scope.crypto.subtle.decrypt(
          { name: "AES-CTR", counter, length: 64 },
          key,
          await response.arrayBuffer(),
        );
        pages[index] = { raw: encode(image) };
      } catch (error) {
        failure = `page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failure) return { error: failure };
  return { pages, loader };
}
