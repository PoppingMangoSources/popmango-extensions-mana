import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSync } from "oxc-parser";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const houseMarks = new Set(["🗨︎", "🔒", "🔗"]);
export function sourceProblems(code, file) {
  const parsed = parseSync(file, code);
  const errors = parsed.errors.map((error) => `${file}: ${error.message}`);
  const visit = (node, parents = []) => {
    const line = code.slice(0, node.start).split("\n").length;
    const fail = (message) => errors.push(`${file}:${line}: ${message}`);
    const inWebView = parents.some(
      (parent) =>
        parent.type === "CallExpression" &&
        parent.callee.type === "MemberExpression" &&
        parent.callee.property.name === "evaluate",
    );
    if (node.type === "TSAnyKeyword") fail("explicit any is forbidden");
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      !houseMarks.has(node.value) &&
      /[\u{1f1e6}-\u{1faff}\ufe0f]/u.test(node.value)
    )
      fail("decorative emoji is forbidden in source strings");
    if (
      node.type === "Property" &&
      (node.key.name ?? node.key.value) === "optional" &&
      !(node.value.type === "Literal" && node.value.value === true)
    )
      fail("optional must be true or omitted");
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      ["fetch", "atob", "btoa"].includes(node.callee.name) &&
      !inWebView
    ) {
      fail("use the shared runtime helpers outside a serialized WebView function");
    }
    if (
      node.type === "MemberExpression" &&
      !inWebView &&
      (node.object.name === "Buffer" ||
        (node.object.name === "crypto" && node.property.name === "subtle"))
    )
      fail("use the host cipher/byte APIs");
    if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
      const body = node.arguments[1];
      if (
        node.callee.property.name === "post" &&
        body?.type === "CallExpression" &&
        body.callee.object?.name === "JSON" &&
        body.callee.property?.name === "stringify"
      )
        fail("POST objects must use Body.json or Body.form");
      if (
        node.callee.property.name === "evaluateScript" &&
        parents.some((parent) =>
          [
            "WhileStatement",
            "ForStatement",
            "ForOfStatement",
            "ForInStatement",
            "DoWhileStatement",
          ].includes(parent.type),
        )
      )
        fail("repeated WebView calls must use evaluate");
    }
    if (node.type === "NewExpression" && node.callee.type === "Identifier") {
      if (
        ["URL", "URLSearchParams", "TextEncoder", "TextDecoder"].includes(node.callee.name) &&
        !inWebView
      )
        fail("use the shared URL/byte/query helpers");
      if (
        node.callee.name === "HttpClient" &&
        parents.some(
          (parent) =>
            parent.type === "MethodDefinition" &&
            ["getCoverTransport", "getPageTransport", "onEnvironmentLoaded"].includes(
              parent.key.name,
            ),
        )
      )
        fail("keep the client outside host-call methods");
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child, [...parents, node]);
      } else if (value?.type) visit(value, [...parents, node]);
    }
  };
  visit(parsed.program);
  return errors;
}

export function workflowProblems(text, file) {
  const parsed = parseDocument(text, { uniqueKeys: true });
  const errors = parsed.errors.map((error) => `${file}: ${error.message}`);
  if (errors.length) return errors;
  const workflow = parsed.toJS();
  for (const job of Object.values(workflow.jobs ?? {})) {
    const steps = job.steps ?? [];
    const publishes = steps.some((step) => step.uses?.startsWith("peaceiris/actions-gh-pages@"));
    if (publishes || workflow.name === "Test" || path.basename(file) === "test.yaml") {
      const index = steps.findIndex((step) => step.run?.trim() === "bun run validate --event");
      if (
        index < 0 ||
        Object.hasOwn(steps[index], "if") ||
        steps[index]["continue-on-error"] ||
        job["continue-on-error"]
      ) {
        errors.push(`${file}: a mandatory unified validation step is required`);
      }
      if (
        publishes &&
        steps.findIndex((step) => step.uses?.startsWith("peaceiris/actions-gh-pages@")) < index
      ) {
        errors.push(`${file}: publishing must follow validation`);
      }
      if (
        !steps.some(
          (step) => step.uses?.startsWith("actions/checkout@") && step.with?.["fetch-depth"] === 0,
        )
      ) {
        errors.push(`${file}: commit/version checks require full checkout history`);
      }
    }
    for (const step of steps) {
      if (step.run?.includes("${{"))
        errors.push(
          `${file}: pass workflow expressions through env rather than shell interpolation`,
        );
    }
  }
  return errors;
}

export function markdownProblems(text, file, directory = root) {
  const errors = [];
  // Fenced examples can contain example-only paths rather than links.
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "");
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z]+:|#|\/)/i.test(link)) continue;
    const target = decodeURIComponent(link.split("#")[0]);
    if (target && !fs.existsSync(path.resolve(directory, path.dirname(file), target)))
      errors.push(`${file}: broken local link ${link}`);
  }
  return errors;
}

export function checkRepository(directory = root) {
  const read = (file) => fs.readFileSync(path.join(directory, file), "utf8");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: directory,
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  const errors = [];
  for (const file of [
    ".github/workflows/test.yaml",
    ".github/workflows/bundle-deploy.yaml",
    ".github/workflows/test-deploy.yaml",
    ".github/workflows/contract.yaml",
    ".github/workflows/codeql.yaml",
    ".claude/skills/mana-extension/SKILL.md",
    ".claude/skills/mana-port/SKILL.md",
    ".claude/skills/mana-images/SKILL.md",
    ".claude/skills/verify/SKILL.md",
  ]) {
    if (!fs.existsSync(path.join(directory, file)))
      errors.push(`${file}: required repository guidance/check is missing`);
  }
  if (read("CLAUDE.md").trim() !== "@AGENTS.md")
    errors.push("CLAUDE.md must import the canonical AGENTS.md");
  if (
    !fs.lstatSync(path.join(directory, ".agents/skills")).isSymbolicLink() ||
    fs.readlinkSync(path.join(directory, ".agents/skills")) !== "../.claude/skills"
  )
    errors.push("agent skill folders must share the canonical symlink");
  const config = JSON.parse(read("tsconfig.json")).compilerOptions;
  for (const key of [
    "strict",
    "noUncheckedIndexedAccess",
    "noFallthroughCasesInSwitch",
    "noImplicitOverride",
  ]) {
    if (config[key] !== true) errors.push(`tsconfig.json: ${key} must stay enabled`);
  }
  const settings = JSON.parse(read(".claude/settings.json"));
  if (
    settings.attribution?.commit !== "" ||
    settings.attribution?.pr !== "" ||
    settings.attribution?.sessionUrl !== false
  )
    errors.push("all attribution channels must remain disabled");
  const commands = JSON.parse(read("package.json")).scripts;
  if (commands.validate !== "node scripts/validate.mjs")
    errors.push("validate must run the canonical gate");
  for (const key of ["hooks", "prepare"])
    if (commands[key] !== "node scripts/setup-git.mjs")
      errors.push(`${key} must configure repository hooks`);
  if (
    read(".githooks/pre-push").trim() !==
    '#!/bin/sh\nset -e\ncd "$(git rev-parse --show-toplevel)"\nexec node scripts/validate.mjs --pre-push'
  )
    errors.push("pre-push must invoke the mandatory gate without CI bypasses");
  for (const file of files) {
    if (!fs.existsSync(path.join(directory, file))) continue;
    if (/^(?:src\/).*\.ts$/.test(file)) errors.push(...sourceProblems(read(file), file));
    if (file.endsWith(".md") && file !== "CHANGELOG.md")
      errors.push(...markdownProblems(read(file), file, directory));
    if (file.endsWith("/SKILL.md")) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(file));
      const doc = parseDocument(frontmatter?.[1] ?? "");
      const meta = doc.toJS();
      if (
        doc.errors.length ||
        !meta?.name ||
        !meta?.description ||
        meta.name !== path.basename(path.dirname(file))
      )
        errors.push(`${file}: valid name/description frontmatter is required`);
    }
    if (/^\.github\/workflows\/.*\.ya?ml$/.test(file))
      errors.push(...workflowProblems(read(file), file));
    if (/\.(?:mjs|js)$/.test(file)) {
      try {
        execFileSync(process.execPath, ["--check", path.join(directory, file)], { stdio: "pipe" });
      } catch {
        errors.push(`${file}: script syntax check failed`);
      }
    }
  }
  for (const file of [".githooks/commit-msg", ".githooks/pre-push"]) {
    if (!(fs.statSync(path.join(directory, file)).mode & 0o111))
      errors.push(`${file}: hook must be executable`);
    try {
      execFileSync("sh", ["-n", path.join(directory, file)], { stdio: "pipe" });
    } catch {
      errors.push(`${file}: shell syntax check failed`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkRepository();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log("Repository structure, guides, workflows, scripts and source AST checks passed.");
}
