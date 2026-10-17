import {
  CloudflareError,
  HttpClient,
  HttpStatusError,
  RequestOrigin,
  type HttpResponse,
} from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
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
 * The URL to hand the reader for a challenge, which is the one that was challenged.
 *
 * Cloudflare answers that URL with the interstitial rather than the endpoint's own
 * response, so opening it shows the puzzle to solve — and the clearance it mints is
 * scoped to the whole domain, so it covers every other request the source makes. The
 * site root is only the fallback, for a response that did not record its request.
 */
export function challengedUrl(response: HttpResponse, fallback: string): string {
  const url = response.request?.url;
  return typeof url === "string" && url ? url : fallback;
}

/**
 * Cloudflare's interstitial answers with a normal 200 as often as it answers
 * with a 403, so the body has to be sniffed as well as the status code.
 */
export function isChallengePage(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, 4096);
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(head))) return true;
  return head.includes("pow_nonce") && head.includes("pow_hash");
}

/**
 * Cloudflare's own word that it challenged the request.
 *
 * An endpoint that answers in JSON gets no interstitial to sniff for, so the header is the
 * only sign it carries.
 */
export function isCloudflareChallenge(response: HttpResponse): boolean {
  return (response.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge";
}

/**
 * Whether a JSON API's answer was written by Cloudflare rather than by the API.
 *
 * Cloudflare names a challenge in a header of its own and answers the interstitial with a
 * 403 as readily as a 200. Where neither that header nor the interstitial's markup is
 * present, the body shape decides: an API that answers JSON did not write a refusal that
 * is not JSON.
 *
 * Without that last test the two cannot be told apart. Reporting every 403 as a challenge
 * sends a reader to a page with no puzzle on it when the API simply said no; reporting none
 * of them leaves a real block with no way to clear it.
 */
export async function isApiChallenge(response: HttpResponse): Promise<boolean> {
  if (isCloudflareChallenge(response)) return true;
  if (response.status !== 403 && response.status !== 503) return false;

  const body = await response.text();
  if (isChallengePage(body)) return true;
  try {
    JSON.parse(body);
    return false;
  } catch {
    return true;
  }
}

/**
 * Whether a body is worth reading to look for an interstitial.
 *
 * The interstitial is always a page of markup. Reading a body pulls it out of the host and
 * into this runtime, so an image or a JSON answer is left where it is rather than read for
 * a challenge it cannot be.
 */
function mayBeChallenge(response: HttpResponse): boolean {
  return /html/i.test(response.headers.get("content-type") ?? "");
}

type ClientOptions = {
  baseUrl: string;
  requests?: number;
  /** Seconds the `requests` are spread across. */
  interval?: number;
  accept?: string;
  headers?: Record<string, string>;
  resolutionUrl?: string;
  originFor?: (url: string) => string;
  json?: boolean;
  maxRetries?: number;
  /** Milliseconds. */
  timeout?: number;
  /** Set false for hosts that reject a cross-origin `origin` header on plain GETs. */
  sendOrigin?: boolean;
  /**
   * Which statuses reach the caller instead of being thrown as an `HttpStatusError`.
   *
   * The host hands back every status as an ordinary response, so a client here refuses
   * anything outside 200–299 itself — callers were written against a host that did, and
   * read a body only once it is the answer they asked for. A source that needs to tell a
   * rate limit, an expired token or a failing origin apart from an ordinary refusal says so
   * here, and then checks the status itself.
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

/** 200–299: what the host used to let through before it stopped refusing for us. */
export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Sets each header the request does not already carry.
 *
 * The request's own headers are the call site's, which know better than any default, so a
 * default only fills a gap.
 */
export function withDefaults(
  headers: { has(name: string): boolean; set(name: string, value: string): unknown },
  defaults: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(defaults)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

export function buildClient(options: ClientOptions): HttpClient {
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
    statusValidator = isSuccess,
  } = options;

  const client = new HttpClient()
    .setRateLimit(requests, interval * 1000)
    .addRequestInterceptor((request) => {
      const origin = originFor?.(request.url) ?? baseUrl;
      withDefaults(request.headers, {
        ...(sendOrigin ? { origin } : {}),
        referer: `${origin}/`,
        accept,
        "accept-language": ACCEPT_LANGUAGE,
        "user-agent": USER_AGENT,
        ...headers,
      });
      return request;
    })
    .addResponseInterceptor(async (response) => {
      if (
        response.status === 403 ||
        response.status === 503 ||
        (mayBeChallenge(response) && isChallengePage(await response.text()))
      ) {
        throw new CloudflareError(challengedUrl(response, resolutionUrl));
      }
      if (json && response.status >= 400) {
        throw new Error(
          `${errorMessage(await response.text(), "The server rejected the request")} (HTTP ${response.status})`,
        );
      }
      if (!statusValidator(response.status)) throw new HttpStatusError(response);
      return response;
    });

  if (maxRetries !== undefined) client.setRetry(maxRetries);
  if (timeout !== undefined) client.setTimeoutMs(timeout);
  return client;
}

/**
 * A client for the app's own cover and page requests, carrying the headers the image host
 * checks.
 *
 * Nothing reads the image here, so its bytes go from the host straight to the decoder; the
 * client only decides what the request says.
 */
export function imageClient(headers: Record<string, string>): HttpClient {
  return new HttpClient().addRequestInterceptor((request, context) => {
    if (context.origin !== RequestOrigin.General) withDefaults(request.headers, headers);
    return request;
  });
}

/**
 * How the host words a body it could not turn into a string. The host decodes text itself
 * and this runtime has no decoder to do better, so a page served as windows-1252, Shift-JIS
 * or any other non-UTF-8 encoding fails at the bridge rather than arriving as mojibake.
 */
const ENCODING_FAILURE = /could not be serialized|unicode \(utf-8\)|invalid.{0,20}utf-?8/i;

/** One WebView is live per source method, so recoveries queue rather than race. */
let webViewTurn: Promise<unknown> = Promise.resolve();

function isEncodingFailure(error: unknown): boolean {
  return ENCODING_FAILURE.test(error instanceof Error ? error.message : String(error));
}

/** Seconds before a WebView that will not navigate is abandoned. */
const WEBVIEW_TIMEOUT_SECONDS = 20;

/**
 * The loaded document, as markup.
 *
 * Serialised into the page by `evaluate`, where a `document` exists; this runtime has none,
 * so it is reached through a locally declared view of `globalThis`. It is a function rather
 * than a script because the host declares `args` beside every script, in the page's own
 * scope, where it outlives the call — a second `evaluateScript` on one page throws.
 */
function outerHtml(): string {
  const page = globalThis as { document?: { documentElement: { outerHTML: string } } };
  return page.document?.documentElement.outerHTML ?? "";
}

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
      return page.evaluate(outerHtml);
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
export async function getText(client: HttpClient, url: string): Promise<string> {
  try {
    return await (await client.get(url)).text();
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
