/* SPDX-License-Identifier: GPL-3.0-or-later */

import { base64ToBytes, bytesToUtf8 } from "../common/index.ts";
import { SESSION_KEY } from "./model.ts";

/** What the site puts in the session token's payload; the rest is not ours to read. */
type SessionPayload = {
  session?: string;
  username?: string;
  time_created?: number;
};

export type SessionInfo = {
  username: string;
  signedInAt?: Date;
};

export async function readToken(): Promise<string> {
  try {
    return (await SecureStore.string(SESSION_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function writeToken(token: string): Promise<void> {
  await SecureStore.set(SESSION_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.remove(SESSION_KEY);
}

/**
 * Reads the signed-in account out of the token itself.
 *
 * The alternative is a profile request, which the sign-in screen would then make on every
 * open; the token already carries the name and the moment it was issued.
 */
export function decodeSession(token: string): SessionInfo | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;

  try {
    // A JWT is base64url, which differs from base64 in two characters and its padding.
    const normalised = payload.split("-").join("+").split("_").join("/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    const decoded = JSON.parse(bytesToUtf8(base64ToBytes(padded))) as SessionPayload;

    const username = (decoded.username ?? "").trim();
    if (!username) return undefined;

    const issued = decoded.time_created == null ? undefined : new Date(decoded.time_created * 1000);

    return {
      username,
      ...(issued && !Number.isNaN(issued.getTime()) ? { signedInAt: issued } : {}),
    };
  } catch {
    return undefined;
  }
}
