# Changelog

Versions only ever bump the patch digit — `1.0.0` → `1.0.1` → `1.0.2`. Never `1.1.0`.

## Mkissa (current: v1.0.1)

### Changed

- The page list is read from the site's own reader rather than from a signed request. The
  signing was rejected in practice, and the hashing and cipher written for it are gone with
  it. The series page is loaded, its parser claimed, and the chapter then routed to within
  the page, which is where the site delivers the list.
- A challenge is given one chance to clear before the reader is asked to solve it.

## Mkissa (v1.0.0)

First release. Manga, manhwa and manhua from mkissa.to:

- Five home rows — Popular, Popular This Week, Popular This Month, Latest Updates and
  Recommended — each of which can be turned off in settings.
- Search across the site's sixty-eight genres with include and exclude, a country filter,
  and the site's three sort orders. Pasting a series link or an `id:` opens it directly.
- Settings for image quality and adult content.
- The page list is taken from the site's own reader, which is the only place it is
  delivered: the series page is loaded, its parser is claimed, and the chapter is then
  routed to within the page. The wait clears a cold challenge rather than giving up under
  it.

## Kagane (current: v1.0.6)

### Fixed

- Waiting out a challenge judged itself by the challenge markers disappearing, which a
  blank or failed page also satisfies. It now waits for the site's own scripts to appear,
  which is the only thing that proves the real page loaded.
- A challenge that has asked for a person is handed over at once instead of being waited
  out first, so the prompt arrives in under a second rather than after the full budget.

## Kagane (v1.0.5)

### Added

- An `Exact Match` switch on the search form. The site supports it and it matches a title
  as typed rather than loosely, which helps for short or common names.

### Changed

- Listings ask for fifty titles a page instead of thirty-five, the size the site's own rows
  use, so scrolling reaches further before another request.

## Kagane (v1.0.4)

### Changed

- Popular now ranks by average views rather than total views, which is what the site's own
  all-time row does. Totals leave a long-running series parked at the top; averages let
  something newer climb.
- A search with no explicit order leaves the sort parameter off, as the site does, instead
  of sending it empty.

## Kagane (v1.0.3)

### Fixed

- A challenge was only cleared automatically on the home page. One failed attempt there
  silenced the bypass for a full minute, so opening a title, a search or the reader in that
  window went straight to the manual prompt without trying. The wait between attempts is
  shorter now, and any request that succeeds clears it — so once a challenge is solved, by
  hand or otherwise, the next one is answered automatically again.

## Kagane (v1.0.2)

### Fixed

- Every row in Latest Updates reported the same age. A timestamp was read for its date and
  its time of day thrown away, so each chapter was dated midnight rather than when it
  landed. Chapters now show the age the site shows.

## Kagane (v1.0.1)

### Fixed

- A Cloudflare challenge went straight to the manual prompt. The source now loads the site
  in the auxiliary WebView and waits for the challenge to run itself out before retrying,
  which takes fifteen to twenty seconds from cold. An earlier attempt at this treated the
  challenge page finishing loading as the challenge being solved, and gave up after twelve
  seconds; it now waits for the challenge markers to actually clear. A cooldown keeps a site
  that challenges everything from spending that budget on every request.

## Kagane (v1.0.0)

First release. The numbering before this one covered a testing round inside the repository,
before anyone else had installed the source, so it starts again from zero.

Manga, manhwa, manhua and comics from kagane.to:

- The site's own home rows — Popular, Trending This Month, This Week and Today, Latest
  Updates and Recently Added.
- The full search form: content rating, format, status, upload sources, and genre and tag
  pickers with include and exclude, the long lists opening as sheets.
- Settings for the upload source, content languages, title cleanup, and hide-lists for
  genres and tags.
- Chapters carry the volume, the number and the name in one label, with the publisher
  beside them and a tick where the upload is official.
- The integrity-token exchange the reader needs, with a refresh when a token goes stale.
- Requests are narrowed to the content ratings the app says it will accept.

## Mangago (current: v1.0.0)

First release, renumbered on the same basis as above.

Manga, manhwa and doujinshi from mangago.me:

- The site's Featured Manga slider, Popular Manga, the latest-update feed, and ten genre
  Top 10 rows.
- Search across the site's genres with include and exclude, plus status and sort.
- Settings for content type, hidden genres, and which home rows appear.
- Chapters keep the site's own wording, numbering included.
- The AES-decrypted, tile-descrambled reader, including the mirror hosts.
- A rating policy from the app is applied through the site's own genre exclusions, so pages
  stay whole.
