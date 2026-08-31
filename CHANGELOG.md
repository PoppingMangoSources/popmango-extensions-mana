# Changelog

## Kagane (current: v1.1.1)

### Fixed

- Every home row asked to resolve a Cloudflare challenge. Two causes: the client sent a
  hand-written user agent, which does not match the connection the app actually makes and
  is what gets a request challenged in the first place — the app's own is now used — and
  any 503 was being reported as a challenge.
- A challenge is now recognised by the `cf-mitigated` header or an HTML body carrying
  Cloudflare's markers. The API answers with an ordinary JSON 403 or 503 for an expired
  reader token, a rate limit or an outage, and none of those are something a WebView can
  resolve.

## Kagane (v1.1.0)

### Added

- `Hidden Gems`, `Trending Today`, `Trending This Week`, `Trending This Month` and
  `Highest Rated` as home rows of their own. The Paperback source offers the trending
  windows as a strip of chips; as rows you can see what is climbing without tapping first.
- Detailed rows now show `MANHWA · Completed` under the title with `Chapters`, `Year` and
  `Genres` beneath it, and `Latest Updates` shows the newest chapter with how long ago it
  landed.

### Changed

- Tiles carry the real content rating. The listing states it per title, so a tile no
  longer has to assume the worst.

### Fixed

- The listing response carries the format, status, genres and newest chapter all along;
  reading them means the richer rows cost no extra requests.

## Kagane (v1.0.1)

### Fixed

- The source icon showed as a placeholder in the app. The toolchain packages only the
  project-root `assets/` folder, so an icon inside `src/<Name>/` was never shipped.

## Kagane (v1.0.0)

### Added

- Initial release, covering the site's JSON API.
- Seven home rows: `Popular` (following the Popular Time Span setting), `Latest Updates`,
  `Newly Added`, and dedicated Today / This Week / This Month / All Time rows.
- Advanced search with ten sort orders, include/exclude genres and tags, "match all"
  toggles for each, and multi-select content rating, format, status and source filters.
  Genres, tags and sources are read from the site rather than hard-coded.
- Settings for content rating, languages, hidden genres, popular time span, upload source
  (all / official / scanlations), source and edition annotations in titles, clean titles,
  spoiler tags, data saver, and four chapter-title formats — plus reset buttons.
- Reader support for the site's integrity and per-chapter access tokens, including
  re-minting an expired token when an image is actually fetched.
- Related editions from a title's tracker entry, and deep links from `kagane.to`.

## Mangago (current: v1.1.0)

### Changed

- `Featured Manga` is now the site's actual Featured Manga slider, read from the home
  page. It was being approximated with a catalogue browse sorted by views, which is
  "most viewed" — a different list from the curated one the site puts at the top.
- `New Chapters` is renamed `Latest Update` to match the site's own wording. The section
  id is unchanged, so a saved on/off switch survives the rename.
- The home page is fetched once and shared between the rows built from it.

## Mangago (v1.0.4)

### Fixed

- Chapters with scrambled panels failed to open at all. Working out the tile keys means
  evaluating the site's own JavaScript, and the fallback path opened an auxiliary WebView
  without navigating it first — which can hang until the host's own timeout, leaving the
  reader on an empty page that never resolves. The WebView now loads a page before it
  evaluates anything, the attempt is capped at eight seconds, and it is skipped entirely
  when there is no timer to bound it with.
- Key derivation can no longer fail or delay a chapter. A chapter that opens with
  scrambled panels is recoverable; one that never opens is not, so a failure now costs the
  descramble rather than the chapter.
- The redraw gate holds for at most three seconds instead of ten, so an unanswered redraw
  cannot hold up the images behind it. An image with no tile key never touches the gate.

## Mangago (v1.0.3)

### Fixed

- The source icon showed as a placeholder in the app, for the same packaging reason as
  above.

## Mangago (v1.0.2)

### Fixed

- Scrambled images came out garbled when several pages decoded at once. The app asks
  whether to redraw an image and then, in a second call that carries no URL, asks for the
  instructions — so two images in flight each received the other's tile key. The handshake
  is now serialised.
- A tile key that is not a clean permutation is rejected instead of applied, so a bad key
  leaves the image untouched rather than punching holes in it.
- Opening a title made two identical requests for the same page, one for the details and
  one for the chapter list. The page is now fetched once and shared.

## Mangago (v1.0.1)

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
