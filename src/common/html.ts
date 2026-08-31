/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { ContentType, PublicationStatus } from "@mana-app/types";

import { resolveUrl } from "./urls.ts";

/**
 * Attributes a lazy-loading theme may hide the real image behind, in the
 * order worth trying. `src` comes last because it is usually the placeholder
 * when any of the others are present.
 */
export const LAZY_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-lazyload",
  "data-cfsrc",
  "data-echo",
  "data-image",
  "srcset",
  "data-srcset",
  "src",
] as const;

/** Collapses runs of whitespace so parsed text compares predictably. */
export function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

/** Same as {@link text}, but for a raw string. */
export function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the real image URL off an `<img>`, looking past lazy-load
 * placeholders and picking the first candidate out of a `srcset`.
 */
export function imageSrc(node: Cheerio<AnyNode>): string {
  for (const name of LAZY_ATTRS) {
    const raw = (node.attr(name) ?? "").trim();
    const first = raw.split(",")[0]?.trim().split(/\s+/)[0];
    if (first && !first.startsWith("data:")) return first;
  }

  // A `style="background-image:url(...)"` cover is common on card layouts.
  const style = node.attr("style") ?? "";
  const fromStyle = /background(?:-image)?\s*:\s*url\((['"]?)(.*?)\1\)/i.exec(style)?.[2];
  return fromStyle?.trim() ?? "";
}

/** {@link imageSrc}, resolved against the site's base URL. */
export function absoluteImage(node: Cheerio<AnyNode>, base: string): string {
  return resolveUrl(imageSrc(node), base);
}

/** Turns a display name into an id a site would recognise in a URL. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Maps a site's status wording onto the app's publication states. */
export function parseStatus(raw: string): PublicationStatus | undefined {
  const value = raw.toLowerCase();
  if (/ongoing|releasing|publishing|updating|en cours|活躍|连载/.test(value)) {
    return PublicationStatus.ONGOING;
  }
  if (/complet|finished|end(ed)?\b|完结|完結/.test(value)) return PublicationStatus.COMPLETED;
  if (/hiatus|paused|on hold/.test(value)) return PublicationStatus.HIATUS;
  if (/cancel|dropped|abandon/.test(value)) return PublicationStatus.CANCELLED;
  return undefined;
}

/** Maps a site's type wording onto the app's content types. */
export function parseContentType(raw: string): ContentType | undefined {
  const value = raw.toLowerCase();
  if (/manhwa|korean|한국/.test(value)) return ContentType.MANHWA;
  if (/manhua|chinese|中国|漫画/.test(value)) return ContentType.MANHUA;
  if (/novel|light novel|web novel/.test(value)) return ContentType.NOVEL;
  if (/comic|western/.test(value)) return ContentType.COMIC;
  if (/manga|japanese/.test(value)) return ContentType.MANGA;
  return undefined;
}

/**
 * Reads the first capture group of the first pattern that matches.
 *
 * Sites reshuffle their markup between themes; listing the alternatives keeps
 * a parser working across both rather than breaking on the day they switch.
 */
export function firstMatch(haystack: string, ...patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const found = pattern.exec(haystack)?.[1];
    if (found) return found;
  }
  return undefined;
}

/** Returns the text of the first selector that matches anything. */
export function firstText($: CheerioAPI, ...selectors: string[]): string {
  for (const selector of selectors) {
    const found = text($(selector).first());
    if (found) return found;
  }
  return "";
}

/**
 * Splits a comma/slash/semicolon separated list into trimmed entries.
 *
 * Author and artist fields are written this way on nearly every theme.
 */
export function splitList(value: string): string[] {
  return value
    .split(/[,;/|]|\sand\s|、/)
    .map((entry) => clean(entry))
    .filter((entry) => entry.length > 0 && !/^(updating|unknown|n\/a|-)$/i.test(entry));
}

/** Reads a JSON blob out of a `<script>` body, tolerating trailing semicolons. */
export function parseJsonish<T>(raw: string): T | undefined {
  const trimmed = raw.trim().replace(/;$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

/**
 * The text of a node excluding its child elements.
 *
 * Info rows are usually `<li><b>Status:</b> Ongoing</li>`, where `.text()`
 * returns the label glued to the value.
 */
export function ownText(node: Cheerio<AnyNode>): string {
  return clean(
    node
      .contents()
      .toArray()
      .filter((child) => child.type === "text")
      .map((child) => ("data" in child ? String(child.data) : ""))
      .join(" "),
  );
}

/**
 * Extracts a *balanced* JSON region beginning at `marker`.
 *
 * A lazy `/\{[\s\S]*?\}/` truncates at the first `}` inside a nested object,
 * which silently yields half a chapter list. This counts braces instead, and
 * skips over strings so a brace inside one cannot unbalance the count.
 */
export function balancedJson(source: string, marker: string): string | undefined {
  const from = source.indexOf(marker);
  if (from < 0) return undefined;

  const start = findOpening(source, from);
  if (start < 0) return undefined;

  const open = source[start]!;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const character = source[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === open) depth++;
    else if (character === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return undefined;
}

function findOpening(source: string, from: number): number {
  for (let i = from; i < source.length; i++) {
    const character = source[i];
    if (character === "{" || character === "[") return i;
  }
  return -1;
}

/**
 * Finds the inline `<script>` containing `marker` and parses the balanced JSON
 * region that follows it.
 *
 * Covers `window.__DATA__ = {...}` and friends. A single well-formed payload
 * such as `__NEXT_DATA__` or JSON-LD needs no scanning — parse the script body
 * directly with {@link parseJsonish}.
 */
export function scriptJson<T>($: CheerioAPI, marker: string): T | undefined {
  for (const element of $("script").toArray()) {
    const body = $(element).html() ?? "";
    if (!body.includes(marker)) continue;

    const region = balancedJson(body, marker);
    if (!region) continue;

    const parsed = parseJsonish<T>(region);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/**
 * Decodes the HTML entities a site may leave in a JSON-in-HTML payload.
 *
 * Full entity decoding is the DOM parser's job; this covers the handful that
 * appear inside attribute values and inline scripts.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|#0*38);/gi, "&")
    .replace(/&(?:lt|#0*60);/gi, "<")
    .replace(/&(?:gt|#0*62);/gi, ">")
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'")
    .replace(/&(?:nbsp|#0*160);/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** Turns a `<div>`-heavy synopsis into the plain paragraphs the app renders. */
export function summaryOf(node: Cheerio<AnyNode>): string {
  const html = node.html() ?? "";
  if (!html) return text(node);

  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n\n")
    .trim();
}

/** True when the page still offers a link to a further page of results. */
export function hasNextPage($: CheerioAPI, ...selectors: string[]): boolean {
  const candidates = selectors.length > 0 ? selectors : DEFAULT_NEXT_SELECTORS;
  return candidates.some((selector) => $(selector).length > 0);
}

const DEFAULT_NEXT_SELECTORS = [
  "a[rel='next']",
  ".pagination a[rel='next']",
  ".pagination .next:not(.disabled) a",
  ".pagination li.next:not(.disabled)",
  "a.next.page-numbers",
  ".wp-pagenavi a.nextpostslink",
];
