# Kagane reader contract

Checked 2026-11-13 against Keiyoushi `all/kagane` and Aidoku Community `multi.kagane`.

- Request a legitimate integrity token from `POST /api/integrity`, then a book session from `POST /api/v2/books/{book_id}?is_datasaver={true|false}` with `x-integrity-token` and JSON `{}`.
- Use the session's `cache_url`, `access_token`, and manifest page IDs/extensions. Quality is a required CDN path segment: `/api/v2/books/page/original/{book_id}/{page_id}.{ext}?token=...` or `/page/datasaver/...`. The `is_datasaver` query remains on the book request, not the image request.
- Keep Origin and Referer consistent with the selected Kagane mirror. Keiyoushi explicitly requires the site's Origin for images. Refresh an issued page in its original quality mode even if preferences changed meanwhile. Accept legacy saved page URLs when renewing them.
- Keiyoushi uses the quality paths. The checked Aidoku revision still uses the legacy image path, so it is a reference for the integrity/manifest flow rather than evidence that its image URL remains valid.
- Live API on kagane.org returned the reported book `01a1d408-76cd-7e4f-9ae4-199bc14e0426` with 35 pages and first page `acb704bf-ae4b-561d-bbaa-17f511b94e82.jxl`. Both legacy and quality-specific CDN requests returned `404 {"error": -7}` with org/cx origins in this environment. Requests using the moe origin and the moe API were blocked with 403 HTML. The cloud browser could open kagane.moe after its initial automatic verification, but the website reader itself reported image-load failures for Not Your Typical Reincarnation Story, chapter 116 (61 pages). The reported book’s image delivery and iOS playback remain unverified.
- The mirror selector contains kagane.org and kagane.moe; kagane.org is the default (2026-11-22). kagane.cx, kagane.net and kagane.si 301 to kagane.moe. The setting moved to the key `mirror-host` so choices saved while kagane.moe was the default start on kagane.org.

Never store a live access token in source or fixtures.

## Cloudflare clearance

The SDK detects challenge headers and protected 403/503 pages before source response
interceptors run. Propagate its CloudflareError unchanged and clear reader credentials.
Supplement it only with positive interstitial markup, including HTTP 200 responses.

kagane.moe sends `cf-mitigated: challenge` on responses that are not challenges: on
2026-11-22 its robots.txt answered 200 with real content and that header, where kagane.org's
did not. The SDK treats the header as a challenge on any status, so on kagane.moe a request
can be read as challenged after the WebView has cleared, and the automatic bypass hands the
reader a manual prompt. kagane.org is the default for that reason.

The runtime names the challenged request as the page to clear. For this API that is a POST
the WebView would load as a GET, so both sources rethrow the error naming the mirror's front
page, `https://<mirror>/`, the same page the reader would open. Requests carry no
per-call clearance probe: the API and the pages sit behind the same zone-wide challenge, so a
working API is already proof of clearance. `getSectionsForPage` does ask the mirror's front
page first, once per ten minutes: the app passes a challenge on its own only for calls like
that one, never for the rows it resolves lazily afterwards, so a challenge first met by a row
was handed to the reader to solve. The settings screen never raises a challenge; its lists
fall back to what is cached or are left out.

`bun scripts/test-cloudflare.mjs` covers SDK detection, built source propagation, the front-page
resolution URL and recovery after a bypass. Completion of the native bypass UI and
cookie transfer still require a Mana device test.
