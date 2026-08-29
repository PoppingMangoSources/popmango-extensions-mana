/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { HTML_ACCEPT, ACCEPT_LANGUAGE, isChallengePage } from "../common/index.ts";
import { BROWSE_USER_AGENT, DOMAIN, READER_USER_AGENT } from "./model.ts";

/**
 * Headers a browser sends when navigating to a reader page. Combined with a
 * same-origin referer they make a sub-page fetch look like a real navigation,
 * which is what the site serves in full.
 */
const READER_NAVIGATION_HEADERS: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

function hostOf(target: string): string {
  const normalised = target.startsWith("//") ? `https:${target}` : target;
  return /^https?:\/\/([^/?#]+)/i.exec(normalised)?.[1]?.toLowerCase() ?? "";
}

/** The rotating mirrors that serve the numeric reader (never www.mangago.me). */
export function isReaderMirrorHost(host: string): boolean {
  return /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(host);
}

/**
 * True for mangago.me and its reader mirrors, which need the `_m_superu`
 * cookie — and false for the image CDN hosts, which must not receive it.
 */
function isMangagoHost(target: string): boolean {
  const host = hostOf(target);
  if (!host) return target.startsWith("/");
  return host === "mangago.me" || host.endsWith(".mangago.me") || isReaderMirrorHost(host);
}

export function pathOf(target: string): string {
  const normalised = target.startsWith("//") ? `https:${target}` : target;
  const absolute = /^https?:\/\/[^/]+(\/[^\s]*)?$/i.exec(normalised);
  const pathAndQuery = absolute
    ? (absolute[1] ?? "/")
    : normalised.startsWith("/")
      ? normalised
      : `/${normalised}`;
  const cut = pathAndQuery.search(/[?#]/);
  return cut >= 0 ? pathAndQuery.slice(0, cut) : pathAndQuery;
}

/**
 * A reader page (`/read-manga/<slug>/<more>` or numeric `/chapter/<a>/<b>/`)
 * takes the desktop UA; everything else takes the mobile one so chapter links
 * come back as read-manga URLs.
 */
export function isReaderPageUrl(target: string): boolean {
  const pathname = pathOf(target);
  const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(pathname);
  if (readManga && (readManga[1] ?? "").length > 0) return true;
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

/** The origin serving a URL — its explicit mirror host, else www.mangago.me. */
export function readerOrigin(target: string): string {
  const host = hostOf(target);
  return host ? `https://${host}` : DOMAIN;
}

/**
 * One client for the whole source.
 *
 * The per-request UA and referer are decided by the URL rather than by the
 * caller, so a redirect from a numeric reader to its `/read-manga/` form stays
 * on the desktop UA and keeps returning the full image list.
 */
export function buildMangagoClient(): NetworkClient {
  const interceptRequest = async (request: NetworkRequest): Promise<NetworkRequest> => {
    const reader = isReaderPageUrl(request.url);
    const origin = reader ? readerOrigin(request.url) : DOMAIN;

    return {
      ...request,
      headers: {
        referer: `${origin}/`,
        origin,
        accept: HTML_ACCEPT,
        "accept-language": ACCEPT_LANGUAGE,
        "user-agent": reader ? READER_USER_AGENT : BROWSE_USER_AGENT,
        ...(reader ? READER_NAVIGATION_HEADERS : {}),
        // Anything the caller set explicitly wins, so a forced reader fetch
        // cannot be downgraded by URL classification of a stale path.
        ...request.headers,
      },
      cookies: isMangagoHost(request.url)
        ? [...(request.cookies ?? []), { name: "_m_superu", value: "1" }]
        : request.cookies,
    };
  };

  const interceptResponse = async (response: NetworkResponse): Promise<NetworkResponse> => {
    const mitigated = response.headers?.["cf-mitigated"];
    if (mitigated === "challenge" || response.status === 403 || response.status === 503) {
      throw new CloudflareError(DOMAIN);
    }
    if (isChallengePage(response.data)) throw new CloudflareError(DOMAIN);
    return response;
  };

  return new NetworkClientBuilder()
    .setRateLimit(1, 1)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse)
    .build();
}
