/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Everything that reads the site's markup.
 *
 * Selectors are the part of a source most likely to break, so they live
 * together rather than being scattered through the class. Confirm every one
 * against real markup before writing it — a guessed selector produces a source
 * that builds, typechecks, and returns nothing.
 */

import { load, type CheerioAPI } from "cheerio";
import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  type Chapter,
  type Content,
  type Highlight,
  type Tag,
} from "@mana-app/types";

import {
  absoluteImage,
  hasNextPage,
  parseChapterNumber,
  parseDate,
  parseStatus,
  resolveUrl,
  slugify,
  summaryOf,
  text,
} from "../common/index.ts";
import { BASE_URL } from "./model.ts";

export function contentUrl(contentId: string): string {
  return `${BASE_URL}/title/${encodeURIComponent(contentId)}`;
}

export function chapterUrl(contentId: string, chapterId: string): string {
  return `${contentUrl(contentId)}/${encodeURIComponent(chapterId)}`;
}

function contentIdFrom(href: string): string {
  return /\/title\/([^/?#]+)/.exec(href)?.[1] ?? "";
}

function chapterIdFrom(href: string): string {
  return /\/title\/[^/?#]+\/([^/?#]+)/.exec(href)?.[1] ?? "";
}

/** One card in a listing, search result or carousel. */
export function parseHighlights(html: string): Highlight[] {
  const $ = load(html);
  const results: Highlight[] = [];

  for (const element of $(".card").toArray()) {
    const card = $(element);
    const link = card.find("a").first();

    const id = contentIdFrom(link.attr("href") ?? "");
    const title = text(card.find(".title").first()) || text(link);
    if (!id || !title) continue;

    const chapter = text(card.find(".chapter").first());

    results.push({
      id,
      title,
      cover: absoluteImage(card.find("img").first(), BASE_URL),
      ...(chapter ? { subtitle: chapter } : {}),
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

/** Whether the listing advertises a further page. */
export function hasMore(html: string): boolean {
  return hasNextPage(load(html));
}

export function parseContent(html: string, contentId: string): Content {
  const $ = load(html);

  const tags: Tag[] = $(".genres a")
    .toArray()
    .map((element) => text($(element)))
    .filter(Boolean)
    .map((title) => ({ id: slugify(title), title }));

  // `parseStatus` returns undefined when the site does not say — do not
  // default to ONGOING, which shows the reader something untrue.
  const status = parseStatus(text($(".status").first()));

  return {
    title: text($("h1").first()),
    cover: absoluteImage($(".cover img").first(), BASE_URL),
    summary: summaryOf($(".summary").first()),
    tags,
    contentType: ContentType.COMIC,
    contentRating: ContentRating.SAFE,
    ...(status === undefined ? {} : { status }),
    webUrl: contentUrl(contentId),
  };
}

/**
 * `index` must start at 0 on the first-published chapter and be contiguous, so
 * it is assigned from the array's own length rather than the loop counter —
 * skipped rows would otherwise leave gaps.
 */
export function parseChapters(html: string): Chapter[] {
  const $ = load(html);
  const chapters: Chapter[] = [];

  for (const element of $(".chapter-list a").toArray()) {
    const link = $(element);
    const href = link.attr("href") ?? "";

    const chapterId = chapterIdFrom(href);
    if (!chapterId) continue;

    const title = text(link);

    chapters.push({
      chapterId,
      number: parseChapterNumber(title, chapters.length + 1),
      index: chapters.length,
      // A site that publishes no date gets the epoch, never an invalid Date.
      date: parseDate(text(link.find(".date"))) ?? new Date(0),
      language: DefinedLanguages.ENGLISH,
      title,
      webUrl: resolveUrl(href, BASE_URL),
    });
  }

  return chapters.reverse().map((chapter, index) => ({ ...chapter, index }));
}

/** Throwing is the only diagnostic channel that reaches the reader. */
export function parsePages($: CheerioAPI, chapterId: string): string[] {
  const pages: string[] = [];

  for (const element of $(".reader img").toArray()) {
    const url = absoluteImage($(element), BASE_URL);
    if (url) pages.push(url);
  }

  if (pages.length === 0) throw new Error(`No pages found for chapter "${chapterId}"`);
  return pages;
}
