/* SPDX-License-Identifier: GPL-3.0-or-later */

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
