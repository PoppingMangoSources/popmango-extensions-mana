Checklist:

- [ ] The patch digit of every changed source is bumped (`info.version`), and only the patch digit
- [ ] `CHANGELOG.md` has a section for each new version, and `bun run readme` was run
- [ ] `info.id` is unchanged, and no home row was renamed away from the site's own name
- [ ] A new source has its icon at `assets/<Name>.png` and a probe in `scripts/probes/`
- [ ] `bun run lint`, `format:check`, `typecheck`, `build` and `check` are clean
- [ ] Tested with `bun run verify <Name>` or on a device — or the PR says it was not
- [ ] AI-assisted changes were reviewed by a person before opening this PR
