import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const version = "1.7.12";
const targets = {
  "linux-x64": ["linux_amd64", "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"],
  "linux-arm64": [
    "linux_arm64",
    "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
  ],
  "darwin-x64": [
    "darwin_amd64",
    "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
  ],
  "darwin-arm64": [
    "darwin_arm64",
    "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  ],
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("Install actionlint 1.7.12 manually for this platform");
const directory = path.join(root, ".tools");
const binary = path.join(directory, "actionlint");
if (
  existsSync(binary) &&
  execFileSync(binary, ["--version"], { encoding: "utf8" }).startsWith(version)
) {
  process.exit(0);
}
mkdirSync(directory, { recursive: true });
const archive = path.join(directory, "actionlint.tar.gz");
try {
  const name = `actionlint_${version}_${target[0]}.tar.gz`;
  const response = await fetch(
    `https://github.com/rhysd/actionlint/releases/download/v${version}/${name}`,
  );
  if (!response.ok) throw new Error(`actionlint download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== target[1])
    throw new Error("actionlint checksum mismatch");
  writeFileSync(archive, bytes);
  execFileSync("tar", ["--no-same-owner", "-xzf", archive, "-C", directory, "actionlint"]);
  console.log(`Installed actionlint ${version}`);
} finally {
  rmSync(archive, { force: true });
}
