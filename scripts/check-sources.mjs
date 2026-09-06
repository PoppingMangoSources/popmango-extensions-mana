#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The repository's own rules, made enforceable.
 *
 * CLAUDE.md, `.claude/skills/mana-extension/SKILL.md` and its references describe how a
 * source has to be shaped. Every rule they list is one that has already shipped broken at
 * least once, and every one of those failures was silent: the bundler strips types without
 * checking them, a missing icon draws a placeholder without an error, and an intent that is
 * not set is a feature the app simply never offers.
 *
 * `verify-source.mjs` is the other half of this and needs the live site. This half needs
 * nothing but the build, so it can gate every push.
 *
 * Usage:
 *   node scripts/check-sources.mjs             # every source
 *   node scripts/check-sources.mjs Kagane      # one source
 *   node scripts/check-sources.mjs --base main # also compare versions against a git ref
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SectionStyle } from "@mana-app/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

/** Intent bits, from `references/api.md`. The app reads this mask and nothing else. */
const Intent = {
  preferenceMenuBuilder: 0,
  imageRequestHandler: 2,
  pageLinkResolver: 3,
  providesSearch: 10,
  providesSearchForm: 11,
  providesSearchSortOptions: 12,
  chaptersInContent: 20,
  providesChapters: 21,
  canHandleURL: 22,
};

const has = (intents, bit) => (BigInt(intents) & (1n << BigInt(bit))) !== 0n;

/** Patterns that mean a source is written against an API that no longer exists. */
const REMOVED_API = [
  [/\bgetSearchFilters\s*\(/, "getSearchFilters — replaced by getSearchForm"],
  [/\bisNSFW\b/, "Content.isNSFW — replaced by contentRating"],
  [/\bdisableTagNavigation\b/, "SourceConfig.disableTagNavigation — the key was removed"],
  [/\bSearchPickerPresentation\b/, "SearchPickerPresentation — use the matching builder"],
];

const failures = [];
const warnings = [];

function check(source, ok, message) {
  if (!ok) failures.push(`${source}: ${message}`);
  return ok;
}

function warn(source, ok, message) {
  if (!ok) warnings.push(`${source}: ${message}`);
  return ok;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
}

/** Every `.ts` file under a directory, so a rule can be applied to a whole source. */
function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

function versionAt(ref, file) {
  try {
    const blob = execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /version:\s*"(\d+\.\d+\.\d+)"/.exec(blob)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Versions only ever bump the patch digit. A minor or major bump is not a worse release,
 * it is an inconsistent history — CLAUDE.md rules it out whatever the release contains.
 */
function checkVersionBump(name, before, after) {
  if (!before || before === after) return;

  const [oldMajor, oldMinor, oldPatch] = before.split(".").map(Number);
  const [newMajor, newMinor, newPatch] = after.split(".").map(Number);

  check(
    name,
    newMajor === oldMajor && newMinor === oldMinor,
    `version went ${before} → ${after}; only the patch digit may change`,
  );
  check(
    name,
    newPatch === oldPatch + 1,
    `version went ${before} → ${after}; the patch digit moves by one`,
  );
}

function checkSource(source, catalog, changelog, base) {
  const name = source.name;
  const dir = path.join(SRC, source.path);
  const files = sourceFiles(dir);
  const code = files.map((file) => read(file) ?? "").join("\n");

  // --- Assets: an icon in the wrong place draws a placeholder and reports nothing.
  const thumb = source.thumbnail ?? "";
  if (thumb && !thumb.startsWith("http")) {
    check(name, !thumb.includes("/"), `thumbnail "${thumb}" must be a bare filename in assets/`);
    check(
      name,
      fs.existsSync(path.join(ROOT, "assets", thumb)),
      `assets/${thumb} is missing — the toolchain packages only the project-root assets/`,
    );
    check(name, fs.existsSync(path.join(DIST, "assets", thumb)), `dist/assets/${thumb} is missing`);
  }
  check(
    name,
    !fs.existsSync(path.join(dir, "assets")),
    "src/<Name>/assets/ is never packaged — move the icon to the project-root assets/",
  );
  // `update-readme.mjs` looks for exactly this path and omits the image if it is absent.
  warn(
    name,
    fs.existsSync(path.join(ROOT, "media", "sources", `${name.toLowerCase()}.png`)),
    `media/sources/${name.toLowerCase()}.png is missing — the README row will have no icon`,
  );

  // --- Probe fixture: without one, the live contract test has nothing to open.
  const probePath = path.join(ROOT, "scripts", "probes", `${name}.json`);
  const probeRaw = read(probePath);
  if (check(name, probeRaw !== undefined, `scripts/probes/${name}.json is missing`)) {
    let probe;
    try {
      probe = JSON.parse(probeRaw);
    } catch {
      check(name, false, `scripts/probes/${name}.json is not valid JSON`);
    }
    if (probe) {
      warn(name, Boolean(probe.query), `probe has no query — the search check cannot run`);
      warn(
        name,
        Boolean(probe.contentId),
        `probe has no contentId — getContent, getChapters and getChapterData are all skipped`,
      );
    }
  }

  // --- Version and CHANGELOG have to agree; nothing else enforces it.
  check(name, /^\d+\.\d+\.\d+$/.test(source.version), `version "${source.version}" is not X.Y.Z`);
  const heading = new RegExp(`^## ${name} \\(current: v(\\d+\\.\\d+\\.\\d+)\\)`, "m");
  const stated = heading.exec(changelog)?.[1];
  if (check(name, stated !== undefined, "no CHANGELOG heading")) {
    check(
      name,
      stated === source.version,
      `CHANGELOG says v${stated} but info.version is ${source.version}`,
    );
  }
  if (base) checkVersionBump(name, versionAt(base, `src/${source.path}/main.ts`), source.version);

  // --- Intents: the mask is what the app reads, so it has to match the methods.
  const intents = source.intents;
  if (/\bgetChapters\s*\(/.test(code)) {
    check(
      name,
      !has(intents, Intent.chaptersInContent),
      "getChapters exists but chaptersInContent is set — the app will expect inline chapters",
    );
  }
  // A tracker keeps a reading position against an account and serves no chapters of its own.
  if (source.environment === "source") {
    check(
      name,
      has(intents, Intent.providesChapters) || has(intents, Intent.chaptersInContent),
      "neither providesChapters nor chaptersInContent is set — no chapters will ever load",
    );
  }
  for (const [method, bit] of [
    ["getSearchForm", Intent.providesSearchForm],
    ["getSortOptions", Intent.providesSearchSortOptions],
    ["getPreferenceMenu", Intent.preferenceMenuBuilder],
    ["willRequestImage", Intent.imageRequestHandler],
    ["handleURL", Intent.canHandleURL],
  ]) {
    if (new RegExp(`\\b${method}\\s*\\(`).test(code)) {
      check(
        name,
        has(intents, bit),
        `${method} is written but its intent bit is clear — check that Target extends the class you edited`,
      );
    }
  }
  check(
    name,
    has(intents, Intent.pageLinkResolver) ||
      !/\bgetSectionsForPage\s*\(/.test(code) ||
      !/\bresolvePageSection\s*\(/.test(code),
    "getSectionsForPage and resolvePageSection are both written but the home page bit is clear",
  );

  // --- Removed API surface: these build cleanly and fail silently on the device.
  for (const [pattern, description] of REMOVED_API) {
    check(name, !pattern.test(code), `uses ${description}`);
  }

  // --- Runtime globals the bare V8 context does not have.
  for (const [pattern, description] of [
    [/\bnew URL\s*\(/, "`new URL` — the runtime has none; use UrlBuilder or resolveUrl"],
    [/\bnew URLSearchParams\s*\(/, "`URLSearchParams` — use withQuery"],
    [/\bcrypto\.subtle\b/, "`crypto.subtle` — use src/common/aes.ts"],
    [/\bnew TextDecoder\s*\(/, "`TextDecoder` — the runtime has none"],
    [/[^.\w]fetch\s*\(/, "`fetch` — use the NetworkClient"],
  ]) {
    check(name, !pattern.test(code), `uses ${description}`);
  }

  // --- A client that reads response.status has to let those statuses through.
  if (/response\.status|\.status\s*===?\s*(?:403|503)/.test(code)) {
    check(
      name,
      /setStatusValidator/.test(code) || /buildClient\s*\(/.test(code),
      "reads response.status without setStatusValidator — the host throws on non-2xx first",
    );
  }

  // --- Section styles: a style outside the enum renders as nothing in particular.
  const styles = [...code.matchAll(/SectionStyle\.(\w+)/g)].map((match) => match[1]);
  for (const style of new Set(styles)) {
    check(name, style in SectionStyle, `SectionStyle.${style} is not a style the app knows`);
  }

  return { name, files: files.length };
}

function main() {
  const argv = process.argv.slice(2);
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  const only = argv.filter((value, index) => {
    if (value.startsWith("--")) return false;
    return index !== baseIndex + 1 || baseIndex < 0;
  });

  const catalogPath = path.join(DIST, "sources.json");
  if (!fs.existsSync(catalogPath)) {
    console.error(`${RED}dist/sources.json not found — run "npm run build" first${RESET}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const changelog = read(path.join(ROOT, "CHANGELOG.md")) ?? "";

  // A Target in src/common/ would turn the shared runtime into an extension of its own.
  const commonFiles = sourceFiles(path.join(SRC, "common"));
  for (const file of commonFiles) {
    if (/\bclass Target\b/.test(read(file) ?? "")) {
      failures.push(`common: ${path.relative(ROOT, file)} declares a Target class`);
    }
  }

  const sources = catalog.sources.filter(
    (source) => only.length === 0 || only.includes(source.name),
  );
  if (sources.length === 0) {
    console.error(`${RED}no matching source in dist/sources.json${RESET}`);
    process.exit(1);
  }

  console.log();
  for (const source of sources) {
    const before = failures.length;
    const beforeWarnings = warnings.length;
    const { files } = checkSource(source, catalog, changelog, base);
    const broke = failures.length - before;
    const flagged = warnings.length - beforeWarnings;
    const mark = broke > 0 ? `${RED}FAIL${RESET}` : `${GREEN}PASS${RESET}`;
    const note = flagged > 0 ? ` ${YELLOW}${flagged} warning(s)${RESET}` : "";
    console.log(
      `  ${mark} ${source.name.padEnd(14)} ${DIM}v${source.version}, ${files} files${RESET}${note}`,
    );
  }

  if (warnings.length > 0) {
    console.log(`\n${YELLOW}Warnings${RESET}`);
    for (const warning of warnings) console.log(`  ${warning}`);
  }

  if (failures.length > 0) {
    console.log(`\n${RED}Failures${RESET}`);
    for (const failure of failures) console.log(`  ${failure}`);
    console.log(`\n${RED}${failures.length} rule(s) broken${RESET}\n`);
    process.exit(1);
  }

  console.log(`\n${GREEN}every source follows the repository's rules${RESET}\n`);
}

main();
