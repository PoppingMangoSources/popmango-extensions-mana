/* SPDX-License-Identifier: GPL-3.0-or-later */

import { ContentRating } from "@mana-app/types";

import type { FilterReader } from "../common/index.ts";
import { CONTENT_RATINGS, FilterID, RANGE_FIELDS, type JsonObject } from "./model.ts";
import { TAG_GROUPS, resolveTypedTags, tagFilterId, tagIdsOf } from "./tag-groups.ts";

export type SearchBodyOptions = {
  query?: string;
  uploadSource: string;
  contentRatings: string[];
  contentLanguages: string[];
  originalLanguages?: string[];
  translatedLanguages?: string[];
  excludedGenreIds: string[];
  excludedTagIds: string[];
  /** Genres the settings require, applied wherever the hide-lists are. */
  includedGenreIds?: string[];
  /** Tags the settings require: one group of site ids per tag, any of which will do. */
  includedTagGroups?: string[][];
  /** Source groups the settings require, and the ones they hide. */
  includedSourceIds?: string[];
  excludedSourceIds?: string[];
  allowedRatings?: readonly ContentRating[];
  hideDisturbing: boolean;
  /** The site's `{ id: name }` tag list, needed only when a tag was typed rather than picked. */
  tagNames?: Record<string, string>;
};

// The site uses age bands; Mana distinguishes mature from explicit content within 18+.
const RATING_EQUIVALENTS: Record<string, ContentRating> = {
  Safe: ContentRating.SAFE,
  Suggestive: ContentRating.SUGGESTIVE,
  Erotica: ContentRating.MATURE,
  Pornographic: ContentRating.EXPLICIT,
};

function applyRatingPolicy(
  ratings: string[],
  allowed: readonly ContentRating[] | undefined,
): string[] {
  if (!allowed) return ratings;

  const permitted = new Set(allowed);
  const allows = (rating: string): boolean => {
    const equivalent = RATING_EQUIVALENTS[rating];
    return equivalent !== undefined && permitted.has(equivalent);
  };

  return (ratings.length > 0 ? ratings : CONTENT_RATINGS).filter(allows);
}

export function selectedContentRatings(
  options: SearchBodyOptions,
  filters?: FilterReader,
): string[] {
  const ages = filters?.options(FilterID.AgeRating) ?? [];
  const selected = filters?.options(FilterID.ContentRating) ?? [];
  const pornography = filters?.option(FilterID.Pornographic);
  let ratings = selected.length
    ? selected
    : ages.length
      ? ratingsForAges(
          ages,
          pornography === "include" ||
            (pornography !== "exclude" && options.contentRatings.includes("Pornographic")),
        )
      : options.contentRatings;
  if (pornography === "exclude") ratings = ratings.filter((rating) => rating !== "Pornographic");
  else if (
    pornography === "include" &&
    ratings.includes("Erotica") &&
    !ratings.includes("Pornographic")
  )
    ratings = [...ratings, "Pornographic"];
  return applyRatingPolicy(ratings, options.allowedRatings);
}

export function ratingsForAges(ages: string[], pornography: boolean): string[] {
  return ages.flatMap((age) =>
    age === "Safe"
      ? ["Safe"]
      : age === "FifteenPlus"
        ? ["Suggestive"]
        : age === "EighteenPlus"
          ? pornography
            ? ["Erotica", "Pornographic"]
            : ["Erotica"]
          : [],
  );
}

export type TagSelection = { included: string[][]; excluded: string[]; matchAll: boolean };

export function readTagSelection(
  filters: FilterReader,
  tagNames: Record<string, string> = {},
): TagSelection {
  const picks = [FilterID.Tags, ...TAG_GROUPS.map((group) => tagFilterId(group.id))].map((id) =>
    filters.excludable(id),
  );
  const typed = resolveTypedTags(filters.text(FilterID.TagQuery), tagNames);
  return {
    included: [...picks.flatMap((pick) => pick.included.map(tagIdsOf)), ...typed.included]
      .map((group) => [...new Set(group.map((id) => id.toLowerCase()))])
      .filter((group) => group.length > 0),
    excluded: [...picks.flatMap((pick) => pick.excluded.flatMap(tagIdsOf)), ...typed.excluded],
    // Off unless switched on; a search saved under the old picker still says "all".
    matchAll:
      filters.option(FilterID.MatchAllTags) === "all" || filters.toggle(FilterID.MatchAllTags),
  };
}

/**
 * The tags a search asks for: its own picks when it has any, otherwise the ones the
 * settings require, all of them, when it is a browse rather than a search by name.
 *
 * The two are not combined. A search may ask for any of its tags, and the settings for
 * all of theirs, and one request to the site can only say one of those; so a search that
 * picks tags of its own looks past the required ones, as a pick already looks past the
 * hide-list.
 */
export function withRequiredTags(
  selection: TagSelection,
  options: SearchBodyOptions,
  browsing: boolean,
): TagSelection {
  if (!browsing || !options.includedTagGroups?.length || selection.included.length > 0)
    return selection;
  const excluded = new Set(selection.excluded.map((id) => id.toLowerCase()));
  const required = options.includedTagGroups.filter((group) =>
    group.some((id) => !excluded.has(id)),
  );
  return { ...selection, included: required, matchAll: true };
}

/**
 * Whether a title's source group may be shown. The site takes a list of groups to ask for
 * but none to leave out, so the hidden ones are checked on the rows that come back; a group
 * the search itself picked is shown whatever the settings say.
 */
export function sourceAllowed(
  sourceId: string | null | undefined,
  options: SearchBodyOptions,
  picked: readonly string[] = [],
): boolean {
  const id = (sourceId ?? "").toLowerCase();
  if (!id || !options.excludedSourceIds?.length) return true;
  if (picked.some((entry) => entry.toLowerCase() === id)) return true;
  return !options.excludedSourceIds.some((entry) => entry.toLowerCase() === id);
}

/** Whether a search over these groups has to be checked locally, alias by alias. */
export function needsGroupCheck(selection: TagSelection): boolean {
  return (
    selection.matchAll &&
    selection.included.length > 1 &&
    selection.included.some((group) => group.length > 1)
  );
}

export function matchesTagGroups(ids: string[] | undefined, groups: string[][]): boolean {
  const present = new Set((ids ?? []).map((id) => id.toLowerCase()));
  return groups.every((group) => group.some((id) => present.has(id)));
}

const EMPTY_SELECTION: TagSelection = { included: [], excluded: [], matchAll: true };

type IncludeExclude = { match_all?: boolean; values: string[]; exclude?: string[] };

function checkedValues(values: string[], label: string): string[] {
  const unique = [...new Set(values.map((value) => value.toLowerCase()))];
  if (unique.length > 50) {
    throw new Error(
      `Kagane allows up to 50 ${label}; ${unique.length} are selected. Reduce the selection in Filters or Settings. A grouped tag can contain several site tag IDs.`,
    );
  }
  return unique;
}

function buildIncludeExclude(
  included: string[],
  excluded: string[],
  matchAll: boolean,
  label: string,
): IncludeExclude | undefined {
  // An explicit pick on the form overrides the hide-list for that one search;
  // sending it as both a value and an exclusion returns nothing.
  const values = checkedValues(included, `included ${label}`);
  const holdBack = new Set(values);
  const exclusions = checkedValues(
    excluded.filter((id) => !holdBack.has(id.toLowerCase())),
    `excluded ${label}`,
  );

  if (values.length === 0 && exclusions.length === 0) return undefined;

  return {
    ...(values.length > 0 ? { match_all: matchAll } : {}),
    values,
    ...(exclusions.length > 0 ? { exclude: exclusions } : {}),
  };
}

export function buildSearchBody(
  options: SearchBodyOptions,
  filters?: FilterReader,
  selection?: TagSelection,
): JsonObject {
  const body: JsonObject = {};
  if (options.uploadSource === "official") body["source_type"] = ["Official"];
  else if (options.uploadSource === "scanlations") body["source_type"] = ["Unofficial", "Mixed"];

  // Sent only when the reader has picked languages. The site's own search carries no
  // language filter at all, and asking for one narrows a title down to the single edition
  // whose row happens to be labelled with that language.
  if (options.contentLanguages.length > 0)
    body["content_lang"] = checkedValues(options.contentLanguages, "languages");
  if (options.originalLanguages?.length)
    body["original_language"] = checkedValues(options.originalLanguages, "original languages");
  if (options.translatedLanguages?.length)
    body["translated_language"] = checkedValues(
      options.translatedLanguages,
      "translation languages",
    );

  const query = options.query?.trim();
  if (query) body["title"] = query;

  // Typing a title's name is asking for that title. The hide-lists are there to keep the
  // home page and the listings clear of what you do not want to browse, and applying them
  // to a name search deletes the very thing that was asked for without saying so — a title
  // an uploader tagged `Ecchi` vanishes from a search for its own name, while another
  // edition of the same work, tagged differently, comes back.
  const browsing = !query;

  const contentRating = selectedContentRatings(options, filters);
  body["age_rating"] = [
    ...new Set(
      contentRating.map((rating) =>
        rating === "Safe" ? "Safe" : rating === "Suggestive" ? "FifteenPlus" : "EighteenPlus",
      ),
    ),
  ];
  if (!contentRating.includes("Pornographic")) body["is_pornographic"] = false;
  else if (contentRating.length === 1) body["is_pornographic"] = true;
  if (options.hideDisturbing) body["is_disturbing"] = false;

  const hiddenGenreIds = browsing ? options.excludedGenreIds : [];
  const hiddenTagIds = browsing ? options.excludedTagIds : [];
  const requiredGenreIds = browsing ? (options.includedGenreIds ?? []) : [];

  const requiredSources = browsing ? (options.includedSourceIds ?? []) : [];
  const applyRequiredSources = (): void => {
    if (!requiredSources.length) return;
    body["source_id"] = checkedValues(requiredSources, "source groups");
    // Groups picked by name stand in for the Upload Source setting, which could only
    // contradict them.
    delete body["source_type"];
  };

  if (!filters) {
    applyRequiredSources();
    const genres = buildIncludeExclude(requiredGenreIds, hiddenGenreIds, true, "genres");
    if (genres) body["genres"] = genres;

    const required = selection ?? withRequiredTags(EMPTY_SELECTION, options, browsing);
    const tags = buildIncludeExclude(
      required.included.flat(),
      hiddenTagIds.flatMap(tagIdsOf),
      required.included.every((group) => group.length === 1),
      "tags",
    );
    if (tags) body["tags"] = tags;
    return body;
  }

  const format = filters.options(FilterID.Format);
  if (format.length > 0) body["format"] = format;

  const status = filters.options(FilterID.Status);
  if (status.length > 0) body["upload_status"] = status;
  const publication = filters.options(FilterID.PublicationStatus);
  if (publication.length > 0) body["publication_status"] = publication;
  const disturbing = filters.option(FilterID.Disturbing);
  if (disturbing === "any") delete body["is_disturbing"];
  else if (disturbing === "only" || disturbing === "exclude")
    body["is_disturbing"] = disturbing === "only";

  const sources = filters.options(FilterID.Sources);
  if (sources.length > 0) {
    body["source_id"] = checkedValues(sources, "source groups");
    // Picked groups stand in for the Upload Source setting for this search; sending both
    // asks for an official upload from a scanlation group and finds nothing.
    delete body["source_type"];
  } else applyRequiredSources();

  // The search's own genre picks replace the required ones, as its tag picks do.
  const genreSelection = filters.excludable(FilterID.Genres);
  const formExcludedGenres = new Set(genreSelection.excluded.map((id) => id.toLowerCase()));
  const ownGenres = genreSelection.included.length > 0;
  const genres = buildIncludeExclude(
    ownGenres
      ? genreSelection.included
      : requiredGenreIds.filter((id) => !formExcludedGenres.has(id.toLowerCase())),
    [...new Set([...genreSelection.excluded, ...hiddenGenreIds])],
    ownGenres
      ? filters.option(FilterID.MatchAllGenres) === "all" || filters.toggle(FilterID.MatchAllGenres)
      : true,
    "genres",
  );
  if (genres) body["genres"] = genres;

  const pickedTags =
    selection ?? withRequiredTags(readTagSelection(filters, options.tagNames), options, browsing);
  // A flat API list cannot express (alias A OR alias B) AND another tag.
  // Request their union and check the conceptual groups on the returned bulk rows.
  const tags = buildIncludeExclude(
    pickedTags.included.flat(),
    [...pickedTags.excluded, ...hiddenTagIds.flatMap(tagIdsOf)],
    pickedTags.matchAll && pickedTags.included.every((group) => group.length === 1),
    "tags",
  );
  if (tags) body["tags"] = tags;

  for (const id of [
    FilterID.OriginalLanguage,
    FilterID.TranslatedLanguage,
    FilterID.ContentLanguage,
    FilterID.SourceType,
  ]) {
    const selected = filters.options(id);
    if (selected.length)
      body[id] = id === FilterID.SourceType ? selected : checkedValues(selected, "languages");
  }
  for (const { id, title } of RANGE_FIELDS) {
    // A stepper cannot be left empty, so its resting 0 means "not set".
    const stepped = id === FilterID.Chapters || id === FilterID.Volumes;
    const read = (side: string): string => {
      const value = filters.text(`${id}_${side}`).trim();
      return stepped && value === "0" ? "" : value;
    };
    const lower = read("min");
    const upper = read("max");
    if (lower || upper) {
      const bounds: { min?: number; max?: number } = {};
      for (const [key, raw] of [
        ["min", lower],
        ["max", upper],
      ] as const) {
        if (!raw) continue;
        const number = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number > 2147483647)
          throw new Error(`${title}: enter a whole number in each range field.`);
        bounds[key] = number;
      }
      if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max)
        throw new Error(`${title}: the range must be in ascending order.`);
      body[id] = bounds;
      continue;
    }
    // Saved searches from earlier builds may still carry a single range string.
    const raw =
      filters.text(id).trim() ||
      (id === FilterID.Chapters ? filters.option(FilterID.ChapterRange) : "");
    if (!raw) continue;
    const match = /^(\d+)(?:\s*(-)\s*(\d+)|(\+))?$/.exec(raw);
    if (!match) throw new Error("Use a number, a range such as 1-20, or a minimum such as 100+.");
    const min = Number(match[1]),
      max = match[4] ? undefined : Number(match[3] ?? match[1]);
    if (
      !Number.isSafeInteger(min) ||
      min > 2147483647 ||
      (max !== undefined && (max < min || max > 2147483647))
    ) {
      throw new Error("The filter range must contain whole numbers in ascending order.");
    }
    body[id] = { min, ...(max === undefined ? {} : { max }) };
  }

  return body;
}

export function buildSortParameter(id: string, ascending = false): string {
  return id ? `${id},${ascending ? "asc" : "desc"}` : "";
}
