/* SPDX-License-Identifier: GPL-3.0-or-later */

import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  type Chapter,
  type Content,
  type Tag,
} from "@mana-app/types";

import { clean, imageSrc, parseDate, resolveUrl, text, UrlBuilder } from "../common/index.ts";
import { canonicalReaderUrl } from "./reader.ts";
import {
  DOMAIN,
  genreIdFromTitle,
  getGenreTitle,
  TITLE_VERSION_REGEX,
  type MangagoListing,
} from "./model.ts";

export function absoluteUrl(target: string): string {
  return resolveUrl(target, DOMAIN);
}

/** Reduces a link to the path the source uses as an id. */
function toPathname(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  const absolute = absoluteUrl(trimmed);
  const match = /^https?:\/\/[^/]+(\/[^?#]*)/i.exec(absolute);
  return match?.[1] ?? trimmed;
}

function coverOf(node: Cheerio<AnyNode>): string {
  return absoluteUrl(imageSrc(node));
}

export function stripTitleVersion(title: string): string {
  TITLE_VERSION_REGEX.lastIndex = 0;
  return title.replace(TITLE_VERSION_REGEX, "").trim() || title;
}

/**
 * Genre-locked sections carry a known rating, so a discover badge matches what
 * the details page will say.
 */
export function contentRatingForGenres(genreTitles: string[]): ContentRating {
  const lower = genreTitles.map((title) => title.trim().toLowerCase());
  if (lower.some((title) => title === "adult" || title === "smut" || title === "yaoi")) {
    return ContentRating.EXPLICIT;
  }
  if (lower.some((title) => title === "mature" || title === "bara")) return ContentRating.MATURE;
  if (lower.some((title) => title === "ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

/**
 * The site's own "Featured Manga" slider, which only exists on the home page.
 *
 * It is a curated list rather than a sort, so it cannot be reproduced by any
 * `/genre/` browse — the home page has to be fetched for it.
 */
export const FEATURED_CONTAINER = "#popular_manga_list";

/** The standard grid used by /genre/, search results and related lists. */
export function parseListings(html: string, scope?: string): MangagoListing[] {
  const $ = load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  const selector = scope
    ? `${scope} .updatesli, ${scope} .pic_list > li`
    : ".updatesli, .pic_list > li";

  $(selector).each((_, element) => {
    const item = $(element);
    const link = item.find("a.thm-effect").first();
    if (link.length === 0) return;

    const id = toPathname(link.attr("href") ?? "");
    if (!id || seen.has(id)) return;

    const image = link.find("img").first();
    const title = clean(link.attr("title") ?? image.attr("alt") ?? link.text());
    if (!title) return;

    const chapter = item.find(".chapter a, a[href*='/read-manga/'][href*='/c']").first();
    const chapterPath = chapter.attr("href") ? toPathname(chapter.attr("href")!) : "";
    const isChapter = chapterPath !== "" && chapterPath !== id;

    seen.add(id);
    items.push({
      id,
      title,
      cover: coverOf(image),
      subtitle: isChapter ? clean(chapter.text()) || undefined : undefined,
      chapterId: isChapter ? chapterPath : undefined,
    });
  });

  return items;
}

export function hasNextPage(html: string): boolean {
  return load(html)(".current + li > a").length > 0;
}

/**
 * The /list/latest/ page carries update time, genres and the newest chapter
 * per title, which is what lets the New Chapters section render as a real
 * chapter-updates list rather than a plain cover strip.
 */
export function parseLatestUpdates(html: string): MangagoListing[] {
  const $ = load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  // Mobile and desktop layouts differ, but both wrap the title in `.row-1`
  // with the other rows as siblings, so anchor on the title for a stable scope.
  $(".row-1 .tit a").each((_, element) => {
    const titleLink = $(element);
    const href = titleLink.attr("href") ?? "";
    if (!href.includes("/read-manga/")) return;

    const id = toPathname(href);
    if (!id || seen.has(id)) return;

    const title = clean(titleLink.attr("title") ?? titleLink.text());
    if (!title) return;

    const content = titleLink.closest(".row-1").parent();
    const cover = coverOf(content.prev().find("img").first());

    const chapter = content.find("a.chico").first();
    const subtitle = clean(chapter.text());
    const chapterId = chapter.attr("href") ? toPathname(chapter.attr("href")!) : undefined;

    let publishDate: Date | undefined;
    content.find(".blue").each((_index, label) => {
      const node = $(label);
      if (node.text().trim().toLowerCase().startsWith("update date")) {
        publishDate = parseDate(clean(node.parent().text()).replace(/^update date:\s*/i, ""));
      }
    });

    const genres = content
      .find(".row-4 .gray")
      .text()
      .split(/[/,]/)
      .map((genre) => clean(genre))
      .filter(Boolean);

    seen.add(id);
    items.push({
      id,
      title,
      cover,
      subtitle: subtitle || undefined,
      chapterId: chapterId || undefined,
      publishDate,
      genres: genres.length ? genres : undefined,
    });
  });

  return items;
}

/**
 * Walks a details page's info rows as (lowercased label, row) pairs. The
 * mobile theme uses `.manga_info li`, the desktop one `.manga_right tr`.
 */
function eachInfoRow($: CheerioAPI, visit: (label: string, row: Cheerio<AnyNode>) => void): void {
  $("#information .manga_info li, #information .manga_right tr").each((_, element) => {
    const row = $(element);
    visit(row.find("b, label").first().text().trim().toLowerCase(), row);
  });
}

/** `.manga_summary`, with its trailing credit line removed. */
function mangaSummary($: CheerioAPI): string | undefined {
  const node = $(".manga_summary").first();
  node.find("font").remove();
  const value = node.text().trim();
  if (!value || /^not found\.*$/i.test(value)) return undefined;
  return value;
}

export function parseContent(
  html: string,
  contentId: string,
  options: { removeTitleVersion: boolean },
): Content {
  const $ = load(html);
  const info = $("#information");

  const rawTitle = $(".w-title h1").first().text().trim() || contentId;
  const title = options.removeTitleVersion ? stripTitleVersion(rawTitle) : rawTitle;

  let status: PublicationStatus | undefined;
  let author = "";
  let artist = "";
  const additionalTitles: string[] = [];
  const tags: Tag[] = [];
  const tagTitles: string[] = [];

  eachInfoRow($, (label, row) => {
    const value = row.find("span").first().text().trim();

    if (label.startsWith("status")) {
      const lower = value.toLowerCase();
      if (lower === "ongoing") status = PublicationStatus.ONGOING;
      else if (lower === "completed") status = PublicationStatus.COMPLETED;
    }

    if (label.startsWith("author")) {
      author = row
        .find("a")
        .map((_, anchor) => $(anchor).text().trim())
        .get()
        .join(", ");
    }

    if (label.startsWith("artist")) {
      artist = row
        .find("a")
        .map((_, anchor) => $(anchor).text().trim())
        .get()
        .join(", ");
    }

    // Alternative names improve search and tracker matching. The site
    // separates them with ";", "/" or a newline — but a title can legitimately
    // contain a comma, so only split on that when neither of the others appear.
    if (label.startsWith("alternative") || label.includes("other name")) {
      const raw = value || row.text().replace(/^[^:]*:/, "");
      const separator = /[;/\n]/.test(raw) ? /[;/\n]+/ : /,/;
      for (const name of raw.split(separator).map((entry) => entry.trim())) {
        if (name && !/^none$/i.test(name) && !additionalTitles.includes(name)) {
          additionalTitles.push(name);
        }
      }
    }

    if (label.startsWith("genre")) {
      row.find("a").each((_, anchor) => {
        const genreTitle = $(anchor).text().trim();
        if (!genreTitle) return;
        tagTitles.push(genreTitle);
        tags.push({ id: genreIdFromTitle(genreTitle), title: genreTitle });
      });
    }
  });

  const isWebtoon = tagTitles.some((genre) => genre.toLowerCase() === "webtoons");

  return {
    title,
    cover: coverOf(info.find("img").first()),
    summary: mangaSummary($) ?? "",
    additionalTitles,
    tags,
    contentType: isWebtoon ? ContentType.MANHWA : ContentType.MANGA,
    contentRating: contentRatingForGenres(tagTitles),
    ...(status === undefined ? {} : { status }),
    webUrl: absoluteUrl(contentId),
    ...(author || artist
      ? {
          additionalInfo: [
            {
              type: 1 as const,
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: [
                ...(author
                  ? [{ type: 1 as const, id: "author", title: author, subtitle: "Author" }]
                  : []),
                ...(artist && artist !== author
                  ? [{ type: 1 as const, id: "artist", title: artist, subtitle: "Artist" }]
                  : []),
              ],
            },
          ],
        }
      : {}),
  };
}

/** Splits "Vol.2 Ch.15: The Title" into its number and its title. */
function parseChapterTitle(input: string): { number?: number; title?: string } {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");

  let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  let number: number | undefined;

  const volume = /^Vol\.\s*(?:(\d+(?:\.\d+)?)|TBA|N\/?A|NA)?\s*/i.exec(left);
  if (volume) left = left.slice(volume[0].length).trimStart();

  if (/^Ch\./i.test(left)) {
    left = left.slice(3).trimStart();
    const match = /^(\d+(?:\.\d+)?)/.exec(left);
    if (match) {
      number = Number(match[1]);
      left = left.slice(match[1]!.length).trimStart();
    }
  }

  const title = right && left ? `${left}: ${right}` : right || left || undefined;
  return { number, title };
}

/**
 * A chapter's number, read only from an explicit marker or a leading digit.
 *
 * The slug's number is an upload id rather than a chapter number, and a number
 * mid-title ("Season 2 …") is not one either, so anything else stays 0 — the
 * sort's "unnumbered" sentinel.
 */
function parseChapterNumber(name: string): number {
  const raw =
    /chapter\s*(\d+(?:\.\d+)?)/i.exec(name)?.[1] ??
    /ch\.\s*(\d+(?:\.\d+)?)/i.exec(name)?.[1] ??
    /^\s*(\d+(?:\.\d+)?)/.exec(name)?.[1];

  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

function isOfficialUpload(value: string): boolean {
  return /\bofficial\b/i.test(value);
}

function detectGroupFromBracket(title: string): string {
  for (const match of title.matchAll(/(?:\[([^\]]{2,80})\]|\(([^()]{2,80})\))/g)) {
    const value = clean(match[1] ?? match[2] ?? "");
    if (!value) continue;
    if (isOfficialUpload(value)) return "Official";
    if (/\b(scans?|scanlations?|translations?|translators?|team|group)\b/i.test(value)) {
      return value;
    }
  }
  return "";
}

function firstUploaderCandidate(candidates: string[], chapterTitle: string): string {
  return (
    candidates
      .map((candidate) => clean(candidate))
      .find(
        (candidate) =>
          candidate &&
          candidate !== chapterTitle &&
          // Skip the substring test when the title is empty, or
          // `candidate.includes("")` rejects every uploader.
          (!chapterTitle || !candidate.includes(chapterTitle)),
      ) ?? ""
  );
}

function extractUploader($: CheerioAPI, row: Cheerio<AnyNode>): string {
  const chapterTitle = clean(row.find("a.chico").first().text());

  const profile = firstUploaderCandidate(
    row
      .find("a[href*='/home/'], a[href*='/user/'], a[href*='/profile/']")
      .not("a.chico")
      .toArray()
      .map((element) => $(element).text()),
    chapterTitle,
  );
  if (profile) return profile;

  // The uploader and date cells share the class "no"; the date is always last,
  // so exclude it positionally rather than by sniffing its content.
  const dateCell = row.find("td").last();
  const candidates = row
    .find(
      "td.no a, td.no, td.uk-table-shrink a, td.uk-table-shrink, td[class*='upload'] a, td[class*='upload'], td[class*='group'] a, td[class*='group']",
    )
    .not(dateCell)
    .not(dateCell.find("a"))
    .toArray()
    .map((element) => $(element).text());

  return firstUploaderCandidate(candidates, chapterTitle);
}

function buildScanlator(rawUploader: string, rawTitle: string): string | undefined {
  const uploader = clean(rawUploader);
  const normalisedUploader = isOfficialUpload(uploader) ? "Official" : uploader;
  const group = detectGroupFromBracket(rawTitle) || (isOfficialUpload(rawTitle) ? "Official" : "");

  if (!group) return normalisedUploader || undefined;
  if (!normalisedUploader || group.toLowerCase() === normalisedUploader.toLowerCase()) return group;
  return `${group} - ${normalisedUploader}`;
}

function compareScanlators(a: Chapter, b: Chapter): number {
  const aOfficial = a.provider?.name.startsWith("Official") ?? false;
  const bOfficial = b.provider?.name.startsWith("Official") ?? false;
  if (aOfficial && !bOfficial) return -1;
  if (!aOfficial && bOfficial) return 1;
  return (a.provider?.name ?? "").localeCompare(b.provider?.name ?? "");
}

export function parseChapters(html: string, options: { hideRaws: boolean }): Chapter[] {
  const $ = load(html);
  const parsed: Chapter[] = [];

  $(
    "table#chapter_table > tbody > tr, table#raws_table > tbody > tr, table.uk-table > tbody > tr",
  ).each((_, element) => {
    const row = $(element);
    const link = row.find("a.chico").first();

    const href = (link.attr("href") ?? "").trim();
    if (!href) return;
    if (options.hideRaws && href.includes("/raw/")) return;

    // An absolute href is a numeric mirror URL and must stay intact so the id
    // alone is enough to fetch; a relative one reduces to its path.
    const chapterId = href.startsWith("http") ? canonicalReaderUrl(href) : toPathname(href);
    if (!chapterId) return;

    const rawTitle = link.text().trim();
    if (!rawTitle) return;

    const parsedTitle = parseChapterTitle(rawTitle);
    const scanlator = buildScanlator(extractUploader($, row), rawTitle);
    const number = parsedTitle.number ?? parseChapterNumber(rawTitle);

    parsed.push({
      chapterId,
      number,
      index: 0,
      title: parsedTitle.title || rawTitle,
      date: parseDate(clean(row.find("td").last().text())) ?? new Date(0),
      language: DefinedLanguages.ENGLISH,
      webUrl: absoluteUrl(chapterId),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    });
  });

  // Side stories, extras and epilogues carry no chapter number of their own.
  // Leaving them at 0 makes the app treat them as the *first* chapters, so
  // they are renumbered above the main run instead — they are published after
  // it, and the app picks where to start reading by chapter number.
  const highest = parsed.reduce((max, chapter) => Math.max(max, chapter.number), 0);
  const extras = parsed.filter((chapter) => chapter.number === 0);
  extras.forEach((chapter, position) => {
    // The site lists newest first, so the earliest row is the latest extra.
    chapter.number = highest + (extras.length - position);
  });

  parsed.sort((a, b) => {
    if (a.number !== b.number) return b.number - a.number;
    return compareScanlators(a, b);
  });

  // Mana wants index 0 on the first-published chapter, so number the reversed
  // order and hand back the list still sorted newest-first.
  const total = parsed.length;
  return parsed.map((chapter, position) => ({ ...chapter, index: total - 1 - position }));
}

/** Related titles shown on a details page. */
export function parseRelated(html: string): MangagoListing[] {
  const $ = load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  const push = (id: string, title: string, cover: string): void => {
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    items.push({ id, title, cover });
  };

  $("div.also_like:has(h4:contains(Other manga by the same author)) + .pic_list .updatesli").each(
    (_, element) => {
      const link = $(element).find("a.thm-effect").first();
      push(
        toPathname(link.attr("href") ?? ""),
        clean(link.attr("title") ?? link.text()),
        coverOf(link.find("img").first()),
      );
    },
  );

  $(".also-like li").each((_, element) => {
    const item = $(element);
    const link = item.find('h4 a[href*="/read-manga/"][title]').first();
    push(
      toPathname(link.attr("href") ?? ""),
      clean(link.attr("title") ?? link.text()),
      coverOf(item.find("img").first()),
    );
  });

  return items;
}

/** Genres the site currently advertises, so a new one shows up without a release. */
export function parseGenrePanel(html: string): string[] {
  const $ = load(html);
  return [
    ...new Set(
      $("#genre_panel .genre_select_div[_id]")
        .toArray()
        .map((element) => clean($(element).attr("_id") ?? ""))
        .filter(Boolean),
    ),
  ];
}

export type BrowseOptions = {
  included: string[];
  excluded: string[];
  page: number;
  sort: string;
  /** Selected status ids; both or neither means "any". */
  statuses?: string[];
};

/**
 * Builds a /genre/ browse URL.
 *
 * The site matches genres by display title — comma-joined in the path for
 * includes, and in `e` for excludes.
 */
export function buildGenreBrowseUrl(options: BrowseOptions): string {
  const included = [...options.included];
  const excluded = [...new Set(options.excluded)].filter((genre) => !included.includes(genre));

  const url = new UrlBuilder(DOMAIN)
    .addPathComponent("genre")
    .addPathComponent(included.length > 0 ? included.join(",") : "all")
    .addPathComponent(String(options.page));

  if (excluded.length > 0) url.setQueryItem("e", excluded.join(","));

  const statuses = options.statuses;
  if (statuses && statuses.length === 1) {
    url.setQueryItem("f", statuses.includes("f") ? "1" : "0");
    url.setQueryItem("o", statuses.includes("o") ? "1" : "0");
  } else {
    url.setQueryItem("f", "1");
    url.setQueryItem("o", "1");
  }

  if (options.sort) url.setQueryItem("sortby", options.sort);

  return url.build();
}

export function buildSearchUrl(query: string, page: number): string {
  return new UrlBuilder(DOMAIN)
    .addPathComponent("r")
    .addPathComponent("l_search")
    .setQueryItem("name", query)
    .setQueryItem("page", String(page))
    .build();
}

export function buildLatestUrl(page: number): string {
  return new UrlBuilder(DOMAIN)
    .addPathComponent("list")
    .addPathComponent("latest")
    .addPathComponent("all")
    .addPathComponent(String(page))
    .build();
}

export { getGenreTitle, text };
