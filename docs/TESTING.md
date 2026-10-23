# Testing a source

Three layers, each catching what the one before cannot. None of them replaces opening the
source in the app; together they say how far a change has been proven, and a report should
say which layers it passed.

## 1. The gates — offline, every change

```bash
bun run lint && bun run format:check && bun run typecheck && bun run build && bun run check
```

`bun run hooks` installs a pre-push hook that runs the same five, and the Test workflow
runs them on every push and pull request.

- **`typecheck`** is the one that matters. `mana-dev` strips types without checking them, so
  a source written against a removed API bundles cleanly and only fails on a device.
- **`build`** writes `dist/sources/<Name>.mana` and `dist/sources.json`, then renders the
  repository page.
- **`check`** holds every source to the rules that can be read from the code: the icon is in
  `assets/`, a probe exists, the intents match the methods, the CHANGELOG agrees with
  `info.version`, the bump was a patch, and nothing reaches for a global the runtime lacks.

What the app will offer comes from the intents the build detected:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.intents.toString(2).padStart(27,'0'))"
```

## 2. The contract — live, through the built bundle

```bash
bun run verify <Name>          # one source
bun run verify <Name> -v       # with every request and result
bun run verify --all
```

`scripts/verify-source.mjs` loads the built bundle into a V8 context with the host shims in
`scripts/harness/runtime.mjs` and calls what the app calls: the home sections and each
row, search, the filter form, a title, its chapters, a chapter's pages and one image through
the page transport. It checks the shape of each answer, not just that one came back.

`scripts/probes/<Name>.json` names what to drive it with:

| Key | What it does |
| :-- | :----------- |
| `query` | A search that returns results |
| `contentId` | A real title — without it the content half is skipped |
| `chapterId` | A representative chapter, when the first one is not |
| `settings` | Seeds `ObjectStore`, to drive the source under non-default settings |
| `pagesNeedWebView` | Pages come through a WebView, which the harness does not have — SKIP with a reason |

**SKIP is not a pass.** A Cloudflare block or a WebView-only reader reports SKIP so the run
stays useful on protected sites, but nothing behind it was tested.

**A sandbox without network proves nothing here.** When every host answers `Forbidden`,
say so rather than calling the change verified. The **Contract** workflow runs the same
command after every deploy, daily at 06:00 UTC, and on request for one source; its log is
where a source meets its site.

### What the harness cannot model

- No WebView, so `evaluate` traps are found by reading the code.
- No redraw, so `redrawImageWithSize` is unchecked.
- The app's per-source concurrency is not reproduced; the client's own limiter is.
- Decryption runs through Node's ciphers in place of the host's; a cipher the host would
  reject with `NotSupportedError` on an older app passes here.

## 3. The device

```bash
bun run dev
```

serves `dist/` with a rebuild on every save. Add the printed address in Mana as a
repository and the source's `console` output streams back to the terminal. This is the only
layer that sees the real reader, the real image cache, section styles as drawn and the
settings gear.

Test the screens the change touched: the home rows in order, a "view more", one filter of
each kind, a title with and without chapters, the first and last page of a chapter, a
download, and each changed setting after reopening the source.

## Sources with their own tests

| Command | What it covers |
| :------ | :------------- |
| `bun run test:toonkotsu` | Toonkotsu's request signing and page decryption, native and fallback, on fixed inputs |

A source whose reader carries crypto or a token dance earns a test like it: fixed inputs,
known outputs, no network.

## Reporting

Say which layers ran and what each said. "Gates green, contract not run — no network" is a
complete report; "verified" without the contract or a device is not.
