/* SPDX-License-Identifier: GPL-3.0-or-later */

import { base64ToBytes, bytesToUtf8 } from "../common/index.ts";
import { PENDING_PASSWORD_KEY, PENDING_USERNAME_KEY, SESSION_KEY } from "./model.ts";

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
 * The half-typed sign-in.
 *
 * Each form callback the app makes is its own trip into the source, so a field's value
 * has to be written down when it changes or the button that reads it finds nothing. The
 * password goes to the keychain rather than the database, and is dropped the moment it
 * has been offered to the site.
 */
export async function rememberUsername(username: string): Promise<void> {
  await ObjectStore.set(PENDING_USERNAME_KEY, username);
}

export async function rememberPassword(password: string): Promise<void> {
  await SecureStore.set(PENDING_PASSWORD_KEY, password);
}

export async function readPendingCredentials(): Promise<{ username: string; password: string }> {
  const [username, password] = await Promise.all([
    ObjectStore.string(PENDING_USERNAME_KEY).catch(() => undefined),
    SecureStore.string(PENDING_PASSWORD_KEY).catch(() => undefined),
  ]);
  return { username: (username ?? "").trim(), password: password ?? "" };
}

export async function forgetPassword(): Promise<void> {
  await SecureStore.remove(PENDING_PASSWORD_KEY).catch(() => undefined);
}

export async function forgetPendingCredentials(): Promise<void> {
  await Promise.all([
    ObjectStore.remove(PENDING_USERNAME_KEY).catch(() => undefined),
    forgetPassword(),
  ]);
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
