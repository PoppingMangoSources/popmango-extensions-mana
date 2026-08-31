# Changelog

Versions only ever bump the patch digit — `1.0.0` → `1.0.1` → `1.0.2`. Never `1.1.0`.

## Kagane (current: v1.0.10)

### Removed

- The `Chapter Title Format` setting. The site records the volume, the chapter number and
  the name separately, so the app composes the row itself — as other clients for this site
  do — and there is nothing left for four hand-written shapes to choose between.

### Changed

- Chapters carry their volume, which the source never reported, so a row reads
  `Vol.1 Ch.11 - Oleg: Apology`. A title that only restates its own numbering is dropped
  rather than repeated after it.

## Kagane (v1.0.9)

### Added

- An official upload is marked with a tick beside its publisher, as other clients for this
  site do. Only sources the site itself types as official get one; a scanlation group or a
  mixed source is left plain.

## Kagane (v1.0.8)

### Fixed

- Chapters name the wrong publisher. The site records who uploaded a series on the series
  itself, not on each chapter, so the group is now resolved from that — an official
  publisher or a scanlation group — matching what other Kagane clients show. A group named
  inside a chapter title is appended to it rather than replacing it.

## Kagane (v1.0.7)

### Fixed

- An expired reader token was reported as a raw network error instead of being refreshed.
  The host rejects any non-2xx response before the caller sees it unless the client says
  otherwise, which made the retry unreachable and replaced the site's own error messages
  with a generic one. Both work now.

## Kagane (v1.0.6)

### Changed

- Every method that performs a network request is now named `fetch*`, so reading the client
  tells you which calls cost a request. `get*` is left to the methods the app itself calls.

## Kagane (v1.0.5)

### Changed

- Helpers follow one naming scheme instead of several overlapping ones: `parse*` reads
  source data, `build*` assembles a URL or request, `format*` renders a display string,
  `is*`/`has*` answer a question. The `*Of`, `extract*`, `to*` and `*Label` synonyms are gone.
- Helpers that existed only to name a single expression are inlined into their one caller.

## Kagane (v1.0.4)

### Changed

- API response types take the house suffix: a top-level response is a `Response`, a nested
  item drops the tag entirely, replacing fourteen `Dto` names no other repository uses.
- `SectionSpecOption` is now `DiscoverSection`, which is what it holds.

## Kagane (v1.0.3)

### Changed

- Staff entries on a title page are built with the helpers the types package exports
  instead of hand-written numeric type tags, which would break silently if the enum
  were renumbered.

## Kagane (v1.0.2)

### Changed

- Opening the home page fetched the tag and upload-source lists that nothing on it uses.
  Each list is now fetched on its own, when something asks for it: the home page costs
  seven requests instead of nine, the tag list waits for the search form, and the source
  list waits for the search form or for `Show Source in Title`.
- Section listing and preference reading go through the shared helpers both sources had
  been reimplementing.

## Kagane (v1.0.1)

### Changed

- Comments cut from 225 lines to 20, matching the density of other Mana repositories. What
  remains records a trap that has already caused a bug, in a line or two.
- Dead code removed and the shared toolkit pruned. `api.ts` takes the repository's own name
  for that layer, `client.ts`; a single-use title helper is inlined, and the relative-time
  formatter both sources carried a copy of now lives in the shared date helpers.

### Fixed

- Asking for a hidden genre through the search form sent it as both a wanted value and an
  exclusion, so the search came back empty. An explicit choice on the form now wins for
  that one search.

## Kagane (v1.0.0)

Initial release. Reset from the pre-release version numbering, which had run ahead of
itself before anyone outside the repository had installed the source.

Manga, manhwa, manhua and comics from kagane.to, with the site's own home rows, the full
search form, hide-lists for genres and tags, and the integrity-token dance the reader
needs.

## Mangago (current: v1.0.7)

### Fixed

- A chapter whose title carried a name lost its number entirely, so `Ch.4: Official
  Uncensored` read as just `Official Uncensored`. The number, the volume and the name are
  reported as separate fields now and the app composes the row, so it reads
  `Ch.4 - Official Uncensored`. A chapter with nothing but a number still reads `Ch.4`.
- The volume was parsed off the title and then discarded; a chapter that names one now
  reports it, so a row can read `Vol.2 Ch.15 - The Duel`.

## Mangago (v1.0.6)

### Changed

- Naming checked against the reference sources; the network methods already followed the
  `fetch*` rule that Kagane needed.

## Mangago (v1.0.5)

### Changed

- Helpers follow one naming scheme instead of several overlapping ones: `parse*` reads
  source data, `build*` assembles a URL or request, `format*` renders a display string,
  `is*`/`has*` answer a question. The `*Of`, `extract*`, `to*` and `*Label` synonyms are gone.
- Helpers that existed only to name a single expression are inlined into their one caller.

## Mangago (v1.0.4)

### Changed

- Helper names follow the repository rules: a helper returning an absolute URL carries a
  `Url` suffix, and the two path helpers say which one keeps the query string.
- `SectionSpecOption` is now `DiscoverSection`, which is what it holds.

## Mangago (v1.0.3)

### Changed

- Staff entries on a title page are built with the helpers the types package exports
  instead of hand-written numeric type tags, which would break silently if the enum
  were renumbered.

## Mangago (v1.0.2)

### Changed

- Section listing and preference reading go through the shared helpers, replacing copies
  of both that had been written out by hand.

## Mangago (v1.0.1)

### Changed

- Comments cut from 307 lines to 14, on the same basis as above.
- Dead code removed: an unused detail parser, its type, an unused alias, and a private copy
  of a URL helper the shared toolkit already had.

### Fixed

- A Cloudflare challenge hit while loading a chapter's pages left silent gaps in the
  chapter, and one hit while resolving a pasted link read as though the link were not
  recognised. Both surface the challenge now, so it can be answered.

## Mangago (v1.0.0)

Initial release. Reset from the pre-release version numbering, as above.

Manga, manhwa and doujinshi from mangago.me, with the site's Featured Manga slider, its ten
genre rows, the latest-update feed, and the AES-decrypted, tile-descrambled reader.
