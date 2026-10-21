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
 * The main catalog is the default; the testing deploy supplies its own address so
 * installing a testing source does not send the reader back to the main catalog.
 */
const REPO_URL =
  process.env.MANA_REPO_URL ??
  (HOMEPAGE ? `${HOMEPAGE}/main` : "https://example.invalid/main");

/** Opens Mana's preview card for the repository, which asks before adding anything. */
const ADD_REPO_URL = `mana://add-repo?url=${encodeURIComponent(REPO_URL)}&name=${encodeURIComponent(REPO_NAME)}`;

const sources = [...(manifest.sources ?? [])]
  .filter((source) => source && source.name !== "Template")
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

// ── icons ──────────────────────────────────────────────────────────────────

// mana-dev copies the project-root assets/ folder into dist/ itself, so the
// icons are already in place; this only reports one that is missing, which the
// app would render as a placeholder.
for (const source of sources) {
  const iconFile = source.thumbnail;
  if (!iconFile || /^https?:/i.test(iconFile)) continue;

  if (!fs.existsSync(path.join(DIST, "assets", iconFile))) {
    process.stderr.write(
      `[page] ${source.name}: assets/${iconFile} is missing — the app will show a placeholder\n`,
    );
  }
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

  var TICKER_SECONDS_PER_SOURCE = 2.25;

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
    var file = source.thumbnail;
    if (!file) return "";
    if (/^https?:/i.test(file)) return file;
    return "assets/" + file;
  }

  function ratingFor(source) {
    return RATING[Number(source.rating) || 0] || RATING[0];
  }

  function languageTags(source) {
    return (source.supportedLanguages || []).map(function (code) {
      return LANGUAGES[code] || String(code).slice(0, 2).toUpperCase();
    }).filter(function (tag, index, all) { return all.indexOf(tag) === index; });
  }

  // Mana shows the repository's own preview first when it has not been added yet,
  // so this one link serves a visitor who has the repository and one who does not.
  function installUrl(source) {
    return "mana://install-source?repo=" + encodeURIComponent(repo.url) +
      "&id=" + encodeURIComponent(source.id);
  }

  function sourceCard(source) {
    var rating = ratingFor(source);
    var icon = iconUrl(source);
    var languages = languageTags(source);

    return '<a class="source-card" href="' + esc(installUrl(source)) + '"' +
      ' title="Install ' + esc(source.name) + '">' +
      (icon ? '<img src="' + esc(icon) + '" alt="" width="54" height="54" loading="lazy">' : "") +
      '<span class="source-card__copy"><b>' + esc(source.name) + '</b>' +
      '<span><span>v' + esc(source.version) + '</span>' +
      '<i class="rating rating--' + rating.tone + '">' + esc(rating.label) + '</i>' +
      (languages.length ? '<span>' + esc(languages.join(" · ")) + '</span>' : "") +
      '</span></span><span class="source-card__add" aria-hidden="true">Get</span></a>';
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
      '<a class="button button--mango" href="' + esc(repo.addUrl) + '">Add to Mana</a>' +
      '<button class="button button--berry" type="button" id="copy-repo">Copy repository URL</button>' +
      '<a class="button button--paper" href="' + esc(repo.github) + '">View on GitHub</a>' +
      '</div></div>' + body + '</section>';

    var copy = document.getElementById("copy-repo");
    if (copy) bindCopy(copy);
    updateScrollbars();
  }

  // Both copy buttons share this. The label is restored from the button's own
  // markup so each keeps its own wording after the confirmation clears.
  function bindCopy(button) {
    var label = button.textContent;

    button.addEventListener("click", function () {
      var done = function () {
        button.textContent = "Copied!";
        setTimeout(function () { button.textContent = label; }, 2000);
      };

      var fallback = function () {
        var field = document.getElementById("repo-url");
        if (!field) return;
        var range = document.createRange();
        range.selectNodeContents(field);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand("copy"); done(); } catch (error) { /* nothing to do */ }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(repo.url).then(done, fallback);
      } else {
        fallback();
      }
    });
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
      return '<a class="ticker__item" href="' + esc(installUrl(source)) + '"' +
        ' title="Install ' + esc(source.name) + '">' +
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
    // One loop crosses the whole set, so a fixed duration would slow every card
    // down as sources are added; this keeps each card moving at the same pace.
    ticker.style.animationDuration = items.length * TICKER_SECONDS_PER_SOURCE + "s";
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

  var heroCopy = document.getElementById("copy-hero");
  if (heroCopy) bindCopy(heroCopy);

  // Coming back from the app restores the page with the tapped card still
  // focused, and a focused strip stands still.
  window.addEventListener("pageshow", function () {
    var active = document.activeElement;
    if (active && ticker.contains(active)) active.blur();
  });

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
  addUrl: ADD_REPO_URL,
  github: GITHUB,
  note: "Novels, manga, manhwa and manhua, kept fresh for the Mana app.",
  sources,
};

const built = new Date();
const description = "PoppingMango manga, manhwa, manhua and novel sources for the Mana app.";
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
      <a class="button button--mango" href="${escapeHtml(ADD_REPO_URL)}">Add to Mana</a>
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
  <section class="compat install" id="install">
    <span class="compat__flower" aria-hidden="true">✿</span>
    <div class="install__body">
      <p><b>Add the repository to Mana.</b> On the device with Mana, tap <b>Add to Mana</b>,
      or tap any source to install just that one. Anywhere else, copy the address, then open
      <b>Mana → Discover → Repositories → Add Repo</b> and paste it in.</p>
      <div class="install__url">
        <code id="repo-url">${escapeHtml(REPO_URL)}</code>
        <a class="button button--mango install__copy" href="${escapeHtml(ADD_REPO_URL)}">Add to Mana</a>
        <button class="button button--berry install__copy" type="button" id="copy-hero">Copy</button>
      </div>
    </div>
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

// ── open page ──────────────────────────────────────────────────────────────

/**
 * An https address that hands straight off to Mana.
 *
 * Chat apps only make http and https links tappable, so a `mana://` link
 * shared there is dead text; this page is what gets shared instead.
 * `open.html?source=<id>` installs one source rather than adding the whole
 * repository.
 */
const OPEN_URL = `${REPO_URL}/open.html`;
const ICON_URL = `${REPO_URL}/assets/Repository.png`;
const sourceNames = Object.fromEntries(sources.map((source) => [source.id, source.name]));
const openDescription = `${sources.length} sources: ${sources.map((source) => source.name).join(", ")}. Tap to open Mana and add the repository.`;
const openTitle = `Add ${REPO_NAME} to Mana`;

const openHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(openTitle)}</title>
<meta name="description" content="${escapeHtml(openDescription)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(REPO_NAME)}">
<meta property="og:title" content="${escapeHtml(openTitle)}">
<meta property="og:description" content="${escapeHtml(openDescription)}">
<meta property="og:url" content="${escapeHtml(OPEN_URL)}">
<meta property="og:image" content="${escapeHtml(ICON_URL)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#ffb3d3">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(mangoMark(32))}">
<noscript><meta http-equiv="refresh" content="0;url=${escapeHtml(ADD_REPO_URL)}"></noscript>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 16px;
  font-family: ui-rounded, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #4a2f42;
  background: linear-gradient(160deg, #eefaf6 0%, #fff6e8 55%, #ffe8f2 100%);
}
.card {
  width: 100%;
  max-width: 380px;
  padding: 28px 24px;
  text-align: center;
  border: 1px solid #f6dfe6;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 14px 34px rgba(124, 75, 91, 0.12);
}
.icon { width: 72px; height: 72px; border-radius: 18px; object-fit: cover; }
h1 { margin: 16px 0 6px; font-size: 19px; }
p { margin: 0; font-size: 13.5px; line-height: 1.5; color: #7d6274; }
.button {
  display: block;
  margin: 20px 0 16px;
  padding: 12px 16px;
  border-radius: 999px;
  background: linear-gradient(120deg, #ffd9ea, #ffb3d3);
  color: #5c2742;
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
}
code {
  display: block;
  margin-top: 10px;
  padding: 9px 11px;
  border: 1px solid #f2e6df;
  border-radius: 12px;
  background: #fffdf8;
  color: #7d6274;
  font: 12px ui-monospace, Menlo, monospace;
  overflow-wrap: anywhere;
}
.back { display: inline-block; margin-top: 18px; font-size: 13px; font-weight: 700; color: #d4568c; }
.spinner {
  width: 24px;
  height: 24px;
  margin: 18px auto 0;
  border-radius: 50%;
  border: 3px solid #ffe4ef;
  border-top-color: #f07fae;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
/* The way in by hand only shows once Mana has had its chance to open. */
#fallback { display: none; }
.failed #fallback { display: block; }
.failed .spinner { display: none; }
</style>
</head>
<body>
<main class="card">
  <img class="icon" src="assets/Repository.png" alt="" width="72" height="72">
  <h1 id="title">${escapeHtml(openTitle)}</h1>
  <p id="status">Opening Mana…</p>
  <div class="spinner" aria-hidden="true"></div>
  <div id="fallback">
    <a class="button" id="open" href="${escapeHtml(ADD_REPO_URL)}">Open in Mana</a>
    <p>Still nothing? Update Mana, or add the repository by hand under Discover → Repositories → Add Repo:</p>
    <code>${escapeHtml(REPO_URL)}</code>
    <a class="back" href="./">See every source</a>
  </div>
</main>
<!-- Leaving for mana:// from the head would stop some browsers drawing the page
     at all, leaving nothing to fall back on when Mana is missing. -->
<script>
(function () {
  "use strict";
  var repo = ${JSON.stringify(REPO_URL)};
  var name = ${JSON.stringify(REPO_NAME)};
  var sources = ${JSON.stringify(sourceNames).replace(/</g, "\\u003c")};
  var match = /[?&]source=([^&#]*)/.exec(location.search);
  var id = match ? decodeURIComponent(match[1]) : "";
  var source = Object.prototype.hasOwnProperty.call(sources, id) ? sources[id] : "";
  var link = source
    ? "mana://install-source?repo=" + encodeURIComponent(repo) + "&id=" + encodeURIComponent(id)
    : "mana://add-repo?url=" + encodeURIComponent(repo) + "&name=" + encodeURIComponent(name);

  if (source) {
    document.title = "Install " + source + " in Mana";
    document.getElementById("title").textContent = document.title;
  }
  document.getElementById("open").href = link;
  location.replace(link);

  // Mana coming to the front hides this page; if it never does, nothing caught the link.
  var timer = setTimeout(function () {
    document.body.className = "failed";
    document.getElementById("status").textContent = "Mana didn't open.";
  }, 2500);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clearTimeout(timer);
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(DIST, "open.html"), openHtml, "utf8");
fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");

const changelog = path.join(ROOT, "CHANGELOG.md");
if (fs.existsSync(changelog)) fs.copyFileSync(changelog, path.join(DIST, "CHANGELOG.md"));

process.stdout.write(
  `[page] Generated dist/index.html and dist/open.html with ${sources.length} source(s)\n`,
);
