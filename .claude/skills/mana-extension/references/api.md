# The `@mana-app/types` surface and the runtime that consumes it

Verified against `@mana-app/types@0.0.26` and `@mana-app/dev@0.1.14` by reading the
type declarations and the runtime embedded in `mana-dev`.

## How the app decides what your source can do

`mana-dev` instantiates your `Target` and reads properties off the instance to compute an
**intent bitmask**, stored in `dist/sources.json`. The app then only offers features whose
bit is set. Methods inherited from a base class or defined on a prototype are detected
normally; a method that does not exist is a feature that does not exist.

| Bit | Intent | Set when the instance has |
| --- | --- | --- |
| 0 | `preferenceMenuBuilder` | `getPreferenceMenu` |
| 1 | `requiresSetup` | `getSetupMenu` **and** `validateSetupForm` **and** `isRunnerSetup` |
| 2 | `imageRequestHandler` | `willRequestImage` |
| 3 | `pageLinkResolver` | `getSectionsForPage` **and** `resolvePageSection` |
| 4 | `libraryPageLinkProvider` | `getLibraryPageLinks` |
| 5 | `authenticatable` | `getAuthenticatedUser` + `handleUserSignOut` **and** one flavour below |
| 6 | `basicAuth` | `handleBasicAuth` |
| 7 | `basicAuthUsesEmail` | `BasicAuthenticationUIIdentifier === EMAIL` |
| 8 | `webviewAuth` | `getWebAuthRequestURL` + `didReceiveSessionCookieFromWebAuthResponse` |
| 9 | `oauthAuth` | `getOAuthRequestURL` + `handleOAuthCallback` |
| 10 | `providesSearch` | `search` |
| 11 | `providesSearchForm` | `getSearchForm` |
| 12 | `providesSearchSortOptions` | `getSortOptions` |
| 13 | `chapterEventHandler` | `getContent` + `onChaptersMarked` + `onChapterRead` |
| 14 | `contentEventHandler` | `getContent` + `onContentsAddedToLibrary` + `onContentsRemovedFromLibrary` |
| 15 | `librarySyncHandler` | `getContent` + `syncUserLibrary` |
| 16 | `pageReadHandler` | `getContent` + `onPageRead` |
| 17 | `progressSyncHandler` | `getContent` + `getProgressState` |
| 18 | `groupedUpdateFetcher` | `getContent` + `getGroupedUpdates` |
| 19 | `redrawingHandler` | `getContent` + `shouldRedrawImage` + `redrawImageWithSize` |
| 20 | `chaptersInContent` | `getChapterData` present **and `getChapters` absent** |
| 21 | `providesChapters` | `getContent` + `getChapterData` |
| 22 | `canHandleURL` | `handleURL` |
| 23 | `allowsMultipleInstances` | `config.allowsMultipleInstances` |
| 24 | `requiresAuthenticationToAccessContent` | `config.requiresAuthenticationToAccessContent` |

Check your own build with:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name, s.intents)"
```

Two traps worth calling out:

- **Bit 20.** Omitting `getChapters` does not mean "no chapters" — it means "chapters
  arrive inside `Content.chapters`". Either implement `getChapters`, or return chapters
  from `getContent`. Doing neither leaves the app expecting inline chapters it never gets.
- **Bit 1.** The runtime checks `target.isRunnerSetup`, but `SourceSetupProvider` in the
  `.d.ts` declares `isSourceSetup`. Implementing only the typed name produces a source that
  never reports as requiring setup. Define both if you need setup.

## Runtime constraints

The source runs in a bare V8 / JavaScriptCore context, not Node and not a browser.

- **No `fetch`, `URL`, `URLSearchParams`, `TextEncoder`/`TextDecoder`, `DOMParser`.** Build
  query strings yourself — `withQuery` in `src/common/query.ts` does it. `Buffer` exists only as a
  bundler-injected shim.
- **`console` may not exist.** Do not rely on logging. A thrown `Error` message is the only
  diagnostic channel guaranteed to reach the user, so put real detail in it.
- **`NetworkResponse.data` is always a `string`.** There is no binary response mode, so a
  page served as windows-1252, Shift-JIS or any other non-UTF-8 encoding does not arrive
  as mojibake — the request fails at the bridge, with a message naming serialisation or
  Unicode. `getText(client, url)` in `src/common/network.ts` recovers those by re-reading
  the page through the WebView, which decodes with the charset the page declares. What
  comes back is the serialised DOM, so a byte the decoder could not map arrives as U+FFFD;
  a parser that slices titles should cut at that character rather than pass it on.
- **`onEnvironmentLoaded` is not awaited.** The runtime calls
  `target.onEnvironmentLoaded?.().catch(...)` and moves on, so anything it assigns can still
  be undefined when the first real method runs. Build the client lazily instead.
- **`Target` must be an exported class.** The bundle ends in
  `globalThis.Target = __exports__.Target`; a source directory without one fails the build
  with `No Target class found in self-contained bundle`.

Host globals available: `NetworkClient`, `NetworkClientBuilder` (imported from the types
package), `CloudflareError`, `NetworkError`, `ObjectStore`, `SecureStore`, `WebViewPage`.

**No `crypto.subtle`.** A site that AES-encrypts its image list needs `src/common/aes.ts`.

### `WebViewPage`

`create()` returns a blank page. `evaluate`/`evaluateScript` on a page that has never
navigated **hangs until the host's own timeout** rather than throwing — the chapter simply
never opens. Always `goto()` first, race the work against your own timer, and close in a
`finally`:

```ts
const page = await WebViewPage.create({ timeout: SECONDS });
try {
  const work = (async () => {
    await page.goto(DOMAIN, { waitUntil: "domcontentloaded" });
    return await page.evaluateScript<T>(program);
  })();
  return await Promise.race([work, expiresIn(SECONDS)]);
} finally {
  await page.close().catch(() => undefined);
}
```

Both `WebViewPage` and `setTimeout` are host-provided and may be absent in an older build,
so feature-detect each off `globalThis` and skip the path rather than throwing. Anything a
WebView is only *enhancing* — a descrambling key, an optional token — belongs in a
`try`/`catch` that degrades, never in the path that decides whether a chapter opens.

A `Function`-constructed program that is self-contained runs in-process and is far cheaper
than a WebView; reach for the WebView only when the site's own globals are needed.

**`ObjectStore`/`SecureStore` typed accessors throw on a type mismatch.** `set(k, v)` takes
any value and stores it natively; `string()`, `boolean()`, `number()` and `stringArray()`
each throw if the stored value is not that type. Reading a preference without catching that
throw fails the whole `getPreferenceMenu` call, and the app surfaces it as a load failure
rather than a per-field problem. Store native values, read with the matching accessor, and
wrap every read.

## Search: the current API

`SearchProvider` is:

```ts
search(request: SearchRequest): Promise<PagedSearchResult>;
getSearchForm?(): Promise<SearchForm>;
getSortOptions?(): Promise<SortOption[]>;
validateSearchForm?(form: SearchFormSubmission): Promise<SearchFormValidationResult>;
```

A `SearchForm` is `{ sections: SearchSection[] }`, built from three section builders —
`SearchListSection`, `SearchTagsSection`, `SearchSortSection` — holding fields built from
`SearchPicker`, `SearchMultiPicker`, `SearchExcludableMultiPicker`, `SearchToggle`,
`SearchTextField`, `SearchStepper`, `SearchDatePicker`. All are exported from
`@mana-app/types`. `buildSearchForm` in `forms/search.ts` assembles them.

**The builder chooses the presentation.** There is no presentation argument, and the host
no longer promotes a long option list to a sheet on its own — a field with five hundred
options renders as five hundred inline rows unless you ask for a sheet:

| Builder | Presentation | Submits |
| --- | --- | --- |
| `SearchPicker` | list, single | `Option` |
| `SearchMenuPicker` | compact menu | `Option` |
| `SearchPickerSheet` | sheet, single | `Option` |
| `SearchMultiPicker` | list, multi | `Option[]` |
| `SearchMultiPickerSheet` | sheet, multi | `Option[]` |
| `SearchExcludableMultiPicker` | list, include/exclude | `{ included, excluded }` |
| `SearchExcludableMultiPickerSheet` | sheet, include/exclude | `{ included, excluded }` |

Any list the server fills — genres, tags, scanlation sources — takes a sheet builder.
`SearchTagsSection` is always inline chips and ignores sheet builders, so it suits a fixed
list of a few dozen and nothing larger.

`SearchGroup({ id, title, children })` groups fields visually inside a `SearchListSection`.
It has no submitted value of its own and cannot nest. Note what it compiles to: the section
flattens the group's children into `children` and records `groups: [{ id, title, fieldIds }]`
alongside — so a group is a rendering hint, and each child keeps its own filter id.

### `SourceContext`

`SourceContext` is a closed interface with two readonly fields, not the open bag it used to
be:

```ts
enum SourceContextOrigin { MIGRATION = 0 }

interface SourceContext {
  readonly origin?: SourceContextOrigin;
  readonly allowedContentRatings?: readonly ContentRating[];
}
```

It reaches a source three ways: as the **second argument to `getContent`**, as
`SearchRequest.context`, and as `PageLink.context`.

`origin` says which host flow asked. `MIGRATION` is the only value defined, and the host
does not always send one — so an absent context, or an absent `origin`, means an ordinary
read and must keep behaving like one. A migration walks a whole library through
`getContent` wanting only enough metadata to match a title, so anything a source fetches
*on top of* the details is bought once per title and thrown away:

```ts
async getContent(contentId: string, context?: SourceContext): Promise<Content> {
  const content = parseContent(await this.api.fetchSeries(contentId));
  if (isMigration(context)) return content;
  …the extra request that fills a Similar Titles row…
}
```

`isMigration` is in `src/common/highlights.ts`. Two sources here pay for this and both wire
it: FlameComics fetches its Similar Titles row and Kagane its related editions, one extra
request each, on every title a migration walks through.

JavaScript ignores an argument a function does not declare, so a source that never adds the
parameter keeps working and simply never sees the context — it is additive, not a break.

`allowedContentRatings` is the ratings the host will accept for this request, absent when
the host states no policy. Honour it through the site's own filtering — a rating parameter,
or the genres that imply one — never by dropping rows after the fact, which leaves short and
ragged pages.

`SearchRequest.filters` values are `FilterPrimitives`:
`string | boolean | number | Option | Option[] | ExcludableMultiSelectProp`. **The shape
depends on the field type**, which is why `FilterReader` exists.

### Migrating a pre-0.0.24 source

| Remove | Replace with |
| --- | --- |
| `getSearchFilters(): Promise<SearchFilter[]>` | `getSearchForm(): Promise<SearchForm>` via `buildSearchForm` |
| `FILTERS: SearchFilter[]` in `model.ts` | `SearchListField[]` from the builders, plus an optional tags field |
| `filters[FilterID.X] as string` | `new FilterReader(request).option(FilterID.X)` |
| `Content.isNSFW: boolean` | `contentRating: ContentRating` (`SAFE`/`SUGGESTIVE`/`MATURE`/`EXPLICIT`) |
| `SourceConfig.disableTagNavigation` | nothing — the key was removed |
| `SourceInfo.rating` as NSFW enum | `CatalogRating` (`SAFE`/`MIXED`/`EXPLICIT`) |
| `SearchPickerPresentation.PAGE` | the matching standard builder (`SearchPicker`, …) |
| `SearchPickerPresentation.PICKER` | `SearchMenuPicker` |
| `SearchSortSection({ style })` | `SearchSortSection({ header?, footer? })` — `style` was removed |

Nothing warns you about any of these: `mana-dev` bundles with esbuild, which strips types
without checking them. `bun run typecheck` is the gate that catches it.


### The auxiliary WebView

`WebViewPage.create()` gives one WebView per source method, and it only offers `goto`,
`evaluate`, `evaluateScript` and `close`. There is **no HTML injection, no `loadData`, no
JS bridge and no page-started hook**, so the Paperback and Tachiyomi trick of rewriting a
page's HTML to install a hook before its own scripts run does not port.

**Ask the page; do not listen to it.** When a site answers an endpoint only to a caller
carrying its own cookies, origin and clearance, load one of its pages and then make *that
request from inside it* — the WebView already holds everything the endpoint checks:

```ts
await page.goto(chapterUrl, { waitUntil: "domcontentloaded", timeout: SECONDS });
await waitForSite(page);                       // see below
const body = await page.evaluate(runQuery, endpoint, query, variables);
```

That is one round trip, awaited. The tempting alternative — claim the page's `JSON.parse`,
plant a link, click it, then poll for whatever the router happened to fetch — needs the
router to be listening, the click to route, and the answer to come back through the one
function that was hooked; when any of those fails it fails as a timeout with nothing to
report. Mkissa was written that way first and reads its own API now.

`evaluate(fn, ...args)` ships a **function** into the page, which typechecks and keeps its
arguments and return value typed across the bridge; `evaluateScript` takes a string and is
the fallback. The function body cannot see anything from this file, and this project has no
DOM library, so reach the page's globals through a locally declared view of `globalThis`
rather than pulling `lib.dom` in.

**`goto` resolving is not "the page is ready"** — it fires when a challenge page loads,
which is the start of the wait. Poll a cheap `querySelector` probe until the site's own
bundle is there, and throw `CloudflareError` the moment challenge markers appear rather than
waiting the budget out. `passChallenge` in `src/common/cloudflare.ts` is that loop for the
ordinary case.

A single-page app routed to within the page keeps the same JavaScript context, and state
parked on `window` survives between calls for as long as no full navigation happens — worth
knowing, but not a reason to prefer hooking over asking.

### What the built bundle carries

`mana-dev` bundles `@mana-app/types` into the `.mana` file, including its own
`NetworkClientBuilder`, whose `build()` returns `new NetworkClient(this)` against the
*global* `NetworkClient`. When driving a built bundle in a sandbox, stub the global
`NetworkClient` — stubbing the builder does nothing, because the bundle brings its own.

The runtime also ships polyfills for `buffer`, `process`, `events`, `path` and `util`,
embedded by `watcher/scripts/bundle-polyfills.js`. Nothing there covers `crypto.subtle`,
`fetch` or `URL`.

## Content shapes

`ChapterSource extends ContentSource` and adds `getChapters?` and `getChapterData`. A
source that serves chapters implements **`ChapterSource`**: `ContentSource` alone does not
require `getChapterData`, so a source that forgot it still typechecks and then leaves the
app waiting for chapters that never arrive. Trackers implement `ContentTracker` and never
this.

`Content` extends `BaseItem` (`title`, `cover`, `contentRating?`, `webUrl?`) with
`status`, `summary`, `tags`, `contentType`, `recommendedPanelMode`, `additionalInfo`,
`trackerInfo`, and optionally `chapters`.

`Chapter` requires `chapterId`, `number`, `index`, `date`, `language`. **`index` must start
at 0 and be contiguous** — the first available chapter is index 0. `date` must be a valid
`Date`; use `new Date(0)` when the site publishes none rather than an invalid date.

**`title` is printed verbatim; the app does not compose a label from the fields.**
A chapter row shows `title` exactly as given, and falls back to `Chapter <number>` only
when there is no title at all. `volume` and `number` order the list and drive resume — they
are never joined onto the title for display. So a source that wants `Vol.1 Ch.11 - Name` on
screen has to build that string itself. Where the site already writes the number into its
own chapter text, pass that text through rather than stripping and rebuilding it.

**`number` decides ordering, and the app picks the start chapter by it.** Every list has
entries carrying no number — side stories, extras, specials, "Season 2 Prologue". Leaving
those at `0` files them *ahead of chapter 1*, so the reader opens a side story instead of
the beginning. Number them above the highest real chapter, preserving their listed order.

**First separate "no number" from "the number 0", which is not the same question.** Many
sites number a prologue `0`, and chapter zero *is* the beginning: it belongs where it
sorts, ahead of chapter 1. Only the genuinely unnumbered chapter gets moved. Record which
one it is when the value is parsed — the number alone can no longer tell you:

```ts
const value = Number.parseFloat(raw);
const numbered = Number.isFinite(value);   // "0" is numbered; "", "side", null are not
const number = numbered ? value : 0;

const highest = parsed.reduce((max, chapter) => Math.max(max, chapter.number), 0);
const extras = parsed.filter((chapter) => !chapter.numbered);
extras.forEach((chapter, position) => {
  chapter.number = highest + (extras.length - position);
});
```

Carry `numbered` on the chapter until the ordering is done, then drop it so the caller gets
an ordinary `Chapter`. Where the position is held in a `Map` keyed on the chapter object,
read it *before* destructuring the flag away — a copy is not the same key.

This has been shipped wrong four times here. `parseFloat(raw) || 0`,
`.filter((c) => c.number !== 0)` and `Number.isFinite(v) && v > 0` each erase the
distinction, and the symptom is always the same: a prologue at the top of the list, and the
app offering to start at chapter 1.

### `shouldRedrawImage` / `redrawImageWithSize`

The app calls these as a **pair, per image, concurrently across many images**, and only
the first call receives the URL. Anything the second call needs — a descrambling key, a
tile map — has to be carried between them in instance state, and a plain field is a race:
a second image's `shouldRedrawImage` overwrites the first's state before its
`redrawImageWithSize` reads it, and the reader shows pages redrawn with each other's
geometry.

Serialise the pair with a queue chain, taking the ticket **before the first `await`** so
two callers cannot both observe the same tail. A single shared gate promise is not enough
— every waiter wakes at once, which is the bug in a different shape.

`ChapterData` is `{ pages?: ChapterPage[] }` where each page has `url` or a base64 `raw`.

`Highlight` needs `id`, `title`, `cover`, and optionally `subtitle`, `badge`, `info`,
`link`. A `link` carrying a `SearchRequest` makes the tile open a filtered list instead of
a title — that is how a genre or character tile can open a pre-filtered list.

**`badge` is a frosted pill drawn over the cover**, on every shape of tile — plain strips
and heroes alike — and `PageSectionLabel` takes one too:

```ts
type Badge = { text: string };   // badge: { text: "★ 8.4" }
```

The text is the whole of a source's say in it: the app owns the tint, the blur and the
shape, and hides a pill whose text is empty or blank. That makes it the right home for the
single number a site grades a title by.

Take the best number the site has for *that* title, in order — the rating first, then what
it has been read, then nothing at all rather than an empty pill. `firstFilled` in
`src/common/highlights.ts` picks it and `toBadge` wraps it:

```ts
const taken = firstFilled(formatScore(series.rating), viewLabel);
const badge = toBadge(taken);
```

Then **take whatever the pill got out of that card's subtitle and its info rows.** The
badge shows on tiles that draw neither, so leaving it in both says the same number twice on
one card — and because the pill falls through, which number that is varies per title.
Compare against `taken` rather than assuming.

`Content.info` is a different surface: it is the title page, where no badge is drawn, so
the rating stays there.

`additionalInfo` sections are built with the `additionalInfo.{staff,characters,links,tags,highlights}`
helpers exported from the types package; do not hand-write the `type` discriminants.
