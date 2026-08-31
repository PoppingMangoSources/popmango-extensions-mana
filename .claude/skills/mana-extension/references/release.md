# Releasing a source

## Gates

All four must pass. Nothing ships on a red gate.

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
```

`typecheck` is the one that matters most: `mana-dev build` bundles without checking types,
so a source written against a removed API builds cleanly and fails silently in the app. CI
runs all four.

Then the contract test against the live site:

```bash
npm run verify <Name>      # one source
npm run verify -- --all    # every source
```

SKIP is not PASS. A Cloudflare SKIP means the source is unverified, not working.

## Confirm the intents

The bitmask in `dist/sources.json` is what the app actually reads. After any change to
which methods a source defines, confirm the result:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.intents)"
```

Bit 11 (`providesSearchForm`, value 2048) set means filters will appear. If you added
`getSearchForm` and the bit is not set, the method is not on the instance — check that the
class really declares it and that `Target` extends the class you edited.

## Version

**Only ever bump the patch digit: `1.0.0` → `1.0.1` → `1.0.2`.** Never `1.1.0`, never
`2.0.0`. Every release is the next patch, whatever it contains — a selector fix, a new
section, a new preference, a reworked home page. Mixed bump sizes make the history
confusing and messy to read, and nothing in the app treats a minor bump differently.

A new source starts at `1.0.0` and counts up from there.

The single exception, which needs asking about first rather than deciding alone: content
ids or chapter ids changing shape invalidates every reader's library. Raise it before
shipping it; do not express it by inventing a major bump.

## CHANGELOG

```markdown
## <Name> (current: v<X.Y.Z>)

### Added / Changed / Fixed
- What changed, in one sentence per bullet.
```

Newest source first, newest entry first within a source. `info.version` and the
`(current: v...)` value must agree — nothing enforces it.

## README

```bash
npm run build && npm run readme
```

That regenerates the source table between the `<!-- sources:start -->` markers and updates
the count on the README badge from `dist/sources.json`. Do not hand-edit that table.

## Assets

`info.thumbnail` is a **bare filename inside the project-root `assets/` folder** —
`"Kagane.png"`, not `"assets/icon.png"` and not a path. The toolchain copies only that
folder into `dist/`; an icon under `src/<Name>/assets/` is never packaged, and the app
falls back to a placeholder without reporting anything. A full URL also works.

`npm run verify <Name>` fails when `dist/assets/<thumbnail>` is missing, which is the
check that catches this.

For the README row, drop a second copy at `media/sources/<name-lowercased>.png` —
`scripts/update-readme.mjs` looks for exactly that path and omits the image if it is absent.

## Publishing

Pushing `main` runs the build and publishes `dist/` to the `gh-pages` branch under `/main`,
plus a redirect at the site root. The address people paste into Mana is:

```
https://poppingmangosources.github.io/popmango-extensions-mana/main
```

GitHub Pages must be set to **deploy from the `gh-pages` branch, `/ (root)` folder**. That
branch only exists after the first successful workflow run.

## Checklist

- [ ] `npm run lint && npm run format:check && npm run typecheck && npm run build` clean
- [ ] `npm run verify <Name>` — PASS, with SKIPs understood
- [ ] intent bitmask has the bits the source intends
- [ ] `info.version` bumped
- [ ] CHANGELOG entry, heading version matching `info.version`
- [ ] `npm run readme` run, table and badge current
- [ ] `assets/<Name>.png` exists and matches `info.thumbnail`
- [ ] `media/sources/<name>.png` exists for the README row
- [ ] `scripts/probes/<Name>.json` has a real `contentId`
