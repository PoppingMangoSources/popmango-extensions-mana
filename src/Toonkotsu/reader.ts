/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { BrowserScope, ReaderResult, SiteFailure, SiteModule, SitePage } from "./model.ts";

export async function readChapterInPage(chapterId: number, hint: string): Promise<ReaderResult> {
  const scope = globalThis as unknown as BrowserScope;

  const adopt = async (url: string): Promise<SiteModule | undefined> => {
    const loaded = (await import(url)) as Record<string, unknown>;
    for (const value of Object.values(loaded)) {
      if (typeof value !== "object" || value === null) continue;
      if (typeof (value as Partial<SiteModule>).chapter === "function") return value as SiteModule;
    }
    return undefined;
  };

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
    for (const entry of scope.performance.getEntriesByType("resource")) candidates.add(entry.name);

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
    return { error: "the site's chapter loader was not found", missingLoader: true };
  }

  let body: unknown;
  try {
    body = await site.chapter(chapterId);
  } catch (error) {
    const failure = (error ?? {}) as SiteFailure;
    if (failure.status === 429 && failure.data?.code === "manga-limit") {
      return { gate: failure.data.reason || "verify", retryAfter: failure.data.retryAfterSec };
    }
    return { error: failure.data?.error || failure.message || String(error) };
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
