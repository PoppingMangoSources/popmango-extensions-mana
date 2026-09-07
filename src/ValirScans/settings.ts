/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { PreferenceSection } from "../common/index.ts";
import { DISCOVER_SECTIONS, PreferenceID } from "./model.ts";

export function sectionPreferenceKey(sectionId: string): string {
  return `${PreferenceID.SectionPrefix}-${sectionId}`;
}

/**
 * Signing in is not on this screen: the source declares a WebView login, so the app owns
 * that flow and puts the account row on the source's own page rather than in Settings.
 */
export function buildSettingsSections(): PreferenceSection[] {
  return [
    {
      header: "Chapters",
      footer:
        "Locked chapters unlock on the website, and sign in for the ones an account already has. Listed here they carry a padlock, which shows what is ahead and when the free run catches up. Turn this on to leave them out.",
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
        "Every row but New Series is read from the same page, so those cost one request between them however many are on.",
      fields: DISCOVER_SECTIONS.map((section) => ({
        type: "toggle" as const,
        key: sectionPreferenceKey(section.id),
        title: section.title,
      })),
    },
  ];
}
