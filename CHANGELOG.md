# Changelog

## Mangago (current: v1.0.0)

### Added

- Initial Mana release, carrying over every capability of the Paperback source.
- Fourteen home sections: `Featured Manga`, `Popular Manga`, `New Chapters`, nine
  genre "Top N" rows, and a `Genres` grid — each with its own switch in settings.
- Advanced search with include/exclude genre selection, status filtering, and six
  sort orders (`Views`, `Comment Count`, `Update Date`, `Creation Date`, `Random`,
  `Alphabetical`).
- Settings for hidden genres, content type (`All` / `Manhwa-Manhua` / `Manga`),
  hiding RAW chapters, and stripping version tags from titles.
- Genre list is read from the site, so a newly added genre appears without a
  source update.
- Reader support for the site's AES-encrypted image lists, including the numeric
  mirror readers that serve one window of images at a time.
- Scrambled `cspiclink` images are unscrambled through Mana's native image redraw
  handler rather than a canvas round-trip.
- Deep links from `mangago.me` open the title directly.
