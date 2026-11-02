import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
for (const [key, value] of Object.entries({
  "user.name": "Popmango Extensions",
  "user.email": "297959108+PoppingMangoSources@users.noreply.github.com",
  "commit.gpgsign": "false",
  "core.hooksPath": ".githooks",
})) {
  execFileSync("git", ["config", "--local", key, value], { cwd });
}
