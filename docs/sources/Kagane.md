# Kagane reader contract

Checked 2026-11-13 against Keiyoushi `all/kagane` and Aidoku Community `multi.kagane`.

- Request a legitimate integrity token from `POST /api/integrity`, then a book session from `POST /api/v2/books/{book_id}?is_datasaver={true|false}` with `x-integrity-token` and JSON `{}`.
- Use the session's `cache_url`, `access_token`, and manifest page IDs/extensions. Quality is a required CDN path segment: `/api/v2/books/page/original/{book_id}/{page_id}.{ext}?token=...` or `/page/datasaver/...`. The `is_datasaver` query remains on the book request, not the image request.
- Keep Origin and Referer consistent with the selected Kagane mirror. Keiyoushi explicitly requires the site's Origin for images. Refresh an issued page in its original quality mode even if preferences changed meanwhile. Accept legacy saved page URLs when renewing them.
- Keiyoushi uses the quality paths. The checked Aidoku revision still uses the legacy image path, so it is a reference for the integrity/manifest flow rather than evidence that its image URL remains valid.
- Live API on kagane.org returned the reported book `01a1d408-76cd-7e4f-9ae4-199bc14e0426` with 35 pages and first page `acb704bf-ae4b-561d-bbaa-17f511b94e82.jxl`. Both legacy and quality-specific CDN requests returned `404 {"error": -7}` with org/cx origins in this environment. Requests using the moe origin and the moe API were blocked with 403 HTML. The cloud browser could open kagane.moe after its initial automatic verification, but the website reader itself reported image-load failures for Not Your Typical Reincarnation Story, chapter 116 (61 pages). The reported book’s image delivery and iOS playback remain unverified.
- The mirror selector contains only kagane.moe and kagane.org. New installs and saved choices for removed mirrors use kagane.moe; an explicit kagane.org choice is preserved.

Never store a live access token in source or fixtures.

## Cloudflare clearance

The SDK detects challenge headers and protected 403/503 pages before source response
interceptors run. Propagate its CloudflareError unchanged and clear reader credentials.
Supplement it only with positive interstitial markup, including HTTP 200 responses.

Both Kagane sources probe the selected site with GET alongside API requests, since API
metadata can work while image delivery requires clearance. Concurrent callers share the
probe, successful checks last ten minutes, and changing mirrors forces a new check.
Failed checks remain retryable; ordinary root errors are not cached as clearance.

`bun scripts/test-cloudflare.mjs` covers SDK detection, built source propagation, probe
retry/concurrency/expiry and mirror changes. Completion of the native bypass UI and
cookie transfer still require a Mana device test.
