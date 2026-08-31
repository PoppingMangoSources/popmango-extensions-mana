/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceSection } from "../common/index.ts";
import {
  CHAPTER_TITLE_MODE_OPTIONS,
  CONTENT_RATING_OPTIONS,
  LANGUAGE_OPTIONS,
  PreferenceID,
  UPLOAD_SOURCE_OPTIONS,
} from "./model.ts";

export type SettingsHooks = {
  /** Genres the site currently publishes, for the hide-list. */
  genres: () => Promise<Option[]>;
  /** Tags the site currently publishes, for the hide-list. */
  tags: () => Promise<Option[]>;
  resetContentFilters: () => Promise<void>;
  resetAll: () => Promise<void>;
};

export function buildSettingsSections(hooks: SettingsHooks): PreferenceSection[] {
  return [
    {
      header: "Content",
      footer:
        "Applies to the home page, listings and search. Erotica and Pornographic are hidden by default.",
      fields: [
        {
          type: "multiselect",
          key: PreferenceID.ContentRating,
          title: "Content Rating",
          options: CONTENT_RATING_OPTIONS,
          minSelectionCount: 1,
        },
        {
          type: "multiselect",
          key: PreferenceID.ContentLanguages,
          title: "Languages",
          options: LANGUAGE_OPTIONS,
          minSelectionCount: 1,
        },
        {
          type: "multiselect",
          key: PreferenceID.ExcludedGenres,
          title: "Hide Genres",
          options: hooks.genres,
        },
        {
          type: "multiselect",
          key: PreferenceID.ExcludedTags,
          title: "Hide Tags",
          options: hooks.tags,
        },
      ],
    },
    {
      header: "Browsing",
      footer:
        "Upload Source picks which uploads appear everywhere; a single search can still override it with the Sources filter.",
      fields: [
        {
          type: "select",
          key: PreferenceID.UploadSource,
          title: "Upload Source",
          options: UPLOAD_SOURCE_OPTIONS,
        },
      ],
    },
    {
      header: "Titles",
      footer:
        "Clean Title removes a trailing bracketed qualifier so duplicate library entries collapse together. It replaces the two annotations above it rather than combining with them.",
      fields: [
        {
          type: "toggle",
          key: PreferenceID.ShowSourceInTitle,
          title: "Show Source in Title",
        },
        {
          type: "toggle",
          key: PreferenceID.ShowEditionInTitle,
          title: "Show Edition in Title",
        },
        { type: "toggle", key: PreferenceID.CleanTitle, title: "Clean Title" },
      ],
    },
    {
      header: "Chapters",
      footer: "Some tags are marked as spoilers by the site and hidden on a title's page.",
      fields: [
        {
          type: "select",
          key: PreferenceID.ChapterTitleMode,
          title: "Chapter Title Format",
          options: CHAPTER_TITLE_MODE_OPTIONS,
        },
        {
          type: "toggle",
          key: PreferenceID.ShowSpoilerTags,
          title: "Show Spoiler Tags",
        },
        {
          type: "toggle",
          key: PreferenceID.DataSaver,
          title: "Data Saver",
        },
      ],
    },
    {
      footer: "Reset returns the hide-lists, or every setting, to their defaults.",
      fields: [
        {
          type: "button",
          id: "reset-content-filters",
          title: "Reset Content Filters",
          isDestructive: true,
          action: hooks.resetContentFilters,
        },
        {
          type: "button",
          id: "reset-all",
          title: "Reset All Settings",
          isDestructive: true,
          action: hooks.resetAll,
        },
      ],
    },
  ];
}
