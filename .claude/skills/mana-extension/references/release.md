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

Bump `info.version` in `src/<Name>/main.ts`. Semantic:

- **patch** — a selector fix, no behaviour change
- **minor** — a new filter, section, or preference
- **major** — content ids or chapter ids change shape, which invalidates users' libraries

A change to how chapter *numbers* are assigned is a minor bump, not a patch: it moves where
the app resumes reading.

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

`info.thumbnail` must be `assets/icon.png` (or `.jpg`) and the file must exist at
`src/<Name>/assets/`. `scripts/build-page.js` copies it into `dist/sources/<Name>/`; a
missing or misnamed file renders a placeholder on the published page. A full URL also works.

For the README row, drop a matching icon at `media/sources/<name-lowercased>.png` —
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
- [ ] `src/<Name>/assets/icon.*` exists and matches `info.thumbnail`
- [ ] `media/sources/<name>.png` exists for the README row
- [ ] `scripts/probes/<Name>.json` has a real `contentId`
