/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { PreferenceSection } from "../common/index.ts";
import { DISCOVER_SECTIONS, IMAGE_QUALITY_OPTIONS, PreferenceID } from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

export function buildSettingsSections(): PreferenceSection[] {
  return [
    {
      header: "Home Sections",
      footer: "Turn off the rows you don't read to make the home page load faster.",
      fields: DISCOVER_SECTIONS.map((section) => ({
        type: "toggle" as const,
        key: sectionPreferenceKey(section.id),
        title: section.title,
      })),
    },
    {
      header: "Images",
      footer: "The resized servers can be slower and occasionally fail.",
      fields: [
        {
          type: "select" as const,
          key: PreferenceID.ImageQuality,
          title: "Image Quality",
          options: IMAGE_QUALITY_OPTIONS,
        },
      ],
    },
    {
      header: "Content",
      footer: "Shows adult titles across the home page and search. Off by default.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.ShowAdult,
          title: "Show Adult Content",
        },
      ],
    },
  ];
}
