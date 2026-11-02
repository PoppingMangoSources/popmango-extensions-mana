import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const run = (command, args, options = {}) => {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
};
const args = process.argv.slice(2);
let base;
try {
  if (args[0] === "--event") {
    run(process.execPath, ["scripts/check-commits.mjs", "--event"]);
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    base = event.pull_request?.base.sha ?? event.before;
  } else if (args[0] === "--pre-push") {
    const input = readFileSync(0, "utf8");
    run(process.execPath, ["scripts/check-commits.mjs", "--pre-push"], {
      input,
      stdio: ["pipe", "inherit", "inherit"],
    });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const updates = input
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/));
    const outgoing = updates.filter(([, sha]) => !/^0+$/.test(sha));
    if (!outgoing.length) process.exit(0);
    if (outgoing.some(([, sha]) => sha !== head))
      throw new Error("Validate and push each checked-out branch separately");
    base = outgoing.find(([, , , before]) => !/^0+$/.test(before))?.[3];
  } else if (args[0] === "--base" && args[1] && args.length === 2) {
    base = args[1];
    run(process.execPath, ["scripts/check-commits.mjs"]);
  } else if (args.length === 0) {
    base = "origin/main";
    run(process.execPath, ["scripts/check-commits.mjs"]);
  } else {
    throw new Error("Usage: validate.mjs [--event | --pre-push | --base REF]");
  }
  if (base && /^0+$/.test(base)) base = undefined;
  // A new branch still compares against main; a missing base is an error, never a skipped rule.
  base ??= "origin/main";
  execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "ignore" });
  const runner = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0 ? "bun" : "npm";
  run(process.execPath, ["scripts/check-repository.mjs"]);
  run(path.join(root, ".tools/actionlint"), ["-shellcheck=", "-pyflakes="]);
  for (const gate of ["lint", "format:check", "typecheck", "build"]) run(runner, ["run", gate]);
  run(process.execPath, ["scripts/check-sources.mjs", "--base", base]);
  for (const test of readdirSync("scripts")
    .filter((name) => /^test-.*\.mjs$/.test(name))
    .sort()) {
    const file = `scripts/${test}`;
    if (readFileSync(file, "utf8").startsWith("#!/usr/bin/env bun")) run("bun", [file]);
    else run(process.execPath, ["--test", file]);
  }
  const generated = ["README.md", "media/badge-count-summer.svg"];
  const before = generated.map((file) => readFileSync(file, "utf8"));
  run(process.execPath, ["scripts/update-readme.mjs"]);
  if (generated.some((file, index) => readFileSync(file, "utf8") !== before[index])) {
    throw new Error(
      "Generated README/catalog badge was stale; review and commit the regenerated files",
    );
  }
  console.log("\nAll repository gates passed.");
} catch (error) {
  console.error(`\nValidation failed: ${error.message}`);
  process.exitCode = 1;
}
