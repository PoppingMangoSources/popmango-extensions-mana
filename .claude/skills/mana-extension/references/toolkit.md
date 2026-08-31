# What lives where

```
assets/<Name>.png the icon — project root, NOT inside src/
src/common/       the shared runtime — imported by every source, never copied
src/<Name>/
  client.ts       the site's network client — headers, cookies, rate limit
  model.ts        site constants, filter/sort definitions, section list, API types
  parsers.ts      HTML/JSON parsing
  main.ts         the source class
```

The toolchain copies **only the project-root `assets/` folder** into `dist/`. An icon
under `src/<Name>/assets/` is never packaged, and the app draws a placeholder with no
error anywhere. `info.thumbnail` is the bare filename in that folder, never a path.

A directory becomes a source when one of its files exports `class Target`. `src/common/`
has none, which is why it is shared code and not an extension. Never add one to it.

Only site-specific work belongs in a source directory. If you write something a second
source would want, move it to `src/common/` rather than copying it.

## `src/common/filters.ts` — `FilterReader`

**Always read search filters through this.** The runtime hands back a different JavaScript
type per field type, and `filters[id] as string` silently yields `undefined` for a
`SELECT`.

```ts
const filters = new FilterReader(request);
filters.has(id);           // present and non-empty
filters.text(id);          // string | Option -> its id
filters.option(id, "all"); // text() with a fallback
filters.options(id);       // Option[] -> ids
filters.excludable(id);    // { included, excluded }
filters.toggle(id);
filters.number(id);        // NaN when absent — guard with Number.isFinite
```

## `src/common/search.ts` — the search form

`buildSearchForm({ fields?, header?, footer?, tags?, tagsHeader?, sortHeader?, sortStyle?, includeSort? })`
assembles a `SearchForm` from the field builders exported by `@mana-app/types`
(`SearchPicker`, `SearchMultiPicker`, `SearchExcludableMultiPicker`, `SearchToggle`,
`SearchTextField`, `SearchStepper`, `SearchDatePicker`). Declare the fields in `model.ts`.

Pass `includeSort: false` when the source has no meaningful sort, so the app does not show
an empty sort control.

`resolveSortId(SORT_OPTIONS, request, fallback)` validates `request.sort.id` against your
declared options and falls back to the one marked `isDefault`.

## `src/common/sections.ts` — home sections

```ts
private sections(): SectionSpec[] {
  return [{ id, title, subtitle?, style?, viewMore?, load: (page) => this.listing(page) }];
}

async getSectionsForPage(_link) { return toPageSections(this.sections()); }

async resolvePageSection(_link, id) {
  const spec = sectionById(this.sections(), id);
  if (!spec) return { items: [] };
  return { items: (await spec.load(1)).results };
}

async search(request) {
  const list = listResults(this.sections(), request);
  if (list) return list;
  // ...real search
}
```

`toPageSections` wires each section's `viewMoreLink` to `{ request: { page: 1, listId: id } }`
and `listResults` routes that `listId` back to the same `load`, so a section and its full
listing cannot disagree. `viewMore: false` for a carousel with no paginated equivalent.

`pageOf(request)` clamps `SearchRequest.page` to at least 1.

Section styles, and what each looks like on screen:

| Style | Shape |
| :--- | :--- |
| `SimpleHero`, `SimpleHeroPaged` | one big cover at a time, title overlaid |
| `SimpleSingleRow`, `SimpleDoubleRow`, `SimpleTripleRow` | a strip of covers, 1–3 rows deep |
| `DetailedSingleRowPaged`, `DetailedDoubleRowPaged`, `DetailedTripleRowPaged` | covers with a title and subtitle beneath |
| `DetailedVerticalList`, `DetailedVerticalListGrouped` | a vertical list; `Highlight.info` renders as key/value rows |
| `Grid` | a plain grid |

`Highlight.info` is a `Pair[]`, and it is what produces the `Rating / Chapters / Volumes`
rows in a detailed list. Only the vertical list styles render it.

## `src/common/preferences.ts` — the preference menu

```ts
private readonly preferences = new PreferenceStore(NAMESPACE, DEFAULTS);

async getPreferenceMenu(): Promise<Form> {
  return buildPreferenceMenu(this.preferences, this.preferenceSections());
}
```

Fields are `text`, `toggle`, `select`, `multiselect`, `stepper`; `select` and `multiselect`
accept either an `Option[]` or an async function, so options can be fetched live.
`buildPreferenceMenu` reads current values and wires `didChange` to the store for you.

Values are stored **natively** through `ObjectStore.set(key, value)` and read back with the
accessor matching the declared default — `string()`, `boolean()`, `number()`, or
`stringArray()`. Those accessors **throw when the stored value is not of the requested
type**, and an uncaught throw takes down the entire settings screen, so every read is
wrapped: a mismatched, corrupt, or legacy JSON-encoded value falls back to the default
instead of failing the form.

Two further rules the store follows, both of which protect user data:

- The element `id` is the full store key (`<namespace>.<key>`).
- A `select`/`multiselect` selection is only reconciled against its option list when that
  list is non-empty. Options are often fetched live, and a failed fetch must not blank a
  saved choice — otherwise the next edit writes the blank back.

**Keep the namespace stable** — changing it orphans every existing user setting.

## `src/common/query.ts` and `urls.ts` — building URLs

`withQuery(url, params)` drops `undefined`/`null`/empty values and encodes the rest.
`encodeForm(body)` does the same for `application/x-www-form-urlencoded` POST bodies but
keeps empty values.

`UrlBuilder` (and its `url(base)` factory) chains path components and query items, and
repeats a key once per entry when handed an array — which is how most sites express
multi-select filters.

```ts
url(DOMAIN).addPathComponent("genre").addPathComponent(page).setQueryItem("e", excluded).build();
```

`resolveUrl(href, base)` absolutises a link: protocol-relative `//host`, root-relative
`/path`, plain relative, and the `\/`-escaped URLs that come out of inline JSON.
`hostOf`, `originOf` and `displayHost` pull a URL apart. There is no `URL` global in the
runtime, so everything goes through these.

## `src/common/network.ts` — the network client

```ts
buildClient({ baseUrl, requests, interval, accept, headers, resolutionUrl, originFor, json, maxRetries, timeout, sendOrigin })
```

Applies rate limiting, sets `origin`/`referer`/`accept`/`accept-language`/`user-agent`, and
installs a response interceptor that throws `CloudflareError(resolutionUrl)` on 403/503 or a
challenge fingerprint (`challenges.cloudflare.com`, `cf-browser-verification`, `__cf_chl_`,
`<title>Just a moment`, a proof-of-work marker).

- `originFor: (url) => string` — per-request origin, for sites whose images or API live on
  a different host than their pages.
- `json: true` — sets a JSON `accept` and turns a `>= 400` response into an `Error`
  carrying the server's own `error.message` when it sends one.
- `sendOrigin: false` — for hosts that reject a cross-origin `origin` header on plain GETs.

A site needing more than this — a per-URL user agent, an injected cookie — gets its own
`client.ts` built on `NetworkClientBuilder` directly. Per-request `headers` always win over
the client defaults.

### POST bodies are objects, not strings

`NetworkRequest.body` is handed over as an **object**; the host serialises it according to
the request's `content-type`. Calling `JSON.stringify` first makes the host encode that
string in turn, so the server receives a quoted JSON string literal where it expects an
object and answers **400 Bad Request** — on every call, with no clue as to why.

```ts
await http.post(url, { body: { page: 0 }, headers: { "content-type": "application/json" } });
```

For an endpoint that wants no body, omit the key entirely rather than passing `""` or
`"{}"`. `encodeForm` is still the right call for a form-encoded body the site expects
pre-encoded — the rule is that you never double-encode, not that you never encode.

### Cloudflare detection on a JSON API

`buildClient`'s blanket "403 or 503 means challenge" is right for an HTML site, where a
403 usually *is* Cloudflare. It is wrong for a JSON API, which answers 403 or 503 for an
expired token, a rate limit or an outage — none of which a WebView can resolve, so
reporting them as a challenge puts an unanswerable prompt in front of every row.

For an API client, require a real challenge fingerprint: the `cf-mitigated: challenge`
header, or an HTML body carrying Cloudflare's markers. A response whose `content-type` is
`application/json` is never a challenge.

**Do not set a hand-written `user-agent` on a client fronting Cloudflare.** The app sends
one matching the connection it actually makes; overriding it with a string of your own
makes the request's fingerprint inconsistent, which is what gets it challenged in the
first place. If a reference implementation sends no user agent, send none.

Rate limit: **3 requests per second is the default worth starting from.** The home page
fans out to one request per enabled section through this one client, so a 1/s budget makes
it visibly crawl.

## `src/common/html.ts` — parsing helpers

| Helper | Why it is not just cheerio |
| :--- | :--- |
| `text(node)` / `clean(str)` | `.text()` plus whitespace collapsing |
| `imageSrc(node)` | comic sites lazy-load: tries `data-src`, `data-original`, `data-lazy-src`, `data-cfsrc`, `srcset`, `src`, then a `background-image` URL |
| `absoluteImage(node, base)` | `imageSrc` resolved against the site root |
| `summaryOf(node)` | turns a `<div>`/`<br>`-heavy synopsis into plain paragraphs |
| `parseStatus(raw)` / `parseContentType(raw)` | maps a site's wording onto the app's enums, `undefined` when it does not say |
| `splitList(value)` | author/artist fields, comma or slash separated |
| `ownText(node)` | text excluding child elements — info rows are `<li><b>Status:</b> Ongoing</li>`, where `.text()` glues the label to the value |
| `firstText($, ...sel)` / `firstMatch(str, ...re)` | first selector or pattern that matches, for themes that reshuffle markup |
| `slugify(value)` | tag and genre ids |
| `decodeEntities(value)` | entities left in JSON-in-HTML payloads |
| `hasNextPage($, ...sel)` | the common "next page" link shapes |

### JSON hidden in a `<script>`

`scriptJson($, marker)` finds the inline script containing `marker` and parses the JSON
that follows it. `balancedJson(source, marker)` is the same extraction on a raw string.

Both count braces and skip over string literals, so a `}` inside a string — or a nested
object — cannot end the region early. **Do not reach for `/\{[\s\S]*?\}/`**: it truncates
at the first `}` inside the first nested object, which yields half a chapter list and no
error.

A single well-formed payload such as `__NEXT_DATA__` or `application/ld+json` needs no
scanning — parse the script body directly with `parseJsonish`.

## `src/common/dates.ts` — dates and chapter numbers

`parseDate(raw)` handles relative phrases ("3 days ago", "an hour ago"), keywords
("today", "yesterday"), unix timestamps, named months, and numeric dates in either order.
It returns `undefined` rather than guessing, so the call site can `?? new Date(0)`.
`parseDateOrEpoch(raw)` does that for you.

`parseChapterNumber(title, fallback)` pulls a number out of a chapter title.

Never hand back an invalid `Date` — it fails the contract test and renders broken.

## `src/common/aes.ts` — decryption

The runtime has **no `crypto.subtle`**, so sites that AES-encrypt their image lists need
this: `aesCbcDecrypt(ciphertext, key, iv, padding)` with `"zero"`, `"pkcs7"` or `"none"`
padding, plus `decodeHex`, `base64ToBytes`, `bytesToUtf8` and `binaryStringToBytes`.
Verified against the FIPS-197 and SP 800-38A vectors.
