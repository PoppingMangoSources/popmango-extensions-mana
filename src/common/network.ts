import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
export const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /challenges\.cloudflare\.com/i,
  /cf-browser-verification/i,
  /__cf_chl_/i,
  /<title>\s*Just a moment/i,
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
];

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

export type ClientOptions = {
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
      throw new CloudflareError(resolutionUrl);
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

  return builder.build();
}
