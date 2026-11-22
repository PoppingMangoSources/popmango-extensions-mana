/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { ChapterData, HttpResponse } from "@mana-app/types";

/** Escapes text for HTML element content and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const RTL_LANGUAGES = ["ar", "ckb", "dv", "fa", "he", "iw", "ps", "sd", "ug", "ur", "yi"];

/**
 * A standalone document for the book reader.
 *
 * The reader takes a book's direction from the HTML `dir` rather than from anything the
 * source declares, so a right-to-left language is marked here.
 */
export function chapterDocument(title: string, bodyHtml: string, language = "en"): string {
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "";
  const dir = RTL_LANGUAGES.includes(code) ? ' dir="rtl"' : "";

  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeHtml(language)}"${dir}>`,
    `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>`,
    `<body>${bodyHtml}</body>`,
    "</html>",
  ].join("");
}

/**
 * A chapter whose content is an HTML document, for a title with `ContentType.NOVEL`.
 *
 * `document` is the form `@mana-app/types` declares; the app reads UTF-8 HTML in it as a
 * book. The response is the page the prose came from, so the app keeps its status and URL,
 * and only the body is replaced. It must be a 2xx response.
 */
export function htmlChapter(response: HttpResponse, html: string): ChapterData {
  return { document: response.withBody(html, { contentType: "text/html; charset=utf-8" }) };
}

/** Plain text, such as an API's chapter body, as one paragraph per non-empty line. */
export function textToHtml(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
