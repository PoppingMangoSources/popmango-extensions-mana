/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceSection, PreferenceStore, PreferenceValue } from "../common/index.ts";
import { CONTENT_TYPE_OPTIONS, DISCOVER_SECTIONS, GENRE_OPTIONS, PreferenceID } from "./model.ts";

export type MangagoPreferences = PreferenceStore<Record<string, PreferenceValue>>;

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

/**
 * The settings screen.
 *
 * Every home section gets its own switch, so a reader who only wants New
 * Chapters is not paying for thirteen other requests on every home refresh.
 */
export function buildSettingsSections(genres: () => Promise<Option[]>): PreferenceSection[] {
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
      header: "Content",
      footer:
        "Hidden genres are excluded from the home page and from genre browsing. Free-text search is served by the site and cannot be filtered.",
      fields: [
        {
          type: "multiselect" as const,
          key: PreferenceID.HiddenGenres,
          title: "Hide Genres",
          options: genres,
        },
        {
          type: "select" as const,
          key: PreferenceID.ContentType,
          title: "Content Type",
          options: CONTENT_TYPE_OPTIONS,
        },
      ],
    },
    {
      header: "Chapters",
      footer:
        "Removing version tags such as “(Official)” from titles helps duplicate library entries collapse onto one another.",
      fields: [
        {
          type: "toggle" as const,
          key: PreferenceID.HideRaws,
          title: "Hide RAW Chapters",
        },
        {
          type: "toggle" as const,
          key: PreferenceID.RemoveTitleVersion,
          title: "Remove Version Tags From Titles",
        },
      ],
    },
  ];
}

export const STATIC_GENRE_OPTIONS = GENRE_OPTIONS;
