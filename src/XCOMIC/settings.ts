/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { PreferenceSection } from "../common/index.ts";
import {
  CONTENT_RATING_OPTIONS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  GENRE_OPTIONS,
  LANGUAGE_OPTIONS,
  MIRROR_OPTIONS,
  PreferenceID,
  TYPE_OPTIONS,
} from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(): PreferenceSection[] {
  return [
    {
      header: "Site",
      footer: "All mirrors serve the same library; switch if one of them is unreachable.",
      fields: [
        {
          type: "select" as const,
          key: PreferenceID.Mirror,
          title: "Preferred Mirror",
          options: MIRROR_OPTIONS,
        },
      ],
    },
    {
      header: "Editions",
      footer:
        "Lists every team's edition of a series under one title, each chapter naming its team.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.MergeEditions,
          title: "Merge Editions",
        },
      ],
    },
    {
      footer:
        "Keeps only the teams you name, separated by commas. Leave it empty for every team. " +
        "Applies while merging.",
      fields: [
        {
          type: "text" as const,
          key: PreferenceID.IncludedEditions,
          title: "Editions To Include",
          placeholder: "e.g. Tapas, Pocket Comics",
        },
      ],
    },
    {
      footer:
        "Lists one team's chapters after another's, so reading on stays with the same team. " +
        "Applies while merging.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.GroupByEdition,
          title: "Group Chapters By Edition",
        },
      ],
    },
    {
      footer:
        "Drops the repeat entries some editions carry for the same chapter, and loads faster. " +
        "Every team's chapters stay listed either way.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.DeduplicateChapters,
          title: "Deduplicate Chapter List",
        },
      ],
    },
    {
      header: "Content",
      footer: "Applies to the home page, browsing and search.",
      fields: [
        {
          type: "multiselect" as const,
          key: PreferenceID.ContentRatings,
          title: "Content Ratings",
          options: CONTENT_RATING_OPTIONS,
          minSelectionCount: 1,
        },
        {
          type: "multiselect" as const,
          key: PreferenceID.ContentTypes,
          title: "Types",
          options: TYPE_OPTIONS,
          minSelectionCount: 1,
        },
        {
          type: "multiselect" as const,
          key: PreferenceID.Languages,
          title: "Translated Languages",
          options: LANGUAGE_OPTIONS,
          minSelectionCount: 1,
        },
        {
          type: "multiselect" as const,
          key: PreferenceID.ExcludedGenres,
          title: "Hide Genres and Formats",
          options: [...GENRE_OPTIONS, ...FORMAT_OPTIONS],
        },
        {
          type: "toggle" as const,
          key: PreferenceID.IgnoreGenreBlocklist,
          title: "Ignore Site Genre Blocklist",
        },
      ],
    },
    {
      header: "Titles",
      footer:
        "Adds the team to the title, as 'On the Way to Meet Mom [WEBTOON]', so one series' " +
        "editions can be told apart. Applies while not merging.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.ShowSourceInTitle,
          title: "Show Source In Title",
        },
      ],
    },
    {
      footer:
        "Version tags are markers like '(Official)' or '(Yaoi)'. Titles already in your " +
        "library keep their name until you refresh them.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.RemoveTitleVersion,
          title: "Remove Version Information From Entry Titles",
        },
        {
          type: "text" as const,
          key: PreferenceID.CustomTitleRegex,
          title: "Custom Regex To Be Removed From Title",
          placeholder: "e.g. \\s*\\(Official\\)$",
        },
      ],
    },
    {
      header: "Home Sections",
      footer: "Turn off the rows you don't read to make the home page load faster.",
      fields: DISCOVER_SECTIONS.map((section) => ({
        type: "toggle" as const,
        key: sectionPreferenceKey(section.id),
        title: section.title,
      })),
    },
  ];
}
