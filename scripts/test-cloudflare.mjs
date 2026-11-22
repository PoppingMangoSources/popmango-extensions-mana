#!/usr/bin/env bun
/* SPDX-License-Identifier: GPL-3.0-or-later */

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CloudflareError, HttpClient, RequestOrigin } from "@mana-app/types";
import {
  buildClient,
  imageClient,
  getText,
  isApiChallenge,
  isChallengePage,
} from "../src/common/network.ts";
import { fallbackUnlessCloudflare } from "../src/common/cloudflare.ts";
import { ManaStore } from "./harness/runtime.mjs";

function bridge(reply) {
  let id = 0;
  const bodies = new Map(),
    requests = [];
  return {
    requests,
    requiresOperation: false,
    now: () => Date.now(),
    async send(message) {
      if (message.operation === 0) {
        requests.push(message);
        const result = await reply(message);
        const bodyID = String(++id);
        bodies.set(bodyID, result.body ?? "");
        return {
          bodyID,
          sessionID: "test",
          status: result.status,
          headers: result.headers ?? {},
          url: message.url,
        };
      }
      if (message.operation === 1) return { value: bodies.get(message.bodyID) ?? "" };
      if (message.operation === 2) bodies.delete(message.bodyID);
      return {};
    },
  };
}
const url = "https://site.test/api/list";
const challenge = {
  status: 403,
  headers: { server: "cloudflare", "content-type": "text/html" },
  body: '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>',
};
const isCF = (error) => error?.name === "CloudflareError";
let checks = 0;
for (const [name, response, expected] of [
  ["native header", { status: 200, headers: { "cf-mitigated": "challenge" }, body: "" }, true],
  ["native interstitial", challenge, true],
  [
    "HTTP 200 interstitial",
    {
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><title>Just a moment...</title><script>window._cf_chl_opt={};</script></html>",
    },
    true,
  ],
  [
    "ordinary JSON 403",
    {
      status: 403,
      headers: { "content-type": "application/json" },
      body: '{"error":"expired_token"}',
    },
    false,
  ],
  [
    "ordinary HTML 503",
    {
      status: 503,
      headers: { "content-type": "text/html" },
      body: "<html><title>Maintenance</title></html>",
    },
    false,
  ],
  ["untyped 403", { status: 403, body: "Forbidden" }, false],
  [
    "normal Turnstile widget",
    {
      status: 200,
      headers: { "content-type": "text/html" },
      body: '<html><title>Sign in</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><input name="cf-turnstile-response"></html>',
    },
    false,
  ],
  [
    "JSON mentioning Cloudflare",
    {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"text":"_cf_chl_opt = historical example"}',
    },
    false,
  ],
]) {
  globalThis.__manaHTTPBridge = bridge(async () => response);
  const client = buildClient({
    baseUrl: "https://site.test",
    requests: 1000,
    json: true,
    maxRetries: 0,
  });
  let result, failure;
  try {
    result = await client.get(url);
  } catch (error) {
    failure = error;
  }
  assert.equal(isCF(failure), expected, `${name}: ${failure?.message ?? "success"}`);
  if (!expected && response.status >= 400) assert.ok(failure, `${name} lost its HTTP failure`);
  if (!failure) {
    assert.equal(globalThis.__manaHTTPBridge.requests[0].headers["user-agent"], undefined);
    await result.text();
  }
  checks++;
}
assert.equal(isChallengePage('<input name="cf-turnstile-response">'), false);
const nativeBridge = bridge(async () => challenge);
globalThis.__manaHTTPBridge = nativeBridge;
let interceptorCalled = false;
const native = new HttpClient().setRetry(0).addResponseInterceptor((response) => {
  interceptorCalled = true;
  return response;
});
await assert.rejects(native.get(url), isCF);
assert.equal(
  interceptorCalled,
  false,
  "runtime must detect the challenge before source interceptors",
);
checks++;
const error = new CloudflareError(url);
assert.throws(
  () => fallbackUnlessCloudflare(error, []),
  (value) => value === error,
);
assert.deepEqual(fallbackUnlessCloudflare(new Error("optional metadata absent"), []), []);
await assert.rejects(
  getText(
    {
      get: async () => {
        throw error;
      },
    },
    url,
  ),
  (value) => value === error,
);
assert.equal(
  await isApiChallenge({
    status: 403,
    headers: { get: () => "text/plain" },
    text: async () => "Forbidden",
  }),
  false,
);
checks++;
globalThis.__manaHTTPBridge = bridge(async () => challenge);
const images = imageClient({ referer: "https://site.test/" });
await assert.rejects(
  images[Symbol.for("mana.http.image.v1")]({
    url: "https://site.test/image.webp",
    origin: RequestOrigin.Page,
  }),
  isCF,
);
checks++;

let sources = 0;
for (const response of [
  challenge,
  {
    status: 200,
    headers: { "content-type": "text/html" },
    body: "<html><title>Just a moment...</title><script>window._cf_chl_opt={};</script></html>",
  },
]) {
  for (const entry of fs.readdirSync(new URL("../dist/sources/", import.meta.url))) {
    if (!entry.endsWith(".mana")) continue;
    const io = bridge(async () => response);
    let webviews = 0;
    const sandbox = {
      ObjectStore: new ManaStore(),
      SecureStore: new ManaStore(),
      __manaHTTPBridge: io,
      console,
      setTimeout,
      clearTimeout,
      WebViewPage: {
        create: async () => {
          webviews++;
          throw new Error("Unexpected source-owned Cloudflare WebView");
        },
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(new URL(`../dist/sources/${entry}`, import.meta.url), "utf8"),
      sandbox,
    );
    const source = new sandbox.Target();
    assert.equal(typeof source.search, "function", `${entry}: missing search`);
    await assert.rejects(
      source.search({ query: "test", page: 1 }),
      isCF,
      `${entry}: source swallowed or replaced the challenge`,
    );
    assert.ok(io.requests.length > 0, `${entry}: no request was exercised`);
    assert.equal(webviews, 0, `${entry}: delayed the native handler with a custom WebView`);
    sources++;
  }
}
console.log(
  `Cloudflare checks passed: ${checks} detection/transport cases and ${sources / 2} bundled sources, each with native and HTTP 200 challenges.`,
);
