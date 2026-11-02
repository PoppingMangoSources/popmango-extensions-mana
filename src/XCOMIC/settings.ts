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
        "With Merge Editions off, one series published by several teams or houses is several " +
        "entries here, all under the same name — showing the source tags each with who " +
        "published it, as 'On the Way to Meet Mom [WEBTOON]'. Version tags are markers like " +
        "'(Official)' or '(Yaoi)'. Titles already saved to your library keep the name they " +
        "were added under until you refresh them.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.ShowSourceInTitle,
          title: "Show Source In Title",
        },
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
      header: "Editions",
      footer:
        "A series is often published by several teams. Merging lists every edition in your " +
        "languages under one title, each chapter naming its team, at one request per edition. " +
        "Editions To Include keeps only the teams named, separated by commas, as 'Tapas, " +
        "Pocket Comics'; leave it empty for all of them. Grouping lists one team's chapters " +
        "after another's, so reading on stays with the same team. Both apply only while " +
        "merging.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.MergeEditions,
          title: "Merge Editions",
        },
        {
          type: "text" as const,
          key: PreferenceID.IncludedEditions,
          title: "Editions To Include",
          placeholder: "All editions",
        },
        {
          type: "toggle" as const,
          key: PreferenceID.GroupByEdition,
          title: "Group Chapters By Edition",
        },
      ],
    },
    {
      header: "Chapters",
      footer:
        "A deduplicated list keeps one entry per chapter number. Turning this off shows every " +
        "upload, including a second group's take on a chapter already listed.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.DeduplicateChapters,
          title: "Deduplicate Chapter List",
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
