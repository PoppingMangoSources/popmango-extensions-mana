// @ts-check
"use strict";

/**
 * Contract test for a built Mana source.
 *
 * Loads `dist/sources/<Name>.mana` into a V8 context with host shims, then
 * exercises the methods the app actually calls and asserts the shape of what
 * comes back. A Cloudflare challenge reports SKIP rather than FAIL, so the
 * suite stays meaningful on protected sites.
 *
 *   node scripts/verify-source.mjs <Name> [--probe path] [--verbose]
 *   node scripts/verify-source.mjs --all
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ContentRating, PublicationStatus, SectionStyle } from "@mana-app/types";
import { ManaStore, createHttpBridge, decodeIntents } from "./harness/runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_SOURCES = path.join(ROOT, "dist", "sources");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

class Skip extends Error {}

function parseArgs(argv) {
  const args = { names: [], probe: undefined, verbose: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--verbose" || arg === "-v") args.verbose = true;
    else if (arg === "--probe") args.probe = argv[++i];
    else if (!arg.startsWith("-")) args.names.push(arg);
  }
  return args;
}

/**
 * `settings` in a probe seeds the key-value store the source reads its preferences from,
 * so a source can be driven under something other than its defaults. A source that only
 * ever makes sense at its defaults leaves it out and gets them.
 */
function loadTarget(bundlePath, settings = {}) {
  const code = fs.readFileSync(bundlePath, "utf-8");
  const store = new ManaStore(settings);

  const sandbox = {
    __manaHTTPBridge: createHttpBridge(),
    ObjectStore: store,
    SecureStore: new ManaStore(),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    AbortController,
    TextEncoder,
    TextDecoder,
    URL,
    Buffer,
    globalThis: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: path.basename(bundlePath) });

  const Target = context.Target;
  if (!Target) throw new Error(`No Target exported by ${path.basename(bundlePath)}`);
  return new Target();
}

/** A hero draws one big cover at a time; with too few it repeats the same one. */
const HERO_STYLES = new Set([SectionStyle.SimpleHero, SectionStyle.SimpleHeroPaged]);
const MIN_HERO_ITEMS = 3;
/** A home row is a strip, not a catalogue — past this it is a listing in the wrong place. */
const MAX_SECTION_ITEMS = 60;

function isCloudflare(error) {
  if (!error) return false;
  if (error.name === "CloudflareError") return true;
  const message = String(error.message ?? error);
  return /cloudflare|just a moment|challenge/i.test(message);
}

/** Wraps a step so a Cloudflare block becomes SKIP instead of FAIL. */
async function step(results, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "pass", detail, ms: Date.now() - started });
    return detail;
  } catch (error) {
    const status = isCloudflare(error) || error instanceof Skip ? "skip" : "fail";
    const message = String(error?.message ?? error);
    results.push({
      name,
      status,
      detail: message.split("\n")[0],
      // Some checks report a list — the first line only says how many, so the rest is
      // kept and printed under the row rather than thrown away.
      rest: message.split("\n").slice(1),
      ms: Date.now() - started,
    });
    return undefined;
  }
}

function firstLine(error) {
  return String(error?.message ?? error).split(String.fromCharCode(10))[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * The SDK's enums are numeric with a reverse mapping, so a value it can name is a value
 * the app understands. The bundler never checks types, so a source handing back the
 * enum's own key as a string — or the site's word for a status — builds and ships and
 * only goes wrong on the device.
 */
function checkEnum(enumeration, enumName, field, value, label) {
  if (value === undefined || value === null) return;

  const named = typeof value === "number" ? enumeration[value] : undefined;
  const allowed = Object.values(enumeration)
    .filter((entry) => typeof entry === "string")
    .join(", ");

  assert(
    named !== undefined,
    `${label}: ${field} is ${JSON.stringify(value)}, not a ${enumName} (${allowed})`,
  );
}

/** The symbol `@mana-app/types` dispatches an image request to a client through. */
const IMAGE_DISPATCH = Symbol.for("mana.http.image.v1");

/** `RequestOrigin.Cover` and `RequestOrigin.Page`. */
const Origin = { Cover: 1, Page: 2 };

/** The first bytes of every format a page or cover is served in. */
function isImage(bytes) {
  const at = (i) => bytes[i] ?? -1;
  return (
    (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) ||
    (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) ||
    (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) ||
    (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) ||
    (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) ||
    (at(0) === 0xff && at(1) === 0x0a) ||
    (at(4) === 0x4a && at(5) === 0x58 && at(6) === 0x4c && at(7) === 0x20)
  );
}

/**
 * Fetches a handful of images and reports the ones that do not come back as one.
 *
 * A source with a cover or page transport is telling the app how to ask for its images —
 * a referer a CDN refuses to serve without, or a page to decrypt on the way in — so the
 * image goes through that client exactly as the app would send it, and what is checked is
 * what the app would be handed to decode.
 */
async function checkImages(images, target) {
  const broken = [];
  for (const { url, origin } of images) {
    try {
      const hook = origin === Origin.Page ? target?.getPageTransport : target?.getCoverTransport;
      if (typeof hook !== "function") {
        const response = await fetch(url);
        const type = response.headers.get("content-type") ?? "";
        // What this is looking for is a 404 or an HTML error page dressed as a 200. Some
        // image proxies answer without a content-type at all, and calling those unreachable
        // reports a cover that renders perfectly well in the app as broken.
        if (!(response.ok && (type === "" || type.startsWith("image/")))) {
          broken.push(`${url} -> HTTP ${response.status} ${type}`);
        }
        continue;
      }

      const client = hook.call(target, { url, origin });
      const response = await client[IMAGE_DISPATCH]({ url, origin });
      if (!response.ok) {
        broken.push(`${url} -> HTTP ${response.status}`);
        continue;
      }
      const bytes = await response.bytes();
      if (!isImage(bytes)) {
        const head = [...bytes.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0"));
        broken.push(`${url} -> not an image (starts ${head.join(" ")})`);
      }
    } catch (error) {
      broken.push(`${url} -> ${firstLine(error)}`);
    }
  }
  return broken;
}

function checkHighlights(results, label) {
  assert(Array.isArray(results), `${label}: results is not an array`);
  assert(results.length > 0, `${label}: returned 0 results`);
  for (const item of results) {
    assert(item && typeof item.id === "string" && item.id.length > 0, `${label}: item missing id`);
    assert(typeof item.title === "string" && item.title.length > 0, `${label}: item missing title`);
    checkEnum(ContentRating, "ContentRating", "contentRating", item.contentRating, label);
  }
  const withCover = results.filter((item) => item.cover).length;
  return `${results.length} results, ${withCover} with covers`;
}

function checkSearchForm(form) {
  assert(form && Array.isArray(form.sections), "getSearchForm did not return { sections }");
  const ids = [];
  for (const section of form.sections) {
    for (const field of section.children ?? []) ids.push(field.id);
    if (section.field) ids.push(section.field.id);
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert(duplicates.length === 0, `duplicate field ids: ${duplicates.join(", ")}`);
  return `${form.sections.length} sections, ${ids.length} fields`;
}

/** The bundle runs in its own vm realm, so `instanceof Date` would be false here. */
function isValidDate(value) {
  if (!value) return false;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return !Number.isNaN(value.getTime());
  }
  return typeof value.getTime === "function" && !Number.isNaN(value.getTime());
}

function checkChapters(chapters) {
  assert(Array.isArray(chapters), "getChapters did not return an array");
  assert(chapters.length > 0, "getChapters returned 0 chapters");
  chapters.forEach((chapter, at) => {
    assert(typeof chapter.chapterId === "string" && chapter.chapterId, `chapter ${at}: no id`);
    assert(Number.isFinite(chapter.number), `chapter ${at}: number is not finite`);
    assert(
      Number.isInteger(chapter.index),
      `chapter ${at}: index ${chapter.index} is not an integer`,
    );
    assert(isValidDate(chapter.date), `chapter ${at}: bad date`);
  });

  // `index` is a chapter's place in the run, not its place in this array: a source that
  // serves its list newest-first still numbers from the oldest chapter. So the indices are
  // checked as a set — 0 to n-1, each used once — whatever order they arrive in.
  const indices = new Set(chapters.map((chapter) => chapter.index));
  assert(indices.size === chapters.length, "chapter indices are not unique");
  const gap = chapters.findIndex((_, position) => !indices.has(position));
  assert(gap === -1, `chapter indices are not contiguous from 0 — ${gap} is missing`);
  const dated = chapters.filter((c) => c.date.getTime() > 0).length;
  return `${chapters.length} chapters, ${dated} with real dates`;
}

async function verify(name, probe, verbose) {
  const bundlePath = path.join(DIST_SOURCES, `${name}.mana`);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`${bundlePath} not found — run "bun run build" first`);
  }

  const target = loadTarget(bundlePath, probe.settings ?? {});
  if (target.onEnvironmentLoaded) await target.onEnvironmentLoaded();

  const results = [];
  const meta = { name, info: target.info, intents: undefined };
  // What the app would put in front of the reader, kept so the rules below can judge the
  // page as a whole rather than each call on its own.
  const preview = { sections: [], search: [], content: undefined, pages: [] };

  await step(results, "info", async () => {
    assert(target.info?.id, "info.id missing");
    assert(target.info?.version, "info.version missing");
    // The toolchain packages only the project-root assets/ folder, so a
    // thumbnail is a bare filename in it. Checking the built file exists is
    // what catches an icon that silently renders as a placeholder in the app.
    const thumb = target.info.thumbnail ?? "";
    if (thumb && !thumb.startsWith("http")) {
      assert(
        !thumb.includes("/"),
        `thumbnail "${thumb}" must be a filename in assets/, not a path`,
      );
      assert(
        fs.existsSync(path.join(ROOT, "dist", "assets", thumb)),
        `dist/assets/${thumb} is missing — put the icon in the project-root assets/ folder`,
      );
    }
    return `${target.info.id} v${target.info.version}`;
  });

  if (target.getSearchForm) {
    await step(results, "getSearchForm", async () => checkSearchForm(await target.getSearchForm()));
  }

  if (target.getSortOptions) {
    await step(results, "getSortOptions", async () => {
      const options = await target.getSortOptions();
      assert(Array.isArray(options) && options.length > 0, "no sort options returned");
      return `${options.length} options`;
    });
  }

  if (target.getPreferenceMenu) {
    await step(results, "getPreferenceMenu", async () => {
      const form = await target.getPreferenceMenu();
      assert(form && Array.isArray(form.sections), "no sections returned");
      return `${form.sections.length} sections`;
    });
  }

  let sections = [];
  if (target.getSectionsForPage && target.resolvePageSection) {
    sections =
      (await step(results, "getSectionsForPage", async () => {
        const found = await target.getSectionsForPage({ id: "home" });
        assert(Array.isArray(found) && found.length > 0, "no sections returned");
        for (const section of found) {
          checkEnum(SectionStyle, "SectionStyle", "style", section.style, `section ${section.id}`);
        }
        return found;
      })) ?? [];

    if (Array.isArray(sections)) {
      if (target.willResolveSectionsForPage) {
        await step(results, "willResolveSectionsForPage", async () => {
          await target.willResolveSectionsForPage({ id: "home" });
          return "ok";
        });
      }
      for (const section of sections) {
        await step(results, `resolvePageSection(${section.id})`, async () => {
          const resolved = await target.resolvePageSection({ id: "home" }, section.id);
          const detail = checkHighlights(resolved?.items, section.id);
          preview.sections.push({ section, items: resolved.items });
          return detail;
        });
      }
    }
  }

  const searched = await step(results, "search", async () => {
    const page = await target.search({ page: 1, query: probe.query ?? "" });
    assert(typeof page?.isLastPage === "boolean", "isLastPage missing");
    const detail = checkHighlights(page.results, "search");
    preview.search = page.results;
    return detail;
  });

  const contentId = probe.contentId;
  if (!contentId) {
    results.push({
      name: "getContent",
      status: "skip",
      detail: "no contentId in probe",
      ms: 0,
    });
  } else {
    await step(results, "getContent", async () => {
      const content = await target.getContent(contentId);
      assert(content?.title, "content.title is empty");
      assert(content?.cover !== undefined, "content.cover missing");
      checkEnum(ContentRating, "ContentRating", "contentRating", content.contentRating, "content");
      checkEnum(PublicationStatus, "PublicationStatus", "status", content.status, "content");
      preview.content = content;
      return `"${content.title}"${content.cover ? "" : " (no cover)"}`;
    });

    // The step reports whatever its body returns, and the later steps need the list, so the
    // list is kept aside and the row is given the summary it would otherwise have swallowed.
    let chapters;
    if (target.getChapters) {
      await step(results, "getChapters", async () => {
        chapters = await target.getChapters(contentId);
        return checkChapters(chapters);
      });
    }

    const chapterId =
      probe.chapterId ?? (Array.isArray(chapters) ? chapters[0]?.chapterId : undefined);

    if (chapterId) {
      await step(results, "getChapterData", async () => {
        // Some sources read pages through a third party that may have nothing
        // for a given issue. `"pagesDependOnUpstream": true` in the probe marks
        // that as SKIP-with-reason instead of a failure, so a genuine parsing
        // break still shows up as FAIL.
        //
        // `"pagesNeedWebView": true` marks the other case: a site that hands its page
        // list only to its own loaded page. There is no browser here to be that page, so
        // the call cannot succeed and its failure says nothing about the source.
        let data;
        try {
          data = await target.getChapterData(contentId, chapterId);
        } catch (error) {
          if (probe.pagesNeedWebView) {
            throw new Skip("the page list is read through a WebView this harness cannot drive");
          }
          if (probe.pagesDependOnUpstream) {
            throw new Skip(`upstream has no pages: ${firstLine(error)}`);
          }
          throw error;
        }
        assert(Array.isArray(data?.pages), "pages is not an array");
        assert(data.pages.length > 0, "0 pages returned");
        for (const page of data.pages) {
          assert(page.url || page.raw, "page has neither url nor raw");
        }
        preview.pages = data.pages;
        return `${data.pages.length} pages`;
      });
    }
  }

  // Every rule here is a break that shipped green: each call answered the right shape and
  // the home page was still wrong in the app.
  if (preview.sections.length > 0) {
    await step(results, "home page", async () => {
      const problems = [];

      for (const { section, items } of preview.sections) {
        if (items.length === 0) {
          problems.push(`"${section.title}" returned nothing.`);
        } else if (HERO_STYLES.has(section.style) && items.length < MIN_HERO_ITEMS) {
          problems.push(
            `"${section.title}" is a hero with ${items.length} item(s) — the app repeats one cover across the carousel.`,
          );
        }
        if (items.length > MAX_SECTION_ITEMS) {
          problems.push(
            `"${section.title}" returns ${items.length} items — a home row is a strip, not a listing.`,
          );
        }
      }

      // Rows are not compared against each other. This used to fail two whose first five
      // titles matched, on the theory that it was one query wearing two names — and it only
      // ever caught rows that were asking different questions and getting the same answer
      // that day: `period=week` against `period=month`, `sort=score` against `sort=reviews`,
      // two separate arrays out of one home payload. What a row asks for is not visible from
      // what came back, and the site agreeing with itself is not a source's bug.

      assert(
        problems.length === 0,
        `${problems.length} problem(s)\n      ${problems.join("\n      ")}`,
      );
      return `${preview.sections.length} sections, none empty, repeating or overlong`;
    });
  }

  // A shape check passes happily on a cover URL that 404s, which is a blank grid for the
  // reader. Sample what the source actually produced and fetch it.
  const sampled = [
    ...preview.sections.flatMap((entry) =>
      entry.items.slice(0, 1).map((item) => ({ url: item.cover, origin: Origin.Cover })),
    ),
    { url: preview.search[0]?.cover, origin: Origin.Cover },
    { url: preview.content?.cover, origin: Origin.Cover },
    { url: preview.pages[0]?.url, origin: Origin.Page },
  ].filter(({ url }) => typeof url === "string" && url.startsWith("http"));

  if (sampled.length > 0) {
    await step(results, "images", async () => {
      const broken = await checkImages(sampled, target);
      assert(broken.length === 0, `unreachable image(s):\n      ${broken.join("\n      ")}`);
      return `${sampled.length} sampled, all served`;
    });
  }

  return { meta, results, verbose, preview };
}

function report(name, results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  console.log(`\n${name}`);
  for (const result of results) {
    counts[result.status]++;
    const color = result.status === "pass" ? GREEN : result.status === "fail" ? RED : YELLOW;
    const mark = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "SKIP";
    const detail =
      typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? "" : "";
    console.log(
      `  ${color}${mark}${RESET} ${result.name.padEnd(32)} ${DIM}${detail} (${result.ms}ms)${RESET}`,
    );
    for (const line of result.rest ?? []) {
      if (line.trim()) console.log(`       ${DIM}${line.trim()}${RESET}`);
    }
  }
  return counts;
}

function loadProbe(name, override) {
  const probePath = override ?? path.join(ROOT, "scripts", "probes", `${name}.json`);
  if (!fs.existsSync(probePath)) return {};
  return JSON.parse(fs.readFileSync(probePath, "utf-8"));
}

function sourceDirs() {
  const manifestPath = path.join(ROOT, "dist", "sources.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return (manifest.sources ?? []).map((s) => s.name).filter((n) => n !== "Template");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.all ? sourceDirs() : args.names;

  if (names.length === 0) {
    console.error("usage: node scripts/verify-source.mjs <Name> [--probe path] | --all");
    process.exit(2);
  }

  const totals = { pass: 0, fail: 0, skip: 0 };

  for (const name of names) {
    const probe = loadProbe(name, args.probe);
    try {
      const { results } = await verify(name, probe, args.verbose);
      const counts = report(name, results);
      totals.pass += counts.pass;
      totals.fail += counts.fail;
      totals.skip += counts.skip;
    } catch (error) {
      console.log(`\n${name}\n  ${RED}FAIL${RESET} could not load: ${error.message}`);
      totals.fail++;
    }
  }

  console.log(
    `\n${GREEN}${totals.pass} passed${RESET}, ${RED}${totals.fail} failed${RESET}, ${YELLOW}${totals.skip} skipped${RESET}`,
  );
  process.exit(totals.fail > 0 ? 1 : 0);
}

main();
