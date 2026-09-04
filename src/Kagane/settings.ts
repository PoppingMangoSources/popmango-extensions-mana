/* SPDX-License-Identifier: GPL-3.0-or-later */

import type { Option } from "@mana-app/types";

import type { PreferenceField, PreferenceSection } from "../common/index.ts";
import {
  CONTENT_RATING_OPTIONS,
  LANGUAGE_OPTIONS,
  PreferenceID,
  UPLOAD_SOURCE_OPTIONS,
} from "./model.ts";
import { excludedTagsKey, groupTags } from "./tag-groups.ts";

/**
 * The tag list is read once and split, so a group with nothing in it is not offered.
 * A failed read leaves the section without hide-lists rather than with empty ones.
 */
async function groupedTagFields(tags: () => Promise<Option[]>): Promise<PreferenceField[]> {
  const grouped = groupTags(await tags().catch(() => []));

  return grouped.map(({ group, options }) => ({
    type: "multiselect",
    key: excludedTagsKey(group.id),
    title: `Hide ${group.title}`,
    options: async () => options,
  }));
}

export type SettingsHooks = {
  genres: () => Promise<Option[]>;
  tags: () => Promise<Option[]>;
  resetContentFilters: () => Promise<void>;
  resetAll: () => Promise<void>;
};

export async function buildSettingsSections(hooks: SettingsHooks): Promise<PreferenceSection[]> {
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
        // One hide-list per tag group, for the same reason the search form splits them:
        // the site's tag list is far too long to work through in a single picker.
        ...(await groupedTagFields(hooks.tags)),
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
