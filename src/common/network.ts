import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /challenges\.cloudflare\.com/i,
  /cf-browser-verification/i,
  /__cf_chl_/i,
  /<title>\s*Just a moment/i,
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
  // The two ids the app's own handler keys on, and the widget an interactive round adds.
  /challenge-error-title/i,
  /challenge-error-text/i,
  /cf-turnstile-response/i,
];

/**
 * Cloudflare's interstitial answers with a normal 200 as often as it answers
 * with a 403, so the body has to be sniffed as well as the status code.
 */
/**
 * The URL to hand the reader for a challenge, which is the one that was challenged.
 *
 * Cloudflare answers that URL with the interstitial rather than the endpoint's own
 * response, so opening it shows the puzzle to solve — and the clearance it mints is
 * scoped to the whole domain, so it covers every other request the source makes. The
 * site root is only the fallback, for a response that did not record its request.
 */
export function challengedUrl(response: NetworkResponse, fallback: string): string {
  const url = response.request?.url;
  return typeof url === "string" && url ? url : fallback;
}

export function isChallengePage(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, 4096);
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(head))) return true;
  return head.includes("pow_nonce") && head.includes("pow_hash");
}

type ClientOptions = {
  baseUrl: string;
  requests?: number;
  interval?: number;
  accept?: string;
  headers?: Record<string, string>;
  resolutionUrl?: string;
  originFor?: (url: string) => string;
  json?: boolean;
  maxRetries?: number;
  timeout?: number;
  /** Set false for hosts that reject a cross-origin `origin` header on plain GETs. */
  sendOrigin?: boolean;
  /**
   * Which statuses reach the caller instead of being turned into a `NetworkError` first.
   *
   * The host accepts only 200–299 by default and rejects the rest **after** the response
   * interceptors run but before the caller sees them, which makes any code that reads
   * `response.status` unreachable and replaces the server's own words with a generic
   * message. A source that needs to tell a rate limit, an expired token or a failing
   * origin apart from an ordinary refusal says so here, and then checks the status itself.
   */
  statusValidator?: (status: number) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Surfaces a JSON API's own error text instead of a bare status code. */
function errorMessage(body: string, fallback: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fallback;
  }

  if (isRecord(parsed)) {
    const error = parsed["error"];
    if (isRecord(error) && typeof error["message"] === "string") return error["message"];
    if (typeof parsed["message"] === "string") return parsed["message"];
    const errors = parsed["errors"];
    if (Array.isArray(errors)) {
      const first = errors[0];
      if (isRecord(first) && typeof first["message"] === "string") return first["message"];
    }
  }
  return fallback;
}

export function buildClient(options: ClientOptions): NetworkClient {
  const {
    baseUrl,
    requests = 5,
    interval = 1,
    accept = options.json ? JSON_ACCEPT : HTML_ACCEPT,
    headers = {},
    resolutionUrl = baseUrl,
    originFor,
    json = false,
    maxRetries,
    timeout,
    sendOrigin = true,
    statusValidator,
  } = options;

  const interceptRequest = async (request: NetworkRequest): Promise<NetworkRequest> => {
    const origin = originFor?.(request.url) ?? baseUrl;
    return {
      ...request,
      headers: {
        ...(sendOrigin ? { origin } : {}),
        referer: `${origin}/`,
        accept,
        "accept-language": ACCEPT_LANGUAGE,
        "user-agent": USER_AGENT,
        ...headers,
        ...request.headers,
      },
    };
  };

  const interceptResponse = async (response: NetworkResponse): Promise<NetworkResponse> => {
    if (response.status === 403 || response.status === 503 || isChallengePage(response.data)) {
      throw new CloudflareError(challengedUrl(response, resolutionUrl));
    }
    if (json && response.status >= 400) {
      throw new Error(
        `${errorMessage(response.data, "The server rejected the request")} (HTTP ${response.status})`,
      );
    }
    return response;
  };

  const builder = new NetworkClientBuilder()
    .setRateLimit(requests, interval)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse);

  if (maxRetries !== undefined) builder.setMaxRetries(maxRetries);
  if (timeout !== undefined) builder.setTimeout(timeout);
  if (statusValidator !== undefined) builder.setStatusValidator(statusValidator);

  return builder.build();
}

/**
 * How the host words a body it could not turn into a string. There is no binary response
 * mode and `NetworkResponse.data` is always a `string`, so a page served as
 * windows-1252, Shift-JIS or any other non-UTF-8 encoding fails at the bridge rather than
 * arriving as mojibake — the request never returns at all.
 */
const ENCODING_FAILURE = /could not be serialized|unicode \(utf-8\)|invalid.{0,20}utf-?8/i;

/** One WebView is live per source method, so recoveries queue rather than race. */
let webViewTurn: Promise<unknown> = Promise.resolve();

function isEncodingFailure(error: unknown): boolean {
  return ENCODING_FAILURE.test(error instanceof Error ? error.message : String(error));
}

/** Seconds before a WebView that will not navigate is abandoned. */
const WEBVIEW_TIMEOUT_SECONDS = 20;

function expiresIn(seconds: number): Promise<never> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return new Promise(() => undefined);
  return new Promise((_, reject) => {
    timer(() => reject(new Error(`the WebView did not answer within ${seconds}s`)), seconds * 1000);
  });
}

/**
 * Re-reads a page through the auxiliary WebView, which decodes it with the charset the
 * page itself declares and hands back text the runtime can hold.
 *
 * What comes back is the DOM serialised after the page's own scripts have run, not the
 * bytes the server sent — so anything the site rewrites client-side is already applied,
 * and a byte the decoder could not map arrives as U+FFFD rather than as an error. A
 * parser that slices titles should cut at that character rather than pass it on.
 */
async function readThroughWebView(url: string): Promise<string> {
  const factory = (globalThis as { WebViewPage?: typeof WebViewPage }).WebViewPage;
  if (!factory) {
    throw new Error(
      `${url} was served in an encoding this version of Mana cannot read, and it has no WebView to recover it with.`,
    );
  }

  const page = await factory.create({ timeout: WEBVIEW_TIMEOUT_SECONDS });
  try {
    const work = (async () => {
      // `evaluate` on a page that has never navigated hangs until the host's own timeout.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: WEBVIEW_TIMEOUT_SECONDS });
      return page.evaluateScript<string>("document.documentElement.outerHTML");
    })();

    return await Promise.race([work, expiresIn(WEBVIEW_TIMEOUT_SECONDS)]);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Reads a page as text, falling back to the WebView when the host cannot decode it.
 *
 * Only an encoding failure is recovered — every other error is the site's own answer and
 * is rethrown untouched, so a 404 stays a 404 rather than becoming a WebView load.
 */
export async function getText(client: NetworkClient, url: string): Promise<string> {
  try {
    return (await client.get(url)).data;
  } catch (error) {
    if (!isEncodingFailure(error)) throw error;

    const turn = webViewTurn.then(() => readThroughWebView(url));
    // The chain must not reject for the next caller, whose read is unrelated to this one.
    webViewTurn = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}
