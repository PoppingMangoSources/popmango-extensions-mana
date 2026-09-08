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
 * The house marks, so every source spells them the same.
 *
 * These are the text-presentation forms on purpose: a pill and a `Pair` both take plain
 * text, and the bare codepoints would draw in colour beside the filled marks around them.
 * `⏯︎` and `🗨︎` carry U+FE0E for exactly that reason.
 */
export const Mark = {
  Rating: "★",
  Views: "⏯︎",
  /** The same heart serves a like and a follow; a site only ever counts one of them. */
  Likes: "♥",
  Comments: "🗨︎",
  Type: "♤",
  Status: "◌",
  Locked: "🔒",
  /** The pill's own book, which reads where the outline spade does not. See `typePill`. */
  TypePill: "📖",
} as const;

/**
 * How a pill words what a title is, which is not how an info row words it.
 *
 * A `Pair` sits in a column with a key beside it, where a light outline mark is enough to
 * tell the rows apart. The pill has none of that — it is a few characters over artwork — so
 * it takes the filled book instead, which still reads at that size.
 */
export function typePill(kind: string | undefined | null): string {
  const value = (kind ?? "").trim();
  return value ? `${Mark.TypePill} ${value}` : "";
}

/**
 * How a pill words where a title has got to: the word alone.
 *
 * "Ongoing" and "Completed" say what they are without help, and the pill is the last thing
 * the chain reaches — a mark in front of it over the cover is decoration, not information.
 */
export function statusPill(state: string | undefined | null): string {
  return (state ?? "").trim();
}

/**
 * The first of these the site actually filled in, or `""` when it filled in none.
 *
 * A pill wants the best thing a site says about a title, and not every title has the best
 * one — so pass the candidates in the house order and let it fall through:
 *
 * 1. what the site grades it — a rating, else what it has been read, else the likes,
 *    follows or comments it counts;
 * 2. what the title *is* — its type;
 * 3. where the title has got to — its status;
 * 4. nothing, which is a bare cover rather than an empty pill.
 *
 * Compare the answer against the candidates to see which one was taken — whatever the pill
 * carries comes out of that card's **subtitle**, or the tile says the same thing twice on
 * two lines a thumb's width apart.
 *
 * Its **info rows** are not touched. A `Pair` list is the reader's read of a title — rating,
 * genres, status, latest chapter, in that order every time — and a row silently missing
 * because a pill happened to take it leaves a hole where the eye expects a number. The rows
 * are far enough from the pill, and labelled, that the repetition reads as confirmation
 * rather than clutter.
 */
export function firstFilled(...candidates: (string | undefined | null)[]): string {
  for (const candidate of candidates) {
    const value = (candidate ?? "").trim();
    if (value) return value;
  }
  return "";
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
