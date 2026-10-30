/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  Cipher,
  HttpClient,
  RequestOrigin,
  type ChapterPage,
  type CipherSpec,
} from "@mana-app/types";

import { base64ToBytes, resolveUrl } from "../common/index.ts";
import { BASE_URL, READER_TIMEOUT, type SitePage } from "./model.ts";

/**
 * The chapter's pages: `chapter.pages`, where the site puts them.
 *
 * Only an answer without that list is searched, for the longest array of objects whose `src`
 * is a path. The answer carries other arrays with a `src` — `sources` names the groups, each
 * with a short id of its own — and a chapter with no more pages than it has groups would
 * otherwise be read as its group list.
 */
export function pagesIn(body: unknown): SitePage[] {
  const listed = (body as { chapter?: { pages?: unknown } } | null)?.chapter?.pages;
  if (Array.isArray(listed)) return listed as SitePage[];

  let found: SitePage[] = [];
  const pending: unknown[] = [body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== "object" || node === null) continue;
    if (Array.isArray(node)) {
      const first = node[0] as SitePage | undefined;
      if (first && typeof first === "object" && typeof first.src === "string") {
        if (first.src.includes("/") && node.length > found.length) found = node as SitePage[];
        continue;
      }
    }
    for (const value of Object.values(node)) pending.push(value);
  }
  return found;
}

/**
 * A page as the reader is handed it, with its keys carried in the fragment.
 *
 * The fragment never reaches the server, and it travels wherever the page URL does — into a
 * download that is fetched long after the chapter's own answer is gone. The runtime hands it
 * back to the page client as `request.fragmentParams`.
 */
export function chapterPage(page: SitePage): ChapterPage | undefined {
  if (!page.src) return undefined;
  const url = resolveUrl(page.src, BASE_URL).split("#")[0]!;
  if (page.k == null && page.n == null) return { url };

  const keys = { k: page.k ?? "", n: page.n ?? "" };
  // Checked once here, so a chapter with bad keys fails when it opens rather than page by page.
  if (!pageCipher(keys)) throw new Error("Toonkotsu sent invalid page encryption metadata.");
  return { url: `${url}#k=${encodeURIComponent(keys.k)}&n=${encodeURIComponent(keys.n)}` };
}

/** The cipher for a page whose URL carried valid keys, or undefined. */
function pageCipher({ k, n }: Readonly<Record<string, string>>): CipherSpec | undefined {
  if (!k || !n) return undefined;
  try {
    const nonce = base64ToBytes(n, true);
    if (nonce.length < 8) return undefined;
    // The site counts blocks in the low eight bytes of the counter and keeps its nonce in the
    // high eight.
    const counter = new Uint8Array(16);
    counter.set(nonce.subarray(0, 8));
    return Cipher.aesCtr({ key: base64ToBytes(k, true), counter, length: 64 });
  } catch {
    // Malformed Base64, or a key of the wrong length.
    return undefined;
  }
}

let covers: HttpClient | undefined;
let pages: HttpClient | undefined;

/** Covers come from the site's own CDN unencrypted and only need its referer. */
export function coverClient(): HttpClient {
  covers ??= new HttpClient().addHeader("Referer", `${BASE_URL}/`);
  return covers;
}

/**
 * Each page's keys arrive in its URL fragment; the host decrypts the body natively.
 */
export function pageClient(): HttpClient {
  pages ??= new HttpClient()
    .setTimeoutMs(READER_TIMEOUT * 1000)
    .addHeader("Referer", `${BASE_URL}/`)
    .addResponseInterceptor(async (response, context) => {
      if (context.origin !== RequestOrigin.Page || !response.ok) return response;
      const cipher = pageCipher(response.request.fragmentParams);
      return cipher ? response.decrypt(cipher) : response;
    });
  return pages;
}
