# popmango-extensions-mana

Content sources for the Mana app (iOS/iPadOS). Each source is a TypeScript class exported
as `Target` and bundled into a `.mana` file.

This file is the agent guide for the repository, whatever the agent. `CLAUDE.md` only points
here. If anything below disagrees with what you remember about Mana, this repository or the
apps sources get ported from, this file and the documents it names win — the platform has
moved under every one of them.

## Working on a source

Load the skill before touching a source. The failure modes here are mostly silent: a filter
that does nothing, a row the app never draws, an icon that becomes a placeholder.

| Task | Skill | Also read |
| :--- | :---- | :-------- |
| Add, fix or extend a source | `mana-extension` | — |
| Port a source from another app | `mana-port` | [docs/CONVERSION.md](docs/CONVERSION.md) |
| Encrypted, scrambled or header-gated images and pages | `mana-images` | — |
| Test a change, read a Contract run | `verify` | [docs/TESTING.md](docs/TESTING.md) |

The skills live in `.claude/skills/`; `.agents/skills` is the same folder for agents that look
there. `mana-extension/references/platform.md` condenses the official source documentation
(<https://mana-ios.github.io/overview>) and the host's release notes — what the app calls,
what it ignores, and what each choice costs.

## Layout

| Path | What it holds |
| :--- | :------------ |
| `src/common/` | The shared runtime: networking, forms, dates, URLs, HTML helpers, AES |
| `src/<Source>/` | One folder per source — `client.ts`, `model.ts`, `parsers.ts`, `main.ts` |
| `src/Template/` | What `bun run new-source` copies |
| `assets/` | Source icons, named `<Source>.png` — the only folder the toolchain packages |
| `docs/` | Porting and testing guides |
| `scripts/` | Build, page generation, README generation, verification harness |
| `scripts/probes/` | Per-source fixtures naming a title and chapter for `bun run verify` |
| `scripts/harness/` | The host shims `verify` runs a built bundle against |
| `scripts/site/` | The published page's stylesheet |
| `media/` | README artwork and per-source icons |

A directory becomes a source when one of its files exports `class Target`. That is why
`src/common/` is shared code rather than an extension — never put a `Target` in it.

## Commands

```bash
bun run typecheck        # the gate that matters — the bundler does not check types
bun run lint
bun run format:check
bun run build            # bundles src/ into dist/ and renders the repository page
bun run check            # every source against the repository's own rules
bun run verify <Name>    # contract test against the live site
bun run readme           # regenerates the README table from dist/sources.json
bun run new-source <Name> --id <id> --url <https://site>
bun run dev              # serves dist/ over HTTP for a device, rebuilding on save
```

Run all four gates before calling a change done. `verify` needs the network, which a
sandboxed agent usually does not have — CI is where a source meets its site, so read the
Contract run rather than assuming a green local build means anything about the live site.

## Scope

A "fix or add a source" task changes `src/<Source>/`, its probe, `assets/`, `CHANGELOG.md`
and the README row. `src/common/` changes when a helper is genuinely shared. `scripts/`,
`.github/`, `package.json` and the toolchain are a different, higher-risk kind of work: leave
them alone unless that work was asked for.

## Conventions

- Comments explain **why**, never what. A comment earns its place when it records a
  non-obvious constraint someone would otherwise "fix" — a site quirk, a runtime
  limitation, an ordering requirement.
- No `any`. `strict` and `noUncheckedIndexedAccess` are on.
- Don't over-engineer: no option, fallback or abstraction for a case that cannot happen.
- Prefer moving a helper into `src/common/` over copying it into a second source.
- The runtime is bare V8/JavaScriptCore: no `fetch`, no DOM, no `crypto.subtle`, no
  `TextEncoder`/`TextDecoder`. `mana-dev` prepends `Buffer`, `URL`, `URLSearchParams` and
  `atob` to every bundle, but `src/common/` already answers each of them (`bytes.ts`,
  `urls.ts`, `query.ts`) and one source should read like the next.
- Decrypt with the host's native ciphers — `response.decrypt` for a body, `Crypto.decrypt`
  for bytes you hold, built from `Cipher`/`Key` in `@mana-app/types`. `crypto-js` stays for
  what the host does not offer, such as hashing.
- A dependency is compiled into every source that imports it, so it is paid for per source —
  `cheerio` about 460 KB, `crypto-js` about 92 KB, against a 176 KB source that imports
  neither. Add one only when `src/common/` genuinely cannot answer it, and never re-export a
  side-effecting one from `src/common/index.ts`: esbuild cannot tree-shake those, so the
  barrel hands it to every source that imports anything at all.
- One `HttpClient` per source, kept for the source's lifetime. A client built per call
  starts its own rate limiter and so has none.
- A `WebViewPage` is asked with `evaluate(fn, …)`, never `evaluateScript`. The host declares
  `args` in the page's own scope on every script and it outlives the call, so a second
  `evaluateScript` against one page throws — and a loop that polls a page is the usual way to
  meet that. A function handed to `evaluate` may be `async` and is awaited; it must resolve
  to a JSON value and can reference nothing outside its own body.
- A WebView opened only to borrow the site's origin loads a script-free document there —
  `/robots.txt` — never the site's own page. The origin and the cookie jar are all the
  endpoint checks; the application brings its bundle, its ads, a readiness wait to write, and
  whatever its own scripts do to keep a source out.
- The pill over a cover and the rows beneath a title answer to different rules: the pill
  takes the best single thing the site says and comes out of the subtitle; the rows keep
  everything, because the tiles that draw rows draw no pill.
- A home row keeps the site's own name for it. Rename nothing the site already titled.
- No emoji in anything a source draws. Marks come from the filled glyphs in `Mark`
  (`src/common/highlights.ts`) — `★`, `♥`, `▲` and the like.
- Don't add a method the app does not call yet expecting the app to use it —
  `mana-extension/references/platform.md` lists them. Don't remove an existing one either:
  a source can drive it from its own settings, as MangaUpdates' sign-in does.

## Versioning

**A new source starts at `1.0.0`** and counts up from there.

**Every push that changes a source bumps its patch digit**: `1.0.0` → `1.0.1` → `1.0.2`. Not
every milestone, not every time the work feels finished — every push. Pushing `main`
publishes, so a build nobody can name is a build nobody can report a bug against, and two
different ones answering to the same number is the worst of both. A new source is no
exception: it is released the moment it is pushed, and the next fix to it is `1.0.1`.

The digit is the same size whatever the push contains — a selector fix, a new section, a new
setting, a rewritten home page. Mixed bump sizes make the history confusing, and the app
treats them all alike, so the size of a change is never the reason to move a bigger digit.
**Never `2.0.0`.**

The minor digit — `1.0.4` → `1.1.0` — moves only when it is asked for by name. It is not a
judgement call: no change is big enough to earn one on its own.

The sources already here were set to `1.1.0` in one go when they stopped being a moving
target — the patch counts had drifted from `1.0.5` to `1.0.38` while each was still finding
its site's quirks, and a shared number was a cleaner place to carry on from. That was a
one-off, and it is not where a new source starts.

## Before publishing

Pushing `main` publishes. Before a push that changes a source, go through this file and the
skill's "Before calling it done" list point by point against the diff — not from memory.

## Git

Commits are authored by Popmango Extensions and unsigned. Commit bodies are one or two
sentences. Do not name or link third parties in code, commit messages, or documentation.
Work lands on `main`.
