/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Rating compatibility adapted from the Kagane source originally © 2026 Inkdex. */
import {
  AdditionalInfoType,
  Chapter,
  Content,
  ContentRating,
  ContentType,
  Highlight,
  highlights,
  HighlightsSection,
  links,
  PublicationStatus,
  ReadingMode,
  staff,
  tags as nativeTags,
} from "@mana-app/types";
import { decode } from "html-entities";
import { chapterLanguage } from "./KaganeLanguage";
import { incompleteRatingInfo, ratingAllowed } from "./ContentRatingPolicy";
import {
  AlternateTitle,
  Book,
  chapterURL,
  Classification,
  Detail,
  imageURL,
  Rating,
  RATINGS,
  Series,
  seriesURL,
  Settings,
  strictUUID,
  TagEntry,
  TrendingEntry,
  UploadSource,
} from "./KaganeModels";
import { groupTags, tagFilterId, tagIdsOf } from "./tag-groups";

const hasControls = (value: string): boolean =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 ||
      (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159),
  );

export function classify(value: Classification): Rating | undefined {
  const legacyValue = value.content_rating;
  const legacy =
    typeof legacyValue === "string"
      ? RATINGS.find((rating) => rating.toLowerCase() === legacyValue.trim().toLowerCase())
      : undefined;
  // Positive explicit evidence must never be downgraded by incomplete/conflicting fields.
  if (value.is_pornographic === true || legacy === "Pornographic") return "Pornographic";
  if (value.age_rating === undefined && value.is_pornographic === undefined) return legacy;
  if (typeof value.is_pornographic !== "boolean") return undefined;
  let rating: Rating;
  if (value.age_rating === "Safe" && !value.is_pornographic) rating = "Safe";
  else if (value.age_rating === "FifteenPlus" && !value.is_pornographic) rating = "Suggestive";
  else if (value.age_rating === "EighteenPlus")
    rating = value.is_pornographic ? "Pornographic" : "Erotica";
  else return undefined;
  return value.content_rating != null && legacy !== rating ? undefined : rating;
}

export function manaRating(value: Classification): ContentRating {
  switch (classify(value)) {
    case "Safe":
      return ContentRating.SAFE;
    case "Suggestive":
      return ContentRating.SUGGESTIVE;
    case "Erotica":
      return ContentRating.MATURE;
    case "Pornographic":
      return ContentRating.EXPLICIT;
    default:
      return ContentRating.SUGGESTIVE;
  }
}

export function allowed(
  value: Classification,
  settings: Settings,
  selected?: readonly string[],
  host?: readonly ContentRating[],
): boolean {
  const rating = classify(value);
  if (
    rating
      ? !settings.contentRatings.includes(rating)
      : settings.contentRatings.length !== RATINGS.length
  )
    return false;
  if (selected?.length && !selected.includes(rating ?? "Suggestive")) return false;
  return ratingAllowed(manaRating(value), { allowedContentRatings: host });
}

/** Prefer English only when the provider explicitly labels the title as English.
 * Catalog alternate_titles are unlabelled strings and cannot establish a language.
 */
export function preferredTitle(
  primary: string,
  language?: string | null,
  alternates: AlternateTitle[] = [],
): string {
  const isEnglish = (value?: string | null): boolean =>
    typeof value === "string" && /^(?:en(?:[-_][a-z0-9]{2,8})*|english)$/i.test(value.trim());
  if (isEnglish(language)) return primary.trim();
  return (
    (Array.isArray(alternates) ? alternates : [])
      .find(
        (entry) =>
          entry && isEnglish(entry.label) && typeof entry.title === "string" && entry.title.trim(),
      )
      ?.title.trim() || primary.trim()
  );
}

export function displayTitle(
  title: string,
  settings: Settings,
  sources: UploadSource[],
  sourceId?: string | null,
  edition?: string | null,
): string {
  let result = title.trim();
  if (settings.cleanTitle)
    result = result.replace(/(?:\([^()]*\)|\[[^[\]]*\])\s*$/, "").trim() || result;
  if (settings.showEdition && edition?.trim()) result += ` (${edition.trim()})`;
  const source = sources.find((item) => item.source_id === sourceId);
  if (settings.showSource && source?.title) result += ` [${source.title}]`;
  return result;
}

/** The pill takes score, then format, then status; detailed layouts show all three as rows instead. */
export function highlight(
  series: Series,
  settings: Settings,
  sources: UploadSource[],
  detailed = false,
): Highlight {
  const latest = series.latest_chapters?.[0];
  const score =
    typeof series.rating === "number" &&
    Number.isFinite(series.rating) &&
    series.rating > 0 &&
    series.rating <= 100
      ? `★ ${(series.rating / 10).toFixed(1)}`
      : undefined;
  const format = series.format && series.format !== "Other" ? series.format : undefined;
  const status = statusLabel(series.publication_status);
  // A thin ring vanishes over cover art, so the pill takes a filled mark for status.
  const pill = score ?? format ?? (status ? `🔗 ${status}` : undefined);
  const chapter =
    (latest?.chapter_no
      ? `Ch. ${latest.chapter_no}`
      : latest?.volume_no
        ? `Vol. ${latest.volume_no}`
        : latest?.title?.trim()) ||
    (typeof series.current_books === "number" ? `${series.current_books} Chapters` : undefined);
  const subtitle = [chapter, detailed || (!score && !format) ? undefined : status]
    .filter(Boolean)
    .join(" • ");
  return {
    id: series.series_id,
    title: displayTitle(
      preferredTitle(series.title, series.title_language),
      settings,
      sources,
      series.source_id,
      series.edition_info,
    ),
    cover: imageURL(series.cover_image_id),
    webUrl: seriesURL(series.series_id),
    contentRating: manaRating(series),
    subtitle: subtitle || undefined,
    badge: !detailed && pill ? { text: pill } : undefined,
    // A detailed row grows past about four lines, so the rest is dropped.
    info: [
      ...(score ? [{ key: "Rating", value: score }] : []),
      ...(format ? [{ key: "Type", value: `♤ ${format}` }] : []),
      ...(status ? [{ key: "Status", value: `◌ ${status}` }] : []),
      ...(typeof series.current_books === "number" && series.current_books > 0
        ? [{ key: "Chapters", value: String(series.current_books) }]
        : []),
      ...(series.start_year ? [{ key: "Year", value: String(series.start_year) }] : []),
      ...(series.genre_list?.length
        ? [
            {
              key: "Genres",
              value: series.genre_list
                .slice(0, 2)
                .map((genre) => genre.name)
                .join(", "),
            },
          ]
        : []),
    ].slice(0, 4),
  };
}

/** The chart's own rank, movement and growth, which carry no review score. */
export function chartHighlight(
  entry: TrendingEntry,
  settings: Settings,
  sources: UploadSource[],
): Highlight {
  const movement = entry.is_new
    ? "New"
    : entry.delta
      ? `${entry.delta > 0 ? "Up" : "Down"} ${Math.abs(entry.delta)}`
      : undefined;
  return {
    ...highlight(entry.series, settings, sources, true),
    info: [
      { key: "Rank", value: String(entry.position) },
      ...(movement ? [{ key: "Movement", value: movement }] : []),
      ...(entry.lift && entry.lift > 1
        ? [{ key: "Weekly growth", value: `+${Math.round((entry.lift - 1) * 100)}%` }]
        : []),
    ],
  };
}

export function uploadAllowed(
  settings: Settings,
  sources: UploadSource[],
  sourceId?: string | null,
): boolean {
  if (settings.uploadSource === "all") return true;
  const source = sources.find((entry) => entry.source_id === sourceId);
  return (
    !!source &&
    (settings.uploadSource === "official"
      ? source.source_type === "Official"
      : source.source_type !== "Official")
  );
}

function statusLabel(value: unknown): string | undefined {
  switch (typeof value === "string" ? value.trim().toLowerCase() : "") {
    case "ongoing":
      return "Ongoing";
    case "completed":
      return "Completed";
    case "hiatus":
      return "Hiatus";
    case "abandoned":
      return "Cancelled";
    default:
      return undefined;
  }
}

/** Only expose evidenced provider-published links, without fetching destinations. */
function trackerLinks(entries: Detail["series_links"]) {
  const trackers = [
    {
      id: "anilist",
      title: "AniList",
      kind: "Tracker",
      pattern: /^https:\/\/anilist\.co\/manga\/([1-9][0-9]*)\/?$/,
    },
    {
      id: "mal",
      title: "MyAnimeList",
      kind: "Tracker",
      pattern: /^https:\/\/myanimelist\.net\/manga\/([1-9][0-9]*)(?:\/[A-Za-z0-9_-]+)?\/?$/,
    },
    {
      id: "kitsu",
      title: "Kitsu",
      kind: "Tracker",
      pattern: /^https:\/\/kitsu\.app\/manga\/([1-9][0-9]*)\/?$/,
    },
    {
      id: "mangaupdates",
      title: "MangaUpdates",
      kind: "Tracker",
      pattern:
        /^https:\/\/www\.mangaupdates\.com\/series\/([a-z0-9]{7})(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/,
    },
    {
      id: "animeplanet",
      title: "Anime-Planet",
      kind: "Tracker",
      pattern: /^https:\/\/www\.anime-planet\.com\/manga\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/,
    },
    {
      id: "mangabaka",
      title: "MangaBaka",
      kind: "Other",
      pattern: /^https:\/\/mangabaka\.org\/([1-9][0-9]*)\/?$/,
    },
    {
      id: "mangadex",
      title: "MangaDex",
      kind: "Other",
      pattern:
        /^https:\/\/mangadex\.org\/title\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/,
    },
    {
      id: "wikipedia-en",
      title: "Wikipedia",
      kind: "Other",
      pattern: /^https:\/\/en\.wikipedia\.org\/wiki\/((?:[A-Za-z0-9_().-]|%[0-9a-fA-F]{2})+)$/,
    },
    {
      id: "wikipedia-ja",
      title: "Wikipedia (ja)",
      kind: "Other",
      pattern: /^https:\/\/ja\.wikipedia\.org\/wiki\/((?:[A-Za-z0-9_().-]|%[0-9a-fA-F]{2})+)$/,
    },
    {
      id: "ann",
      title: "Anime News Network",
      kind: "Other",
      pattern: /^https:\/\/www\.animenewsnetwork\.com\/encyclopedia\/manga\.php\?id=([1-9][0-9]*)$/,
    },
    {
      id: "viz",
      title: "VIZ",
      kind: "Official",
      pattern: /^https:\/\/www\.viz\.com\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/,
    },
    {
      id: "youngjump",
      title: "Young Jump",
      kind: "Other",
      pattern: /^https:\/\/youngjump\.jp\/manga\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/,
    },
  ];
  const seen = new Set<string>();
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    if (typeof entry?.url !== "string" || hasControls(entry.url)) return [];
    const url = entry.url.trim();
    for (const tracker of trackers) {
      if (entry.kind !== tracker.kind) continue;
      const match = tracker.pattern.exec(url);
      if (!match) continue;
      let identity = match[1] ?? "";
      if (tracker.id.startsWith("wikipedia-")) {
        try {
          identity = decodeURIComponent(identity);
        } catch {
          return [];
        }
        // Reject encoded delimiters, dot segments and double encodings.
        if (
          !identity ||
          hasControls(identity) ||
          /^[.]{1,2}$/.test(identity) ||
          !/^[\p{L}\p{M}\p{N}_().-]+$/u.test(identity)
        )
          return [];
      }
      // Slugs and a trailing slash do not create another tracker identity.
      const id = `${tracker.id}:${identity}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [links.item({ id, title: tracker.title, url })];
    }
    return [];
  });
}

export function visibleDetailTags(
  details: Detail,
  settings: Settings,
): NonNullable<Detail["tags"]> {
  return (details.tags ?? []).filter(
    (tag) => settings.showSpoilers || !(tag.is_spoiler || tag.spoiler),
  );
}

export function content(
  id: string,
  details: Detail,
  settings: Settings,
  sources: UploadSource[],
  taxonomy: TagEntry[],
): Content {
  const type = (
    {
      Manga: ContentType.MANGA,
      Manhwa: ContentType.MANHWA,
      Manhua: ContentType.MANHUA,
      Comic: ContentType.COMIC,
    } as Record<string, ContentType>
  )[details.format ?? ""];
  const status = (
    {
      Ongoing: PublicationStatus.ONGOING,
      Completed: PublicationStatus.COMPLETED,
      Hiatus: PublicationStatus.HIATUS,
      Cancelled: PublicationStatus.CANCELLED,
    } as Record<string, PublicationStatus>
  )[statusLabel(details.publication_status) ?? ""];
  const uploadStatus = statusLabel(details.upload_status);
  const covers = [...(details.series_covers ?? [])]
    .sort((left, right) => Number(right.is_main) - Number(left.is_main))
    .map((cover) => imageURL(cover.image_id))
    .filter(Boolean);
  // Mana's main chips belong to the genres filter, not the narrative-tag namespace.
  const visibleGenres = (details.genres ?? []).filter(
    (genre) => settings.showSpoilers || !genre.is_spoiler,
  );
  const tags = visibleGenres.flatMap((genre) => {
    const id = strictUUID(genre.genre_id);
    return id ? [{ id, title: genre.genre_name }] : [];
  });
  const visibleTags = visibleDetailTags(details, settings);
  const visibleIds = new Set(visibleTags.map((tag) => tag.tag_id));
  const representedIds = new Set<string>();
  const extraTags: string[] = [];
  const unmatchedGenres = visibleGenres.filter((genre) => !strictUUID(genre.genre_id));
  if (unmatchedGenres.length)
    extraTags.push(
      `Other source genres (not tappable here):\n${unmatchedGenres.map((genre) => genre.genre_name).join(", ")}`,
    );
  // Use the full taxonomy, exactly as getSearchForm does. Grouping only this
  // title's tags would lose alternate IDs and could change the option title.
  const tagSections = groupTags(
    taxonomy.map((tag) => ({ id: tag.id, title: tag.tag_name })),
  ).flatMap(({ group, options }) => {
    const present = options.filter((option) =>
      tagIdsOf(option.id).some((id) => visibleIds.has(id)),
    );
    if (!present.length) return [];
    present.forEach((option) => tagIdsOf(option.id).forEach((id) => representedIds.add(id)));
    // The pinned SDK persists ten items per section. Keep overflow readable
    // instead of inventing section IDs that the search form does not own.
    if (present.length > 10)
      extraTags.push(
        `Additional ${group.title} tags (use search filters):\n${present
          .slice(10)
          .map((option) => option.title)
          .join(", ")}`,
      );
    return [
      nativeTags.section({
        id: tagFilterId(group.id),
        title: group.title,
        items: present.slice(0, 10).map((option) => nativeTags.item(option)),
      }),
    ];
  });
  const unmatched = visibleTags.filter((tag) => !tag.tag_id || !representedIds.has(tag.tag_id));
  if (unmatched.length)
    extraTags.push(
      `Other source tags (not tappable here):\n${unmatched.map((tag) => tag.tag_name).join(", ")}`,
    );
  const people = (details.series_staff ?? []).map((person) =>
    staff.item({ id: `${person.role}:${person.name}`, title: person.name, subtitle: person.role }),
  );
  const description = decode(
    (details.description ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, ""),
  ).trim();
  const source = sources.find((item) => item.source_id === details.source_id)?.title;
  const externalLinks = trackerLinks(details.series_links);
  const primary = preferredTitle(
    details.title,
    details.title_language,
    details.series_alternate_titles,
  );
  const title = displayTitle(primary, settings, sources, details.source_id, details.edition_info);
  const additionalTitles = [
    ...new Set(
      [
        details.title,
        ...(Array.isArray(details.series_alternate_titles)
          ? details.series_alternate_titles
          : []
        ).map((entry) => entry?.title),
      ]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const associatedNames = additionalTitles.filter((value) => value !== primary && value !== title);
  // The site's title page prefers the Bayesian score from 150 ratings on.
  const score =
    (details.total_ratings ?? 0) >= 150 && typeof details.bayesian_rating === "number"
      ? details.bayesian_rating
      : details.average_rating;
  // Group only the integer prefix; retain fractional precision and exponent notation.
  const stats = [
    typeof score === "number" && Number.isFinite(score) && score > 0 && score <= 100
      ? `★ ${(score / 10).toFixed(1)}`
      : "",
    typeof details.total_views === "number" &&
    Number.isFinite(details.total_views) &&
    details.total_views >= 0
      ? `◉ ${String(details.total_views).replace(/^\d+/, (integer) => integer.replace(/\B(?=(\d{3})+(?!\d))/g, ","))} views`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = [
    stats,
    description,
    associatedNames.length ? `Associated names:\n${associatedNames.join("\n")}` : "",
    source ? `Source: ${source}` : "",
    details.edition_info ? `Edition: ${details.edition_info}` : "",
    uploadStatus ? `Upload status: ${uploadStatus}` : "",
    ...extraTags,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    title,
    cover: covers[0] ?? "",
    additionalCovers: covers.slice(1),
    summary,
    tags,
    contentType: type,
    status,
    additionalTitles,
    contentRating: manaRating(details),
    webUrl: seriesURL(id),
    recommendedPanelMode: [
      ...visibleGenres.map((genre) => genre.genre_name),
      ...visibleTags.map((tag) => tag.tag_name),
    ].some((title) => /^(?:webtoon|long strip)$/i.test(title))
      ? ReadingMode.WEBTOON
      : type === ContentType.MANHWA || type === ContentType.MANHUA || type === ContentType.COMIC
        ? ReadingMode.PAGED_COMIC
        : ReadingMode.PAGED_MANGA,
    additionalInfo: [
      ...tagSections,
      ...(people.length
        ? [staff.section({ id: "staff", title: "Staff", hasMore: false, items: people })]
        : []),
      ...Array.from({ length: Math.ceil(externalLinks.length / 10) }, (_, index) =>
        links.section({
          id: index ? `links-${index + 1}` : "links",
          title: index ? "More links" : "Links",
          items: externalLinks.slice(index * 10, (index + 1) * 10),
        }),
      ),
      ...(!classify(details) ? [incompleteRatingInfo()] : []),
    ],
  };
}

/** This endpoint lacks genre/tag metadata, so exclusions prohibit the request. */
export function editionSection(
  rows: unknown[],
  currentId: string,
  settings: Settings,
  host?: readonly ContentRating[],
): HighlightsSection | undefined {
  if (settings.excludedGenres.length || settings.excludedTags.length) return undefined;
  const seen = new Set<string>([currentId.toLowerCase()]);
  const items = rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const id = strictUUID(row.id),
      cover = strictUUID(row.cover_image_id),
      sourceId = strictUUID(row.source_id);
    const source =
      row.source && typeof row.source === "object" && !Array.isArray(row.source)
        ? (row.source as Record<string, unknown>)
        : undefined;
    if (
      !id ||
      !cover ||
      !sourceId ||
      seen.has(id) ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      hasControls(row.title)
    )
      return [];
    if (
      !source ||
      source.id !== row.source_id ||
      !strictUUID(source.id) ||
      typeof source.title !== "string" ||
      !source.title.trim() ||
      hasControls(source.title) ||
      !["Official", "Unofficial", "Mixed"].includes(source.source_type as string)
    )
      return [];
    if (
      !["Manga", "Manhwa", "Manhua", "Comic", "Other"].includes(row.format as string) ||
      typeof row.is_disturbing !== "boolean"
    )
      return [];
    const language = chapterLanguage(row.translated_language);
    if (
      language === "und" ||
      chapterLanguage(row.title_language) === "und" ||
      (settings.languages.length &&
        !settings.languages.some((value) => chapterLanguage(value) === language))
    )
      return [];
    if (
      row.edition_info != null &&
      (typeof row.edition_info !== "string" || hasControls(row.edition_info))
    )
      return [];
    const classification = row as Classification;
    if (!classify(classification) || !allowed(classification, settings, undefined, host)) return [];
    if (
      settings.uploadSource !== "all" &&
      (settings.uploadSource === "official"
        ? source.source_type !== "Official"
        : source.source_type === "Official")
    )
      return [];
    seen.add(id);
    return [
      {
        type: AdditionalInfoType.Highlights as const,
        id,
        title: displayTitle(
          row.title,
          settings,
          [{ source_id: sourceId, title: source.title, source_type: source.source_type as string }],
          sourceId,
          row.edition_info as string | null | undefined,
        ),
        cover: imageURL(cover),
        webUrl: seriesURL(id),
        contentRating: manaRating(classification),
      },
    ];
  });
  return items.length
    ? highlights.section({
        id: "other-editions",
        title: items.length > 10 ? "Other Editions (first 10)" : "Other Editions",
        hasMore: false,
        items: items.slice(0, 10),
      })
    : undefined;
}

/** The site's recommendations for a series with no other edition, from rows the caller has already filtered. */
export function similarSection(
  rows: Series[],
  settings: Settings,
  sources: UploadSource[],
): HighlightsSection | undefined {
  const items = rows.slice(0, 10).map((row) => ({
    type: AdditionalInfoType.Highlights as const,
    id: row.series_id,
    title: displayTitle(
      preferredTitle(row.title, row.title_language),
      settings,
      sources,
      row.source_id,
      row.edition_info,
    ),
    cover: imageURL(row.cover_image_id),
    webUrl: seriesURL(row.series_id),
    contentRating: manaRating(row),
  }));
  return items.length
    ? highlights.section({ id: "similar", title: "More like this", hasMore: false, items })
    : undefined;
}

function date(value?: string | null): Date {
  if (!value) return new Date(0);
  const parsed = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export function available(book: Book): boolean {
  return (
    book.is_locked !== true &&
    book.requires_login !== true &&
    book.is_paid !== true &&
    (!book.available_at || date(book.available_at).getTime() <= Date.now())
  );
}

export function chapters(
  id: string,
  books: Book[],
  details: Detail,
  settings: Settings,
  sources: UploadSource[],
): Chapter[] {
  const source = sources.find((item) => item.source_id === details.source_id);
  // The current cursor API is oldest first. Its sort_no is a position, not
  // necessarily a chapter number (decimal chapters and volume-only books exist).
  return [...books]
    .sort((left, right) => (left.sort_no ?? 0) - (right.sort_no ?? 0))
    .filter(available)
    .map((book, index) => {
      const parsed = Number.parseFloat(
        book.chapter_no?.trim() ||
          book.title.match(
            /^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)/i,
          )?.[1] ||
          "",
      );
      const volume = Number.parseFloat(book.volume_no ?? "");
      const number = Number.isFinite(parsed)
        ? parsed
        : Number.isFinite(volume)
          ? 0
          : (book.sort_no ?? index + 1);
      const original = book.title.trim();
      let name = original
        .replace(/(?:\s*\{[^{}]*\})+\s*$/, "")
        .replace(
          /^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*\d+(?:\.\d+)?\s*(?:[-:\u2013\u2014]\s*)?/i,
          "",
        )
        .trim();
      if (Number.isFinite(parsed)) {
        const escaped = String(parsed).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        name = name
          .replace(new RegExp(`^${escaped}(?:\\.\\s+|\\s*[-:\\u2013\\u2014]\\s*|\\s+)`), "")
          .trim();
      }
      const label = `${settings.chapterTitle === "vol_chapter" && Number.isFinite(volume) ? `Vol.${volume} ` : ""}Ch.${number}`;
      const title =
        settings.chapterTitle === "original"
          ? original
          : settings.chapterTitle === "optional"
            ? name || original
            : `${label}${name ? ` - ${name}` : ""}`;
      const provider = source?.title || (book.groups ?? []).map((group) => group.title).join(", ");
      return {
        chapterId: book.book_id,
        number,
        index,
        title,
        date: date(book.released_at ?? book.created_at),
        volume: Number.isFinite(volume) ? volume : undefined,
        language: chapterLanguage(details.translated_language),
        webUrl: chapterURL(id, book.book_id),
        provider: provider
          ? {
              id: source?.source_id ?? provider,
              name: provider + (source?.source_type === "Official" ? " ✓" : ""),
            }
          : undefined,
      };
    })
    .map((chapter, index) => ({ ...chapter, index }))
    .reverse();
}

/** Decode only the public token's expiration hint, never execute remote content. */
export function readerExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return Date.now() + 60_000;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0;
    let count = 0;
    let decoded = "";
    for (const character of payload.replace(/-/g, "+").replace(/_/g, "/")) {
      if (character === "=") break;
      const value = alphabet.indexOf(character);
      if (value < 0) return Date.now() + 60_000;
      bits = (bits << 6) | value;
      count += 6;
      if (count >= 8) {
        count -= 8;
        decoded += String.fromCharCode((bits >> count) & 255);
      }
    }
    const claims: unknown = JSON.parse(decoded);
    if (typeof claims === "object" && claims !== null && "exp" in claims) {
      const exp = (claims as { exp?: unknown }).exp;
      if (typeof exp === "number" && Number.isFinite(exp)) return exp * 1000 - 15_000;
    }
  } catch {
    /* Opaque tokens use a short conservative refresh interval. */
  }
  return Date.now() + 60_000;
}
