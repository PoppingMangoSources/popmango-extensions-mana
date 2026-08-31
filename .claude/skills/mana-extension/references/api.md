# The `@mana-app/types` surface and the runtime that consumes it

Verified against `@mana-app/types@0.0.24` and `@mana-app/dev@0.1.13` by reading the
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
- **`NetworkResponse.data` is always a `string`.** There is no binary response mode; a
  non-UTF-8 body may not survive the bridge at all.
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

Nothing warns you about any of these: `mana-dev` bundles with esbuild, which strips types
without checking them. `npm run typecheck` is the gate that catches it.

## Content shapes

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
the beginning. Number them above the highest real chapter, preserving their listed order:

```ts
const highest = parsed.reduce((max, chapter) => Math.max(max, chapter.number), 0);
const extras = parsed.filter((chapter) => chapter.number === 0);
extras.forEach((chapter, position) => {
  chapter.number = highest + (extras.length - position);
});
```

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

`Highlight` needs `id`, `title`, `cover`, and optionally `subtitle`, `badge`, `link`. A
`link` carrying a `SearchRequest` makes the tile open a filtered list instead of a title —
that is how a genre or character tile can open a pre-filtered list.

`additionalInfo` sections are built with the `additionalInfo.{staff,characters,links,tags,highlights}`
helpers exported from the types package; do not hand-write the `type` discriminants.
