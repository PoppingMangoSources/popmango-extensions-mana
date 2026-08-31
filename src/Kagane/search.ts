/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The JSON body the search endpoint expects.
 *
 * Every home row and every search goes through here, so the reader's content
 * settings apply uniformly and there is one place to look when a filter does
 * not seem to bite.
 */

import type { FilterReader } from "../common/index.ts";
import { FilterID } from "./model.ts";

export type SearchBodyOptions = {
  query?: string;
  /** "all" | "official" | "scanlations" */
  uploadSource: string;
  contentRatings: string[];
  contentLanguages: string[];
  /** Genre ids hidden through settings, always excluded. */
  excludedGenreIds: string[];
};

type IncludeExclude = { match_all?: boolean; values: string[]; exclude?: string[] };

/**
 * The API's own vocabulary for who uploaded a title. "Scanlations only" is the
 * absence of official uploads rather than a value of its own.
 */
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
  if (included.length === 0 && excluded.length === 0) return undefined;

  return {
    ...(matchAll && included.length > 0 ? { match_all: true } : {}),
    values: included,
    ...(excluded.length > 0 ? { exclude: excluded } : {}),
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

  // The rating filter on the search form wins over the settings default, so a
  // one-off search can widen what settings normally hide.
  const ratings = filters?.options(FilterID.ContentRating) ?? [];
  const contentRating = ratings.length > 0 ? ratings : options.contentRatings;
  if (contentRating.length > 0) body["content_rating"] = contentRating;

  if (!filters) {
    // A plain browse still honours the hidden-genre setting.
    const genres = includeExclude([], options.excludedGenreIds, false);
    if (genres) body["genres"] = genres;
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
    tagSelection.excluded,
    filters.toggle(FilterID.MatchAllTags),
  );
  if (tags) body["tags"] = tags;

  return body;
}

/**
 * The `sort` query value.
 *
 * Relevance is the API's default and is expressed by sending nothing;
 * everything else takes an explicit direction, descending unless asked.
 */
export function sortParameter(id: string, ascending: boolean | undefined): string {
  if (!id) return "";
  return ascending === true ? id : `${id},desc`;
}
