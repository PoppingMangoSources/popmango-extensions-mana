---
name: mana-extension
description: Create or update a Mana content source (extension) in this repo. Use when adding a comic/manga/novel site as a source, scaffolding a new extension, fixing or extending an existing one, or migrating a source to the current @mana-app/types API.
---

# Building Mana extensions

A source is a TypeScript class exported as `Target` that Mana instantiates and calls.
The app only calls methods it detects on that instance, so **which methods you define
decides what the app shows**. Get that wrong and the feature does not exist.

Work in four phases. Do not skip ahead: every phase depends on facts established by the
one before it.

## Phase 1 — Recon

Never write selectors from memory. Fetch the real pages first and confirm every
selector against actual markup.

Read `references/recon.md` and work through its five targets in order:

1. **Home sections** — what the home page offers, and its category/popular/latest routes
2. **Search + filters** — the search URL shape, the facets the site exposes, and how it paginates
3. **Title view** — title, cover, summary, status, tags
4. **Chapter list** — inline markup, an inline-script JSON blob, or an AJAX endpoint
5. **Chapter pages** — the image list, its lazy-load attributes, and any referer requirement

Write down, before coding: the exact URL for each of the five, the selector or JSON path
for every field, and the pagination signal.

## Phase 2 — Scaffold

```bash
npm run new-source <Name> --id <id> --url <https://site>
```

Then drop an icon at `src/<Name>/assets/icon.png`.

A source directory holds only what is specific to that site:

```
src/<Name>/
  client.ts     the site's network client — headers, cookies, rate limit
  model.ts      site constants, filter/sort definitions, section list, API types
  parsers.ts    HTML/JSON parsing
  main.ts       the source class
  assets/       icon.png
```

Everything reusable lives in `src/common/` and is **imported, not copied**:

| Module | What it gives you |
| :--- | :--- |
| `network.ts` | `buildClient`, Cloudflare fingerprinting |
| `filters.ts` | `FilterReader` |
| `search.ts` | `buildSearchForm`, `resolveSortId` |
| `sections.ts` | `SectionSpec`, `toPageSections`, `listResults`, `pageOf` |
| `preferences.ts` | `PreferenceStore`, `buildPreferenceMenu` |
| `query.ts` | `withQuery`, `encodeForm` |
| `dates.ts` | `parseDate`, `parseDateOrEpoch`, `parseChapterNumber` |
| `urls.ts` | `UrlBuilder`, `resolveUrl`, `hostOf`, `originOf` |
| `html.ts` | `text`, `clean`, `imageSrc`, `ownText`, `summaryOf`, `parseStatus`, `hasNextPage`, `scriptJson` |
| `aes.ts` | `aesCbcDecrypt`, `base64ToBytes`, `bytesToUtf8`, `decodeHex` |

A directory becomes a source when one of its files exports `class Target`. That is why
`src/common/` is shared code and not an extension of its own — never put a `Target` in it.

## Phase 3 — Implement

Read `references/api.md` for the type surface and the intent rules, and
`references/toolkit.md` for what `src/common/` already does. Search forms, filter reading,
home sections, preferences and query strings are all there — do not hand-roll them.

Three rules that are not obvious and cause silent breakage:

- **Method presence is the feature flag.** `getSearchForm` is what makes filters appear;
  `getSortOptions` is what makes sorting appear; `getSectionsForPage` *and*
  `resolvePageSection` are both required for a home page. Do not define a method you
  cannot back with real data — an empty sort list is worse than no sort list.
- **Read filters through `FilterReader`.** A `SELECT` filter hands back an `Option`
  object, not a string. `filters[id] as string` yields `undefined` and the filter
  silently does nothing.
- **Never assign the network client in `onEnvironmentLoaded`.** It is not awaited before
  the first method call. Use a lazy `private get http()` getter.

House style: comments explain *why*, never *what*. A comment earns its place when it
records a non-obvious constraint someone would otherwise "fix" — a site quirk, a runtime
limitation, an ordering requirement. Prefer a helper over duplication.

## Phase 4 — Verify

All four gates must pass before the work is done:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run build
```

Then confirm the app will actually see the intents you intended:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.intents.toString(2).padStart(25,'0'))"
```

Then run the contract test against the live site:

```bash
npm run verify <Name>
```

It drives the built `.mana` bundle through the methods the app calls and checks the shape
of what comes back. Fill `scripts/probes/<Name>.json` with a real `contentId` (and
`chapterId` if the first chapter is not representative) or the content half is skipped. A
Cloudflare block reports SKIP, not FAIL — that is expected for protected sites and **is
not a pass**.

Finish with `references/release.md`: version bump, CHANGELOG entry, README row.

## Performance

The home page fans out to one request per enabled section, all through one rate-limited
client. Two rules keep it from crawling:

- **A section costs one request.** Never enrich tiles from their detail pages — eight
  detail fetches in front of the first row is what makes a source feel broken.
- **Batch preference reads.** `Promise.all` over the section switches, not a loop of
  awaits, because nothing renders until that method returns.

## Updating an existing source

Site markup changes constantly. When a source breaks, re-run Phase 1 for the specific
broken target — do not guess at a selector fix. `npm run verify <Name>` tells you which of
the five targets broke.

If a source still calls `getSearchFilters`, sets `Content.isNSFW`, or sets
`SourceConfig.disableTagNavigation`, it is written against a removed API and its filters
are dead. `references/api.md` has the migration recipe.
