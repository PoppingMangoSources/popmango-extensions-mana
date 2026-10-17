/* SPDX-License-Identifier: GPL-3.0-or-later */

import { CloudflareError, HttpClient, type HttpResponse } from "@mana-app/types";

import {
  ACCEPT_LANGUAGE,
  HTML_ACCEPT,
  challengedUrl,
  hostOf,
  isChallengePage,
  isCloudflareChallenge,
  withDefaults,
} from "../common/index.ts";
import { BROWSE_USER_AGENT, DOMAIN, READER_USER_AGENT } from "./model.ts";

const SUPER_USER = "_m_superu=1";

const READER_NAVIGATION_HEADERS: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

function isReaderMirrorHost(host: string): boolean {
  return /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(host);
}

function isMangagoHost(target: string): boolean {
  const host = hostOf(target);
  if (!host) return target.startsWith("/");
  return host === "mangago.me" || host.endsWith(".mangago.me") || isReaderMirrorHost(host);
}

export function parsePathAndQuery(target: string): string {
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

function isReaderPageUrl(target: string): boolean {
  const pathname = parsePathAndQuery(target);
  const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(pathname);
  if (readManga && (readManga[1] ?? "").length > 0) return true;
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

export function readerOrigin(target: string): string {
  const host = hostOf(target);
  return host ? `https://${host}` : DOMAIN;
}

export function buildMangagoClient(): HttpClient {
  return new HttpClient()
    .setRateLimit(3, 1000)
    .addRequestInterceptor((request) => {
      const reader = isReaderPageUrl(request.url);
      const origin = reader ? readerOrigin(request.url) : DOMAIN;

      withDefaults(request.headers, {
        referer: `${origin}/`,
        origin,
        accept: HTML_ACCEPT,
        "accept-language": ACCEPT_LANGUAGE,
        "user-agent": reader ? READER_USER_AGENT : BROWSE_USER_AGENT,
        ...(reader ? READER_NAVIGATION_HEADERS : {}),
      });
      // A request carries no cookies of its own any more, only a header, so this one is
      // added to whatever the call site already wrote there rather than in place of it.
      if (isMangagoHost(request.url)) {
        const cookies = request.headers.get("cookie");
        request.headers.set("cookie", cookies ? `${cookies}; ${SUPER_USER}` : SUPER_USER);
      }
      return request;
    })
    .addResponseInterceptor(async (response) => {
      // The challenged URL is what the app opens for the reader; Cloudflare answers it
      // with the interstitial, and the clearance it mints covers the whole domain.
      if (
        isCloudflareChallenge(response) ||
        response.status === 403 ||
        response.status === 503 ||
        (mayBeMarkup(response) && isChallengePage(await response.text()))
      ) {
        throw new CloudflareError(challengedUrl(response, DOMAIN));
      }
      return response;
    });
}

/** Only markup can be the interstitial; an image is left unread. */
function mayBeMarkup(response: HttpResponse): boolean {
  return !/^image\//i.test(response.headers.get("content-type") ?? "");
}
