---
name: verify
description: Verify a change to a Mana source by running its built bundle and watching what it does — home rows, search, a title, a chapter's pages, and images through its cover or page transport — rather than re-running the gates. Use after changing a source, when asked to verify or test one, or to compare a source before and after a commit.
---

# Verifying a Mana source

Verification here means running the built `.mana` bundle and observing it. The gates
(`typecheck`, `lint`, `format:check`, `build`, `check`) are CI's job and prove nothing about
behaviour; run `build` only to get the bundle. Layers and their limits are in
[docs/TESTING.md](../../../docs/TESTING.md); this file is the recipe.

## The surface

A source has no UI of its own. The app loads its bundle into a JavaScript runtime and calls
methods on `Target`; images go through `getCoverTransport`/`getPageTransport` when the source
has them. The repository reproduces that host in `scripts/harness/runtime.mjs` — the HTTP
bridge, `ObjectStore`, native-style decryption — and that is where to observe from here. A
device is the only place the real reader, image cache and section styles exist.

## 1. Build the bundle

```bash
bun run build                      # dist/sources/<Name>.mana
```

## 2. Drive the methods the change reaches

```bash
bun run verify <Name> -v           # every request and result
```

It calls what the app calls — home sections and each row, search, the filter form, a title,
its chapters, a chapter's pages, and one cover and page through the transports — with the
title named in `scripts/probes/<Name>.json`. Add `settings` to the probe to drive non-default
settings, or point at another probe with `--probe`.

**SKIP is not a pass.** A Cloudflare challenge or a WebView-only reader skips, and nothing
behind it ran. Many sites answer this sandbox with a challenge (`403`, `Just a moment...`) for
both the API and page files while covers still load; say which steps skipped and why.

## 3. Images: pacing, headers, decryption

When the change touches a transport — a rate limit, a referer, a cipher — drive it against a
local server, so the site does not have to be reachable:

```bash
node .claude/skills/verify/drive-images.mjs <Name> --origin page --count 9 \
  --fragment "k={key}&n={nonce}" --encrypt aes-ctr
node .claude/skills/verify/drive-images.mjs <Name> --origin cover --count 9
```

It sends the requests through the bundle's own transport with the app's image dispatch,
prints when the server received each, the referer sent and whether what came back is an
image. `--fragment` is the source's own key format (Toonkotsu's is shown); `--encrypt aes-ctr`
serves an AES-256-CTR body with an 8-byte nonce in the high half of the counter. Another
cipher means editing the server half of the script.

Compare against the previous commit by building it in a worktree:

```bash
git worktree add /tmp/before HEAD~1 && ln -s "$PWD/node_modules" /tmp/before/node_modules
(cd /tmp/before && bun run build)
# point the script at /tmp/before/dist, then: git worktree remove --force /tmp/before
```

What it can and cannot show:

- `setRateLimit(n, ms)` spaces requests evenly (`RateLimit.spaced`): 3 a second arrives about
  0.33 s apart, not in threes. `RateLimit.tokenBucket` allows bursts.
- The server is local, so downloads are instant: it shows when requests start, not how they
  share a slow connection.
- Decryption runs through Node's ciphers, so a pass proves the parameters, not the host.

## 4. On a device

```bash
bun run dev                        # serves dist/, rebuilds on save
```

Add the printed address in Mana as a repository; `console` output streams back tagged with
the source id. Mana's Console (Settings) records every request with its timing, size and
`cf-cache-status`; export it after reproducing a problem. Before anyone shares one, remove
`Cookie:` and `Authorization:` values and requests to other sites.

Check the screens the change touched: home rows in order, a "view more", one filter of each
kind, a title with and without chapters, the first and last page of a chapter, a download read
offline, and each changed setting after reopening the source.

## Report

Say what ran and what it showed: the command, the captured output, which steps skipped and
why. Probe beyond the claim — a 404, a missing key, a second burst straight after the first,
a setting at its other value — and report what held. "Gates green" is not verification, and a
run where every host answered with a challenge is BLOCKED, not PASS.

## References

- [Mana docs](https://mana-ios.github.io/overview) — networking, images, crypto, WebView
- [mana-dev](https://github.com/Mana-iOS/mana-dev) — the build and `serve --watch` behind
  `bun run build` and `bun run dev`
- [mana-ios.github.io](https://github.com/Mana-iOS/mana-ios.github.io) — the docs' source
