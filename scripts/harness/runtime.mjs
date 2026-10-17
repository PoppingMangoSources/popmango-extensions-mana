// @ts-check
"use strict";

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
};

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

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
