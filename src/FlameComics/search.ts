/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SortID, type SearchCriteria, type SeriesListItem } from "./model.ts";
import { categoriesOf } from "./parsers.ts";

function lower(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/** A tri-state field: every excluded value must be absent, and included ones present. */
function matchesTriState(
  values: readonly string[],
  included: readonly string[],
  excluded: readonly string[],
  matchAll: boolean,
): boolean {
  const held = new Set(lower(values));

  if (excluded.some((entry) => held.has(entry))) return false;
  if (included.length === 0) return true;

  return matchAll
    ? included.every((entry) => held.has(entry))
    : included.some((entry) => held.has(entry));
}

function matchesAny(value: string | undefined, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true;
  return wanted.includes((value ?? "").trim().toLowerCase());
}

export function filterSeries(
  series: readonly SeriesListItem[],
  criteria: SearchCriteria,
): SeriesListItem[] {
  const query = criteria.query.trim().toLowerCase();

  return series.filter((item) => {
    if (query && !item.title.toLowerCase().includes(query)) return false;

    if (
      !matchesTriState(
        categoriesOf(item),
        criteria.includedCategories,
        criteria.excludedCategories,
        criteria.matchAllCategories,
      )
    ) {
      return false;
    }

    if (
      !matchesTriState(
        item.publisher ?? [],
        criteria.includedPublishers,
        criteria.excludedPublishers,
        false,
      )
    ) {
      return false;
    }
    if (
      !matchesTriState(item.author ?? [], criteria.includedAuthors, criteria.excludedAuthors, false)
    ) {
      return false;
    }
    if (
      !matchesTriState(item.artist ?? [], criteria.includedArtists, criteria.excludedArtists, false)
    ) {
      return false;
    }

    if (!matchesAny(item.type, criteria.types)) return false;
    if (!matchesAny(item.status, criteria.status)) return false;
    if (!matchesAny(item.language, criteria.language ? [criteria.language] : [])) return false;
    if (!matchesAny(item.country, criteria.country ? [criteria.country] : [])) return false;
    if (criteria.years.length > 0 && !criteria.years.includes(String(item.year ?? ""))) {
      return false;
    }

    return true;
  });
}

export function sortSeries(series: SeriesListItem[], sort: string): SeriesListItem[] {
  const updatedAt = (item: SeriesListItem): number => item.updated ?? item.last_edit ?? 0;

  switch (sort) {
    case SortID.TitleAscending:
      return series.sort((left, right) => left.title.localeCompare(right.title));
    case SortID.TitleDescending:
      return series.sort((left, right) => right.title.localeCompare(left.title));
    case SortID.Likes:
      return series.sort((left, right) => (right.likes ?? 0) - (left.likes ?? 0));
    case SortID.Year:
      return series.sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
    case SortID.Random:
      // Fisher-Yates; the site offers a random order and the app has no shuffle of its own.
      for (let index = series.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [series[index], series[swap]] = [series[swap]!, series[index]!];
      }
      return series;
    default:
      return series.sort((left, right) => updatedAt(right) - updatedAt(left));
  }
}
