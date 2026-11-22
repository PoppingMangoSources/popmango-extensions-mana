/* SPDX-License-Identifier: GPL-3.0-or-later */

import { isApiChallenge } from "./network.ts";

import { CloudflareError } from "@mana-app/types";

// Optional metadata may be missing; a challenge must still reach the app's handler.
export function fallbackUnlessCloudflare<T>(error: unknown, fallback: T): T {
  if (error instanceof CloudflareError) throw error;
  return fallback;
}

export function delay(ms: number): Promise<void> {
  const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  if (!timer) return Promise.resolve();
  return new Promise((resolve) => {
    timer(() => resolve(), ms);
  });
}

// Metadata can succeed while images on the same site still need browser clearance.
export function createClearanceProbe(
  client: () => import("@mana-app/types").HttpClient,
  siteUrl: () => string | Promise<string>,
): () => Promise<void> {
  let checkedUrl = "";
  let checkedAt = 0;
  let inFlight: { url: string; promise: Promise<void> } | undefined;
  return async () => {
    const url = await siteUrl();
    if (checkedUrl === url && Date.now() - checkedAt < 10 * 60_000) return;
    if (inFlight?.url === url) return inFlight.promise;
    const promise = (async () => {
      try {
        const response = await client().get(url, { headers: { accept: "text/html" } });
        if (await isApiChallenge(response)) throw new CloudflareError(url);
        response.requireOk();
        checkedUrl = url;
        checkedAt = Date.now();
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
      }
    })();
    inFlight = { url, promise };
    try {
      await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = undefined;
    }
  };
}
