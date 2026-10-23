# Porting a source to Mana

Follow [AGENTS.md](../AGENTS.md) for repository rules and the `mana-port` skill for the
working sequence. This document is the map: what each app's source API becomes here, and
what does not survive the trip. It does not replace `@mana-app/types` or `src/common/`.

Most sources here started as a working implementation for another app. A port is worth
doing because the reference has already found the endpoints, the token dance and the
quirks. It is not worth trusting for anything the reader sees: the home rows, their names
and their order come from the live site, not from the reference.

## The shape every port lands in

```
assets/<Name>.png      icon — the project root, never under src/
src/<Name>/
  client.ts            one HttpClient: base URL, headers, rate limit, interceptors
  model.ts             constants, section list, filters, sorts, API types
  parsers.ts           HTML/JSON → Highlight, Content, Chapter, ChapterPage
  main.ts              export class Target — fetches and orchestrates, parses nothing
scripts/probes/<Name>.json
```

`bun run new-source <Name> --id <id> --url <https://site>` writes all of it from
`src/Template/`. Keep the reference's `id` only if it never shipped here under another one —
`info.id` is the key for every library entry, download and setting, and changing it makes a
new source.

## The Mana side, once

| Mana method | Called when |
| :--- | :--- |
| `getSectionsForPage(link)` + `resolvePageSection(link, id)` | The home page (`link.id === "home"`) and any custom page |
| `search(request)` | Search, a "view more" link, a tag tap, a library list |
| `getSearchForm()`, `getSortOptions()` | The filter sheet and the sort menu |
| `getContent(id, context)` | A title's profile, and migration |
| `getChapters(id)` | The chapter list, unless `Content.chapters` was filled |
| `getChapterData(contentId, chapterId, chapter)` | The reader: `pages`, or a whole `document` |
| `getPreferenceMenu()` | The settings gear — it appears only when this exists |
| `getCoverTransport` / `getPageTransport` | Images that need headers, cookies, a limiter or decryption |
| `handleURL(url)` | A link on one of `config.owningLinks` |

Every one is detected by presence. A method that exists is a feature the app offers; a
method that exists and returns nothing useful is a feature that looks broken.

## From Paperback 0.9

The closest shape after Suwatte: discover sections, a search form, a settings form.

| Paperback 0.9 | Mana |
| :--- | :--- |
| `initialise()` | Lazy fields on the class. `onEnvironmentLoaded` exists but is not awaited |
| `getDiscoverSections()` | `getSectionsForPage({ id: "home" })` |
| `getDiscoverSectionItems(section, metadata)` | `resolvePageSection(link, sectionId)` for the row; `search` with a `viewMoreLink` request for its pages |
| `getSearchResults(query, metadata, sorting)` | `search(request)` — `request.page` replaces `metadata` |
| `getAdvancedSearchForm()` | `getSearchForm()`, built with `buildSearchForm` |
| `getSortingOptions()` | `getSortOptions()` |
| `getMangaDetails(mangaId)` | `getContent(contentId, context)` |
| `getChapters(sourceManga)` | `getChapters(contentId)` — an id, not the object |
| `getChapterDetails(chapter)` | `getChapterData(contentId, chapterId, chapter)` |
| `getSettingsForm()` | `getPreferenceMenu()`, built with `buildPreferenceMenu` |
| `PaperbackInterceptor.interceptRequest` | `addRequestInterceptor` on the client |
| `PaperbackInterceptor.interceptResponse` | `addResponseInterceptor`; for images, inside a page transport |
| `cloudflareBypassCompleted()` | Nothing. Throw `CloudflareError` and the app runs the challenge |
| `processTitlesForUpdates` | Nothing. The app checks each library title through `getChapters` |
| `Application.scheduleRequest` | `this.http.get` / `post` with `Body.json` / `Body.form` |
| `Application.getState` / `setState` | `ObjectStore` — or `PreferenceStore` for settings |
| `Application.getSecureState` | `SecureStore` |
| `cheerio.load` | `load` from `cheerio`, bundled per source |
| Discover section types | `SectionStyle` — see the table below |
| `ContentRating` on every tile | `contentRating` on `Content`; `context.allowedContentRatings` says what the reader allows |

| Paperback section type | Mana `SectionStyle` |
| :--- | :--- |
| `featured` | `SimpleHeroPaged` |
| `prominentCarousel` | `DetailedSingleRowPaged`, or `SimpleDoubleRow` for a dense row |
| `simpleCarousel` | `SimpleSingleRow` |
| `chapterUpdates` | `DetailedVerticalListGrouped` |
| `genres` | `Grid` of tiles, each linking to `{ request: { filters: { genres: [id] } } }` |

## From Paperback 0.8

Everything 0.9 says, plus: `getHomePageSections` becomes the section pair,
`getViewMoreItems` becomes `search` with a `viewMoreLink`, `getTags` becomes the search
form's tag field, and `requestManager` becomes the one `HttpClient`. 0.8's tag sections
were the only filter it had; Mana has real pickers, toggles and steppers, so rebuild the
form the site actually offers rather than porting the tag list.

## From Aidoku

Aidoku sources are Rust compiled to WASM; nothing carries over as code, but the structure
maps one to one.

| Aidoku | Mana |
| :--- | :--- |
| `Source::get_search_manga_list(query, page, filters)` | `search(request)` |
| `Source::get_manga_update(manga, needs_details, needs_chapters)` | `getContent` and `getChapters`, or `Content.chapters` when one request answers both |
| `Source::get_page_list(manga, chapter)` | `getChapterData` |
| `Home::get_home()` | `getSectionsForPage` + `resolvePageSection` |
| `ListingProvider::get_manga_list(listing, page)` | `search` with a `listId` or a sort, reached from a `viewMoreLink` |
| `DynamicFilters` / `res/filters.json` | `getSearchForm()` |
| `DynamicSettings` / `res/settings.json` | `getPreferenceMenu()` |
| `DynamicListings` | Sections from `getSectionsForPage` |
| `ImageRequestProvider::get_image_request` | `getPageTransport` / `getCoverTransport` returning the client, headers set in a request interceptor |
| `PageImageProcessor::process_page_image` | A response interceptor on the page transport — `response.decrypt` when a native cipher fits |
| `DeepLinkHandler::handle_deep_link` | `handleURL` with `config.owningLinks` |
| `BaseUrlProvider` | A preference read in the client's request interceptor |
| `BasicLoginHandler`, `WebLoginHandler` | Not offered by Mana yet — see `references/platform.md` |
| `NotificationHandler` | `didChange` on the form field |
| `MigrationHandler` | A stable `info.id`; `context.origin === MIGRATION` in `getContent` |
| `source.json` `languages`, `contentRating` | `info.supportedLanguages`, `info.rating` |

## From Tachiyomi / Mihon (Kotlin)

| Tachiyomi | Mana |
| :--- | :--- |
| `popularMangaRequest` / `Parse` | A home section, and a sort in `getSortOptions` |
| `latestUpdatesRequest` / `Parse` | A home section, `DetailedVerticalListGrouped` when it carries chapter times |
| `searchMangaRequest(page, query, filters)` / `Parse` | `search(request)` |
| `getFilterList()` | `getSearchForm()` — `Filter.Select` → picker, `Filter.Group<CheckBox>` → multi-picker, `Filter.Group<TriState>` → excludable multi-picker, `Filter.Text` → text field, `Filter.Sort` → `getSortOptions` |
| `mangaDetailsRequest` / `Parse` | `getContent` |
| `chapterListRequest` / `Parse` | `getChapters` |
| `pageListRequest` / `Parse`, `imageUrlParse` | `getChapterData` — resolve every image URL there, there is no second hop |
| `imageRequest(page)` | `getPageTransport` with a request interceptor |
| `client.newBuilder().addInterceptor` | `addRequestInterceptor` / `addResponseInterceptor` |
| `rateLimit(...)` | `setRateLimit(requests, intervalMs)` on the one client |
| `headersBuilder()` | `addHeaders` on the client — never a hand-written `user-agent` |
| `ConfigurableSource.setupPreferenceScreen` | `getPreferenceMenu()` |
| `SManga.status` | `PublicationStatus` |
| `SChapter.chapter_number` / `date_upload` | `Chapter.number` / `Chapter.date` |
| `SChapter.name` | `Chapter.title`, carrying the whole label |
| `@Serializable` DTOs | TypeScript types in `model.ts` |

Tachiyomi asks for the chapter list newest-first and numbers by position; Mana reads
`Chapter.index` as reading order, `0` the first chapter to read, whatever order the array
arrives in.

## From Suwatte

Mana's source contract shares most of its names with Suwatte's, so most of a Suwatte source
maps one to one:
`getContent`, `getChapters`, `getChapterData`, `getSectionsForPage`, `resolvePageSection`,
`getPreferenceMenu`, `handleURL`, `ObjectStore`, `SecureStore`, `CloudflareError`. What
changed:

| Suwatte | Mana |
| :--- | :--- |
| `NetworkClient` / `NetworkRequest` | `HttpClient` — the old contract is removed, not deprecated |
| `willRequestImage(url)` | `getCoverTransport` / `getPageTransport` returning the client |
| `getDirectory(request)` | `search(request)` |
| `getDirectoryConfig()` | `getSearchForm()` + `getSortOptions()` |
| `DirectoryFilter` types | Search form builders — values are option **ids** |
| A challenge the reader cannot hand over | `CloudflareError` from the source; Mana offers `config.cloudflareResolutionURL` to solve it |
| Image decryption through the client in JS | `response.decrypt(cipher)` — the bytes never enter JavaScript |

## What a port gains

These have no equivalent in most references. Use them where the site supports them:

- **`Content.additionalInfo`** — staff, links, related titles and tags under the summary.
- **`Content.trackerInfo`** — AniList and MyAnimeList ids, so tracking links itself.
- **Info rows on tiles** — `Highlight.info` under a `Detailed*` style.
- **Native decryption** — AES-CTR/CBC/GCM and XOR on a response body or held bytes.
- **`ChapterData.document`** — a CBZ handed to the reader whole.
- **Deep links** — `handleURL` plus `config.owningLinks`.

## What a port loses

- **Sign-in by password or web login.** The types carry both; the app offers only OAuth.
- **Library and progress sync.** `syncUserLibrary`, `getProgressState`, library events and
  `getLibraryPageLinks` are declared and never called.
- **A pre-request hook inside a WebView.** No page-started callback, no HTML injection. A
  token the site computes in its page is read with `evaluate` after `goto`.
- **Per-source threading.** The app runs a source's calls a few at a time (two by default)
  and image transports only through the client's limiter; a reference that fanned out ten detail
  fetches per row has to stop doing that.

## Checklist

- [ ] Every section, filter, sort and setting the reference has, unless the site dropped it
- [ ] Home rows named and ordered as the live site has them
- [ ] `src/<Name>/` with `client.ts`, `model.ts`, `parsers.ts`, `main.ts`; icon at `assets/<Name>.png`
- [ ] `scripts/probes/<Name>.json` with a real title and chapter
- [ ] `bun run typecheck`, `lint`, `format:check`, `build`, `check` all clean
- [ ] `bun run verify <Name>` passes — or the Contract run does, when the sandbox has no network
- [ ] `1.0.0`, a CHANGELOG section and a README row
