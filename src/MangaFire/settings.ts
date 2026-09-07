/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { PreferenceSection } from "../common/index.ts";
import {
  CONTENT_RATING_OPTIONS,
  DISCOVER_SECTIONS,
  LANGUAGE_OPTIONS,
  PreferenceID,
} from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(): PreferenceSection[] {
  return [
    {
      header: "Content",
      footer:
        "Leave every grade unpicked to browse the whole catalogue. A grade turned off here is never asked for, so the pages stay full rather than arriving short.",
      fields: [
        {
          type: "multiselect",
          key: PreferenceID.ContentRatings,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
        },
      ],
    },
    {
      header: "Chapters",
      footer:
        "A chapter list is fetched once per language, so each extra language is another request when a title opens. Changes apply the next time a chapter list is refreshed.",
      fields: [
        {
          type: "multiselect",
          key: PreferenceID.Languages,
          title: "Languages",
          options: LANGUAGE_OPTIONS,
          // Emptying the list would leave every title with no chapters at all.
          minSelectionCount: 1,
        },
        {
          type: "toggle",
          key: PreferenceID.ShowVolumes,
          title: "Prefer Volume Release",
        },
        {
          type: "toggle",
          key: PreferenceID.MergeChapters,
          title: "Merge Duplicate Chapters",
        },
        {
          type: "toggle",
          key: PreferenceID.OfficialFirst,
          title: "Prefer Official Releases",
        },
      ],
    },
    {
      header: "Home Sections",
      footer: "Each row costs one request, so turning one off makes the home page load sooner.",
      fields: DISCOVER_SECTIONS.map((section) => ({
        type: "toggle" as const,
        key: sectionPreferenceKey(section.id),
        title: section.title,
      })),
    },
  ];
}
