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
        "Keep Best Upload per Group keeps one upload per chapter and team, preferring " +
        "complete uploads, then wider scans and larger files. Smallest Upload keeps the " +
        "lightest instead, for each team and, with Deduplicate Chapters, for each chapter. " +
        "Switching it lists other uploads, so read status does not carry over. Upload Size " +
        "shows the chosen upload's download size. Deduplicate Chapters keeps only the " +
        "site's first visible upload for each chapter.",
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
          type: "toggle" as const,
          key: PreferenceID.BestUploadPerGroup,
          title: "Keep Best Upload per Group",
        },
        {
          type: "toggle" as const,
          key: PreferenceID.SmallestUpload,
          title: "Smallest Upload",
        },
      ],
    },
    {
      // The app draws a text field's placeholder but not its title, so the section names it.
      header: "Hidden Groups",
      footer:
        "Leaves out uploads from these scanlation groups, as the site's own setting does. " +
        "Upper and lower case don't matter.",
      fields: [
        {
          type: "text" as const,
          key: PreferenceID.HiddenGroups,
          title: "Hidden Groups",
          placeholder: "Group names, comma separated",
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
