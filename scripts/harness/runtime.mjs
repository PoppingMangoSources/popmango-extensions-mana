// @ts-check
"use strict";

import { createDecipheriv } from "node:crypto";

/**
 * Host shims for running a built `.mana` bundle outside the Mana app.
 *
 * The bundle is self-contained JavaScript that ends in
 * `globalThis.Target = __exports__.Target`. It carries its own `HttpClient`, which asks
 * the host for every transfer through `globalThis.__manaHTTPBridge`, and expects
 * `ObjectStore` and `SecureStore` as globals. These implementations mirror the contract
 * the in-app runtime provides, backed by Node's `fetch`.
 */

/** The bridge's operation codes, in the order `@mana-app/types` declares them. */
const Operation = {
  Fetch: 0,
  Read: 1,
  Release: 2,
  Cancel: 3,
  CreateBody: 4,
  RetainBody: 5,
  Invalidate: 6,
  BeginOperation: 7,
  EndOperation: 8,
  Decrypt: 9,
};

/** What a decrypted page is, from its first bytes, as the app names it. */
function imageType(bytes) {
  const at = (i) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) return "image/webp";
  return undefined;
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** `CryptoAlgorithm` and `CipherPadding`, in the order `@mana-app/types` declares them. */
const Algorithm = { AesCtr: 0, AesCbc: 1, AesGcm: 2, Xor: 3 };
const Padding = { Pkcs7: 0, Zero: 1, None: 2 };

/**
 * Runs a cipher the way the app does natively, so a source that hands its decryption to the
 * host is verified through that path rather than refused as unsupported.
 */
function decryptNatively(specJson, data) {
  const spec = JSON.parse(specJson);
  const bytes = (field) => Buffer.from(spec[field] ?? "", "base64");
  const key = bytes("key");
  const bits = key.length * 8;

  switch (spec.algorithm) {
    case Algorithm.AesCtr: {
      const decipher = createDecipheriv(`aes-${bits}-ctr`, key, bytes("counter"));
      return Buffer.concat([decipher.update(data), decipher.final()]);
    }
    case Algorithm.AesCbc: {
      const decipher = createDecipheriv(`aes-${bits}-cbc`, key, bytes("iv"));
      decipher.setAutoPadding(spec.padding === Padding.Pkcs7);
      let plain = Buffer.concat([decipher.update(data), decipher.final()]);
      if (spec.padding === Padding.Zero) {
        let end = plain.length;
        while (end > 0 && plain[end - 1] === 0) end--;
        plain = plain.subarray(0, end);
      }
      return plain;
    }
    case Algorithm.AesGcm: {
      const decipher = createDecipheriv(`aes-${bits}-gcm`, key, bytes("iv"));
      if (spec.additionalData) decipher.setAAD(bytes("additionalData"));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    }
    case Algorithm.Xor: {
      const plain = Buffer.from(data);
      const end = spec.limit === undefined ? plain.length : Math.min(plain.length, spec.offset + spec.limit);
      for (let i = spec.offset, k = 0; i < end; i++, k = (k + 1) % key.length) plain[i] ^= key[k];
      return plain;
    }
    default:
      throw new Error(`The harness cannot run cipher ${spec.algorithm}`);
  }
}

/** `BodyReader.Base64`; anything else is read as text. */
const BASE64_READER = 1;

/** `HttpBodyKind.Bytes`, the one body that crosses the bridge as base64. */
const BYTES_BODY = 3;

/**
 * The host side of the HTTP bridge.
 *
 * A response body stays here, keyed by id, until the bundle reads or releases it, which
 * is how the app keeps an image it is only passing along out of the JavaScript runtime.
 * Every status is a response; only a transfer that never completes is an error.
 */
export function createHttpBridge() {
  const bodies = new Map();
  const transfers = new Map();
  let next = 0;

  const keep = (bytes) => {
    const bodyID = String(++next);
    bodies.set(bodyID, bytes);
    return { bodyID, sessionID: "harness" };
  };

  async function fetchResponse(message) {
    const controller = new AbortController();
    transfers.set(message.requestID, controller);
    const timer = setTimeout(() => controller.abort(), message.timeoutMs ?? 30_000);

    try {
      const body =
        message.body === undefined
          ? undefined
          : message.bodyKind === BYTES_BODY
            ? Buffer.from(message.body, "base64")
            : message.body;
      const raw = await fetch(message.url, {
        method: METHODS[message.method] ?? "GET",
        headers: message.headers,
        body,
        redirect: "follow",
        signal: controller.signal,
      });
      const bytes = new Uint8Array(await raw.arrayBuffer());
      return {
        ...keep(bytes),
        status: raw.status,
        url: raw.url || message.url,
        headers: Object.fromEntries(raw.headers.entries()),
      };
    } catch (error) {
      if (controller.signal.aborted) {
        const timeout = new Error(`${message.url} timed out`);
        timeout.name = "TimeoutError";
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      transfers.delete(message.requestID);
    }
  }

  return {
    requiresOperation: false,
    crypto: Object.values(Algorithm),
    now: () => Date.now(),
    async send(message) {
      switch (message.operation) {
        case Operation.Fetch:
          return fetchResponse(message);
        case Operation.Read: {
          const bytes = bodies.get(message.bodyID);
          if (!bytes) throw new Error(`Response body ${message.bodyID} was already released`);
          const buffer = Buffer.from(bytes);
          return {
            value:
              message.reader === BASE64_READER ? buffer.toString("base64") : buffer.toString("utf8"),
          };
        }
        case Operation.Release:
          bodies.delete(message.bodyID);
          return {};
        case Operation.Cancel:
          transfers.get(message.requestID)?.abort();
          return {};
        case Operation.CreateBody:
          return keep(new Uint8Array(Buffer.from(message.value ?? "", "base64")));
        case Operation.Decrypt: {
          // A response body is decrypted where it is held; bytes the source already has
          // arrive with the message.
          const held = message.bodyID === undefined ? undefined : bodies.get(message.bodyID);
          if (message.bodyID !== undefined && !held) {
            throw new Error(`Response body ${message.bodyID} was already released`);
          }
          const plain = decryptNatively(message.spec, held ?? Buffer.from(message.value ?? "", "base64"));
          if (!held) return { value: plain.toString("base64") };
          const kept = keep(new Uint8Array(plain));
          const type = imageType(plain);
          return type ? { ...kept, contentType: type } : kept;
        }
        default:
          return {};
      }
    },
    /** The bytes a body id holds, for a check that reads what the app would be handed. */
    bytes(bodyID) {
      return bodies.get(bodyID);
    },
  };
}

/** In-memory stand-in for the app's key-value stores. */
export class ManaStore {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  async get(k) {
    return this.values.has(k) ? this.values.get(k) : null;
  }

  async set(k, v) {
    this.values.set(k, v);
  }

  async remove(k) {
    this.values.delete(k);
  }

  async string(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "string") throw new Error(`${k} is not a string`);
    return value;
  }

  async boolean(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "boolean") throw new Error(`${k} is not a boolean`);
    return value;
  }

  async number(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "number") throw new Error(`${k} is not a number`);
    return value;
  }

  async stringArray(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new Error(`${k} is not a string array`);
    }
    return value;
  }
}

/** The intent bit layout the mana-dev runtime uses, in declaration order. */
export const INTENT_NAMES = [
  "preferenceMenuBuilder",
  "requiresSetup",
  "retired",
  "pageLinkResolver",
  "libraryPageLinkProvider",
  "authenticatable",
  "basicAuth",
  "basicAuthUsesEmail",
  "webviewAuth",
  "oauthAuth",
  "providesSearch",
  "providesSearchForm",
  "providesSearchSortOptions",
  "chapterEventHandler",
  "contentEventHandler",
  "librarySyncHandler",
  "pageReadHandler",
  "progressSyncHandler",
  "groupedUpdateFetcher",
  "redrawingHandler",
  "chaptersInContent",
  "providesChapters",
  "canHandleURL",
  "allowsMultipleInstances",
  "requiresAuthenticationToAccessContent",
  "coverTransport",
  "pageTransport",
];

export function decodeIntents(mask) {
  return INTENT_NAMES.filter((_, index) => (mask >> index) & 1);
}

/**
 * A stand-in for the host's auxiliary WebView.
 *
 * The real one hands a source a WKWebView for the length of one source method. A probe
 * cannot run a browser, so this keeps the parts a source can actually get wrong — a page
 * evaluated before it was navigated, a second page opened while one is still live, work
 * queued on a page that was already closed, an operation that outruns its timeout — and
 * leaves what the page *contains* to the probe, which supplies it through `handlers`.
 *
 * `handlers.goto(url, options)` decides whether navigation succeeds. `handlers.script`
 * answers `evaluateScript(script, args)`, and `handlers.evaluate` answers `evaluate(fn,
 * ...args)`; either may throw to model a page that refuses to be read.
 */
export function createWebViewPage(handlers = {}) {
  let live = false;

  const timeoutAfter = (seconds, label) =>
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`WebView ${label} timed out after ${seconds}s`)),
        seconds * 1000,
      );
      // A pending timer must not hold the probe's process open past its own work.
      timer.unref?.();
    });

  return {
    async create(options = {}) {
      // The host allows one per source method and rejects the second, so a source that
      // leaks a page fails here rather than quietly working in the probe.
      if (live) throw new Error("A WebView is already open for this source method");
      live = true;

      const timeout = options.timeout ?? 30;
      let navigated = false;
      let closed = false;

      const guard = (label) => {
        if (closed) throw new Error(`WebView ${label} called after close()`);
        if (!navigated) throw new Error(`WebView ${label} called before goto()`);
      };

      const bounded = (work, seconds, label) =>
        Promise.race([Promise.resolve().then(work), timeoutAfter(seconds ?? timeout, label)]);

      return {
        async goto(url, gotoOptions = {}) {
          if (closed) throw new Error("WebView goto called after close()");
          await bounded(() => handlers.goto?.(url, gotoOptions), gotoOptions.timeout, "goto");
          navigated = true;
        },

        async evaluate(fn, ...args) {
          guard("evaluate");
          return bounded(() => handlers.evaluate?.(fn, args), undefined, "evaluate");
        },

        async evaluateScript(script, args = []) {
          guard("evaluateScript");
          return bounded(() => handlers.script?.(script, args), undefined, "evaluateScript");
        },

        async close() {
          closed = true;
          live = false;
        },
      };
    },
  };
}
