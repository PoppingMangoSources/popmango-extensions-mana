/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The reader pipeline.
 *
 * A chapter's image list is an AES-CBC blob whose key, IV and character
 * unscrambling routine all live inside an obfuscated `chapter.js`. Getting to
 * the images means deobfuscating that script, decrypting the blob, undoing the
 * character shuffle, and — for the tiled `cspiclink` images — pulling out the
 * per-image permutation key the reader will hand to Mana's redraw handler.
 */

import { aesCbcDecrypt, base64ToBytes, bytesToUtf8 } from "../common/aes.ts";
import { resolveUrl } from "../common/index.ts";
import { DOMAIN, READER_MIRROR_HOSTS } from "./model.ts";
import { pathOf, readerOrigin } from "./client.ts";

const IMG_SRCS_REGEX = /var\s+imgsrcs\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/;
const HEX_VARIABLE_REGEX =
  /var\s+(key|iv)\s*=\s*CryptoJS\.enc\.Hex\.parse\(["']([0-9a-zA-Z]+)["']\)/g;
const COLS_REGEX = /var\s*widthnum\s*=\s*heightnum\s*=\s*(\d+)/;
const TOTAL_PAGES_REGEX = /total_pages\s*=\s*(\d+)/;
const KEY_LOCATION_REGEX = /str\.charAt\(\s*(\d+)\s*\)/g;

/**
 * Lines mentioning any of these are DOM/jQuery work rather than key
 * derivation, and would throw if evaluated outside a browser.
 */
const JS_FILTERS = [
  "jQuery",
  "document",
  "getContext",
  "toDataURL",
  "getImageData",
  "width",
  "height",
];

const REPLACE_POS_JS = `
function replacePos(strObj, pos, replacetext) {
  var str = strObj.substr(0, pos) + replacetext + strObj.substring(pos + 1, strObj.length);
  return str;
}
`;

export type ReaderCrypto = {
  script: string;
  key: Uint8Array;
  iv: Uint8Array;
  cols: number;
};

/** The tile permutation for one scrambled image. */
export type DescrambleKey = {
  /** `cols * cols` destination indices, in source-tile order. */
  order: number[];
  cols: number;
};

export function extractImgsrcs(html: string): string | undefined {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? "";
    if (!body.includes("imgsrcs")) continue;
    const found = IMG_SRCS_REGEX.exec(body)?.[1];
    if (found) return found;
  }
  return IMG_SRCS_REGEX.exec(html)?.[1];
}

export function extractChapterJsUrl(html: string): string | undefined {
  return (
    /<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i.exec(html)?.[1] ??
    /src=["']([^"']*chapter\.js[^"']*)["']/i.exec(html)?.[1]
  );
}

export function extractTotalPages(html: string): number {
  const candidates = [
    TOTAL_PAGES_REGEX.exec(html)?.[1],
    /class=["'][^"']*multi_pg_tip[^"']*["'][^>]*>\s*\(\s*\d+\s*\/\s*(\d+)\s*\)/i.exec(html)?.[1],
    /page\s+\d+\s+of\s+(\d+)/i.exec(html)?.[1],
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/**
 * The reader-page URL template from `input#curl`, e.g.
 * `/chapter/35134/2096487/{page}/`. A template without `{page}` is unusable,
 * so the caller falls back to the `pcurl` variable.
 */
export function extractCurlTemplate(html: string): string | undefined {
  const value = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
  if (!value || !value.includes("{page}")) return undefined;
  return templatePathname(value);
}

/** Some pages ship a useless `curl` of "/" and put the real one in `pcurl`. */
export function extractPcurlTemplate(html: string): string | undefined {
  const match = /\bpcurl\s*=\s*["']([^"']*\/pg-)\d+(\/[^"']*)?["']/.exec(html);
  if (!match?.[1]) return undefined;
  return templatePathname(`${match[1]}{page}${match[2] ?? ""}`);
}

function templatePathname(template: string): string {
  // Protect the placeholder so path normalisation cannot mangle the braces.
  const placeholder = "__MANGAGO_PAGE__";
  const guarded = template.replace(/\{page\}/g, placeholder);
  const path = pathOf(guarded.startsWith("http") ? guarded : `${DOMAIN}${guarded}`);
  return path.split(placeholder).join("{page}");
}

/**
 * Deobfuscates a `sojson.v4`-packed script.
 *
 * The payload is a run of decimal character codes separated by letters, framed
 * by a fixed-length prologue and epilogue.
 */
export function sojsonV4Decode(source: string): string {
  if (!source.startsWith("['sojson.v4']")) {
    throw new Error("chapter.js is not sojson.v4-obfuscated");
  }
  if (source.length < 299) throw new Error("chapter.js is too short to be valid");

  const args = source.slice(240, source.length - 59);
  return args
    .split(/[a-zA-Z]+/g)
    .filter(Boolean)
    .map((code) => String.fromCharCode(Number(code)))
    .join("");
}

export function findHexEncodedVariable(script: string, variable: string): string | undefined {
  HEX_VARIABLE_REGEX.lastIndex = 0;
  for (const match of script.matchAll(HEX_VARIABLE_REGEX)) {
    if (match[1] === variable) return match[2];
  }
  return undefined;
}

export function extractDescrambleCols(script: string): number {
  const value = Number(COLS_REGEX.exec(script)?.[1]);
  return Number.isFinite(value) ? value : 0;
}

/** Every marker the decode pipeline needs, checked before a script is trusted. */
export function isUsableChapterJs(script: unknown): script is string {
  return (
    typeof script === "string" &&
    script.length > 1000 &&
    !!findHexEncodedVariable(script, "key") &&
    !!findHexEncodedVariable(script, "iv") &&
    extractDescrambleCols(script) > 0 &&
    script.includes("var renImg = function(img,width,height,id){") &&
    script.includes("key = key.split(")
  );
}

/**
 * Undoes the character shuffle applied to the decrypted image list.
 *
 * The shuffle key is a handful of digits hidden at fixed offsets inside the
 * list itself; the offsets are the arguments of the `str.charAt(n)` calls left
 * in the deobfuscated script.
 */
export function unscrambleImageList(imageList: string, script: string): string {
  KEY_LOCATION_REGEX.lastIndex = 0;
  const locations = [
    ...new Set([...script.matchAll(KEY_LOCATION_REGEX)].map((match) => Number(match[1]))),
  ].filter((value) => Number.isFinite(value));

  if (locations.length === 0) return imageList;

  const keys: number[] = [];
  for (const location of locations) {
    const digit = imageList[location];
    // A non-digit means the list was never scrambled; leave it alone.
    if (!digit || !/[0-9]/.test(digit)) return imageList;
    keys.push(Number(digit));
  }

  // Each removal shifts every later offset left by one, which is why the
  // subtraction tracks how many have already been taken out.
  let result = imageList;
  locations.forEach((location, index) => {
    const at = location - index;
    if (at >= 0 && at < result.length) result = result.slice(0, at) + result.slice(at + 1);
  });

  const chars = result.split("");
  for (const key of [...keys].reverse()) {
    for (let i = chars.length - 1; i >= key; i--) {
      if (i % 2 !== 0) {
        const swap = chars[i - key]!;
        chars[i - key] = chars[i]!;
        chars[i] = swap;
      }
    }
  }

  return chars.join("");
}

/** Decrypts and unscrambles one reader page's `imgsrcs` blob. */
export function decodeImgsrcs(blob: string, crypto: ReaderCrypto, keepBlanks = false): string[] {
  const plain = aesCbcDecrypt(base64ToBytes(blob), crypto.key, crypto.iv, "zero");
  const text = bytesToUtf8(plain).replace(/\0+$/g, "").replace(/,+$/g, "");
  const images = unscrambleImageList(text, crypto.script)
    .split(",")
    .map((entry) => entry.trim());
  return keepBlanks ? images : images.filter(Boolean);
}

/**
 * Builds the source that derives an image's tile-permutation key.
 *
 * The routine lives inside `renImg` in the deobfuscated script, interleaved
 * with canvas work that cannot run here — hence the line filter.
 */
export function buildDescramblingKeyScript(script: string): string {
  const afterRenImg = script.split("var renImg = function(img,width,height,id){")[1];
  if (!afterRenImg) throw new Error("renImg not found in chapter.js");

  const body = afterRenImg.split("key = key.split(")[0];
  if (body === undefined) throw new Error("key derivation not found in chapter.js");

  const cleaned = body
    .split("\n")
    .filter((line) => JS_FILTERS.every((banned) => !line.includes(banned)))
    .join("\n")
    .split("img.src")
    .join("url");

  return `${REPLACE_POS_JS}
function getDescramblingKey(url) {
  ${cleaned}
  return key;
}`;
}

/**
 * Evaluates the derivation script for a batch of image URLs.
 *
 * `Function` is tried first because it needs no host support. When the runtime
 * refuses it, the auxiliary WebView runs the same script instead — the app
 * offers one per source method, and a chapter only needs the one pass.
 */
export async function deriveDescramblingKeys(
  script: string,
  imageUrls: string[],
): Promise<Map<string, string>> {
  const derived = new Map<string, string>();
  if (imageUrls.length === 0) return derived;

  const program = buildDescramblingKeyScript(script);

  try {
    const factory = (globalThis as { Function?: FunctionConstructor }).Function;
    if (factory) {
      const run = new factory(
        "urls",
        `${program}
return urls.map(function (url) { return getDescramblingKey(url); });`,
      ) as (urls: string[]) => string[];

      const keys = run(imageUrls);
      imageUrls.forEach((url, index) => {
        const key = keys[index];
        if (typeof key === "string" && key) derived.set(url, key);
      });
      if (derived.size > 0) return derived;
    }
  } catch {
    // Fall through to the WebView.
  }

  try {
    const page = await WebViewPage.create();
    try {
      const keys = await page.evaluateScript<string[]>(
        `${program}
args[0].map(function (url) { return getDescramblingKey(url); });`,
        [imageUrls],
      );
      imageUrls.forEach((url, index) => {
        const key = keys?.[index];
        if (typeof key === "string" && key) derived.set(url, key);
      });
    } finally {
      await page.close();
    }
  } catch {
    // No key means the image is served unscrambled; better a readable page
    // than a hard failure on a chapter that may not be tiled at all.
  }

  return derived;
}

/**
 * Turns the site's "3a1a0a…" key into the tile order the redraw handler wants.
 *
 * The result has to be a genuine permutation of `cols * cols`: the redraw is a
 * list of copies, so a repeated destination overwrites a tile and a missing one
 * leaves a hole. A key that does not qualify is rejected rather than rendered,
 * because a half-applied permutation looks worse than the untouched image.
 */
export function parseDescrambleKey(key: string, cols: number): DescrambleKey | undefined {
  if (cols <= 0) return undefined;

  const size = cols * cols;
  const order = key.split("a").map((entry) => Number(entry || "0"));
  if (order.length < size) return undefined;

  const trimmed = order.slice(0, size);
  const seen = Array.from({ length: size }, () => false);

  for (const destination of trimmed) {
    if (!Number.isInteger(destination) || destination < 0 || destination >= size) return undefined;
    if (seen[destination]) return undefined;
    seen[destination] = true;
  }

  return { order: trimmed, cols };
}

/** The mirrors worth trying for a numeric `/chapter/` reader path. */
export function numericChapterCandidates(target: string): string[] {
  const path = pathOf(target);
  if (!/^\/chapter\/\d+\/\d+/.test(path)) return [];
  const suffix = target.slice(target.indexOf(path));
  return READER_MIRROR_HOSTS.map((host) => `${host}${suffix}`);
}

/**
 * Pins a reader URL to a host that will serve it, and repairs the
 * host-doubling that a stale link can produce.
 */
export function canonicalReaderUrl(target: string): string {
  const queryStart = target.search(/[?#]/);
  let head = queryStart === -1 ? target : target.slice(0, queryStart);
  const suffix = queryStart === -1 ? "" : target.slice(queryStart);

  if (head.startsWith("//")) head = `https:${head}`;

  const schemes = [...head.matchAll(/https?:\/\//g)];
  if (schemes.length > 1) head = head.slice(schemes[schemes.length - 1]!.index);

  const inputHost = /^https?:\/\/([^/?#]+)/i.exec(head)?.[1]?.toLowerCase();
  const mirrorOrigin =
    inputHost && /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(inputHost)
      ? `https://${inputHost}`
      : undefined;

  const readerIndex = Math.max(head.lastIndexOf("/read-manga/"), head.lastIndexOf("/chapter/"));
  const working = (readerIndex > 0 ? head.slice(readerIndex) : head) + suffix;

  const path = pathOf(working);
  const numeric = /^\/chapter\/\d+\/\d+/.test(path);
  const origin = numeric && mirrorOrigin ? mirrorOrigin : DOMAIN;

  const cut = working.search(/[?#]/);
  const pathAndQuery = cut >= 0 ? path + working.slice(cut) : path;
  return `${origin}${pathAndQuery}`;
}

/** Builds the URL for image index `page`, pinned to the loaded reader's host. */
export function buildTemplatePageUrl(template: string, loadedUrl: string, page: number): string {
  const origin = readerOrigin(loadedUrl);
  const path = template.replace("{page}", String(page));
  return canonicalReaderUrl(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
}

export function resolveChapterJsUrl(src: string, loadedUrl: string): string {
  return resolveUrl(src, loadedUrl);
}
