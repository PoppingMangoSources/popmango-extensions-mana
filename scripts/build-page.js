/* SPDX-License-Identifier: GPL-3.0-or-later */
// @ts-check
"use strict";

/**
 * Builds the repository page published to GitHub Pages.
 *
 * Runs as `postbuild`, so it reads the manifest the toolchain just wrote to
 * `dist/sources.json`, copies each source's icon next to it, and renders the
 * page around them. The catalog is also inlined into the page and refreshed
 * from the manifest in the browser, so a visitor sees the list immediately and
 * still gets today's versions on a cached page.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const MANIFEST = path.join(DIST, "sources.json");

if (!fs.existsSync(MANIFEST)) {
  process.stderr.write("[page] dist/sources.json not found — skipping page generation\n");
  process.exit(0);
}

/** @type {{ repositoryName?: string; sources?: any[]; buildTime?: string }} */
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch {
  process.stderr.write("[page] dist/sources.json is unreadable — skipping page generation\n");
  process.exit(0);
}

/** @type {any} */
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
} catch {
  /* The page falls back to its own defaults. */
}

const REPO_NAME = manifest.repositoryName ?? pkg.repositoryName ?? "PoppingMango Sources";
const GITHUB = pkg.repository ?? "https://github.com/PoppingMangoSources/popmango-extensions-mana";
const HOMEPAGE = (pkg.homepage ?? "").replace(/\/+$/, "");

/**
 * The URL a reader pastes into Mana.
 *
 * The deploy publishes `dist/` into the `main` folder of the Pages branch, so
 * the manifest the app fetches sits one level below the site root.
 */
const REPO_URL = HOMEPAGE ? `${HOMEPAGE}/main` : "https://example.invalid/main";

const sources = [...(manifest.sources ?? [])]
  .filter((source) => source && source.name !== "Template")
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

// ── icons ──────────────────────────────────────────────────────────────────

for (const source of sources) {
  if (!source.path) continue;
  const iconFile = source.thumbnail ?? "assets/icon.png";
  if (/^https?:/i.test(iconFile)) continue;

  const from = path.join(ROOT, "src", source.path, iconFile);
  if (!fs.existsSync(from)) continue;

  const to = path.join(DIST, "sources", source.path, iconFile);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// ── helpers ────────────────────────────────────────────────────────────────

/** @param {string} value */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {number} size */
function mangoMark(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="PoppingMango"><defs><linearGradient id="mango-gradient-${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd087"/><stop offset="1" stop-color="#ff9a61"/></linearGradient></defs><circle cx="24" cy="24" r="23" fill="#fff7dc"/><ellipse cx="23" cy="27" rx="13" ry="15" fill="url(#mango-gradient-${size})"/><ellipse cx="18" cy="20" rx="3.5" ry="6" fill="#fff" opacity=".42"/><ellipse cx="31" cy="10" rx="7" ry="3.4" fill="#8fce8b" transform="rotate(24 31 10)"/><circle cx="34" cy="17" r="2.4" fill="#fff" opacity=".9"/></svg>`;
}

function styles() {
  try {
    return fs.readFileSync(path.join(__dirname, "site", "summer.css"), "utf8");
  } catch {
    return "body{font-family:system-ui,sans-serif;margin:2rem;}";
  }
}

/**
 * Runs in the visitor's browser.
 *
 * Kept as a plain string of ES5 so the page needs no build step of its own and
 * works on the older WebViews people open these links in.
 */
function browserScript() {
  return `
(function () {
  "use strict";

  var RATING = [
    { label: "Safe", tone: "safe" },
    { label: "Mixed", tone: "mature" },
    { label: "18+", tone: "adult" }
  ];

  var LANGUAGES = {
    en_US: "EN", en: "EN", ja_JP: "JA", ja: "JA", ko_KR: "KO", ko: "KO",
    "zh-CN": "ZH", zh_CN: "ZH", zh: "ZH", fr_FR: "FR", fr: "FR",
    es_ES: "ES", es: "ES", pt_BR: "PT", pt: "PT", de_DE: "DE", de: "DE",
    it_IT: "IT", it: "IT", ru_RU: "RU", ru: "RU", UNIVERSAL: "ALL"
  };

  var repo = JSON.parse(document.getElementById("repo-data").textContent);
  var sections = document.getElementById("repo-sections");
  var ticker = document.getElementById("ticker-track");
  var filterInput = document.getElementById("source-filter");

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function sortSources(list) {
    return (list || []).filter(Boolean).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function iconUrl(source) {
    if (!source.path) return "";
    var file = source.thumbnail || "assets/icon.png";
    if (/^https?:/i.test(file)) return file;
    return "sources/" + source.path + "/" + file;
  }

  function ratingFor(source) {
    return RATING[Number(source.rating) || 0] || RATING[0];
  }

  function languageTags(source) {
    return (source.supportedLanguages || []).map(function (code) {
      return LANGUAGES[code] || String(code).slice(0, 2).toUpperCase();
    }).filter(function (tag, index, all) { return all.indexOf(tag) === index; });
  }

  function sourceCard(source) {
    var rating = ratingFor(source);
    var icon = iconUrl(source);
    var languages = languageTags(source);
    var href = source.website || repo.github;

    return '<a class="source-card" href="' + esc(href) + '" target="_blank" rel="noopener"' +
      ' title="' + esc(source.description || source.name) + '">' +
      (icon ? '<img src="' + esc(icon) + '" alt="" width="54" height="54" loading="lazy">' : "") +
      '<span class="source-card__copy"><b>' + esc(source.name) + '</b>' +
      '<span><span>v' + esc(source.version) + '</span>' +
      '<i class="rating rating--' + rating.tone + '">' + esc(rating.label) + '</i>' +
      (languages.length ? '<span>' + esc(languages.join(" · ")) + '</span>' : "") +
      '</span></span><span class="source-card__add" aria-hidden="true">↗</span></a>';
  }

  function render() {
    var query = filterInput.value.trim().toLowerCase();
    var list = sortSources(repo.sources);
    var shown = query ? list.filter(function (source) {
      return String(source.name).toLowerCase().indexOf(query) !== -1 ||
        String(source.description || "").toLowerCase().indexOf(query) !== -1;
    }) : list;

    var body;
    if (list.length === 0) {
      body = '<p class="empty">This source garden is still being planted.</p>';
    } else if (shown.length === 0) {
      body = '<p class="empty">No sources here match your search.</p>';
    } else {
      body = '<div class="source-scroll"><div class="source-grid">' +
        shown.map(sourceCard).join("") +
        '</div><span class="source-scroll__rail" aria-hidden="true">' +
        '<span class="source-scroll__thumb"></span></span></div>';
    }

    sections.innerHTML = '<section class="repository repository--mango" id="catalog">' +
      '<div class="repository__head"><div>' +
      '<p class="repository__kicker">For the Mana app</p>' +
      '<h3>' + esc(repo.name) + ' <span>' + list.length + ' sources</span></h3>' +
      '<p>' + esc(repo.note) + '</p></div>' +
      '<div class="repository__actions">' +
      '<button class="button button--mango" type="button" id="copy-repo">Copy repository URL</button>' +
      '<a class="button button--paper" href="' + esc(repo.github) + '">View on GitHub</a>' +
      '</div></div>' + body + '</section>';

    var copy = document.getElementById("copy-repo");
    if (copy) copy.addEventListener("click", copyRepoUrl);
    updateScrollbars();
  }

  function copyRepoUrl() {
    var button = document.getElementById("copy-repo");
    var done = function () {
      button.textContent = "Copied!";
      setTimeout(function () { button.textContent = "Copy repository URL"; }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(repo.url).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      var field = document.getElementById("repo-url");
      if (!field) return;
      var range = document.createRange();
      range.selectNodeContents(field);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try { document.execCommand("copy"); done(); } catch (error) { /* nothing to do */ }
    }
  }

  function updateScrollbar(container) {
    var viewport = container.querySelector(".source-grid");
    var rail = container.querySelector(".source-scroll__rail");
    var thumb = container.querySelector(".source-scroll__thumb");
    var scrollable = viewport.scrollHeight > viewport.clientHeight + 1;

    rail.hidden = !scrollable;
    if (!scrollable) return;

    var railHeight = rail.clientHeight;
    var thumbHeight = Math.max(42, railHeight * viewport.clientHeight / viewport.scrollHeight);
    var available = Math.max(0, railHeight - thumbHeight);
    var progress = viewport.scrollTop / Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    thumb.style.height = thumbHeight + "px";
    thumb.style.transform = "translateY(" + (available * progress) + "px)";
  }

  function updateScrollbars() {
    Array.prototype.forEach.call(document.querySelectorAll(".source-scroll"), function (container) {
      var viewport = container.querySelector(".source-grid");
      updateScrollbar(container);
      if (viewport.dataset.scrollbarReady !== "true") {
        viewport.dataset.scrollbarReady = "true";
        viewport.addEventListener("scroll", function () { updateScrollbar(container); }, { passive: true });
      }
    });
  }

  function renderTicker() {
    var items = sortSources(repo.sources).map(function (source) {
      var icon = iconUrl(source);
      return '<a class="ticker__item" href="' + esc(source.website || repo.github) + '"' +
        ' target="_blank" rel="noopener">' +
        (icon ? '<img src="' + esc(icon) + '" alt="" width="38" height="38">' : "") +
        '<span><b>' + esc(source.name) + '</b><small>v' + esc(source.version) + '</small></span></a>';
    });

    if (!items.length) {
      ticker.hidden = true;
      return;
    }

    var set = '<div class="ticker__set">' + items.join("") + '</div>';
    var duplicate = set
      .replace('<div class="ticker__set">', '<div class="ticker__set" aria-hidden="true">')
      .replace(/<a class=/g, '<a tabindex="-1" class=');
    ticker.innerHTML = set + duplicate;
  }

  // A visitor may be looking at a cached page, so the catalog is re-read from
  // the manifest the app itself uses and the list re-rendered if it moved on.
  function refresh() {
    fetch("sources.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (fresh) {
        repo.sources = sortSources((fresh.sources || []).filter(function (source) {
          return source && source.name !== "Template";
        }));
        render();
        renderTicker();
      })
      .catch(function () { /* The inlined catalog stays on screen. */ });
  }

  filterInput.addEventListener("input", render);
  window.addEventListener("resize", updateScrollbars);
  render();
  renderTicker();
  refresh();
})();
`;
}

// ── page ───────────────────────────────────────────────────────────────────

const repo = {
  name: REPO_NAME,
  url: REPO_URL,
  github: GITHUB,
  note: "Novels, manga, manhwa and manhua, kept fresh for the Mana app.",
  sources,
};

const built = new Date();
const description =
  "PoppingMango manga, manhwa, manhua and novel sources for the Mana app.";
const data = JSON.stringify(repo).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#ffca8f">
<meta name="color-scheme" content="light">
<title>${escapeHtml(REPO_NAME)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(mangoMark(32))}">
<style>
${styles()}
</style>
</head>
<body>
<div class="summer-sky" aria-hidden="true">
  <span class="sun"></span>
  <span class="cloud cloud--one"></span>
  <span class="cloud cloud--two"></span>
</div>

<header class="hero" id="top">
  <nav class="topbar" aria-label="Site links">
    <a class="brand" href="#top">
      <span class="brand__mark" aria-hidden="true">${mangoMark(46)}</span>
      <span><b>PoppingMango</b><small>Mana sources</small></span>
    </a>
    <div class="topbar__links">
      <a href="#install">Install</a>
      <a href="#catalog">Catalog</a>
      <a href="${escapeHtml(GITHUB)}">GitHub</a>
    </div>
  </nav>

  <div class="hero__copy">
    <p class="eyebrow">A little pocket of summer</p>
    <h1>Manga days,<br><span>mango skies.</span></h1>
    <p class="hero__lede">Sources for novels, manga, manhwa and manhua—one repository, added in a couple of taps.</p>
    <div class="hero__actions">
      <a class="button button--mango" href="#install">Add to Mana</a>
      <a class="button button--berry" href="#catalog">Browse the catalog</a>
    </div>
  </div>

  <div class="hero__card" aria-hidden="true">
    <span class="hero__sparkle">✦</span>
    <span class="hero__mango">${mangoMark(126)}</span>
    <span class="hero__caption">fresh sources<br>for sunny reads</span>
  </div>
</header>

<section class="ticker" aria-label="Available sources">
  <div class="ticker__fade ticker__fade--left"></div>
  <div class="ticker__track" id="ticker-track"></div>
  <div class="ticker__fade ticker__fade--right"></div>
</section>

<main>
  <section class="compat" id="install">
    <span class="compat__flower" aria-hidden="true">✿</span>
    <p><b>Add the repository to Mana.</b> Copy the address below, then open
    <b>Mana → Discover → Repositories → Add Repo</b> and paste it in.<br>
    <code id="repo-url">${escapeHtml(REPO_URL)}</code></p>
  </section>

  <div class="catalog-tools">
    <div>
      <p class="eyebrow">Pick your favourites</p>
      <h2>The source garden</h2>
    </div>
    <label class="search">
      <span aria-hidden="true">⌕</span>
      <input id="source-filter" type="search" placeholder="Search every source" autocomplete="off">
    </label>
  </div>

  <div id="repo-sections"></div>
</main>

<footer class="footer">
  <span aria-hidden="true">${mangoMark(42)}</span>
  <p><b>PoppingMango Mana Sources</b><br>Novels, manga, manhwa and manhua for the Mana app.</p>
  <p class="footer__links"><a href="${escapeHtml(GITHUB)}">GitHub</a></p>
  <p class="footer__built">Catalog built ${escapeHtml(built.toISOString().slice(0, 10))}</p>
</footer>

<script id="repo-data" type="application/json">${data}</script>
<script>
${browserScript()}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(DIST, "index.html"), html, "utf8");
fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");

const changelog = path.join(ROOT, "CHANGELOG.md");
if (fs.existsSync(changelog)) fs.copyFileSync(changelog, path.join(DIST, "CHANGELOG.md"));

process.stdout.write(`[page] Generated dist/index.html with ${sources.length} source(s)\n`);
