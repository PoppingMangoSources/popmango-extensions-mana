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
        "Deduplicate Chapters lists only the upload the site shows first for each chapter, " +
        "rather than one from every team. Upload Size closes a chapter's name with the " +
        "download it is offering, which is how one team's two uploads of it differ — with " +
        "it off they are the same row, and only one is listed. Hidden Groups leaves out " +
        "those teams' uploads, matching the site's own setting.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.DeduplicateChapters,
          title: "Deduplicate Chapters",
        },
        {
          type: "toggle" as const,
          key: PreferenceID.ShowUploadSize,
          title: "Upload Size",
        },
        {
          type: "text" as const,
          key: PreferenceID.HiddenGroups,
          title: "Hidden Groups",
          placeholder: "Names, comma separated",
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
