# Changelog

## Mangago (current: v1.1.0)

### Fixed

- Side stories, extras and epilogues no longer sort as the *first* chapters. They carry no
  chapter number of their own, and leaving them at zero made the app offer one of them as
  the place to start reading; they are now numbered above the main run.

### Changed

- The home page loads far faster. The featured row was fetching a detail page per title —
  eight extra round trips in front of the first thing on screen — and now costs one
  request, and the request budget was raised from one to three per second.
- The section switches are read in one batch rather than one at a time, so the home page
  stops waiting on fourteen sequential store reads before it can draw.
- Removed the `Genres` grid; the same genres are available as search filters.

### Added

- Repository documentation for building and releasing sources.

## Mangago (v1.0.0)

### Added

- Initial Mana release, carrying over every capability of the Paperback source.
- Home sections: `Featured Manga`, `Popular Manga`, `New Chapters` and nine genre "Top N"
  rows, each with its own switch in settings.
- Advanced search with include/exclude genre selection, status filtering, and six sort
  orders (`Views`, `Comment Count`, `Update Date`, `Creation Date`, `Random`,
  `Alphabetical`).
- Settings for hidden genres, content type (`All` / `Manhwa-Manhua` / `Manga`), hiding RAW
  chapters, and stripping version tags from titles.
- Genre list is read from the site, so a newly added genre appears without a source update.
- Reader support for the site's AES-encrypted image lists, including the numeric mirror
  readers that serve one window of images at a time.
- Scrambled `cspiclink` images are unscrambled through Mana's native image redraw handler
  rather than a canvas round-trip.
- Deep links from `mangago.me` open the title directly.
