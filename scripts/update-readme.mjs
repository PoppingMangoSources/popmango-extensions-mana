/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Regenerates the source table in README.md from the built manifest.
 *
 * The table lives between HTML comment markers so the surrounding prose is
 * hand-written and this only ever rewrites the list. Run it after a build:
 *
 *   npm run build && npm run readme
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, "dist", "sources.json");
const README = path.join(ROOT, "README.md");
const COUNT_BADGE = path.join(ROOT, "media", "badge-count-summer.svg");

const START = "<!-- sources:start -->";
const END = "<!-- sources:end -->";

const RATING_LABEL = ["Safe", "Mixed", "18+"];

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error("No dist/sources.json — run the build first.");
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const sources = [...(manifest.sources ?? [])]
    .filter((source) => source && source.name !== "Template")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  await writeReadme(sources);
  await writeCountBadge(sources.length);

  console.log(`Updated README.md and the count badge with ${sources.length} source(s).`);
}

/** Strips the scheme and any "www." so the link text reads as a bare domain. */
function displayHost(url) {
  return String(url ?? "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function iconPath(source) {
  const local = path.join("media", "sources", `${String(source.name).toLowerCase()}.png`);
  return existsSync(path.join(ROOT, local)) ? local : undefined;
}

function tableRow(source) {
  const icon = iconPath(source);
  const badge = icon ? `<img src="${icon}" width="22" align="top"/> ` : "";
  const host = displayHost(source.website);
  const site = host ? `[${host}](${source.website})` : "—";
  const rating = RATING_LABEL[Number(source.rating) || 0] ?? "Safe";

  return `| ${badge}**${source.name}** | ${site} | ${rating} | v${source.version} |`;
}

async function writeReadme(sources) {
  const readme = await readFile(README, "utf8");

  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md is missing the ${START} / ${END} markers.`);
  }

  const body = [
    "",
    `**${sources.length} source${sources.length === 1 ? "" : "s"} available for Mana.**`,
    "",
    "| Source | Site | Rating | Version |",
    "| :----- | :--- | :----- | :------ |",
    ...sources.map(tableRow),
    "",
  ].join("\n");

  const updated = readme.slice(0, start + START.length) + body + readme.slice(end);
  await writeFile(README, updated, "utf8");
}

/** Keeps the count on the README badge in step with the catalog. */
async function writeCountBadge(count) {
  if (!existsSync(COUNT_BADGE)) return;

  const svg = await readFile(COUNT_BADGE, "utf8");
  const updated = svg
    .replace(/aria-label="[^"]*"/, `aria-label="${count} Mana sources"`)
    .replace(/(<circle cx="212"[\s\S]*?<text[^>]*>)[^<]*(<\/text>)/, `$1${count}$2`);

  await writeFile(COUNT_BADGE, updated, "utf8");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
