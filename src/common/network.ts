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
/**
 * Markup only an interstitial carries.
 *
 * `challenges.cloudflare.com` and `cf-turnstile-response` are left out on purpose: an
 * ordinary page embeds the Turnstile widget on a form, and calling that a challenge sends
 * the reader to a page with nothing to solve.
 */
const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /<title>\s*Just a moment/i,
  /cf-browser-verification/i,
  /(?:window\.)?_cf_chl_opt\s*=/i,
  /id=["']cf-chl-/i,
  // The two ids the app's own handler keys on.
  /challenge-error-title/i,
  /challenge-error-text/i,
  // A proof-of-work interstitial posts its answer back here; the WebView the app opens for
  // a challenge runs it like any other.
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
];

/**
 * The URL to hand the reader for a challenge, which is the one that was challenged.
 *
 * Cloudflare answers that URL with the interstitial rather than the endpoint's own
 * response, so opening it shows the puzzle to solve — and the clearance it mints is
 * scoped to the whole domain, so it covers every other request the source makes. The
 * fallback is only for a response that did not record its request.
 */
export function challengedUrl(response: HttpResponse, fallback: string): string {
  return response.request?.url || fallback;
}

/**
 * Cloudflare's interstitial answers with a normal 200 as often as it answers with a 403,
 * so the body has to be sniffed as well as the status code.
 */
export function isChallengePage(html: string): boolean {
  const head = html.slice(0, 8192);
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
 * Whether a response is a challenge the SDK let through.
 *
 * The SDK already throws for the `cf-mitigated` header and for a Cloudflare 403/503 that
 * carries challenge markup, before any interceptor runs. What reaches here is the rest: an
 * interstitial served as a 200, or a refusal with no challenge on it. Only the first is a
 * challenge — a bare 403 is the site saying no, and calling it Cloudflare opens a page with
 * no puzzle on it. A body that is not markup is left unread, since reading it pulls it out
 * of the host for a challenge it cannot be.
 */
export async function isApiChallenge(response: HttpResponse): Promise<boolean> {
  if (isCloudflareChallenge(response)) return true;
  const type = response.headers.get("content-type") ?? "";
  if (type && !/html/i.test(type)) return false;
  return isChallengePage(await response.text());
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
        ...headers,
      });
      return request;
    })
    .addResponseInterceptor(async (response) => {
      if (await isApiChallenge(response)) {
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
