import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checker = join(root, "scripts/check-commits.mjs");
const owner = {
  GIT_AUTHOR_NAME: "Popmango Extensions",
  GIT_AUTHOR_EMAIL: "297959108+PoppingMangoSources@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Popmango Extensions",
  GIT_COMMITTER_EMAIL: "297959108+PoppingMangoSources@users.noreply.github.com",
};

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "mana-commits-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, ...owner, CI: "1" };
  const git = (...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const check = (args = [], input, extraEnv = {}) =>
    spawnSync(process.execPath, [checker, ...args], {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
      input,
    });
  const commit = (message, extraEnv = {}) => {
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        message,
      ],
      {
        cwd,
        env: { ...env, ...extraEnv },
        stdio: "pipe",
      },
    );
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  return { cwd, env, git, check, commit };
}

test("accept owner aliases and reject each unwanted attribution form", (t) => {
  const { check, commit } = fixture(t);
  commit("fix: keep the chapter order\n\nPreserve the order returned by the site.");
  assert.equal(check().status, 0);
  commit("fix: keep the order", {
    GIT_AUTHOR_NAME: "PoppingMangoSources",
    GIT_COMMITTER_NAME: "PoppingMangoSources",
  });
  assert.equal(check().status, 0);
  for (const footer of [
    "Co-Authored-By: Example <person@example.com>",
    "co-authored-by: Example <person@example.com>",
    "Assisted-by: Example",
    "Signed-off-by: Example <person@example.com>",
    "Claude-Session: https://example.com/session_123",
    "Generated with Claude Code",
    "Generated-by: Example",
    "https://example.com/code/session_123",
  ]) {
    commit(`fix: keep the order\n\n${footer}`);
    const result = check();
    assert.equal(result.status, 1, footer);
    assert.match(result.stderr, /remove attribution/);
  }
});

test("reject wrong author, committer and signature headers", (t) => {
  const { check, commit, git, cwd, env } = fixture(t);
  for (const overrides of [
    { GIT_AUTHOR_NAME: "Another person" },
    { GIT_COMMITTER_EMAIL: "someone@example.com" },
  ]) {
    commit("fix: keep the order", overrides);
    assert.equal(check().status, 1);
  }
  const sha = commit("fix: keep the order");
  const raw = git("cat-file", "commit", sha).replace(
    "\n\n",
    "\ngpgsig -----BEGIN PGP SIGNATURE-----\n fixture\n -----END PGP SIGNATURE-----\n\n",
  );
  const signed = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd,
    env,
    input: raw,
    encoding: "utf8",
  }).trim();
  const result = check(["--range", `${sha}..${signed}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be unsigned/);
});

test("inspect every outgoing commit, including an invalid commit behind a clean tip", (t) => {
  const { check, commit, git } = fixture(t);
  const base = commit("fix: initial state");
  commit("fix: intermediate change\n\nCo-Authored-By: Example <person@example.com>");
  const head = commit("fix: final change");
  assert.equal(check().status, 0);
  assert.equal(check(["--push", base, head]).status, 1);
  assert.equal(
    check(["--pre-push"], `refs/heads/main ${head} refs/heads/main ${base}\n`).status,
    1,
  );
  assert.equal(check(["--push", base, "0".repeat(40)]).status, 0);
  assert.equal(check(["--push", "f".repeat(40), head]).status, 1);
  // Older history on another branch does not become a new branch's violation.
  git("update-ref", "refs/remotes/origin/main", head);
  const clean = commit("fix: new branch change");
  assert.equal(check(["--push", "0".repeat(40), clean]).status, 0);
});

test("use actual push and pull-request event commits rather than the checkout merge", (t) => {
  const { check, commit, cwd } = fixture(t);
  const base = commit("fix: initial state");
  const bad = commit("fix: intermediate change\n\nAssisted-by: Example");
  const event = join(cwd, "event.json");
  for (const payload of [
    { before: base, after: bad },
    { pull_request: { base: { sha: base }, head: { sha: bad } } },
  ]) {
    writeFileSync(event, JSON.stringify(payload));
    assert.equal(check(["--event"], undefined, { GITHUB_EVENT_PATH: event }).status, 1);
  }
  commit("fix: clean checkout");
  writeFileSync(event, "{}");
  assert.equal(check(["--event"], undefined, { GITHUB_EVENT_PATH: event }).status, 0);
});

test("fetch the old tip after a force-push without checking removed commits", (t) => {
  const { check, commit, cwd, git, env } = fixture(t);
  const base = commit("fix: initial state");
  const removed = commit("fix: old change\n\nAssisted-by: Example");
  git("reset", "--hard", base);
  const head = commit("fix: replacement change");
  const checkout = join(cwd, "checkout");
  execFileSync("git", ["clone", "--no-local", cwd, checkout], { env, stdio: "pipe" });
  const missing = spawnSync("git", ["cat-file", "-e", removed], { cwd: checkout, env });
  assert.notEqual(missing.status, 0);
  const event = join(cwd, "force-push.json");
  writeFileSync(event, JSON.stringify({ before: removed, after: head }));
  const result = spawnSync(process.execPath, [checker, "--event"], {
    cwd: checkout,
    env: { ...env, GITHUB_EVENT_PATH: event },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(check(["--push", removed, head]).status, 0);
});

test("setup activates hooks and local unsigned owner defaults; hooks block invalid commits and pushes", (t) => {
  const { cwd, env, git, commit } = fixture(t);
  mkdirSync(join(cwd, "scripts"));
  mkdirSync(join(cwd, ".githooks"));
  for (const path of [
    "scripts/setup-git.mjs",
    "scripts/validate.mjs",
    "scripts/check-commits.mjs",
    ".githooks/commit-msg",
    ".githooks/pre-push",
  ]) {
    copyFileSync(join(root, path), join(cwd, path));
    if (path.startsWith(".githooks/")) chmodSync(join(cwd, path), 0o755);
  }
  execFileSync(process.execPath, [join(cwd, "scripts/setup-git.mjs")], { cwd, env });
  assert.equal(git("config", "--local", "core.hooksPath"), ".githooks");
  assert.equal(git("config", "--local", "user.email"), owner.GIT_AUTHOR_EMAIL);
  assert.equal(git("config", "--local", "user.name"), owner.GIT_AUTHOR_NAME);
  assert.equal(git("config", "--local", "commit.gpgsign"), "false");
  const base = commit("fix: initial state");
  const rejected = spawnSync(
    "git",
    [
      "commit",
      "--allow-empty",
      "-m",
      "fix: change\n\nCo-Authored-By: Example <person@example.com>",
    ],
    { cwd, env, encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  const bad = commit("fix: change\n\nAssisted-by: Example");
  const pushed = spawnSync("sh", [".githooks/pre-push"], {
    cwd,
    env,
    encoding: "utf8",
    input: `refs/heads/main ${bad} refs/heads/main ${base}\n`,
  });
  assert.notEqual(pushed.status, 0);
  assert.match(pushed.stderr, /remove attribution/);
  commit("fix: clean change");
  const message = join(cwd, "message");
  writeFileSync(message, "fix: clean change\n");
  const wrongIdentity = spawnSync("sh", [".githooks/commit-msg", message], {
    cwd,
    env: { ...env, GIT_AUTHOR_NAME: "Other" },
    encoding: "utf8",
  });
  assert.notEqual(wrongIdentity.status, 0);
});

test("project settings disable all three attribution channels", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  assert.deepEqual(settings.attribution, { commit: "", pr: "", sessionUrl: false });
});
