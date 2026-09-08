/* SPDX-License-Identifier: GPL-3.0-or-later */

import { SourceContextOrigin, type Badge, type SourceContext } from "@mana-app/types";

/**
 * The frosted pill the app draws over a tile's cover, on both plain and hero highlights.
 *
 * It is one short string and the app owns everything about how it looks, so the text is
 * the whole of a source's say in it. That makes it the right home for the single number a
 * site grades a title by — a rating reads better over the artwork than crowding the line
 * under the title, and once it is here it must not also be written there.
 *
 * Empty or whitespace-only text is dropped rather than drawn as an empty pill.
 */
export function toBadge(text: string | undefined | null): Badge | undefined {
  const value = (text ?? "").trim();
  return value ? { text: value } : undefined;
}

/**
 * Whether this request came from the app moving a title between sources.
 *
 * A migration walks a whole library through `getContent`, and wants only enough metadata
 * to match a title — so anything a source fetches on top of the details themselves is
 * bought once per title and thrown away. `MIGRATION` is the only origin defined, and the
 * host does not always send one, so an absent context means an ordinary read.
 */
export function isMigration(context: SourceContext | undefined): boolean {
  return context?.origin === SourceContextOrigin.MIGRATION;
}
