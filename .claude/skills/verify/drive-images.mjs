// @ts-check
/**
 * Sends image requests through a built source's own cover or page transport, the way the app
 * does, against a local server — so pacing, headers and decryption can be watched without the
 * site, which a sandbox usually cannot reach.
 *
 *   node .claude/skills/verify/drive-images.mjs <Name> [--origin page|cover] [--count 9]
 *        [--fragment "k={key}&n={nonce}"] [--encrypt aes-ctr]
 *
 * With --encrypt aes-ctr the server answers an AES-256-CTR body whose counter is the 8-byte
 * nonce followed by eight zero bytes, and {key}/{nonce} in --fragment are filled with the
 * base64url values. Without it the body is a plain PNG.
 *
 * Prints when the server received each request and what the transport handed back.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  ManaStore,
  createHttpBridge,
} from "../../../scripts/harness/runtime.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const IMAGE_DISPATCH = Symbol.for("mana.http.image.v1");
const Origin = { cover: 1, page: 2 };

const argv = process.argv.slice(2);
const name = argv.find((arg) => !arg.startsWith("-"));
const option = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1];
};
if (!name) {
  console.error(
    "usage: drive-images.mjs <Name> [--origin page|cover] [--count N] [--fragment ...] [--encrypt aes-ctr]",
  );
  process.exit(2);
}
const origin = option("--origin", "page");
const count = Number(option("--count", "9"));
const fragment = option("--fragment", "");
const encrypt = option("--encrypt", "");

/** A valid 1x1 PNG padded with an ancillary chunk to about the size of a real page. */
function png(size) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let x = 0xffffffff;
    for (const b of buf) x = table[(x ^ b) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk("zzZz", crypto.randomBytes(size)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const plain = png(1_000_000);
const key = crypto.randomBytes(32);
const nonce = crypto.randomBytes(8);
let body = plain;
if (encrypt === "aes-ctr") {
  const cipher = crypto.createCipheriv(
    "aes-256-ctr",
    key,
    Buffer.concat([nonce, Buffer.alloc(8)]),
  );
  body = Buffer.concat([cipher.update(plain), cipher.final()]);
}

const arrivals = [];
const server = http.createServer((request, response) => {
  arrivals.push({ at: Date.now(), headers: request.headers });
  response.writeHead(200, {
    "content-type": encrypt ? "application/octet-stream" : "image/png",
  });
  response.end(body);
});
await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve(undefined)),
);
const base = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;

const sandbox = {
  __manaHTTPBridge: createHttpBridge(),
  ObjectStore: new ManaStore(),
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
};
Object.assign(sandbox, { globalThis: sandbox, global: sandbox, self: sandbox });
const bundle = path.join(ROOT, "dist", "sources", `${name}.mana`);
vm.runInContext(fs.readFileSync(bundle, "utf-8"), vm.createContext(sandbox), {
  filename: `${name}.mana`,
});
const target = new sandbox.Target();
const hook =
  origin === "cover" ? target.getCoverTransport : target.getPageTransport;
if (typeof hook !== "function") {
  console.log(
    `${name} has no ${origin} transport: the app loads these images itself.`,
  );
  server.close();
  process.exit(0);
}

const b64 = (bytes) => bytes.toString("base64url");
const suffix = fragment
  ? `#${fragment.replace("{key}", encodeURIComponent(b64(key))).replace("{nonce}", encodeURIComponent(b64(nonce)))}`
  : "";
const isImage = (b) =>
  (b[0] === 0x89 && b[1] === 0x50) ||
  (b[0] === 0xff && b[1] === 0xd8) ||
  (b[8] === 0x57 && b[9] === 0x45);

console.log(
  `${name} ${target.info?.version ?? ""}: ${count} ${origin} requests sent together`,
);
const started = Date.now();
const results = await Promise.all(
  Array.from({ length: count }, async (_, i) => {
    const url = `${base}/image/${i}.bin${suffix}`;
    try {
      const client = hook.call(target, { url, origin: Origin[origin] });
      const response = await client[IMAGE_DISPATCH]({
        url,
        origin: Origin[origin],
      });
      const bytes = await response.bytes();
      return `${response.status} ${isImage(bytes) ? "image" : "not an image"}`;
    } catch (error) {
      return `error: ${String(error?.message ?? error).split("\n")[0]}`;
    }
  }),
);
server.close();

console.log(
  "received at (s):",
  arrivals.map((a) => ((a.at - started) / 1000).toFixed(2)).join(" "),
);
console.log(
  "referer:",
  [...new Set(arrivals.map((a) => a.headers.referer ?? "(none)"))].join(", "),
);
const tally = {};
for (const result of results) tally[result] = (tally[result] ?? 0) + 1;
console.log("results:", JSON.stringify(tally));
