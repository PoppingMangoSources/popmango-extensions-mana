/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating, JsonValue, Option, SearchRequest } from "@mana-app/types";
import {
  AGE_RATINGS,
  CHAPTER_PRESETS,
  Filters,
  MAX_IDS,
  RANGES,
  RATINGS,
  Rating,
  Selection,
  Settings,
  TagEntry,
} from "./KaganeModels";
import { manaRating } from "./KaganeParsers";
import { assertRatingPolicy, ratingAllowed } from "./ContentRatingPolicy";
import { resolveTypedTags, TAG_GROUPS, tagFilterId, tagIdsOf } from "./tag-groups";

type NumericRange = { min?: number; max?: number };

/** Steppers and older saved text bounds, validated before any provider/taxonomy request.
 * A stepper left at its floor was never set, so it asks for nothing.
 */
export function readNumericRanges(filters: Filters | undefined): Record<string, NumericRange> {
  if (filters === undefined) return {};
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    throw invalidNumericRange();
  const body: Record<string, NumericRange> = {};
  for (const [field, lowest, highest, floor] of RANGES) {
    const range: NumericRange = {};
    for (const side of ["min", "max"] as const) {
      const id = `${field}_${side}`;
      if (!Object.prototype.hasOwnProperty.call(filters, id)) continue;
      const value = filters[id];
      const text =
        typeof value === "number"
          ? String(value)
          : typeof value === "string"
            ? value.trim()
            : undefined;
      if (text === undefined || (text && !/^[0-9]+$/.test(text))) throw invalidNumericRange();
      const number = Number(text);
      if (!text || (typeof value === "number" && number === floor)) continue;
      if (!Number.isSafeInteger(number) || number < lowest || number > highest)
        throw invalidNumericRange();
      range[side] = number;
    }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max)
      throw invalidNumericRange();
    if (Object.keys(range).length) body[field] = range;
  }
  // A typed chapter bound replaces the preset.
  const preset = selectedOption(filters, "chapter_range");
  if (preset && !body.current_books) {
    const match = CHAPTER_PRESETS.some((option) => option.id === preset)
      ? /^(\d+)(?:-(\d+)|\+)$/.exec(preset)
      : null;
    if (!match) throw invalidNumericRange();
    body.current_books = { min: Number(match[1]), ...(match[2] ? { max: Number(match[2]) } : {}) };
  }
  return body;
}

function invalidNumericRange(): Error {
  return new Error(
    "Invalid Kagane numeric range. Use whole chapter and volume counts or years 1–9999, with the lower bound no greater than the upper.",
  );
}

export function selectedOptions(filters: Filters | undefined, id: string): string[] {
  const value = filters?.[id];
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Option =>
            !!item && typeof item === "object" && typeof item.id === "string",
        )
        .map((item) => item.id)
    : [];
}
export function selectedOption(filters: Filters | undefined, id: string): string | undefined {
  const value = filters?.[id];
  if (typeof value === "string") return value || undefined;
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Option).id === "string"
    ? (value as Option).id
    : undefined;
}
function selection(
  filters: Filters | undefined,
  id: string,
): { included: string[]; excluded: string[] } {
  const value = filters?.[id];
  const pick =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Selection)
      : undefined;
  return {
    included: (pick?.included ?? []).map((item) => item.id),
    excluded: (pick?.excluded ?? []).map((item) => item.id),
  };
}

/** Validate native tag values without turning malformed or stale picks into no filter. */
export function needsTagTaxonomy(filters: Filters | undefined, excluded: string[]): boolean {
  const ids = new Set(["tags", ...TAG_GROUPS.map((group) => tagFilterId(group.id))]);
  let selected = excluded.length > 0;
  for (const [id, value] of Object.entries(filters ?? {})) {
    if (id !== "tags" && !id.startsWith("tags:")) continue;
    if (
      !ids.has(id) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== "included" && key !== "excluded")
    )
      throw invalidTagFilter();
    const pick = value as Selection;
    for (const side of [pick.included, pick.excluded]) {
      if (side === undefined) continue;
      if (
        !Array.isArray(side) ||
        side.some(
          (option) =>
            !option ||
            typeof option !== "object" ||
            typeof option.id !== "string" ||
            !option.id.trim(),
        )
      )
        throw invalidTagFilter();
      if (side.length) selected = true;
    }
  }
  if (filters?.tag_query !== undefined && typeof filters.tag_query !== "string")
    throw invalidTagFilter();
  if (filters?.match_all_tags !== undefined && typeof filters.match_all_tags !== "boolean")
    throw invalidTagFilter();
  return selected || (typeof filters?.tag_query === "string" && !!filters.tag_query.trim());
}

function invalidTagFilter(): Error {
  return new Error("Invalid Kagane tag filter. Refresh tag choices or remove this filter.");
}

function validateTagIds(values: string[], tags: TagEntry[]): void {
  const valid = new Set(tags.map((tag) => tag.id));
  for (const value of values) {
    const ids = value.split("+");
    if (ids.some((id) => !id || !valid.has(id)))
      throw new Error(`Unknown Kagane tag "${value}". Refresh tag choices or remove this filter.`);
  }
}

function limited(values: string[], label: string): string[] {
  const unique = [...new Set(values)];
  if (unique.length > MAX_IDS)
    throw new Error(`Kagane allows at most ${MAX_IDS} ${label}, and ${unique.length} are picked.`);
  return unique;
}

function compound(
  included: string[],
  excluded: string[],
  match: boolean,
  label: string,
): Record<string, JsonValue> | undefined {
  const values = limited(included, `included ${label}`);
  const exclude = limited(excluded, `excluded ${label}`);
  return values.length || exclude.length
    ? {
        values,
        ...(match && values.length ? { match_all: true } : {}),
        ...(exclude.length ? { exclude } : {}),
      }
    : undefined;
}
/** One selected visible tag can stand for several spelling/alias IDs. */
export function includedTagGroups(filters: Filters | undefined, tags: TagEntry[]): string[][] {
  const picks = ["tags", ...TAG_GROUPS.map((group) => tagFilterId(group.id))]
    .flatMap((id) => selection(filters, id).included)
    .map(tagIdsOf);
  const names = Object.fromEntries(tags.map((tag) => [tag.id, tag.tag_name]));
  const typed = typeof filters?.tag_query === "string" ? filters.tag_query.split(",") : [];
  for (const name of typed) {
    if (name.trim().startsWith("-")) continue;
    const resolved = resolveTypedTags(name, names).included;
    if (resolved.length) picks.push(resolved);
  }
  return picks.filter((group) => group.length);
}

export function matchesTagGroups(
  ids: readonly string[] | undefined,
  groups: string[][],
  matchAll: boolean,
): boolean {
  if (!groups.length) return true;
  const present = new Set(ids ?? []);
  return matchAll
    ? groups.every((group) => group.some((id) => present.has(id)))
    : groups.some((group) => group.some((id) => present.has(id)));
}

export function selectedRatings(request: SearchRequest<Filters>, settings: Settings): Rating[] {
  assertRatingPolicy(request.context);
  const selected = selectedOptions(request.filters, "content_rating");
  return RATINGS.filter(
    (rating) =>
      settings.contentRatings.includes(rating) &&
      (!selected.length || selected.includes(rating)) &&
      ratingAllowed(manaRating({ content_rating: rating }), request.context),
  );
}
export function searchBody(
  request: SearchRequest<Filters>,
  settings: Settings,
  tags: TagEntry[],
): Record<string, JsonValue> {
  const ranges = readNumericRanges(request.filters);
  needsTagTaxonomy(request.filters, settings.excludedTags);
  const pooled = ["tags", ...TAG_GROUPS.map((group) => tagFilterId(group.id))].map((id) =>
    selection(request.filters, id),
  );
  validateTagIds(
    [...pooled.flatMap((pick) => [...pick.included, ...pick.excluded]), ...settings.excludedTags],
    tags,
  );
  const ratings = selectedRatings(request, settings);
  const body: Record<string, JsonValue> = {
    ...ranges,
    content_rating: ratings,
    age_rating: [...new Set(ratings.map((rating) => AGE_RATINGS[rating]))],
    source_type:
      settings.uploadSource === "official"
        ? ["Official"]
        : settings.uploadSource === "scanlations"
          ? ["Unofficial", "Mixed"]
          : ["Official", "Unofficial", "Mixed"],
  };
  if (!ratings.includes("Pornographic")) body.is_pornographic = false;
  else if (ratings.length === 1) body.is_pornographic = true;
  // Unknown source ratings need a broad query to reach their native Suggestive fallback.
  // A deliberate source-rating filter still requires actual matching site metadata.
  if (
    ratings.includes("Suggestive") &&
    settings.contentRatings.length === RATINGS.length &&
    !selectedOptions(request.filters, "content_rating").length
  ) {
    delete body.content_rating;
    delete body.age_rating;
    delete body.is_pornographic;
  }
  // A reading language picked for this search replaces the saved ones.
  const languages = selectedOptions(request.filters, "content_lang");
  if (languages.length || settings.languages.length)
    body.content_lang = languages.length ? languages : settings.languages;
  const disturbing = selectedOption(request.filters, "is_disturbing");
  if (disturbing === "exclude" || (disturbing !== "any" && settings.hideDisturbing))
    body.is_disturbing = false;
  const query = request.query?.trim();
  if (query) body.title = query;
  for (const id of [
    "format",
    "upload_status",
    "publication_status",
    "source_id",
    "original_language",
    "translated_language",
  ]) {
    const values = selectedOptions(request.filters, id);
    if (values.length) body[id] = id === "source_id" ? limited(values, "sources") : values;
  }
  const genres = selection(request.filters, "genres");
  const genreFilter = compound(
    genres.included,
    [...genres.excluded, ...settings.excludedGenres],
    request.filters?.match_all_genres === true,
    "genres",
  );
  if (genreFilter) body.genres = genreFilter;
  const typed = resolveTypedTags(
    typeof request.filters?.tag_query === "string" ? request.filters.tag_query : "",
    Object.fromEntries(tags.map((tag) => [tag.id, tag.tag_name])),
  );
  // API cannot express (alias A OR alias B) AND a second conceptual tag.
  // Ask for the broad union in that case, then enforce groups on bulk rows locally.
  const tagFilter = compound(
    [...pooled.flatMap((pick) => pick.included.flatMap(tagIdsOf)), ...typed.included],
    [
      ...pooled.flatMap((pick) => pick.excluded.flatMap(tagIdsOf)),
      ...typed.excluded,
      ...settings.excludedTags.flatMap(tagIdsOf),
    ],
    request.filters?.match_all_tags === true &&
      includedTagGroups(request.filters, tags).every((group) => group.length === 1),
    "tags",
  );
  if (tagFilter) body.tags = tagFilter;
  return body;
}

export function hasHidden(
  ids: readonly string[] | undefined,
  excluded: readonly string[],
): boolean {
  const hidden = new Set(excluded.flatMap(tagIdsOf));
  return (ids ?? []).some((id) => hidden.has(id));
}

export function hostRatingKey(host: readonly ContentRating[] | undefined): string {
  return host === undefined ? "" : [...host].sort().join(",");
}
