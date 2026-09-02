/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceSection } from "../common/index.ts";
import {
  CONTENT_RATING_OPTIONS,
  DISCOVER_SECTIONS,
  LANGUAGE_OPTIONS,
  PreferenceID,
  TYPE_OPTIONS,
} from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(genres: () => Promise<Option[]>): PreferenceSection[] {
  return [
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
          title: "Hide Genres",
          options: genres,
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
