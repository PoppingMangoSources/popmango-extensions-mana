/* SPDX-License-Identifier: GPL-3.0-or-later */

import { ContentRating } from "@mana-app/types";

import type { FilterReader } from "../common/index.ts";
import { CONTENT_RATINGS, FilterID } from "./model.ts";
import { TAG_GROUPS, resolveTypedTags, tagFilterId, tagIdsOf } from "./tag-groups.ts";

export type SearchBodyOptions = {
  query?: string;
  uploadSource: string;
  contentRatings: string[];
  contentLanguages: string[];
  excludedGenreIds: string[];
  excludedTagIds: string[];
  allowedRatings?: readonly ContentRating[];
  hideDisturbing: boolean;
  /** The site's `{ id: name }` tag list, needed only when a tag was typed rather than picked. */
  tagNames?: Record<string, string>;
};

// Kagane names four ratings of its own; Erotica has no exact counterpart, and MATURE is
// the closest rung the app offers below EXPLICIT.
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
  const ratings = filters?.options(FilterID.ContentRating) ?? [];
  return applyRatingPolicy(
    ratings.length > 0 ? ratings : options.contentRatings,
    options.allowedRatings,
  );
}

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
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.uploadSource === "official") body["source_type"] = ["Official"];
  else if (options.uploadSource === "scanlations") body["source_type"] = ["Unofficial", "Mixed"];

  // Sent only when the reader has picked languages. The site's own search carries no
  // language filter at all, and asking for one narrows a title down to the single edition
  // whose row happens to be labelled with that language.
  if (options.contentLanguages.length > 0)
    body["content_lang"] = checkedValues(options.contentLanguages, "languages");

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

  if (!filters) {
    const genres = buildIncludeExclude([], hiddenGenreIds, false, "genres");
    if (genres) body["genres"] = genres;

    const tags = buildIncludeExclude([], hiddenTagIds.flatMap(tagIdsOf), false, "tags");
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
  if (sources.length > 0) body["source_id"] = checkedValues(sources, "sources");

  const genreSelection = filters.excludable(FilterID.Genres);
  const genres = buildIncludeExclude(
    genreSelection.included,
    [...new Set([...genreSelection.excluded, ...hiddenGenreIds])],
    !filters.has(FilterID.MatchAllGenres) ||
      filters.option(FilterID.MatchAllGenres) === "all" ||
      filters.toggle(FilterID.MatchAllGenres),
    "genres",
  );
  if (genres) body["genres"] = genres;

  // Tags are picked a group at a time but searched as one list, so every group's picker
  // is read and the selections pooled.
  // The ungrouped id is read alongside the groups: a tag tapped on a title's page arrives
  // under it, since nothing outside this source knows which group that tag belongs to.
  const tagFilters = [FilterID.Tags, ...TAG_GROUPS.map((group) => tagFilterId(group.id))];
  const tagSelection = tagFilters.reduce<{ included: string[]; excluded: string[] }>(
    (pooled, id) => {
      const picked = filters.excludable(id);
      pooled.included.push(...picked.included);
      pooled.excluded.push(...picked.excluded);
      return pooled;
    },
    { included: [], excluded: [] },
  );

  // Twenty-odd pickers is a lot to hunt through for one tag, so a name may be typed
  // instead. Names are resolved against the site's list rather than the pickers, so a tag
  // reaches the search whichever group it was sorted into.
  const typed = resolveTypedTags(filters.text(FilterID.TagQuery), options.tagNames ?? {});

  // A picker offers one option per tag while the site holds several ids for it, so each
  // selected value carries them all and is opened back up here.
  const tags = buildIncludeExclude(
    [...new Set([...tagSelection.included.flatMap(tagIdsOf), ...typed.included])],
    [
      ...new Set([
        ...[...tagSelection.excluded, ...hiddenTagIds].flatMap(tagIdsOf),
        ...typed.excluded,
      ]),
    ],
    !filters.has(FilterID.MatchAllTags) ||
      filters.option(FilterID.MatchAllTags) === "all" ||
      filters.toggle(FilterID.MatchAllTags),
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
  for (const id of [FilterID.StartYear, FilterID.EndYear, FilterID.Chapters, FilterID.Volumes]) {
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
