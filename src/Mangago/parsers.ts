/* SPDX-License-Identifier: GPL-3.0-or-later */

import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  ContentRating,
  additionalInfo,
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
  genreTitle,
  TITLE_VERSION_REGEX,
  type MangagoListing,
} from "./model.ts";

export function absoluteUrl(target: string): string {
  return resolveUrl(target, DOMAIN);
}

function parsePathname(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  const absolute = absoluteUrl(trimmed);
  const match = /^https?:\/\/[^/]+(\/[^?#]*)/i.exec(absolute);
  return match?.[1] ?? trimmed;
}

function coverUrl(node: Cheerio<AnyNode>): string {
  return absoluteUrl(imageSrc(node));
}

function stripTitleVersion(title: string): string {
  TITLE_VERSION_REGEX.lastIndex = 0;
  return title.replace(TITLE_VERSION_REGEX, "").trim() || title;
}

const RATED_GENRES: [ContentRating, string[]][] = [
  [ContentRating.EXPLICIT, ["Adult", "Smut", "Yaoi"]],
  [ContentRating.MATURE, ["Mature", "Bara"]],
  [ContentRating.SUGGESTIVE, ["Ecchi"]],
];

export function ratingForGenres(genreTitles: string[]): ContentRating {
  const lower = new Set(genreTitles.map((title) => title.trim().toLowerCase()));
  for (const [rating, genres] of RATED_GENRES) {
    if (genres.some((genre) => lower.has(genre.toLowerCase()))) return rating;
  }
  return ContentRating.SAFE;
}

// The site filters by genre, not by rating, so a host policy is honoured by excluding the
// genres that carry a disallowed rating — which keeps the paging intact.
export function genresAboveRatingPolicy(allowed: readonly ContentRating[] | undefined): string[] {
  if (!allowed) return [];
  const permitted = new Set(allowed);
  return RATED_GENRES.filter(([rating]) => !permitted.has(rating)).flatMap(([, genres]) => genres);
}

export const FEATURED_CONTAINER = "#popular_manga_list";

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

    const id = parsePathname(link.attr("href") ?? "");
    if (!id || seen.has(id)) return;

    const image = link.find("img").first();
    const title = clean(link.attr("title") ?? image.attr("alt") ?? link.text());
    if (!title) return;

    const chapter = item.find(".chapter a, a[href*='/read-manga/'][href*='/c']").first();
    const chapterPath = chapter.attr("href") ? parsePathname(chapter.attr("href")!) : "";
    const isChapter = chapterPath !== "" && chapterPath !== id;

    seen.add(id);
    items.push({
      id,
      title,
      cover: coverUrl(image),
      subtitle: isChapter ? clean(chapter.text()) || undefined : undefined,
      chapterId: isChapter ? chapterPath : undefined,
    });
  });

  return items;
}

export function hasNextPage(html: string): boolean {
  return load(html)(".current + li > a").length > 0;
}

export function parseLatestUpdates(html: string): MangagoListing[] {
  const $ = load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  $(".row-1 .tit a").each((_, element) => {
    const titleLink = $(element);
    const href = titleLink.attr("href") ?? "";
    if (!href.includes("/read-manga/")) return;

    const id = parsePathname(href);
    if (!id || seen.has(id)) return;

    const title = clean(titleLink.attr("title") ?? titleLink.text());
    if (!title) return;

    const content = titleLink.closest(".row-1").parent();
    const cover = coverUrl(content.prev().find("img").first());

    const chapter = content.find("a.chico").first();
    const subtitle = clean(chapter.text());
    const chapterId = chapter.attr("href") ? parsePathname(chapter.attr("href")!) : undefined;

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

function eachInfoRow($: CheerioAPI, visit: (label: string, row: Cheerio<AnyNode>) => void): void {
  $("#information .manga_info li, #information .manga_right tr").each((_, element) => {
    const row = $(element);
    visit(row.find("b, label").first().text().trim().toLowerCase(), row);
  });
}

function parseSummary($: CheerioAPI): string | undefined {
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
    cover: coverUrl(info.find("img").first()),
    summary: parseSummary($) ?? "",
    additionalTitles,
    tags,
    contentType: isWebtoon ? ContentType.MANHWA : ContentType.MANGA,
    contentRating: ratingForGenres(tagTitles),
    ...(status === undefined ? {} : { status }),
    webUrl: absoluteUrl(contentId),
    ...(author || artist
      ? {
          additionalInfo: [
            additionalInfo.staff.section({
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: [
                ...(author
                  ? [additionalInfo.staff.item({ id: "author", title: author, subtitle: "Author" })]
                  : []),
                ...(artist && artist !== author
                  ? [additionalInfo.staff.item({ id: "artist", title: artist, subtitle: "Artist" })]
                  : []),
              ],
            }),
          ],
        }
      : {}),
  };
}

function parseChapterTitle(input: string): { number?: number; volume?: number; title?: string } {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");

  let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  let number: number | undefined;
  let volume: number | undefined;

  const volumeMatch = /^Vol\.\s*(?:(\d+(?:\.\d+)?)|TBA|N\/?A|NA)?\s*/i.exec(left);
  if (volumeMatch) {
    if (volumeMatch[1]) volume = Number(volumeMatch[1]);
    left = left.slice(volumeMatch[0].length).trimStart();
  }

  if (/^Ch\./i.test(left)) {
    left = left.slice(3).trimStart();
    const match = /^(\d+(?:\.\d+)?)/.exec(left);
    if (match) {
      number = Number(match[1]);
      left = left.slice(match[1]!.length).trimStart();
    }
  }

  const title = right && left ? `${left}: ${right}` : right || left || undefined;
  return { number, volume, title };
}

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

function parseGroupFromBracket(title: string): string {
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

function firstUploader(candidates: string[], chapterTitle: string): string {
  return (
    candidates
      .map((candidate) => clean(candidate))
      .find(
        (candidate) =>
          candidate &&
          candidate !== chapterTitle &&
          (!chapterTitle || !candidate.includes(chapterTitle)),
      ) ?? ""
  );
}

function parseUploader($: CheerioAPI, row: Cheerio<AnyNode>): string {
  const chapterTitle = clean(row.find("a.chico").first().text());

  const profile = firstUploader(
    row
      .find("a[href*='/home/'], a[href*='/user/'], a[href*='/profile/']")
      .not("a.chico")
      .toArray()
      .map((element) => $(element).text()),
    chapterTitle,
  );
  if (profile) return profile;

  const dateCell = row.find("td").last();
  const candidates = row
    .find(
      "td.no a, td.no, td.uk-table-shrink a, td.uk-table-shrink, td[class*='upload'] a, td[class*='upload'], td[class*='group'] a, td[class*='group']",
    )
    .not(dateCell)
    .not(dateCell.find("a"))
    .toArray()
    .map((element) => $(element).text());

  return firstUploader(candidates, chapterTitle);
}

function formatScanlator(rawUploader: string, rawTitle: string): string | undefined {
  const uploader = clean(rawUploader);
  const normalisedUploader = isOfficialUpload(uploader) ? "Official" : uploader;
  const group = parseGroupFromBracket(rawTitle) || (isOfficialUpload(rawTitle) ? "Official" : "");

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

    const chapterId = href.startsWith("http") ? canonicalReaderUrl(href) : parsePathname(href);
    if (!chapterId) return;

    const rawTitle = link.text().trim();
    if (!rawTitle) return;

    const parsedTitle = parseChapterTitle(rawTitle);
    const scanlator = formatScanlator(parseUploader($, row), rawTitle);
    const number = parsedTitle.number ?? parseChapterNumber(rawTitle);

    parsed.push({
      chapterId,
      number,
      index: 0,
      // The app renders this verbatim, so it carries the site's own wording,
      // numbering included; number and volume below only order the list.
      title: rawTitle,
      ...(parsedTitle.volume === undefined ? {} : { volume: parsedTitle.volume }),
      date: parseDate(clean(row.find("td").last().text())) ?? new Date(0),
      language: DefinedLanguages.ENGLISH,
      webUrl: absoluteUrl(chapterId),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    });
  });

  // Notices and side stories carry no number. Numbering them above the run put them at
  // the top of the list; they belong at the end of it, and never at index 0, which is
  // where the app resumes an unread title.
  const numbered = parsed.filter((chapter) => chapter.number !== 0);
  const extras = parsed.filter((chapter) => chapter.number === 0);

  const byNumber = (left: Chapter, right: Chapter): number => {
    if (left.number !== right.number) return right.number - left.number;
    return compareScanlators(left, right);
  };

  numbered.sort(byNumber);

  // The list reads newest first with the extras beneath it, while `index` counts up from
  // the earliest numbered chapter and leaves the extras above the run.
  const ordered = [...numbered, ...extras];
  const indexOf = new Map<Chapter, number>();
  numbered.forEach((chapter, position) => indexOf.set(chapter, numbered.length - 1 - position));
  extras.forEach((chapter, position) => indexOf.set(chapter, numbered.length + position));

  return ordered.map((chapter) => ({ ...chapter, index: indexOf.get(chapter) ?? 0 }));
}

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
        parsePathname(link.attr("href") ?? ""),
        clean(link.attr("title") ?? link.text()),
        coverUrl(link.find("img").first()),
      );
    },
  );

  $(".also-like li").each((_, element) => {
    const item = $(element);
    const link = item.find('h4 a[href*="/read-manga/"][title]').first();
    push(
      parsePathname(link.attr("href") ?? ""),
      clean(link.attr("title") ?? link.text()),
      coverUrl(item.find("img").first()),
    );
  });

  return items;
}

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
  statuses?: string[];
};

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

export { genreTitle, text };
