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
For a primitive that file does not carry, `crypto-js` is a dependency here and bundles into
the source intact — it needs no `Buffer`, `process`, `require` or host `crypto`, and has been
run in a bare V8 context to confirm it. See `toolkit.md` for the size it costs.

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

**First prove the plain request fails.** A WebView is the most expensive thing a source can
open and the easiest to get subtly wrong, and "the endpoint must want the site's cookies"
is a guess until a capture says so. Read the network log of a client that works: if it
reaches the endpoint over an ordinary request, so can the source, and the only thing that
was ever missing is a header or the right host. Mkissa was written on that guess and read
its API through a WebView for two releases; the log showed a plain POST carrying nothing
but `origin` and `referer`, and deleting the WebView fixed it.

**Ask the page; do not listen to it.** When a site *does* answer only a caller carrying its
own origin, cookies and clearance, make the request *from inside a page on that origin*:

```ts
// page-fetch.ts — @ts-nocheck. This does not run here; `evaluate` serialises it into the
// page, where `fetch` and the site's cookies exist and this project's types do not.
export async function postGraphql(url: string, body: string): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "*/*" },
    credentials: "include",
    body,
  });
  return await response.text();
}
```

```ts
const page = await WebViewPage.create();
await page.goto(`${BASE_URL}/robots.txt`, { waitUntil: "load" });
return page.evaluate<string, [string, string]>(postGraphql, API_URL, body);
```

**Load a script-free document on the origin, not the site's own page.** `/robots.txt` is
the whole trick, and it is the part that is easy to get wrong. What the endpoint checks is
the origin and the cookie jar; running the site's application buys nothing and costs a
great deal — its bundle, its ads, its hydration, and every defence its own scripts mount.
One site here freezes a pristine `JSON.parse` taken from a throwaway iframe onto `window`
in its first inline script, with a comment saying it is there so a hook installed later
cannot see the parse. A source that loads `/robots.txt` never meets any of that, is ready
on `load` with no readiness poll to write, and issues its request in one round trip.

`credentials: "include"` is what carries the app's cookie jar — including any clearance the
reader has already granted through `config.cloudflareResolutionURL`. Without it the request
goes out cookieless and the gate is still shut.

**Reach for the page only once the ordinary request has been refused.** Post through the
source's own client first; a WebView is the expensive path and most endpoints do not need
it. And read the refusal properly: a GraphQL API answers **200 with an `errors` array**, so
a source that treats any 200 as data never sees the gate at all. Look for the site's own
marker in those errors — `NEED_CAPTCHA` on one site here — re-issue that one request through
the page, and throw `CloudflareError` only if it is still refused:

```ts
const direct = envelope(await this.http.post(API_URL, { headers, body }));
if (!direct.captcha) return dataOf(direct);

const throughPage = envelope(await this.pageRequest(JSON.stringify(body)));
if (!throughPage.captcha) return dataOf(throughPage);

throw new CloudflareError(BASE_URL);
```

Note the two body shapes. The host serialises an object body itself from the content type,
so the direct call passes an object; the page's own `fetch` wants a string, so that one is
stringified. Passing a string to the host encodes it twice and the API sees a quoted blob.

**Listening for the site's own request is a last resort, and often impossible.** Rewriting
a page's HTML to install a hook before its own scripts run — the Paperback and Tachiyomi
approach — has no equivalent here, and a hook installed after the fact is exactly what the
`JSON.parse` pin above defeats. Claiming the page's parser, planting a link, clicking it and
polling for whatever the router fetched needs the router to be listening, the click to
route, and the answer to come back through the one function that was hooked; when any of
those fails it fails as a timeout with nothing to report.

**Use `evaluate`, not `evaluateScript`.** The host hands a script its arguments by declaring
`args` in the page's own global scope — on every call, whether arguments are passed or not —
and that declaration outlives the evaluation. So the *second* `evaluateScript` against one
WebView throws `SyntaxError: Cannot declare a const variable twice: 'args'`. Anything that
polls a page, installs something and then reads it back, or simply asks twice, dies on its
second question. Caught and read as "not ready yet", which is the natural way to write such a
loop, it turns into a silent wait for the whole budget: this repo shipped a Cloudflare bypass
that had never once worked, and a reader that never opened a chapter.

`evaluate(fn, ...args)` ships a **function** into the page and declares nothing beside it, so
it can be called as often as you like. It also typechecks and keeps its arguments and return
value typed across the bridge. The function body cannot see anything from this file — not a module constant, not an
imported helper, nothing but its own arguments — so inline everything it needs and check the
built bundle if in doubt. This project has no DOM library either, so reach the page's globals
through a locally declared view of `globalThis` rather than pulling `lib.dom` in.

**An `async` function is fine.** `evaluate` is declared `Promise<Awaited<Result>>` and means
it: a function that returns a promise is awaited in the page and its resolved value crosses
the bridge. The value itself must be JSON — a string, a number, a plain object — so return
`response.text()` and parse it on this side rather than handing back a `Response`.

**`goto` resolving is not "the page is ready"** *when the page is an application*. On a
static document there is nothing to wait for and `waitUntil: "load"` is enough — another
reason to prefer one. On a real page it fires when a challenge page loads, which is the
start of the wait. Poll a cheap `querySelector` probe until the site's own
bundle is there, and throw `CloudflareError` the moment challenge markers appear rather than
waiting the budget out. `passChallenge` in `src/common/cloudflare.ts` is that loop for the
ordinary case. Take the probe's selectors from the site's own HTML — a Next.js probe
(`#__next`, `/_next/`) against a SvelteKit site never matches, and the source spends its
whole budget waiting for a page that is already on screen.

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

Take the best thing the site says about *that* title, falling through the house order:

1. **what the site grades it** — a rating, else what it has been read, else the likes,
   follows or comments it counts;
2. **what the title is** — its type;
3. **where it has got to** — its status;
4. nothing, which is a bare cover rather than an empty pill.

`firstFilled` in `src/common/highlights.ts` picks the first one the site filled in and
`toBadge` wraps it; `Mark` there holds the glyphs so every source spells them alike:

```ts
const taken = firstFilled(
  formatScore(series.rating),
  views ? `${Mark.Views} ${views}` : "",
  typePill(kind),
  statusPill(state),
);
const badge = toBadge(taken);
```

**The pill words the last two itself.** `typePill` puts the filled book `📖` in front of a
type and `statusPill` the filled `🔗` in front of a status. The outline marks a `Pair` uses —
`♤` and `◌` — read against a key in a column; over artwork at pill size they all but
disappear. Use those two helpers rather than composing the marks by hand.

Both run their word through `titleCase`, and so should every type or status a source puts in
a row: sites write these as `ONGOING`, `manhwa`, `ON_HIATUS` and `Hiatus`, and one site's
shouting beside another's whisper reads as a bug. It retypes a phrase the site wrote in a
single case, reads a column's underscores as the spaces they stand for, and leaves alone both
a phrase the site capitalised itself and a short all-capitals word, which is an initialism —
MangaUpdates files western comics under `OEL`, and "Oel" is not a word.

Then **take whatever the pill got out of that card's subtitle** — the two sit a thumb's
width apart on a plain strip, and the pill falls through, so compare against `taken` rather
than assuming which one it was.

**Its info rows keep everything.** `Highlight.info` only renders on the `Detailed*` styles,
and no pill is drawn over the small thumbnails those use — so a row dropped because a pill
"already said it" is a row the reader never sees. Every source's rows carry the site's whole
read: rating, count, type, status, chapter, in a stable order, whether or not the pill took
one of them. `Content.info`, the title page, is the same: no badge is drawn there either.

`additionalInfo` sections are built with the `additionalInfo.{staff,characters,links,tags,highlights}`
helpers exported from the types package; do not hand-write the `type` discriminants.
