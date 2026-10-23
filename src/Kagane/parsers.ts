/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  additionalInfo,
  ContentType,
  PublicationStatus,
  type AdditionalInfoSection,
  type Chapter,
  type Content,
  type Highlight,
  type Option,
  type Pair,
  type Tag,
} from "@mana-app/types";

import {
  Mark,
  compactCount,
  decodeEntities,
  panelMode,
  firstFilled,
  parseDate,
  statusPill,
  titleCase,
  toBadge,
  typePill,
  base64ToBytes,
  bytesToUtf8,
} from "../common/index.ts";
import {
  BASE_URL,
  CONTENT_RATINGS,
  CHAPTER_GROUP_REGEX,
  CHAPTER_METADATA_REGEX,
  CHAPTER_NUMBER_PREFIX_REGEX,
  CHAPTER_TRAILING_GROUP_REGEX,
  CHAPTER_VOLUME_SUFFIX_REGEX,
  FilterID,
  TITLE_BRACKET_REGEX,
  type ChapterBook,
  type BookIndexResponse,
  type DetailsResponse,
  type SeriesSummary,
} from "./model.ts";
import { groupTags, tagFilterId, tagIdsOf } from "./tag-groups.ts";

export type TitleOptions = {
  cleanTitle: boolean;
  showSource: boolean;
  showEdition: boolean;
  sources: Record<string, string>;
};

export function formatTitle(
  title: string,
  options: TitleOptions,
  sourceId?: string | null,
  editionInfo?: string | null,
): string {
  const trimmed = title.trim();
  if (options.cleanTitle) return trimmed.replace(TITLE_BRACKET_REGEX, "").trim() || trimmed;

  let result = title.trim();
  if (options.showEdition && editionInfo) result = `${result} (${editionInfo})`;

  if (options.showSource && sourceId) {
    const sourceName = options.sources[sourceId];
    if (sourceName) result = `${result} [${sourceName}]`;
  }

  return result;
}

export function seriesUrl(seriesId: string): string {
  return `${BASE_URL}/series/${seriesId}`;
}

export function chapterUrl(seriesId: string, chapterId: string): string {
  return `${BASE_URL}/series/${seriesId}/reader/${chapterId}`;
}

function parseStatus(raw: string | undefined): PublicationStatus | undefined {
  switch ((raw ?? "").toUpperCase()) {
    case "ONGOING":
      return PublicationStatus.ONGOING;
    case "COMPLETED":
      return PublicationStatus.COMPLETED;
    case "HIATUS":
      return PublicationStatus.HIATUS;
    case "ABANDONED":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

function parseContentType(format: string | null | undefined): ContentType | undefined {
  switch ((format ?? "").toLowerCase()) {
    case "manga":
      return ContentType.MANGA;
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "comic":
      return ContentType.COMIC;
    default:
      return undefined;
  }
}

export function contentRatingId(
  value: Pick<SeriesSummary, "age_rating" | "is_pornographic" | "content_rating">,
): string | undefined {
  const legacy = CONTENT_RATINGS.find(
    (rating) => rating.toLowerCase() === value.content_rating?.trim().toLowerCase(),
  );
  if (value.is_pornographic === true || legacy === "Pornographic") return "Pornographic";
  if (value.age_rating === undefined && value.is_pornographic === undefined) return legacy;
  if (typeof value.is_pornographic !== "boolean") return undefined;
  const rating =
    value.age_rating === "Safe"
      ? "Safe"
      : value.age_rating === "FifteenPlus"
        ? "Suggestive"
        : value.age_rating === "EighteenPlus"
          ? "Erotica"
          : undefined;
  return value.content_rating != null && legacy !== rating ? undefined : rating;
}

export function parseContentRating(
  value: Pick<SeriesSummary, "age_rating" | "is_pornographic" | "content_rating">,
): ContentRating {
  switch (contentRatingId(value)) {
    case "Safe":
      return ContentRating.SAFE;
    case "Suggestive":
      return ContentRating.SUGGESTIVE;
    case "Pornographic":
      return ContentRating.EXPLICIT;
    case "Erotica":
      return ContentRating.MATURE;
    default:
      return ContentRating.MATURE;
  }
}

function formatStatus(book: SeriesSummary): string | undefined {
  switch ((book.publication_status ?? "").toUpperCase()) {
    case "ONGOING":
      return "Ongoing";
    case "COMPLETED":
      return "Completed";
    case "HIATUS":
      return "Hiatus";
    case "ABANDONED":
      return "Cancelled";
    default:
      return undefined;
  }
}

/** The site's own word for the format. "Other" says nothing, so it is not printed. */
export function formatKind(book: SeriesSummary): string {
  const format = book.format?.trim();
  return format && format.toLowerCase() !== "other" ? titleCase(format) : "";
}

export function highlightBadge(book: SeriesSummary): string {
  const kind = formatKind(book);
  const status = formatStatus(book) ?? "";
  return firstFilled(
    book.rating ? `${Mark.Rating} ${(book.rating / 10).toFixed(1)}` : "",
    typePill(kind),
    statusPill(status),
  );
}

/** What is left to say under the title once the pill has taken its half. */
export function formatDescriptor(book: SeriesSummary): string | undefined {
  const taken = highlightBadge(book);
  const kind = formatKind(book);
  const status = formatStatus(book) ?? "";

  const parts = [
    kind && taken.endsWith(kind) ? "" : kind,
    status && taken.endsWith(status) ? "" : status,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function formatLatestChapter(book: SeriesSummary): string | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;

  const chapter = latest.chapter_no?.trim();
  const volume = latest.volume_no?.trim();

  if (chapter) return volume ? `Vol.${volume} Ch.${chapter}` : `Ch. ${chapter}`;
  if (volume) return `Volume ${volume}`;
  return latest.title?.trim() || undefined;
}

export function parseLatestChapterDate(book: SeriesSummary): Date | undefined {
  const latest = book.latest_chapters?.[0];
  if (!latest) return undefined;
  return parseDate(latest.available_at ?? latest.created_at);
}

/**
 * The rows a detailed tile shows.
 *
 * No pill is drawn over the small thumbnail those tiles use, so what the pill would have
 * said has to be here too — otherwise a row is the only thing the reader sees and it is
 * missing the two facts the tile led with everywhere else.
 */
export function buildInfoRows(book: SeriesSummary): Pair[] {
  const rows: Pair[] = [];
  if (book.rating)
    rows.push({ key: "Rating", value: `${Mark.Rating} ${(book.rating / 10).toFixed(1)}` });

  const kind = formatKind(book);
  if (kind) rows.push({ key: "Type", value: `${Mark.Type} ${kind}` });

  const status = formatStatus(book);
  if (status) rows.push({ key: "Status", value: `${Mark.Status} ${status}` });

  const books = book.current_books;
  if (typeof books === "number" && books > 0) rows.push({ key: "Chapters", value: String(books) });

  if (book.start_year) rows.push({ key: "Year", value: String(book.start_year) });

  const genres = (book.genre_list ?? []).map((genre) => genre.name).slice(0, 2);
  if (genres.length > 0) rows.push({ key: "Genres", value: genres.join(", ") });

  // A tile stretches its whole row past about four lines, so the rest is dropped.
  return rows.slice(0, 4);
}

export function parseHighlight(
  book: SeriesSummary,
  options: TitleOptions,
  coverFor: (imageId: string) => string,
  extra?: { subtitle?: string; info?: Pair[] },
): Highlight {
  const badge = extra?.info ? undefined : toBadge(highlightBadge(book));

  return {
    id: book.series_id,
    title: formatTitle(book.title, options, book.source_id),
    cover: book.cover_image_id ? coverFor(book.cover_image_id) : "",
    ...(extra?.subtitle ? { subtitle: extra.subtitle } : {}),
    ...(badge === undefined ? {} : { badge }),
    ...(extra?.info && extra.info.length > 0 ? { info: extra.info } : {}),
    contentRating: parseContentRating(book),
    webUrl: seriesUrl(book.series_id),
  };
}

/** The most items the app keeps in one profile section. */
const SECTION_LIMIT = 10;

/**
 * A title's tags as sections, one per tag group, the way the search form groups them.
 *
 * The groups are cut from the site's whole tag list rather than this title's, so an entry
 * carries the same id — every alias of the tag — as the search form's picker, and the
 * section carries that picker's id: a tapped tag searches for exactly what the form would.
 * Past the app's ten items a section's remainder is named in the summary instead, and a tag
 * the list does not know goes in a plain Tags section.
 */
function tagSections(
  tags: { tag_id: string; tag_name: string }[],
  taxonomy: Option[],
): { sections: AdditionalInfoSection[]; overflow: string[] } {
  const present = new Set(tags.map((tag) => tag.tag_id.toLowerCase()));
  const represented = new Set<string>();
  const sections: AdditionalInfoSection[] = [];
  const overflow: string[] = [];

  const section = (id: string, title: string, entries: Option[]): void => {
    if (entries.length > SECTION_LIMIT)
      overflow.push(
        `More ${title} tags: ${entries
          .slice(SECTION_LIMIT)
          .map((entry) => entry.title)
          .join(", ")}`,
      );
    sections.push(
      additionalInfo.tags.section({
        id,
        title,
        items: entries
          .slice(0, SECTION_LIMIT)
          .map((entry) => additionalInfo.tags.item({ id: entry.id, title: entry.title })),
      }),
    );
  };

  for (const { group, options } of groupTags(taxonomy)) {
    const matched = options.filter((option) =>
      tagIdsOf(option.id).some((id) => present.has(id.toLowerCase())),
    );
    if (!matched.length) continue;
    for (const option of matched)
      for (const id of tagIdsOf(option.id)) represented.add(id.toLowerCase());
    section(tagFilterId(group.id), group.title, matched);
  }

  const rest = tags
    .filter((tag) => !represented.has(tag.tag_id.toLowerCase()))
    .map((tag) => ({ id: tag.tag_id, title: tag.tag_name }));
  if (rest.length) section(FilterID.Tags, "Tags", rest);

  return { sections, overflow };
}

export function parseContent(
  seriesId: string,
  details: DetailsResponse,
  options: TitleOptions & { showSpoilerTags: boolean },
  coverFor: (imageId: string) => string,
  taxonomy: Option[] = [],
): Content {
  const sourceName = details.source_id ? options.sources[details.source_id] : undefined;

  const authors = (details.series_staff ?? [])
    .filter((staff) => /author|story/i.test(staff.role))
    .map((staff) => staff.name);
  const artists = (details.series_staff ?? [])
    .filter((staff) => /artist|art/i.test(staff.role))
    .map((staff) => staff.name);

  const alternateTitles = (details.series_alternate_titles ?? [])
    .map((entry) => entry.title.trim())
    .filter(Boolean);

  // The chips under the title are the genres; the tags follow in sections of their own.
  const tags: Tag[] = (details.genres ?? [])
    .filter((genre) => options.showSpoilerTags || !genre.is_spoiler)
    .map((genre) => ({
      id: genre.genre_id,
      title: genre.genre_name,
    }));
  const visibleTags = (details.tags ?? []).filter(
    (tag) => options.showSpoilerTags || !tag.is_spoiler,
  );
  const grouped = tagSections(visibleTags, taxonomy);

  const summary = [buildSummary(details, sourceName), ...grouped.overflow].join("\n\n");
  const status = parseStatus(details.publication_status ?? details.upload_status);
  const contentType = parseContentType(details.format);

  const panel = panelMode({
    type: contentType,
    tags: [...tags, ...visibleTags.map((tag) => ({ title: tag.tag_name }))].map((tag) => tag.title),
  });

  return {
    title: formatTitle(details.title, options, details.source_id, details.edition_info),
    cover: details.series_covers?.[0]?.image_id ? coverFor(details.series_covers[0]!.image_id) : "",
    summary,
    additionalTitles: alternateTitles,
    tags,
    ...(contentType === undefined ? {} : { contentType }),
    ...(panel === undefined ? {} : { recommendedPanelMode: panel }),
    contentRating: parseContentRating(details),
    trackerInfo: Object.fromEntries(
      (details.series_links ?? []).flatMap((link) => {
        const match = /^https?:\/\/(?:www\.)?(anilist\.co|myanimelist\.net)\/manga\/(\d+)/.exec(
          link.url,
        );
        return match ? [[match[1] === "anilist.co" ? "anilist" : "mal", match[2]!]] : [];
      }),
    ),
    ...(status === undefined ? {} : { status }),
    webUrl: seriesUrl(seriesId),
    additionalInfo: [
      ...grouped.sections,
      ...(contentRatingId(details) === undefined
        ? [
            additionalInfo.tags.section({
              id: "content-rating-metadata",
              title: "Content rating metadata",
              items: [
                additionalInfo.tags.item({
                  id: "incomplete-rating",
                  title: "Incomplete metadata; Mature is used for app compatibility",
                }),
              ],
            }),
          ]
        : []),
      ...((details.series_links?.length ?? 0) > 0
        ? [
            additionalInfo.links.section({
              id: "links",
              title: "Links",
              items: details.series_links!.map((link) =>
                additionalInfo.links.item({
                  id: link.url,
                  title: link.label,
                  url: link.url,
                }),
              ),
            }),
          ]
        : []),
      ...(authors.length > 0 || artists.length > 0
        ? [
            additionalInfo.staff.section({
              id: "staff",
              title: "Staff",
              hasMore: false,
              items: [
                ...unique(authors).map((name) =>
                  additionalInfo.staff.item({
                    id: `author:${name}`,
                    title: name,
                    subtitle: "Author",
                  }),
                ),
                ...unique(artists)
                  .filter((name) => !authors.includes(name))
                  .map((name) =>
                    additionalInfo.staff.item({
                      id: `artist:${name}`,
                      title: name,
                      subtitle: "Artist",
                    }),
                  ),
              ],
            }),
          ]
        : []),
    ],
  };
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function formatRating(details: DetailsResponse): string | undefined {
  const percent =
    typeof details.average_rating === "number" && details.average_rating > 0
      ? details.average_rating
      : typeof details.bayesian_rating === "number" && details.bayesian_rating > 0
        ? details.bayesian_rating
        : undefined;

  return percent === undefined ? undefined : `${Mark.Rating} ${(percent / 10).toFixed(1)}`;
}

function formatViews(views: number | null | undefined): string | undefined {
  const count = compactCount(views);
  return count ? `${Mark.Views} ${count}` : undefined;
}

function buildSummary(details: DetailsResponse, sourceName: string | undefined): string {
  const parts: string[] = [];

  const stats = [formatRating(details), formatViews(details.total_views)].filter(Boolean);
  // Mana's `Content` has no rating or views field, so they lead the summary.
  if (stats.length > 0) parts.push(stats.join("  ·  "));

  const description = (details.description ?? "").trim();
  if (description) {
    parts.push(
      decodeEntities(description.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim(),
    );
  }

  if (sourceName) parts.push(`Source: ${sourceName}`);

  const alternates = (details.series_alternate_titles ?? [])
    .map((entry) => entry.title.trim())
    .filter(Boolean);
  if (alternates.length > 0) {
    parts.push(["Associated Name(s):", ...alternates.map((name) => `• ${name}`)].join("\n"));
  }

  return parts.join("\n\n").trim();
}

/**
 * The chapter's own name, with the numbering the site repeats inside the title
 * removed. The label below puts the number back once, so a title of
 * "Chapter 44 - Volume 9 (Ushi)" would otherwise say it twice.
 */
function parseChapterName(title: string): string {
  return title
    .replace(CHAPTER_METADATA_REGEX, "")
    .replace(CHAPTER_TRAILING_GROUP_REGEX, "")
    .replace(CHAPTER_VOLUME_SUFFIX_REGEX, "")
    .replace(CHAPTER_NUMBER_PREFIX_REGEX, "")
    .replace(/^[\s:.\-–—]+/, "")
    .trim();
}

/**
 * Who published the chapter: the series' upload source — an official publisher
 * or a scanlation group — with the group some titles name inline appended.
 */
function parseScanlator(
  book: ChapterBook,
  sourceName: string | undefined,
  official: boolean,
): string | undefined {
  // The tick marks an official upload, the way other clients for this site do.
  const base = sourceName
    ? official
      ? `${sourceName} ✓`
      : sourceName
    : (book.groups ?? []).map((group) => group.title).join(", ");

  const stripped = book.title.trim().replace(CHAPTER_METADATA_REGEX, "");
  const match = CHAPTER_GROUP_REGEX.exec(stripped);
  const tag = match?.[1] ?? match?.[2];

  if (base && tag) return `${base} (${tag})`;
  return base || tag || undefined;
}

/** "Vol.1 Ch.11 - Oleg: Apology" — the app prints this verbatim. */
function formatChapterLabel(number: number, volume: number | undefined, name: string): string {
  const label = [volume === undefined ? "" : `Vol.${volume}`, `Ch.${number}`]
    .filter(Boolean)
    .join(" ");
  return name ? `${label} - ${name}` : label;
}

export function chapterLanguage(value: unknown): string {
  if (typeof value !== "string") return "und";
  let code = value.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, string> = {
    "es-la": "es-419",
    "pt-la": "pt-br",
    iw: "he",
    in: "id",
    ji: "yi",
  };
  code =
    aliases[code] ?? code.replace(/^(iw|in|ji)-/, (prefix) => `${aliases[prefix.slice(0, -1)]}-`);
  code = code.replace(/^(ja|ko|zh)-ro$/, "$1-latn");
  if (
    !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*$/.test(
      code,
    ) ||
    /^(?:unk|und|unknown)(?:-|$)/.test(code)
  )
    return "und";
  return code
    .split("-")
    .map((part, index) =>
      index === 0
        ? part
        : /^[a-z]{4}$/.test(part)
          ? part[0]!.toUpperCase() + part.slice(1)
          : /^[a-z]{2}$/.test(part)
            ? part.toUpperCase()
            : part,
    )
    .join("-");
}

export function parseBookIndex(index: BookIndexResponse): ChapterBook[] {
  if (
    !Array.isArray(index.fields) ||
    !Array.isArray(index.books) ||
    !Array.isArray(index.groups) ||
    index.books.length !== index.count
  )
    throw new Error("Kagane returned an incomplete chapter index.");

  const ids = new Set<string>();
  return index.books.map((row): ChapterBook => {
    if (!Array.isArray(row) || row.length !== index.fields.length)
      throw new Error("Kagane returned an invalid chapter index row.");
    const value: Record<string, unknown> = Object.fromEntries(
      index.fields.map((field, column) => [field, row[column]]),
    );
    const { book_id, title, sort_no, chapter_no, volume_no, released_at, group_ix, page_count } =
      value;
    if (
      typeof book_id !== "string" ||
      !book_id ||
      ids.has(book_id) ||
      typeof title !== "string" ||
      typeof sort_no !== "number" ||
      !Number.isFinite(sort_no) ||
      (chapter_no != null && typeof chapter_no !== "string") ||
      (volume_no != null && typeof volume_no !== "string") ||
      (released_at != null && (typeof released_at !== "number" || !Number.isFinite(released_at))) ||
      !Array.isArray(group_ix)
    )
      throw new Error("Kagane returned invalid chapter index metadata.");
    ids.add(book_id);
    const groups = group_ix.map((position: unknown) => {
      if (
        typeof position !== "number" ||
        !Number.isInteger(position) ||
        position < 0 ||
        !index.groups[position]
      )
        throw new Error("Kagane returned an invalid chapter group index.");
      return index.groups[position]!;
    });
    const date = typeof released_at === "number" ? new Date(released_at * 1000) : undefined;
    if (date && !Number.isFinite(date.getTime()))
      throw new Error("Kagane returned an invalid chapter release date.");
    return {
      book_id,
      title,
      sort_no,
      groups,
      chapter_no: chapter_no as string | null | undefined,
      volume_no: volume_no as string | null | undefined,
      ...(typeof page_count === "number" && Number.isSafeInteger(page_count) && page_count > 0
        ? { page_count }
        : {}),
      ...(date ? { became_visible_at: date.toISOString() } : {}),
    };
  });
}

export function parseChapters(
  seriesId: string,
  details: DetailsResponse,
  options: { sourceName?: string; official?: boolean; chapterTitle?: string },
): Chapter[] {
  const books = details.series_books ?? [];
  // The index supplies reading order independently of uploads and restarted chapter numbers.
  const ordered = [...books].sort((left, right) => (left.sort_no ?? 0) - (right.sort_no ?? 0));

  const chapters = ordered.map((book, index) => {
    const scanlator = parseScanlator(book, options.sourceName, options.official === true);
    const title = book.title.trim();
    const parsedNumber = Number.parseFloat(
      (
        (book.chapter_no ?? "").trim() ||
        (CHAPTER_NUMBER_PREFIX_REGEX.exec(title)?.[1] ?? "")
      ).replace(/[^\d.]/g, ""),
    );
    const name = parseChapterName(title);
    const volume = Number.parseFloat((book.volume_no ?? "").replace(/[^\d.]/g, ""));

    const numbered = Number.isFinite(parsedNumber);
    const number = numbered ? parsedNumber : 0;
    const label = title.replace(CHAPTER_METADATA_REGEX, "").trim();
    const hasLabel = /^(?:\(?S\d+\)?\s*)?(?:episodes?|chapters?|ch\.?|volumes?|vol\.?)\s*\d/i.test(
      label,
    );

    return {
      chapterId: book.book_id,
      number,
      index,
      numbered,
      name,
      hasLabel,
      originalTitle: title,
      title: hasLabel ? label : name,
      ...(Number.isFinite(volume) ? { volume } : {}),
      date:
        parseDate(book.became_visible_at ?? book.created_at ?? book.published_on) ?? new Date(0),
      language: chapterLanguage(details.translated_language),
      webUrl: chapterUrl(seriesId, book.book_id),
      ...(scanlator ? { provider: { id: scanlator, name: scanlator } } : {}),
    };
  });

  placeUnnumbered(chapters);
  for (const chapter of chapters) {
    // A number given to an unnumbered chapter only places it; it is never printed as if the
    // site had said it, so a Prologue stays "Prologue" rather than becoming "Ch.0".
    if (!chapter.numbered && options.chapterTitle !== "original") {
      chapter.title = chapter.name || chapter.originalTitle;
      continue;
    }
    switch (options.chapterTitle ?? "auto") {
      case "original":
        chapter.title = chapter.originalTitle;
        break;
      case "optional":
        chapter.title = chapter.name || formatChapterLabel(chapter.number, chapter.volume, "");
        break;
      case "always":
        chapter.title = formatChapterLabel(chapter.number, undefined, chapter.name);
        break;
      case "vol_chapter":
        chapter.title = formatChapterLabel(chapter.number, chapter.volume, chapter.name);
        break;
      default:
        if (!chapter.hasLabel)
          chapter.title = formatChapterLabel(chapter.number, chapter.volume, chapter.name);
    }
  }

  return chapters
    .map(
      (
        {
          numbered: _numbered,
          name: _name,
          hasLabel: _hasLabel,
          originalTitle: _originalTitle,
          ...chapter
        },
        index,
      ) => ({
        ...chapter,
        index,
      }),
    )
    .reverse();
}

/**
 * Numbers for chapters the site left unnumbered, from where they sit in reading order: a
 * run before the first numbered chapter counts up from 0, one between two numbered chapters
 * falls between them, and one after the last follows it. Numbering them past the end
 * instead put a Prologue at Ch.101 of a 100-chapter series, and reading it marked the whole
 * series read for trackers and progress.
 */
function placeUnnumbered(chapters: { number: number; numbered: boolean }[]): void {
  let start = 0;
  while (start < chapters.length) {
    if (chapters[start]!.numbered) {
      start++;
      continue;
    }
    let end = start;
    while (end < chapters.length && !chapters[end]!.numbered) end++;
    const before = start > 0 ? chapters[start - 1]!.number : undefined;
    const after = end < chapters.length ? chapters[end]!.number : undefined;
    const count = end - start;
    for (let offset = 0; offset < count; offset++) {
      let number: number;
      if (before === undefined) {
        const step = after === undefined ? 1 : Math.min(0.1, after / count);
        number = after === undefined ? offset + 1 : offset * step;
      } else {
        const step = after === undefined ? 0.1 : Math.min(0.1, (after - before) / (count + 1));
        number = before + step * (offset + 1);
      }
      chapters[start + offset]!.number = Math.round(number * 1000) / 1000;
    }
    start = end;
  }
}

export function readerExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (payload) {
      const claims: unknown = JSON.parse(bytesToUtf8(base64ToBytes(payload, true)));
      if (
        typeof claims === "object" &&
        claims !== null &&
        "exp" in claims &&
        typeof claims.exp === "number" &&
        Number.isFinite(claims.exp)
      )
        return claims.exp * 1000 - 15_000;
    }
  } catch {
    // Opaque or incomplete tokens get a short renewal interval.
  }
  return Date.now() + 60_000;
}
