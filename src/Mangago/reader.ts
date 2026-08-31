/* SPDX-License-Identifier: GPL-3.0-or-later */

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

const JS_FILTERS = [
  "jQuery",
  "document",
  "getContext",
  "toDataURL",
  "getImageData",
  "width",
  "height",
];

const WEBVIEW_TIMEOUT_SECONDS = 8;

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

export type DescrambleKey = {
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

export function extractCurlTemplate(html: string): string | undefined {
  const value = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
  if (!value || !value.includes("{page}")) return undefined;
  return templatePathname(value);
}

export function extractPcurlTemplate(html: string): string | undefined {
  const match = /\bpcurl\s*=\s*["']([^"']*\/pg-)\d+(\/[^"']*)?["']/.exec(html);
  if (!match?.[1]) return undefined;
  return templatePathname(`${match[1]}{page}${match[2] ?? ""}`);
}

function templatePathname(template: string): string {
  const placeholder = "__MANGAGO_PAGE__";
  const guarded = template.replace(/\{page\}/g, placeholder);
  const path = pathOf(guarded.startsWith("http") ? guarded : `${DOMAIN}${guarded}`);
  return path.split(placeholder).join("{page}");
}

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

export function unscrambleImageList(imageList: string, script: string): string {
  KEY_LOCATION_REGEX.lastIndex = 0;
  const locations = [
    ...new Set([...script.matchAll(KEY_LOCATION_REGEX)].map((match) => Number(match[1]))),
  ].filter((value) => Number.isFinite(value));

  if (locations.length === 0) return imageList;

  const keys: number[] = [];
  for (const location of locations) {
    const digit = imageList[location];
    if (!digit || !/[0-9]/.test(digit)) return imageList;
    keys.push(Number(digit));
  }

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

export function decodeImgsrcs(blob: string, crypto: ReaderCrypto, keepBlanks = false): string[] {
  const plain = aesCbcDecrypt(base64ToBytes(blob), crypto.key, crypto.iv, "zero");
  const text = bytesToUtf8(plain).replace(/\0+$/g, "").replace(/,+$/g, "");
  const images = unscrambleImageList(text, crypto.script)
    .split(",")
    .map((entry) => entry.trim());
  return keepBlanks ? images : images.filter(Boolean);
}

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

export async function deriveDescramblingKeys(
  script: string,
  imageUrls: string[],
): Promise<Map<string, string>> {
  const derived = new Map<string, string>();
  if (imageUrls.length === 0) return derived;

  let program: string;
  try {
    program = buildDescramblingKeyScript(script);
  } catch {
    return derived;
  }

  const collect = (keys: readonly unknown[] | undefined): void => {
    imageUrls.forEach((url, index) => {
      const key = keys?.[index];
      if (typeof key === "string" && key) derived.set(url, key);
    });
  };

  try {
    const factory = (globalThis as { Function?: FunctionConstructor }).Function;
    if (factory) {
      const run = new factory(
        "urls",
        `${program}
return urls.map(function (url) { return getDescramblingKey(url); });`,
      ) as (urls: string[]) => unknown[];

      collect(run(imageUrls));
      if (derived.size > 0) return derived;
    }
  } catch {}

  try {
    collect(await runInWebView(program, imageUrls));
  } catch {}

  return derived;
}

async function runInWebView(program: string, imageUrls: string[]): Promise<unknown[] | undefined> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) return undefined;

  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return undefined;

  // evaluate() on a page that never navigated hangs until the host times out,
  // so goto() first and bound the whole thing.
  const page = await factory.create({ timeout: WEBVIEW_TIMEOUT_SECONDS });

  try {
    const work = (async (): Promise<unknown[]> => {
      await page.goto(DOMAIN, { waitUntil: "domcontentloaded" });
      return await page.evaluateScript<unknown[]>(
        `${program}
args[0].map(function (url) { return getDescramblingKey(url); });`,
        [imageUrls],
      );
    })();

    const expired = new Promise<undefined>((resolve) => {
      timer(() => resolve(undefined), WEBVIEW_TIMEOUT_SECONDS * 1000);
    });

    return await Promise.race([work, expired]);
  } finally {
    await page.close().catch(() => undefined);
  }
}

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

export function numericChapterCandidates(target: string): string[] {
  const path = pathOf(target);
  if (!/^\/chapter\/\d+\/\d+/.test(path)) return [];
  const suffix = target.slice(target.indexOf(path));
  return READER_MIRROR_HOSTS.map((host) => `${host}${suffix}`);
}

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

export function buildTemplatePageUrl(template: string, loadedUrl: string, page: number): string {
  const origin = readerOrigin(loadedUrl);
  const path = template.replace("{page}", String(page));
  return canonicalReaderUrl(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
}

export function resolveChapterJsUrl(src: string, loadedUrl: string): string {
  return resolveUrl(src, loadedUrl);
}
