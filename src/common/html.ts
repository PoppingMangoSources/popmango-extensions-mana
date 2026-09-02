/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { PublicationStatus } from "@mana-app/types";

import { resolveUrl } from "./urls.ts";

/**
 * Attributes a lazy-loading theme may hide the real image behind, in the
 * order worth trying. `src` comes last because it is usually the placeholder
 * when any of the others are present.
 */
const LAZY_ATTRS = [
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

/** Turns a tag-heavy synopsis into the plain paragraphs the app renders. */
function summaryFromHtml(html: string): string {
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

export function summaryOf(node: Cheerio<AnyNode>): string {
  const html = node.html() ?? "";
  return html ? summaryFromHtml(html) : text(node);
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
