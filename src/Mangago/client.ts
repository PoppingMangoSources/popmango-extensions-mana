/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import { ACCEPT_LANGUAGE, HTML_ACCEPT, hostOf, isChallengePage } from "../common/index.ts";
import { BROWSE_USER_AGENT, DOMAIN, READER_USER_AGENT } from "./model.ts";

const READER_NAVIGATION_HEADERS: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

export function isReaderMirrorHost(host: string): boolean {
  return /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(host);
}

function isMangagoHost(target: string): boolean {
  const host = hostOf(target);
  if (!host) return target.startsWith("/");
  return host === "mangago.me" || host.endsWith(".mangago.me") || isReaderMirrorHost(host);
}

export function pathAndQueryOf(target: string): string {
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

export function isReaderPageUrl(target: string): boolean {
  const pathname = pathAndQueryOf(target);
  const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(pathname);
  if (readManga && (readManga[1] ?? "").length > 0) return true;
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

export function readerOrigin(target: string): string {
  const host = hostOf(target);
  return host ? `https://${host}` : DOMAIN;
}

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
    .setRateLimit(3, 1)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse)
    .build();
}
