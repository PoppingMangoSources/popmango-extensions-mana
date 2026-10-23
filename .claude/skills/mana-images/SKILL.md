---
name: mana-images
description: Get a Mana source's covers or reader pages loading when the site gates, encrypts or scrambles them — referer or cookie checks, signed or expiring URLs, AES/XOR-encrypted pages, CryptoJS passphrase payloads, shuffled tiles, CBZ downloads. Use when images fail to load, load blank or broken, or when a site's page list or page bytes are encrypted.
---

# Images that need help

Start from the cheapest path that works and move down only when it fails. Each step costs
more: the first never starts the source at all.

## 1. Find out what the image actually needs

Fetch one cover and one page URL without help, then with the site's own headers, and
compare. Note which of these changes the answer:

- `referer` / `origin` — the usual gate
- a cookie — set by the reader page, or by a challenge
- a signature or expiry in the URL — then the URL must be fetched fresh, not cached in a field
- the bytes themselves — an image that downloads fine and will not decode is encrypted or
  scrambled

Covers and pages often differ. Decide each on its own.

## 2. Pick the path

| What it needs | Path | Notes |
| :--- | :--- | :--- |
| Nothing | No transport | The app loads it natively; the source never runs |
| Headers or cookies | `getPageTransport` and/or `getCoverTransport` returning the source's client | Set headers in a request interceptor guarded by `context.origin` |
| Decryption with a key per page | Page transport + response interceptor calling `response.decrypt(cipher)` | Key and IV ride in the URL fragment → `request.fragmentParams` |
| An encrypted page **list** | `Crypto.decrypt(cipher, bytes)` in `getChapterData` | Then plain URLs, or step 3 per page |
| A CryptoJS passphrase blob (`U2FsdGVkX1…`) | `parseSalted` → `Key.fromPassphrase` → `Cipher.aesCbc` | Base64-decode first |
| Shuffled tiles, order fixed per size | `shouldRedrawImage` + `redrawImageWithSize` | Gets only the size — the order cannot depend on the URL |
| Shuffled tiles, order from the URL or a seed | Response interceptor rebuilding the bytes | Reads bytes into JavaScript; last resort |
| The chapter is a ZIP/CBZ | `{ document: response }` from `getChapterData` | One download per chapter, opened natively |

`mana-extension/references/platform.md` has every cipher's parameters and what each path
costs.

## 3. Rules that bite

- **Return a long-lived client** from a transport. A client built per call has no rate limit.
- **Transports are paced only by the client's limiter**, not the per-source concurrency cap.
  If the API limiter is tight, give pages their own client:
  `getPageTransport(r) { return r.url.includes(CDN) ? this.cdn : this.http; }`.
- **Guard interceptors by origin.** A response interceptor that decrypts must return
  `RequestOrigin.General` responses untouched, or the API breaks.
- **Images are cached by URL in their final form.** A URL that can yield two images needs the
  difference in its query or fragment.
- **The fragment is never sent**, so a key in it does not leak to the CDN and does not change
  the request — only the cache key.
- **Read nothing you do not have to.** `response.bytes()` copies the image into JavaScript;
  `withBody` copies it back. Native `decrypt` does neither.
- **Older apps.** Without native crypto, AES-CTR and XOR fall back to JavaScript; AES-CBC,
  AES-GCM and key derivation reject with `NotSupportedError`. Where an older app must keep
  working, catch that and fall back to `src/common/aes.ts`.
- **Errors carry WebCrypto names**: `DataError` is a wrong key or IV length, `OperationError` a
  wrong key or tampered data. A page that decrypts to garbage without either is the wrong
  mode or counter, not a wrong key.

## 4. Prove it

- A test with fixed inputs and known outputs for the crypto, like
  `scripts/test-toonkotsu-reader.mjs` — the harness runs Node's ciphers in place of the
  host's, so it proves the parameters, not the app.
- `bun run verify <Name>` fetches one page through the transport.
- On a device: the first and last page of a chapter, a download read offline, and a cover in
  the library after a restart.
