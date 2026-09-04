<p align="center">
  <img src="media/header.svg" alt="PoppingMango Sources — novels, manga, manhwa and manhua for Mana" width="100%"/>
</p>

<p align="center">
  <img src="media/badge-ios-summer-compact.svg" alt="iOS / iPadOS" height="28"/>
  <img src="media/badge-app-summer.svg" alt="For Mana" height="28"/>
  <br/>
  <img src="media/badge-count-summer.svg" alt="Mana sources" height="28"/>
</p>

<p align="center">
  <a href="https://poppingmangosources.github.io/popmango-extensions-mana/">
    <img src="media/button-add.svg" alt="Add PoppingMango to Mana" height="52"/>
  </a>
</p>

<p align="center">
  On iPhone or iPad, tap the button, copy the repository address,<br/>
  and paste it into Mana under <b>Discover → Repositories → Add Repo</b>.
</p>

---

## About

**PoppingMango Sources** is an independent source collection for the Mana app, covering
novels, manga, manhwa and manhua.

Every source here is written directly against the Mana extension API rather than being a
repackaged bundle from another app, so home sections, advanced search filters and per-source
settings all behave the way Mana expects.

## Installing

Add this address as a repository in Mana:

```
https://poppingmangosources.github.io/popmango-extensions-mana/main
```

Open **Mana → Discover → Repositories → Add Repo**, paste the address, and the catalog below
becomes available to install.

## Sources

<!-- sources:start -->
**5 sources available for Mana.**

| Source | Site | Rating | Version |
| :----- | :--- | :----- | :------ |
| <img src="media/sources/flamecomics.png" width="22" align="top"/> **FlameComics** | [flamecomics.xyz](https://flamecomics.xyz) | Safe | v1.0.6 |
| <img src="media/sources/kagane.png" width="22" align="top"/> **Kagane** | [kagane.to](https://kagane.to) | Mixed | v1.0.15 |
| <img src="media/sources/mangago.png" width="22" align="top"/> **Mangago** | [mangago.me](https://www.mangago.me) | Mixed | v1.0.6 |
| <img src="media/sources/mangaupdates.png" width="22" align="top"/> **MangaUpdates** | [mangaupdates.com](https://www.mangaupdates.com) | Mixed | v1.0.6 |
| <img src="media/sources/xcomic.png" width="22" align="top"/> **XCOMIC** | [xcomic.me](https://xcomic.me) | 18+ | v1.0.6 |
<!-- sources:end -->

## Reporting a problem

Open an issue with the bug report form. Include the affected source, the title or page that
failed, and a screenshot if you have one — the source version shown next to the extension in
Mana is the single most useful thing to include.

For a site you would like added, use the source request form.

## Development

<details>
<summary><b>Building and testing</b></summary>

```bash
npm install
npm run typecheck        # TypeScript, no emit
npm run lint             # oxlint
npm run format:check     # oxfmt
npm run build            # bundles src/ into dist/ and renders the repository page
npm run verify -- --all  # runs every source against its probe
```

`npm run new-source` scaffolds a source folder. `npm run readme` regenerates the table above
from `dist/sources.json` after a build.

### Layout

| Path | What it holds |
| :--- | :------------ |
| `src/common/` | The shared runtime — networking, forms, dates, URLs, HTML helpers, AES |
| `src/<Source>/` | One folder per source; the entry point is the `Target` class in `main.ts` |
| `scripts/` | Build, page generation, README generation and the verification harness |
| `scripts/probes/` | Per-source fixtures naming a title and chapter for `npm run verify` |

A folder becomes a source when one of its files exports `class Target`, which is why
`src/common/` is shared code rather than an extension of its own.

### Publishing

Pushing `main` builds the catalog and publishes `dist/` to the `gh-pages` branch under
`/main`, alongside the repository page at the site root.

</details>

## Disclaimer

These extensions are **not** affiliated with the Mana app or with any of the websites they
read from. All site names and logos belong to their respective owners.

Licensed under the [GNU General Public License v3.0 or later](LICENSE).
