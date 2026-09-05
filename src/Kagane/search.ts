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

  const kept = (ratings.length > 0 ? ratings : CONTENT_RATINGS).filter(allows);
  if (kept.length > 0) return kept;

  // The saved choice and the host policy do not overlap. Sending nothing asks the API for
  // everything, so fall back to the policy itself rather than to the narrower preference.
  const policy = CONTENT_RATINGS.filter(allows);
  return policy.length > 0 ? policy : ["Safe"];
}

type IncludeExclude = { match_all?: boolean; values: string[]; exclude?: string[] };

function buildIncludeExclude(
  included: string[],
  excluded: string[],
  matchAll: boolean,
): IncludeExclude | undefined {
  // An explicit pick on the form overrides the hide-list for that one search;
  // sending it as both a value and an exclusion returns nothing.
  const holdBack = new Set(included);
  const exclusions = excluded.filter((id) => !holdBack.has(id));

  if (included.length === 0 && exclusions.length === 0) return undefined;

  return {
    ...(matchAll && included.length > 0 ? { match_all: true } : {}),
    values: included,
    ...(exclusions.length > 0 ? { exclude: exclusions } : {}),
  };
}

export function buildSearchBody(
  options: SearchBodyOptions,
  filters?: FilterReader,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    source_type:
      options.uploadSource === "official"
        ? ["Official"]
        : options.uploadSource === "scanlations"
          ? ["Unofficial", "Mixed"]
          : ["Official", "Unofficial", "Mixed"],
  };

  // Sent only when the reader has picked languages. The site's own search carries no
  // language filter at all, and asking for one narrows a title down to the single edition
  // whose row happens to be labelled with that language.
  if (options.contentLanguages.length > 0) body["content_lang"] = options.contentLanguages;

  const query = options.query?.trim();
  if (query) body["title"] = query;

  const ratings = filters?.options(FilterID.ContentRating) ?? [];
  const contentRating = applyRatingPolicy(
    ratings.length > 0 ? ratings : options.contentRatings,
    options.allowedRatings,
  );
  if (contentRating.length > 0) body["content_rating"] = contentRating;

  if (!filters) {
    const genres = buildIncludeExclude([], options.excludedGenreIds, false);
    if (genres) body["genres"] = genres;

    const tags = buildIncludeExclude([], options.excludedTagIds.flatMap(tagIdsOf), false);
    if (tags) body["tags"] = tags;
    return body;
  }

  const format = filters.options(FilterID.Format);
  if (format.length > 0) body["format"] = format;

  const status = filters.options(FilterID.Status);
  if (status.length > 0) body["upload_status"] = status;

  const sources = filters.options(FilterID.Sources);
  if (sources.length > 0) body["source_id"] = sources;

  const genreSelection = filters.excludable(FilterID.Genres);
  const genres = buildIncludeExclude(
    genreSelection.included,
    [...new Set([...genreSelection.excluded, ...options.excludedGenreIds])],
    filters.toggle(FilterID.MatchAllGenres),
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
        ...[...tagSelection.excluded, ...options.excludedTagIds].flatMap(tagIdsOf),
        ...typed.excluded,
      ]),
    ],
    filters.toggle(FilterID.MatchAllTags),
  );
  if (tags) body["tags"] = tags;

  return body;
}

/**
 * The site sorts one way. It accepts an ascending parameter and answers it with the same
 * order it already gave, so the sorts are not offered as orderable and this always asks
 * for the descending one — newest, most viewed, most books first.
 */
export function buildSortParameter(id: string): string {
  return id ? `${id},desc` : "";
}
