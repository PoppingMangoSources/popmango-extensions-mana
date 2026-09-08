# popmango-extensions-mana

Content sources for the Mana app (iOS/iPadOS). Each source is a TypeScript class exported
as `Target` and bundled into a `.mana` file.

## Working on a source

Use the `mana-extension` skill in `.claude/skills/` — it carries the recon method, the
`@mana-app/types` surface, the shared toolkit, and the release checklist. Read it before
adding or fixing a source; the failure modes here are mostly silent.

## Layout

| Path | What it holds |
| :--- | :------------ |
| `src/common/` | The shared runtime: networking, forms, dates, URLs, HTML helpers, AES |
| `src/<Source>/` | One folder per source — `client.ts`, `model.ts`, `parsers.ts`, `main.ts` |
| `assets/` | Source icons, named `<Source>.png` — the only folder the toolchain packages |
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
```

Run all four gates before calling a change done. `verify` needs the network, which this
sandbox does not have — CI is where a source meets its site, so read the Contract run rather
than assuming a green local build means anything about the live site.

## Conventions

- Comments explain **why**, never what. A comment earns its place when it records a
  non-obvious constraint someone would otherwise "fix" — a site quirk, a runtime
  limitation, an ordering requirement.
- No `any`. `strict` and `noUncheckedIndexedAccess` are on.
- Prefer moving a helper into `src/common/` over copying it into a second source.
- The runtime is bare V8/JavaScriptCore: no `fetch`, no `URL`, no `crypto.subtle`, no
  `TextDecoder`. `src/common/` has replacements for each. `crypto-js` bundles and runs there
  for a primitive `src/common/aes.ts` does not carry.
- A `WebViewPage` is asked with `evaluate(fn, …)`, never `evaluateScript`. The host declares
  `args` in the page's own scope on every script and it outlives the call, so a second
  `evaluateScript` against one page throws — and a loop that polls a page is the usual way to
  meet that. A function handed to `evaluate` must return a settled JSON value, not a promise,
  and can reference nothing outside its own body.
- The pill over a cover and the rows beneath a title answer to different rules: the pill
  takes the best single thing the site says and comes out of the subtitle; the rows keep
  everything, because the tiles that draw rows draw no pill.

## Versioning

Sources only ever bump the patch digit: `1.0.0` → `1.0.1` → `1.0.2`. **Never `1.1.0`, never
`2.0.0`**, whatever the release contains — a fix, a new section, a new setting, a rewritten
home page. Mixed bump sizes make the history confusing and messy, and the app treats them
all alike. A new source starts at `1.0.0`.

## Git

Commits are authored by Popmango Extensions and unsigned. Commit bodies are one or two
sentences. Do not name or link third parties in code, commit messages, or documentation.
Work lands on `main`.
