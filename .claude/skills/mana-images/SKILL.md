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

## 3. Rules that bite

`mana-extension/references/platform.md` holds the facts these rest on — what each path
costs, how transports are paced, how images are cached, every cipher's parameters. What
they mean in practice:

- **Return a long-lived client** from a transport, never one built in the call.
- **Give pages their own client** when the API limiter is tight, since that limiter is the
  only thing pacing them:
  `getPageTransport(r) { return r.url.includes(CDN) ? this.cdn : this.http; }`.
- **Guard interceptors by origin.** A response interceptor that decrypts returns
  `RequestOrigin.General` responses untouched, or the API breaks.
- **Put a per-image key in the fragment.** It is never sent, so it leaks to no CDN, and it
  keeps two images apart in a cache keyed by URL.
- **Read nothing you do not have to.** `response.bytes()` and `withBody` copy the image in
  and out of JavaScript; native `decrypt` does neither.
- **Read the error's name.** `DataError` is a wrong key or IV length; `OperationError` a
  wrong key, wrong mode or tampered data. A page that decrypts to garbage without either is
  the wrong mode or counter, not a wrong key.

## 4. Prove it

- A test with fixed inputs and known outputs for the crypto, like
  `scripts/test-toonkotsu-reader.mjs` — the harness runs Node's ciphers in place of the
  host's, so it proves the parameters, not the app.
- `bun run verify <Name>` fetches one page through the transport.
- On a device: the first and last page of a chapter, a download read offline, and a cover in
  the library after a restart.
