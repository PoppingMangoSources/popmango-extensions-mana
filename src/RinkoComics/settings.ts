/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { PreferenceSection } from "../common/index.ts";
import { DISCOVER_SECTIONS, PreferenceID } from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(): PreferenceSection[] {
  return [
    {
      header: "Chapters",
      footer:
        "Locked chapters unlock on the website. Listed here they carry a padlock and cannot be opened, but they show what is ahead and when the free run catches up. Turn this on to leave them out.",
      fields: [
        {
          type: "toggle",
          key: PreferenceID.HideLockedChapters,
          title: "Hide Locked Chapters",
        },
      ],
    },
    {
      header: "Home Sections",
      footer:
        "Every row is read from the same page, so the whole home costs one request however many are on.",
      fields: DISCOVER_SECTIONS.map((section) => ({
        type: "toggle" as const,
        key: sectionPreferenceKey(section.id),
        title: section.title,
      })),
    },
  ];
}
