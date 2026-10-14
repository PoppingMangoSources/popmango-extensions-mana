/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceSection } from "../common/index.ts";
import { CONTENT_RATING_OPTIONS, DISCOVER_SECTIONS, PreferenceID, TYPE_OPTIONS } from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(hiddenTags: () => Promise<Option[]>): PreferenceSection[] {
  return [
    {
      header: "Content",
      footer:
        "Applies to the home page, browsing and search. Pornographic titles are only asked " +
        "for when that rating is on, so turning it off costs nothing rather than filtering " +
        "a page after the fact.",
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
          key: PreferenceID.Types,
          title: "Types",
          options: TYPE_OPTIONS.map(({ id, title }) => ({ id, title })),
          minSelectionCount: 1,
        },
        {
          type: "multiselect" as const,
          key: PreferenceID.HiddenTags,
          title: "Hide Tags",
          options: hiddenTags,
        },
      ],
    },
    {
      header: "Chapters",
      footer:
        "Off, every team's upload of a chapter is listed, as a version of the same chapter. " +
        "On, the list is only the upload the site shows first for each one.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.DeduplicateChapters,
          title: "Deduplicate Chapters",
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
