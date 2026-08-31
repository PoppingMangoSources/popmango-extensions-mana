/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { FilterReader } from "../common/index.ts";
import { FilterID } from "./model.ts";

export type SearchBodyOptions = {
  query?: string;
  uploadSource: string;
  contentRatings: string[];
  contentLanguages: string[];
  excludedGenreIds: string[];
  excludedTagIds: string[];
};

type IncludeExclude = { match_all?: boolean; values: string[]; exclude?: string[] };

function sourceTypesFor(uploadSource: string): string[] {
  if (uploadSource === "official") return ["Official"];
  if (uploadSource === "scanlations") return ["Unofficial", "Mixed"];
  return ["Official", "Unofficial", "Mixed"];
}

function includeExclude(
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
    source_type: sourceTypesFor(options.uploadSource),
    content_lang: options.contentLanguages,
  };

  const query = options.query?.trim();
  if (query) body["title"] = query;

  const ratings = filters?.options(FilterID.ContentRating) ?? [];
  const contentRating = ratings.length > 0 ? ratings : options.contentRatings;
  if (contentRating.length > 0) body["content_rating"] = contentRating;

  if (!filters) {
    const genres = includeExclude([], options.excludedGenreIds, false);
    if (genres) body["genres"] = genres;

    const tags = includeExclude([], options.excludedTagIds, false);
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
  const genres = includeExclude(
    genreSelection.included,
    [...new Set([...genreSelection.excluded, ...options.excludedGenreIds])],
    filters.toggle(FilterID.MatchAllGenres),
  );
  if (genres) body["genres"] = genres;

  const tagSelection = filters.excludable(FilterID.Tags);
  const tags = includeExclude(
    tagSelection.included,
    [...new Set([...tagSelection.excluded, ...options.excludedTagIds])],
    filters.toggle(FilterID.MatchAllTags),
  );
  if (tags) body["tags"] = tags;

  return body;
}

export function sortParameter(id: string, ascending: boolean | undefined): string {
  if (!id) return "";
  return ascending === true ? id : `${id},desc`;
}
