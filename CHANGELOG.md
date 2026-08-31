# Changelog

Versions only ever bump the patch digit — `1.0.0` → `1.0.1` → `1.0.2`. Never `1.1.0`.

## Kagane (current: v1.0.1)

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

## Mangago (current: v1.0.1)

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
