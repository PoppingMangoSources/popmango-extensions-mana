import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const email = "297959108+PoppingMangoSources@users.noreply.github.com";
const names = ["Popmango Extensions", "PoppingMangoSources"];
const problems = [];

function checkIdentity(identity, label) {
  const match = /^(.*) <([^>]+)> \d+ [+-]\d{4}$/.exec(identity);
  if (!match || !names.includes(match[1]) || match[2] !== email) {
    problems.push(`${label}: use the PoppingMangoSources identity (run 'bun run hooks')`);
  }
}

function checkMessage(message, label) {
  if (
    /^\s*(?:co-authored-by|assisted-by|signed-off-by|[\w-]*session[\w-]*|generated(?:[ -]by)?|authored-by|committed-by)\s*:/im.test(
      message,
    ) ||
    /\b(?:generated|authored|co-authored|assisted) (?:with|by)\b/i.test(message) ||
    /\b(?:claude|anthropic|chatgpt|openai|copilot|codex)\b/i.test(message) ||
    /https?:\/\/\S*(?:session[_/-]|\/sessions\/)/i.test(message)
  ) {
    problems.push(
      `${label}: remove attribution trailers, generated-by footers and agent/session links`,
    );
  }
}

function checkCommit(sha) {
  const raw = git("cat-file", "commit", sha);
  const split = raw.indexOf("\n\n");
  const headers = raw.slice(0, split);
  const label = sha.slice(0, 12);
  checkIdentity(headers.match(/^author (.*)$/m)?.[1] ?? "", `${label} author`);
  checkIdentity(headers.match(/^committer (.*)$/m)?.[1] ?? "", `${label} committer`);
  if (/^gpgsig(?:-sha256)? /m.test(headers)) problems.push(`${label}: commits must be unsigned`);
  checkMessage(raw.slice(split + 2), label);
}

function checkRange(range) {
  for (const sha of git("rev-list", range).split("\n").filter(Boolean)) checkCommit(sha);
}

function checkPush(before, after) {
  if (/^0+$/.test(after)) return;
  if (!before || /^0+$/.test(before)) {
    // On a new branch, validate commits not already on another remote branch.
    const commits = git("rev-list", after, "--not", "--remotes=origin");
    for (const sha of commits.split("\n").filter(Boolean)) checkCommit(sha);
    checkCommit(after);
  } else {
    // Fail closed when the old tip is missing; a full checkout/fetch is required.
    checkRange(`${before}..${after}`);
    checkCommit(after);
  }
}

try {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === "--message" && first) {
    checkMessage(readFileSync(first, "utf8"), "commit message");
    checkIdentity(git("var", "GIT_AUTHOR_IDENT"), "author");
    checkIdentity(git("var", "GIT_COMMITTER_IDENT"), "committer");
  } else if (mode === "--range" && first) {
    checkRange(first);
  } else if (mode === "--push" && first && second) {
    checkPush(first, second);
  } else if (mode === "--pre-push") {
    for (const line of readFileSync(0, "utf8").trim().split("\n").filter(Boolean)) {
      const [, localSha, , remoteSha] = line.split(/\s+/);
      checkPush(remoteSha, localSha);
    }
  } else if (mode === "--event") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (event.pull_request) {
      checkRange(`${event.pull_request.base.sha}..${event.pull_request.head.sha}`);
      checkCommit(event.pull_request.head.sha);
    } else if (event.before && event.after) {
      // A force-push can leave the previous tip outside checkout's fetched history.
      if (
        !/^0+$/.test(event.before) &&
        spawnSync("git", ["cat-file", "-e", `${event.before}^{commit}`]).status !== 0
      ) {
        if (!/^[0-9a-f]{40,64}$/.test(event.before)) throw new Error("Invalid previous commit SHA");
        execFileSync("git", ["fetch", "--no-tags", "origin", event.before], { stdio: "inherit" });
      }
      checkPush(event.before, event.after);
    } else {
      checkCommit("HEAD");
    }
  } else if (!mode) {
    checkCommit("HEAD");
  } else {
    throw new Error(
      "Usage: check-commits.mjs [--message FILE | --range RANGE | --push BEFORE AFTER | --pre-push | --event]",
    );
  }
  if (problems.length) throw new Error([...new Set(problems)].join("\n"));
  console.log("Commit metadata passed.");
} catch (error) {
  console.error(`Commit metadata failed: ${error.message}`);
  process.exitCode = 1;
}
