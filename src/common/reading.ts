import { ContentType, ReadingMode } from "@mana-app/types";

/** Words a site uses for a strip meant to be scrolled rather than turned. */
const STRIP_TAGS = new Set([
  "longstrip",
  "long strip",
  "long-strip",
  "webtoon",
  "webcomic",
  "vertical",
  "full color",
  "full_color",
]);

/**
 * How a site spells the direction it wants a title read in.
 *
 * `ttb` is the one that matters — a strip scrolled downward — and the two horizontal ones
 * decide which edge a page turn starts from. Sites spell them as three-letter codes, as
 * words, or not at all.
 */
function statedMode(direction: string): ReadingMode | undefined {
  const value = direction
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!value) return undefined;

  if (value === "ttb" || value === "toptobottom" || value === "vertical" || value === "webtoon") {
    return ReadingMode.WEBTOON;
  }
  if (value === "rtl" || value === "righttoleft") return ReadingMode.PAGED_MANGA;
  if (value === "ltr" || value === "lefttoright") return ReadingMode.PAGED_COMIC;
  return undefined;
}

export type PanelModeOptions = {
  /** What the site itself says, where it says anything. Outranks every guess below. */
  direction?: string | null;
  type?: ContentType;
  /** Genres or formats as the site names them; one of them may say "long strip". */
  tags?: readonly string[];
};

/**
 * Which way a reader should be handed the pages, as far as the source can tell.
 *
 * The app opens at `PAGED_COMIC` when a source says nothing, which is wrong for most of
 * what these sites carry: a manhwa is a strip and a manga turns right to left. So the site's
 * own statement is taken first, then a tag that names the format, then what the title is.
 * Nothing is returned where none of the three answers, rather than guessing at a novel or
 * an unclassified upload.
 */
export function panelMode(options: PanelModeOptions = {}): ReadingMode | undefined {
  const { direction, type, tags = [] } = options;

  const stated = statedMode(direction ?? "");
  if (stated !== undefined) return stated;

  // A format tag beats the type: a manga serialised as a strip is still a strip.
  if (tags.some((tag) => STRIP_TAGS.has(tag.trim().toLowerCase()))) return ReadingMode.WEBTOON;

  switch (type) {
    case ContentType.MANHWA:
    case ContentType.MANHUA:
      return ReadingMode.WEBTOON;
    case ContentType.MANGA:
      return ReadingMode.PAGED_MANGA;
    case ContentType.COMIC:
      return ReadingMode.PAGED_COMIC;
    default:
      return undefined;
  }
}

/**
 * What a site's own word for a format means, where it writes one out.
 *
 * Sites name these the same handful of ways — a type field, a tag, a breadcrumb — and each
 * source would otherwise carry its own copy of the same switch.
 */
export function contentTypeOf(word: string | null | undefined): ContentType | undefined {
  const value = (word ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (!value) return undefined;

  if (value === "manga" || value === "japanese" || value === "ja") return ContentType.MANGA;
  if (value === "manhwa" || value === "korean" || value === "ko") return ContentType.MANHWA;
  if (value === "manhua" || value === "chinese" || value === "zh" || value === "zhhk") {
    return ContentType.MANHUA;
  }
  if (value === "novel" || value === "lightnovel" || value === "webnovel") {
    return ContentType.NOVEL;
  }
  if (value === "comic" || value === "oel" || value === "cartoon" || value === "western") {
    return ContentType.COMIC;
  }
  return undefined;
}
