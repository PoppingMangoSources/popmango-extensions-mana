import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { markdownProblems, sourceProblems, workflowProblems } from "./check-repository.mjs";
import { verify } from "./verify-source.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("parse source rules as code, excluding comments and strings", () => {
  assert.deepEqual(
    sourceProblems('// const x: any = fetch("url");\nconst x = "optional: false";', "file.ts"),
    [],
  );
  for (const code of [
    "const x: any = 1;",
    "const x = { optional: false };",
    "fetch('url');",
    "new TextDecoder();",
    "class S { getPageTransport() { return new HttpClient(); } }",
  ]) {
    assert.ok(sourceProblems(code, "file.ts").length > 0, code);
  }
  assert.deepEqual(
    sourceProblems(
      'page.evaluate(async () => { const r = await fetch("url"); return r.text(); });',
      "file.ts",
    ),
    [],
  );
  assert.deepEqual(
    sourceProblems(
      "const client = new HttpClient(); class S { getPageTransport() { return client; } }",
      "file.ts",
    ),
    [],
  );
});

const workflow = `name: Test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: bun run validate --event
`;
test("reject skipped, missing, interpolated and duplicate workflow validation", () => {
  assert.deepEqual(workflowProblems(workflow, "test.yaml"), []);
  for (const broken of [
    workflow.replace("bun run validate --event", "echo skipped"),
    workflow.replace(
      "      - run: bun run validate --event",
      "      - if: false\n        run: bun run validate --event",
    ),
    workflow.replace(
      "      - run: bun run validate --event",
      "      - continue-on-error: true\n        run: bun run validate --event",
    ),
    workflow.replace("fetch-depth: 0", "fetch-depth: 1"),
    workflow.replace("bun run validate --event", "echo ${{ inputs.source }}"),
    workflow + "name: duplicate\n",
  ])
    assert.ok(workflowProblems(broken, "test.yaml").length > 0, broken);
  const publishFirst = workflow
    .replace("name: Test", "name: Deploy")
    .replace(
      "      - run: bun run validate --event",
      "      - uses: peaceiris/actions-gh-pages@v4\n      - run: bun run validate --event",
    );
  assert.ok(
    workflowProblems(publishFirst, "deploy.yaml").some((error) =>
      error.includes("publishing must follow"),
    ),
  );
});

test("local documentation links must resolve from their actual location", (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "mana-docs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "AGENTS.md"), "rules");
  assert.deepEqual(markdownProblems("[rules](AGENTS.md)", "README.md", directory), []);
  assert.equal(markdownProblems("[rules](missing.md)", "README.md", directory).length, 1);
});

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), "mana-source-rules-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  };
  fs.symlinkSync(path.join(root, "node_modules"), path.join(cwd, "node_modules"), "dir");
  write(
    "scripts/check-sources.mjs",
    fs.readFileSync(path.join(root, "scripts/check-sources.mjs"), "utf8"),
  );
  write("assets/Fake.png", "image");
  write("dist/assets/Fake.png", "image");
  write("media/sources/fake.png", "image");
  write(
    "scripts/probes/Fake.json",
    JSON.stringify({ query: "title", contentId: "", chapterId: "" }),
  );
  fs.mkdirSync(path.join(cwd, "src/common"), { recursive: true });
  const source = (version, suffix = "", id = "fake") => {
    write(
      "src/Fake/main.ts",
      `const info = { id: "${id}", version: "${version}" }; export class Target { getChapters() {} } ${suffix}`,
    );
    write(
      "dist/sources.json",
      JSON.stringify({
        sources: [
          {
            id,
            name: "Fake",
            path: "Fake",
            version,
            thumbnail: "Fake.png",
            supportedLanguages: ["en_US"],
            environment: "source",
            intents: 2 ** 21,
          },
        ],
      }),
    );
  };
  source("1.0.0");
  write("CHANGELOG.md", "## Fake (current: v1.0.0)\n\n### Added\n- Added the source.\n");
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("add", "src", "CHANGELOG.md");
  git("-c", "commit.gpgsign=false", "commit", "-qm", "Initial source");
  const check = () =>
    spawnSync(process.execPath, ["scripts/check-sources.mjs", "--base", "HEAD"], {
      cwd,
      encoding: "utf8",
    });
  return { cwd, write, source, check, git };
}

test("changed source must bump exactly one patch and add its CHANGELOG entry", (t) => {
  const { source, check, write } = fixture(t);
  assert.equal(check().status, 0);
  source("1.0.0", "// changed implementation");
  assert.equal(check().status, 1, "unchanged version cannot hide a source edit");
  source("1.1.0");
  assert.equal(check().status, 1, "minor bump rejected");
  source("1.0.2");
  assert.equal(check().status, 1, "skipped patch rejected");
  source("1.0.1");
  assert.equal(check().status, 1, "missing changelog rejected");
  write("CHANGELOG.md", "## Fake (current: v1.0.1)\n\n### Fixed\n- Fixed the source.\n");
  assert.equal(check().status, 0);
  source("1.0.1", "", "renamed");
  assert.equal(check().status, 1, "saved source identity cannot change");
});

test("missing catalog entries, probe queries, icons and languages fail", (t) => {
  const { source, check, write, cwd } = fixture(t);
  write("dist/sources.json", JSON.stringify({ sources: [] }));
  assert.equal(check().status, 1);
  source("1.0.0");
  write("scripts/probes/Fake.json", "{}");
  assert.equal(check().status, 1);
  write("scripts/probes/Fake.json", '{"query":"title"}');
  const catalog = JSON.parse(fs.readFileSync(path.join(cwd, "dist/sources.json"), "utf8"));
  catalog.sources[0].supportedLanguages = [];
  write("dist/sources.json", JSON.stringify(catalog));
  assert.equal(check().status, 1);
  source("1.0.0");
  fs.rmSync(path.join(cwd, "assets/Fake.png"));
  assert.equal(check().status, 1);
});

test("blank probe ids still exercise details, chapters and reader using search results", async (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "mana-contract-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, "Fixture.mana");
  fs.writeFileSync(
    bundle,
    `globalThis.Target = class {
    info = { id: "fixture", name: "Fixture", version: "1.0.0" };
    async search() { return { isLastPage: true, results: [{ id: "title", title: "Title", cover: "" }] }; }
    async getContent(id) { if (id !== "title") throw Error("wrong title"); return { title: "Title", cover: "" }; }
    async getChapters() { return [{ chapterId: "chapter", title: "Chapter 1", number: 1, index: 0, date: new Date(1000) }]; }
    async getChapterData(id, chapter) { if (id !== "title" || chapter !== "chapter") throw Error("reader was not selected"); return { text: "A chapter of text" }; }
  };`,
  );
  const { results } = await verify(
    "Fixture",
    { query: "title", contentId: "", chapterId: "" },
    false,
    bundle,
  );
  for (const name of ["getContent", "getChapters", "getChapterData"])
    assert.equal(results.find((result) => result.name === name)?.status, "pass", name);
});
