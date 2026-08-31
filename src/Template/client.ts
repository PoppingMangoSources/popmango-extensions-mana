/* SPDX-License-Identifier: GPL-3.0-or-later */

import { buildClient } from "../common/index.ts";
import { BASE_URL } from "./model.ts";

/**
 * The site's network client.
 *
 * `buildClient` covers the usual case — rate limiting, the standard headers,
 * and turning a Cloudflare challenge into a `CloudflareError` the app can hand
 * to a WebView. A site that needs more than it offers (a per-URL user agent, an
 * injected cookie, a signed header) builds on `NetworkClientBuilder` directly
 * instead; see `src/Mangago/client.ts`.
 *
 * Three per second is the budget worth starting from: the home page fans out
 * to one request per enabled section through this one client.
 */
export function buildTemplateClient(): NetworkClient {
  return buildClient({ baseUrl: BASE_URL, requests: 3, interval: 1 });
}
