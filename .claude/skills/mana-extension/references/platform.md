# What the app does with a source

Condensed from the official source documentation (<https://mana-ios.github.io/overview>)
and the host's release notes through Build 55, checked against `@mana-app/types@0.1.1` and
the runtime in `mana-dev@0.2.0`, and corrected where the app itself has been seen to do
otherwise. Where the documentation and the toolchain disagree, the toolchain is what
decides, and the disagreement is noted. The documentation still describes the app before
Build 55 — it calls password and web sign-in unused — so where they differ, the release
notes win.

This file is the one place these facts are kept. The other references and skills point
here rather than restating them, so a platform change is corrected once.

Only the current app is supported. Nobody runs a build without native crypto, timers or
the current forms, so nothing here guards against one.

## Features are opt-in

The build detects methods on the instance; rebuild after adding or removing one.

| Feature | Methods |
| :--- | :--- |
| Title pages (required) | `getContent`, `getChapterData`, plus `getChapters` unless `Content.chapters` is filled |
| Search | `search`; optional `getSearchForm`, `getSortOptions`, `validateSearchForm` |
| Custom home page | `getSectionsForPage` **and** `resolvePageSection`; optional `willResolveSectionsForPage` |
| Settings gear | `getPreferenceMenu` — the gear appears only when it exists |
| Sign-in | `getAuthenticatedUser` **and** `handleUserSignOut`, plus one style — see [Sign-in](#sign-in) |
| Reading events | `onChaptersMarked` **and** `onChapterRead`; optional `onPageRead` |
| Deep links | `handleURL` with `config.owningLinks` |
| Custom image loading | `getCoverTransport`, `getPageTransport` — each independently |
| Tile descrambling | `shouldRedrawImage` **and** `redrawImageWithSize` |

## Not called yet

Declared in the types and detected by the build, but the app never calls them itself:
no screen, no button, no event leads to them. Don't add one expecting the app to use it.

A source may still call one of these from its own code. So **never remove an existing one**
on the strength of this table: find what calls it first, and test it on a device.

| Area | Methods |
| :--- | :--- |
| First-run setup | `getSetupMenu`, `validateSetupForm`, `isSourceSetup` — define `isRunnerSetup` too, see below |
| Library events | `onContentsAddedToLibrary`, `onContentsRemovedFromLibrary` |
| Library links | `getLibraryPageLinks` |
| Progress and library sync | `getProgressState`, `syncUserLibrary`, `getGroupedUpdates` |
| More profile items | `getAdditionalInfoSectionItems` — only `Content.additionalInfo` is drawn, and `hasMore` does nothing |

Partly used: `onChapterRead` and `onPageRead` arrive from the book reader (EPUB, PDF, text)
only, and only when `onChaptersMarked` also exists — define it as a no-op if you need the
other two.

Build 55 renamed `isRunnerSetup` to `isSourceSetup`, and the app asks for the new name.
`mana-dev@0.2.0` still sets the setup intent only when `isRunnerSetup` exists, so a source
with setup defines both, one returning the other, as MangaUpdates does. `bun run check`
fails a source that defines only one.

## Sign-in

Every style needs `getAuthenticatedUser()`, returning `null` when signed out, and
`handleUserSignOut()`. Then one style; a source with several is offered only the first, in
the order password, web, OAuth — so a password method kept beside OAuth hides the OAuth one.

| Style | Methods | What the reader sees |
| :--- | :--- | :--- |
| Password | `handleBasicAuth(identifier, password)` | A sheet asking for a username or email and a password. An error thrown from `handleBasicAuth` shows on the sheet |
| Web | `getWebAuthRequestURL()`, `didReceiveSessionCookieFromWebAuthResponse(name)` | A full-screen login page loading that URL |
| OAuth | `getOAuthRequestURL()`, `handleOAuthCallback(response)` | The system web authentication sheet |

- **Password.** The app never stores the password: `handleBasicAuth` gets it once, and any
  token or session lives in the source's own store or cookies. When it resolves, the app
  calls `getAuthenticatedUser()` for the account name. The release notes say to set
  `BasicAuthUIIdentifier` to `BasicAuthenticationUIIdentifier.EMAIL` for an email field and
  keyboard; `mana-dev@0.2.0` sets that intent from a property named
  `BasicAuthenticationUIIdentifier`. Set both, as MangaUpdates does.
- **Web.** The login page starts with the app's cookies for its URL.
  `didReceiveSessionCookieFromWebAuthResponse(name)` is called once for each new cookie name
  set on the login host, its subdomains or its parent domain; return `{ state: true }` once
  the session cookie appears. The app then copies the cookies to its own store, closes the
  page and calls `getAuthenticatedUser()`. The reader can also tap **Done**. Signing out
  calls `handleUserSignOut()` and clears the login host's cookies from both stores.
- MangaUpdates (password) and ValirScans (web) had these methods before the app offered
  them, and now get the app's own screens. MangaUpdates' settings-form sign-in still works
  beside the sheet.

## Calls

- One instance; calls overlap at every `await`. The app runs a source's methods two at a
  time by default (configurable from one to twenty). Per-call state is local.
- A request belongs to the method that started it. When the method returns, throws or is
  cancelled, its requests are cancelled and their bodies released — read every body before
  returning. Parsed values and copied bytes stay valid.
- `onEnvironmentLoaded` is not awaited. Build anything required lazily.
- `Chapter.index` is reading order: `0` is the first chapter to read. If every chapter has
  `index: 0`, the app orders by `number` instead.
- A thrown `Error`'s message is shown to the user. `console` goes to the app's log.

## Pages

- A section returned from `getSectionsForPage` with its `items` already filled is resolved
  and costs no `resolvePageSection` call — the cheap way to show a fixed row such as genres.
- `willResolveSectionsForPage` runs once before the sections resolve, for one shared
  response several rows read from.
- A `Highlight` without `link` opens the title; `noninteractive: true` opens nothing.
- On a title page, a highlight item without `icon` or `url` uses its `cover` and `webUrl`,
  and a Characters section (`additionalInfo.characters`) is saved and shown.
- `Content.trackerInfo` keys must match a tracker's link keys — its `info.id` unless its
  `trackerConfig.linkKeys` says otherwise (`anilist`, `mal`).

## Cookies

- WebView cookies are copied to the app's store when a flow ends — a Cloudflare check, a web
  sign-in, a source's own WebView — and once at launch, not on every request. Only new or
  changed cookies are copied, across every domain.
- A redirect to another host no longer carries a hand-built `Cookie` header; the redirected
  request gets that host's stored cookies.
- The Cloudflare auto-bypass finishes on the first page load that shows no challenge.

## WebView

- One page per source at a time: a second `WebViewPage.create` waits until the first closes,
  so close in `finally`. It does not block the source's other methods.
- One action at a time on a page: a second `goto`/`evaluate` before the first finishes
  throws `WebViewPageActionInProgress`.
- `timeout` (default 30 s) bounds each action; `idleTimeout` (default 30 s) closes an idle
  page, after which any use throws `WebViewPageClosed`.
- Arguments and results are JSON: functions are rejected, `Date`s become strings,
  `undefined` is dropped. Only `http`/`https` URLs can be opened.

## Networking

- `HttpClient` is the only networking API. The old `NetworkClient` contract is removed, and
  a bundle built without operation ownership fails with an explicit error.
- Keep one client (or one shared `RateLimiter`) for the source's lifetime. A client per call
  has no rate limit. `setRateLimit(n, ms)` and `setRateLimiter(RateLimit.spaced(…))` are
  the same thing; `RateLimit.tokenBucket` allows bursts.
- Default retries: `GET`/`HEAD` only, on network errors (not timeouts or cancellation) and
  429/502/503/504, honouring `Retry-After`, else backing off from 250 ms to at most 5 s.
  Request interceptors run on every attempt, response interceptors once.
- Every status is a response. `requireOk()` throws `HttpStatusError` for non-2xx.
- A request that names no `user-agent` goes out with a browser's. A host that refuses
  browsers needs the source's own on every client that reaches it, image transports
  included — MangaDex sends a browser to a bot check from its API (a 302 to an HTML page
  that reads as a 200), its cover host and its image servers (a 404).
- `HttpHeaders` supports property access (`headers.location`, assignable), case-sensitive;
  methods ignore case. Outgoing names are sent lowercase.
- A URL fragment is never sent. Its `key=value` pairs travel on the request as
  `fragmentParams`, through interceptors, retries and `response.request`.

## Images — what each path costs

| Path | Source runs? | Bytes enter JavaScript? |
| :--- | :--- | :--- |
| No transport | No | No — cheapest |
| Transport, headers only | Once per image | No |
| `response.decrypt` in a page transport | Once per image | No — native |
| `response.bytes()` → `withBody` | Once per image | Yes, copied in and out |
| `ChapterData.document` | Once per chapter | No |
| `ChapterPage.raw` (base64) | In `getChapterData` | Yes, a third larger than the image |

- Implement only the transport you need. A source whose covers load fine skips
  `getCoverTransport`, so the library never starts it for a cover; without a transport the
  app requests the image URL as it stands. `willRequestImage` is no longer called at all.
- Image transports are outside the per-source concurrency limit; only the client's rate
  limiter paces them. A limiter tuned for API calls also throttles every page.
- Images are cached by URL in their final, decoded form. One URL that can yield two images
  needs the difference in its query or fragment.
- `redrawImageWithSize` receives only the size, so the tile order cannot depend on the URL.
  If it does, rearrange in a response interceptor instead.

## Crypto

| Builder | Parameters | Notes |
| :--- | :--- | :--- |
| `Cipher.aesCtr` | `key`, `counter`, `length?` | `counter` is the full first 16-byte block; `length` (1–128, default 64) low bits count |
| `Cipher.aesCbc` | `key`, `iv`, `padding?` | `CipherPadding.Pkcs7` (default), `Zero`, `None` |
| `Cipher.aesGcm` | `key`, `iv`, `additionalData?` | `iv` 12 bytes or more; ciphertext followed by its 16-byte tag; a bad key rejects with `OperationError` |
| `Cipher.xor` | `key`, `offset?`, `limit?` | Repeating key; skip `offset` bytes, XOR at most `limit` |
| `Key.fromPassphrase(pass, salt, { keySize? })` | → `{ key, iv }` | OpenSSL `EVP_BytesToKey`, MD5, one round — `CryptoJS.AES.decrypt(text, pass)` |
| `Key.pbkdf2({ password, salt, iterations, hash, length })` | → `Uint8Array` | `KeyHash.Sha1`/`Sha256`/`Sha512` |
| `parseSalted(data)` | → `{ salt, ciphertext }` | Splits `Salted__` data |

- AES keys are 16, 24 or 32 bytes; CBC and CTR IVs are 16 bytes; everything is a `Uint8Array`.
- `response.decrypt(cipher, { contentType? })` decrypts a body natively, strips
  `content-encoding`/`content-length`, and detects JPEG, PNG, GIF, WebP, AVIF, HEIC and
  JPEG XL when no type is given. `Crypto.decrypt(cipher, bytes)` is for bytes you hold.
- Errors use WebCrypto names: `DataError` (bad parameters — key or IV length, padding,
  range) and `OperationError` (the data does not decrypt: wrong key, wrong mode, tampered).
- There is no hashing. `src/common/aes.ts` carries SHA-256 and HMAC on `crypto-js`.

## Documents and books

A title with `ContentType.NOVEL` — "Book" in the app — opens in the book reader. Its
`getChapterData` returns one of:

| Field | What the app does |
| :--- | :--- |
| `document` | The response goes to the app without entering JavaScript and must be 2xx. The app tells EPUB and PDF apart by their bytes — name, MIME type and URL are ignored — and reads other UTF-8 bytes like `text`. Wins over `pages` and `text` |
| `text` | Nonempty text read as a book. HTML tags it recognises render as markup, and text such as `2 < 3` stays plain. Empty text does not replace image `pages` |

- One file is one chapter, however many sections an EPUB holds.
- A ZIP without `META-INF/container.xml` is an image archive (CBZ) and opens in the image
  reader, pages sorted by path; every other document is kept as a book file in downloads.
- Pictures in an HTML chapter load lazily through `getPageTransport`, like image pages, and
  downloads pack them into the chapter so it reads offline.
- A book's direction comes from the book — EPUB metadata or the HTML `dir` —
  and `recommendedPanelMode` is not used for books. The novel reading modes (5–8, from
  `NOVEL_PAGED_COMIC` on) were removed; a saved one falls back to Left to Right.
- `@mana-app/types@0.1.1` declares `document` but not `text`; return `text` through a type
  that adds it until the package does.
- Malformed archives, archives without images and HTTP failures reject with an error.

## Removed in Build 55

`overrideDownloadRequest`, `getBrowsePageLinks` and `getReadChapterMarkers` are gone, and
`willRequestImage` is not called. `bun run check` fails a source that still uses one.

## Forms

Search filters and settings share one set of builders (`Search*` for the search form, `UI*`
for settings).

| Builder | Value | Looks like |
| :--- | :--- | :--- |
| `Picker` | option id | Pushed list |
| `MenuPicker` | option id | Inline pill with a menu; optional pickers get "None" |
| `PickerSheet` | option id | Sheet |
| `MultiPicker` / `MultiPickerSheet` | `string[]` | Pushed list / sheet, `minSelectionCount`/`maxSelectionCount` |
| `ExcludableMultiPicker` / `…Sheet` | `{ included, excluded }` | Include/exclude states |
| `Toggle`, `TextField`, `Stepper`, `DatePicker` | `boolean`, `string`, `number`, ISO string | — |
| `Button` (settings only) | — | Runs its `action` |

- `ListSection({ header?, footer?, children })` is a list; `TagsSection({ field })` shows one
  picker as inline chips; `Group({ id, title, children })` is a collapsible row inside a
  list — at least one field, no nesting, values still saved under each field's own id.
- `SearchSortSection` places the sort menu inside the search form.
- Picker values are option **ids**; the app no longer converts titles.
- `optional` must be `true` or omitted.
- The app does not store settings: save in `didChange`, read back when building the menu.
  It rebuilds the menu to find the changed field, so keep `getPreferenceMenu` quick and ids
  stable. Errors thrown from `didChange` are logged, not shown.
- A text field draws its placeholder, not its title — put the meaning in the placeholder or
  the section header.
- A settings screen does not redraw after a `Button`'s `action` or a `didChange`. The form
  is rebuilt only when it is opened again, so a sign-in button leaves the screen showing
  the signed-out state until the reader backs out and returns. Say so in the section's
  footer; a thrown message from `action` reaches only the log.

## Storage

`ObjectStore` (app preferences, device-only) and `SecureStore` (Keychain, synced through
iCloud Keychain), both scoped per source. Values outlive updates and uninstalls.

The typed reads (`boolean`, `number`, `string`, `stringArray`) return `null` for falsy values
— `false`, `0`, `""` — and throw on a type mismatch. A setting that can be `false` or `0` is
read with `get(key)` and a type check — `typeof stored === "boolean" ? stored : default` —
or through `PreferenceStore`, which does that already. The harness models the same rule, so
`verify` with a probe whose `settings` store `false` reproduces the mistake.

## Repositories

- `mana://add-repo?url=<repo>[&name=<name>]` and `mana://install-source?repo=<repo>&id=<id>`
  open a confirmation in the app. Only `http(s)` repository URLs are accepted. The
  repository page uses both.
- Language codes are normalised on read: `_` becomes `-`, lowercased, language names map to
  ISO codes, and `all`/`multi`/`other`/`unknown` become universal.
- A source with no `supportedLanguages` is listed only to readers who allow every language.
  List each one the site serves — `DefinedLanguages` where it names one, a bare ISO code
  otherwise.
- Themes share as links too: `mana://add-theme?url=<theme file>` (`http(s)` only) loads a
  hosted file, and `mana://add-theme?data=<base64url theme>` carries one inline, which is
  what the app's Share Link makes.
