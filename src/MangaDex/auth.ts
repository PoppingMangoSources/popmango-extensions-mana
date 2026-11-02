/* SPDX-License-Identifier: GPL-3.0-or-later */

import { Body, HttpClient, type OAuthURL } from "@mana-app/types";

import { sha256 } from "../common/aes.ts";
import { base64ToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../common/bytes.ts";
import {
  AUTH_CALLBACK_SCHEME,
  AUTH_CLIENT_ID,
  AUTH_REDIRECT_URI,
  AUTH_URL,
  USER_AGENT,
} from "./model.ts";

const SESSION_KEY = "mangadex.session";
const VERIFIER_KEY = "mangadex.pkce-verifier";
/** An access token lives fifteen minutes; one this close to its end is refreshed first. */
const EXPIRY_MARGIN_S = 60;
const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

type Session = { access: string; refresh: string };
type TokenAnswer = { access_token?: string; refresh_token?: string; error_description?: string };

/** The sign-in was refused or the session ended, as against a passing network failure. */
export class SignedOutError extends Error {}

let client: HttpClient | undefined;
function http(): HttpClient {
  client ??= new HttpClient().addHeaders({ "user-agent": USER_AGENT, accept: "application/json" });
  return client;
}

// A refresh token is spent by using it, so two rows refreshing at once must share one
// request: the second would present a token the first had already traded in.
let refreshing: Promise<string> | undefined;

async function readSession(): Promise<Session | undefined> {
  const stored = await SecureStore.get(SESSION_KEY);
  if (typeof stored !== "string" || !stored) return undefined;
  try {
    const session = JSON.parse(stored) as Partial<Session>;
    return session.access && session.refresh
      ? { access: session.access, refresh: session.refresh }
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeSession(answer: TokenAnswer, previous?: Session): Promise<string> {
  const access = answer.access_token ?? "";
  const refresh = answer.refresh_token ?? previous?.refresh ?? "";
  if (!access || !refresh) throw new SignedOutError("MangaDex did not return a session.");
  await SecureStore.set(SESSION_KEY, JSON.stringify({ access, refresh }));
  return access;
}

export async function signOut(): Promise<void> {
  refreshing = undefined;
  await SecureStore.remove(SESSION_KEY);
}

export async function hasSession(): Promise<boolean> {
  return (await readSession()) !== undefined;
}

/** Seconds since the epoch at which a token stops being accepted, from its own claims. */
function expiresAt(token: string): number {
  const claims = token.split(".")[1] ?? "";
  try {
    const body = JSON.parse(
      bytesToUtf8(base64ToBytes(claims.replace(/-/g, "+").replace(/_/g, "/"), true)),
    ) as { exp?: unknown };
    return typeof body.exp === "number" ? body.exp : 0;
  } catch {
    return 0;
  }
}

async function requestTokens(form: Record<string, string>): Promise<TokenAnswer> {
  const response = await http().post(`${AUTH_URL}/token`, Body.form(form));
  const text = await response.text();
  let answer: TokenAnswer = {};
  try {
    answer = JSON.parse(text) as TokenAnswer;
  } catch {}

  // The auth server answers a spent or revoked token with 400 or 401; anything else is the
  // server or the network, and must not sign the reader out.
  if (response.status === 400 || response.status === 401) {
    throw new SignedOutError(answer.error_description || "MangaDex ended the session.");
  }
  if (!response.ok) throw new Error(`MangaDex sign-in is unavailable (HTTP ${response.status})`);
  return answer;
}

/**
 * A token the API will take, refreshed first if it is about to lapse, or `undefined` when
 * nobody is signed in. A session the auth server has ended is cleared on the way.
 */
export async function accessToken(force = false): Promise<string | undefined> {
  const session = await readSession();
  if (!session) return undefined;
  if (!force && expiresAt(session.access) > Date.now() / 1000 + EXPIRY_MARGIN_S) {
    return session.access;
  }

  refreshing ??= requestTokens({
    grant_type: "refresh_token",
    refresh_token: session.refresh,
    client_id: AUTH_CLIENT_ID,
  })
    .then((answer) => writeSession(answer, session))
    .finally(() => {
      refreshing = undefined;
    });

  try {
    return await refreshing;
  } catch (error) {
    if (error instanceof SignedOutError) {
      await signOut();
      return undefined;
    }
    throw error;
  }
}

/**
 * The sign-in page, with a PKCE challenge whose verifier waits in the store for the callback.
 *
 * The verifier only ties the code MangaDex hands back to this one sign-in, and the source
 * API offers no cryptographic random source, so `Math.random` is what makes it.
 */
export async function authorizationRequest(): Promise<OAuthURL> {
  const verifier = Array.from(
    { length: 64 },
    () => VERIFIER_ALPHABET[Math.floor(Math.random() * VERIFIER_ALPHABET.length)],
  ).join("");
  await SecureStore.set(VERIFIER_KEY, verifier);

  return {
    url: `${AUTH_URL}/auth`,
    params: {
      client_id: AUTH_CLIENT_ID,
      response_type: "code",
      redirect_uri: AUTH_REDIRECT_URI,
      scope: "email openid",
      code_challenge: bytesToBase64Url(sha256(utf8ToBytes(verifier))),
      code_challenge_method: "S256",
    },
    callbackScheme: AUTH_CALLBACK_SCHEME,
  };
}

/** Trades the code in the callback URL for a session. */
export async function completeSignIn(callback: string): Promise<void> {
  const param = (name: string): string => {
    const match = new RegExp(`[?&#]${name}=([^&#]*)`).exec(callback);
    return match ? decodeURIComponent(match[1]!.replace(/\+/g, " ")) : "";
  };

  const code = param("code");
  if (!code) throw new Error(param("error_description") || "Sign-in was cancelled.");

  const verifier = await SecureStore.get(VERIFIER_KEY);
  await SecureStore.remove(VERIFIER_KEY);
  if (typeof verifier !== "string" || !verifier) {
    throw new Error("The sign-in had expired. Try signing in again.");
  }

  refreshing = undefined;
  await writeSession(
    await requestTokens({
      grant_type: "authorization_code",
      code,
      client_id: AUTH_CLIENT_ID,
      redirect_uri: AUTH_REDIRECT_URI,
      code_verifier: verifier,
    }),
  );
}
