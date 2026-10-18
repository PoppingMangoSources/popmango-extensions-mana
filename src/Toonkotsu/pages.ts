/* SPDX-License-Identifier: GPL-3.0-or-later */

import { HttpClient, RequestOrigin, type ChapterPage, type HttpResponse } from "@mana-app/types";

import {
  base64BodyToBytes,
  base64ToBytes,
  bytesToBase64,
  resolveUrl,
  withDefaults,
} from "../common/index.ts";
import { decryptPage } from "./crypto.ts";
import { BASE_URL, type SitePage } from "./model.ts";

type PageKeys = { key: Uint8Array; nonce: Uint8Array };

/** The longest array of objects carrying a `src`, wherever in the answer the site put it. */
export function pagesIn(body: unknown): SitePage[] {
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
  return found;
}

/**
 * A page as the reader is handed it, with its keys carried in the fragment.
 *
 * The fragment never reaches the server, and it travels wherever the page URL does — into a
 * download that is fetched long after the chapter's own answer is gone.
 */
export function chapterPage(page: SitePage): ChapterPage | undefined {
  if (!page.src) return undefined;
  const url = withoutFragment(resolveUrl(page.src, BASE_URL));
  if (page.k == null && page.n == null) return { url };
  if (!page.k || !page.n) throw new Error("Toonkotsu sent incomplete page encryption metadata.");
  const key = base64ToBytes(page.k, true);
  const nonce = base64ToBytes(page.n, true);
  if (![16, 24, 32].includes(key.length) || nonce.length < 8) {
    throw new Error("Toonkotsu sent invalid page encryption metadata.");
  }

  const keyed = `${url}#k=${encodeURIComponent(page.k)}&n=${encodeURIComponent(page.n)}`;
  remember(url, keyed);
  return { url: keyed };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/**
 * The keyed URL of each page handed out this session, by its bare URL.
 *
 * For a host that drops the fragment on the way back to the transport: the keys are then
 * found here instead, for as long as this runtime lives.
 */
const remembered = new Map<string, string>();
const REMEMBERED = 2000;

function remember(url: string, withKeys: string): void {
  remembered.delete(url);
  remembered.set(url, withKeys);
  if (remembered.size > REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
}

function keysOf(url: string): PageKeys | undefined {
  const hash = url.indexOf("#");
  if (hash < 0) return undefined;

  const fields = new Map<string, string>();
  for (const pair of url.slice(hash + 1).split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) fields.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
  }
  const k = fields.get("k");
  const n = fields.get("n");
  if (!k || !n) return undefined;

  // The site counts blocks in the low eight bytes of the counter and keeps its nonce in the
  // high eight.
  return { key: base64ToBytes(k), nonce: base64ToBytes(n).subarray(0, 8) };
}

/** Decrypted pages arrive as the site's own file, which says what it is in its first bytes. */
function imageType(bytes: Uint8Array): string | undefined {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) return "image/webp";
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) return "image/avif";
  return undefined;
}

function withReferer(client: HttpClient): HttpClient {
  return client.addRequestInterceptor((request) => {
    withDefaults(request.headers, { referer: `${BASE_URL}/` });
    return request;
  });
}

let images: HttpClient | undefined;

/** Covers and unencrypted pages, which only need the site to be named as their referrer. */
export function imageClient(): HttpClient {
  images ??= withReferer(new HttpClient());
  return images;
}

/**
 * The client for one encrypted page, which decrypts it as it arrives.
 *
 * One per page because the keys are the page's own and the request interceptors never see
 * them: the fragment that carries them is gone before the request is built. Each page is
 * decrypted only when the reader asks for it, so opening a chapter waits on one page rather
 * than all of them.
 */
export function pageClient(url: string): HttpClient {
  const keys = keysOf(url) ?? keysOf(remembered.get(withoutFragment(url)) ?? "");
  if (!keys) return imageClient();

  return withReferer(new HttpClient()).addResponseInterceptor(async (response, context) => {
    if (context.origin !== RequestOrigin.Page || !response.ok) return response;
    // Read as base64 and decoded here: `bytes()` decodes by searching the alphabet for every
    // character, which is most of a page's time on a device with no JIT.
    //
    // Done in one piece, as soon as the page arrives. Pacing it in slices behind a queue was
    // tried and measured on a device: the runtime's timers are slow enough there that pages
    // took seconds each and the reader cancelled them before they were done.
    const image = await decryptPage(
      base64BodyToBytes(await response.base64()),
      keys.key,
      keys.nonce,
    );
    return handOver(response.withBody(image, { contentType: imageType(image) }), image);
  });
}

/** `BodyReader.Base64`, which the types package does not export. */
const BASE64_READER = 1;

/**
 * Gives a rewritten response its base64 up front.
 *
 * The host takes a rewritten body back as base64, and the runtime builds that string by
 * appending to it four characters at a time — close to half a second a page without a JIT,
 * against a few tens of milliseconds here. The response's own cache of what it has been read
 * as is where the export looks first, so the string is left there. A runtime shaped
 * differently simply encodes it itself, as it would have anyway.
 */
function handOver(response: HttpResponse, image: Uint8Array): HttpResponse {
  const storage = (response as unknown as { storage?: { reads?: unknown } }).storage;
  if (storage?.reads instanceof Map) {
    storage.reads.set(BASE64_READER, Promise.resolve(bytesToBase64(image)));
  }
  return response;
}
