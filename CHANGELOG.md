# Changelog

Versions only ever bump the patch digit — `1.0.0` → `1.0.1` → `1.0.2`. Never `1.1.0`.

## Repository

### Fixed

- The repository's own icon never loaded in the app. It was published as the relative
  path `assets/Repository.png`, which the app has no base to resolve against, so it now
  names the published file in full.

## MangaUpdates (current: v1.0.3)

### Fixed

- Signing in said nothing, so the only way to tell it had worked was to leave Settings and
  come back — and pressing the button again signed in all over again. The app rebuilds
  that screen only when it is opened and gives a source no way to redraw it or raise a
  notice, so the button now reports who it signed in as, and a second press says the
  account is already signed in rather than repeating the request (v1.0.3).

- The Sign In button did nothing but report both fields empty. The app runs every form
  callback on its own, so the typed username and password were gone by the time the
  button read them; they are now written down as they are typed — the password to the
  keychain, and dropped the moment the site has been given it (v1.0.2).
- Checked every call against the site's published API description. A write refused for
  being inside the five-second window is now waited out and sent again rather than lost,
  signing in no longer carries the session it is replacing, the account screen no longer
  reads contribution counts as though they were reading counts, and Drama CD joins the
  types the search offers (v1.0.1).

### Added

- Initial release. Signs in with a MangaUpdates username and password, and tracks a
  title's list, chapter, volume and score against the account.
- Browse rows for Trending Now, Popular Manga, Popular Manhwa and Top Rated, and a search
  form covering genres, types, release state, licensing, year and reader categories.
- Reading progress never moves backwards, and writes are spaced so the site's one-write
  every-five-seconds limit does not silently drop them.
- An account screen in the source's own settings, so signing in does not depend on where
  the app chooses to put its own prompt.
- The source declares that it needs an account, which is what puts the app's own Account
  row on the source page.

## XCOMIC (current: v1.0.5)

### Changed

- Every source hands the app the URL that was actually challenged by Cloudflare rather
  than the site root, so the prompt opens the page that is blocked (v1.0.5).
- Rows are named as the site's own sort control names them, and both language pickers
  carry all 107 codes the site publishes rather than 93 (v1.0.3).
- Most Reviews leads the detailed rows and Most Follows sits under Most Chapters; tiles
  carry the rating in place of the type, with follows and comments marked by their own
  glyphs (v1.0.2).
- Renamed from XComic, restarted at v1.0.0, and gained a `comik.to` mirror (v1.0.0).

### Added

- The score, follows, reviews and comment counts the site publishes now reach the tiles
  and the detail page, and Most Follows and Most Reviews rows were added (v1.0.1).

### Fixed

- The Formats filter was removed: the site files its formats among its genres, and eight
  of its twelve hardcoded ids did not exist on the site at all (v1.0.1).

## XComic (v1.0.1)

### Fixed

- Every row on the home page failed or came back empty. The first release invented the
  shape of four API requests rather than using the site's own: the two feeds page by
  cursor and reject a page number outright, the chapter list keys on `comic_id` and names
  its own order, browse needs the offset of the page it is asking for, and its results
  arrive as a list of nodes rather than one wrapper. All four match the site now.

### Changed

- The home page is laid out like the other sources here: a hero, a detailed pair for
  today's trending, then this week, the grouped chapter feed, all-time, and recently added.

## XComic (v1.0.0)

First release. Manga, manhwa, manhua and comics from xcomic.me:

- Six home rows — Top Rated, Most Views for today, this week and all time, Latest Uploads
  and Recently Added — each of which can be turned off in settings.
- The site's full advanced search: types, content ratings, demographics, genres with
  include, exclude and match-all, original and upload status, chapter count, a year or a
  year range, and original and translated languages, with nineteen sort orders.
- Settings for content ratings, types, translated languages and a genre hide-list, which
  stand in for anything the search form leaves blank.
- Chapters keep the site's own order and name their scanlator, whether that is an official
  source, a group, or the person who uploaded it.

## FlameComics (current: v1.0.6)

### Changed

- Popular leads as the hero with Staff Picks below it, both naming the type and the like
  count; the Featured carousel is a single row with no subtitle (v1.0.4).
- Tiles write the heart against the count — `Likes  ♥ 141` (v1.0.4).

## FlameComics (v1.0.1)

### Added

- A Featured row carrying the site's own front-page carousel. A slide pointing at a novel
  rather than a comic is left out.
- Every row shows the publication status beside the like count.

### Changed

- The like count is labelled `Likes ♥` rather than a bare heart.
- Popular moved to a detailed two-row layout now that Featured holds the top of the page.

## FlameComics (v1.0.0)

First release. Manhwa, manhua and manga from flamecomics.xyz:

- Three home rows — Popular, Latest Updates and Staff Picks — all served from the one
  payload the site's own homepage uses, so the whole page costs a single request. Each
  carries the site's like count as a heart.
- The site has no search endpoint, so its full catalogue is fetched once and filtered here:
  categories with include, exclude and match-all, publisher, author and artist the same
  way, plus type, status, year, language and country, and six sort orders.
- Chapters are read from the series payload that already carries them, and page images
  come from the CDN with the token the site uses as a cache-buster.

## Kagane (current: v1.0.11)

### Fixed

- A challenge met while a request was in flight is retried instead of surfacing, and the
  cooldown that left a later screen with no attempt at all is gone (v1.0.10).
- The reader's integrity and access tokens are dropped when a challenge replaces the
  session they were minted against, which is what previously left the reader stuck until
  the source was closed and its cache cleared by hand (v1.0.9).

## Kagane (v1.0.8)

### Changed

- The hero row carries fifty titles, the same as every other row, so the cap that existed
  only to shorten it is gone.

## Kagane (v1.0.7)

### Fixed

- The hero row ranked by averaged views, which reads as a monthly chart rather than an
  all-time one. It counts total views again, as other clients for this site do, and shows
  twenty titles instead of ten.

### Changed

- Identical requests already in flight share one response, so a refresh that fires every
  row at once, or a retry after a challenge, no longer asks the server the same question
  several times over.

## Kagane (v1.0.6)

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

## Mangago (current: v1.0.5)

### Fixed

- Cloudflare challenges were reported as plain network errors: without a status validator
  the host threw on 403 before the check that classifies them could run (v1.0.5).

## Mangago (v1.0.4)

### Changed

- Chapters are listed in the order the site uploaded them, which is what other clients for
  this site show, instead of being re-sorted by number. Notices therefore sit where they
  were posted rather than being gathered at either end. An unread title still starts at its
  first numbered chapter.

## Mangago (v1.0.3)

### Changed

- Unnumbered chapters are ordered among themselves the way the numbered run is — official
  uploads first, then by uploader — rather than being left in page order.

## Mangago (v1.0.2)

### Fixed

- Notices and unnumbered side stories sat above the newest chapter. Numbering them past the
  end of the run kept them out of the resume position but put them at the top of the list;
  they now sit beneath it, and an unread title still starts at its first real chapter.

## Mangago (v1.0.1)

### Changed

- Helpers used only inside their own file are no longer exported, and two byte encoders
  that no source still calls are gone.

## Mangago (v1.0.0)

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
