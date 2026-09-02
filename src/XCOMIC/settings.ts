/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceSection } from "../common/index.ts";
import { DISCOVER_SECTIONS, LANGUAGE_OPTIONS, MIRROR_OPTIONS, PreferenceID } from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export type TaxonomyLists = {
  genres: () => Promise<Option[]>;
  types: () => Promise<Option[]>;
  contentRatings: () => Promise<Option[]>;
};

export function buildSettingsSections(taxonomy: TaxonomyLists): PreferenceSection[] {
  return [
    {
      header: "Site",
      footer: "Both mirrors serve the same library; switch if one of them is unreachable.",
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
          options: taxonomy.contentRatings,
          minSelectionCount: 1,
        },
        {
          type: "multiselect" as const,
          key: PreferenceID.ContentTypes,
          title: "Types",
          options: taxonomy.types,
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
          title: "Hide Genres",
          options: taxonomy.genres,
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
        "Version tags are markers like '(Official)' or '(Yaoi)'. Titles already saved to your " +
        "library keep the name they were added under until you refresh them.",
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
