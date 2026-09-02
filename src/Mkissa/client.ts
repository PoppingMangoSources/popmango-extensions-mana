/* SPDX-License-Identifier: GPL-3.0-or-later */

import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

import {
  UrlBuilder,
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  decodeHex,
  sha256,
  sha256Hex,
  utf8ToBytes,
} from "../common/index.ts";
import {
  API_URL,
  BASE_URL,
  BUILD_ID,
  MIRROR_HOSTS,
  PAGES_QUERY,
  SIGNING_PART_A,
  TS_BUCKET_MS,
  type ChapterPageEdge,
  type GraphQLResponse,
  type PagesResponse,
  type SigningBootstrap,
} from "./model.ts";

function isCloudflareChallenge(response: NetworkResponse): boolean {
  const headers = response.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "cf-mitigated");
  return key !== undefined && String(headers[key] ?? "").toLowerCase() === "challenge";
}

/**
 * The signing key is one fixed half XORed with a half the site serves, so it can rotate
 * the key without shipping a new bundle.
 */
function deriveSigningKey(partB: string): Uint8Array {
  const fixed = decodeHex(SIGNING_PART_A);
  const served = base64ToBytes(partB);
  if (served.length < 32) throw new Error("Mkissa returned a signing half that is too short");

  const key = new Uint8Array(32);
  for (let i = 0; i < key.length; i++) key[i] = fixed[i]! ^ served[i]!;
  return key;
}

function buildSignature(key: Uint8Array, epoch: number, queryHash: string): string {
  // The timestamp is bucketed so a signature stays valid for the whole window.
  const ts = Math.floor(Date.now() / TS_BUCKET_MS) * TS_BUCKET_MS;
  const payload = JSON.stringify({ v: 1, ts, epoch, buildId: BUILD_ID, qh: queryHash });
  const iv = sha256(utf8ToBytes(`${epoch}:${BUILD_ID}:${queryHash}:${ts}`)).slice(0, 12);
  const sealed = aesGcmEncrypt(utf8ToBytes(payload), key, iv);

  const out = new Uint8Array(13 + sealed.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(sealed, 13);
  return bytesToBase64(out);
}

export class MkissaApi {
  private client: NetworkClient | undefined;
  private bootstrap: SigningBootstrap | undefined;

  private get http(): NetworkClient {
    this.client ??= new NetworkClientBuilder()
      .setRateLimit(3, 1)
      // The signed page request is read for its status before its body is parsed.
      .setStatusValidator(() => true)
      .addRequestInterceptor(async (request: NetworkRequest) => ({
        ...request,
        headers: {
          accept: request.url.startsWith(API_URL)
            ? "application/json, text/plain, */*"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          referer: `${BASE_URL}/`,
          origin: BASE_URL,
          ...request.headers,
        },
      }))
      .addResponseInterceptor(async (response: NetworkResponse) => {
        if (isCloudflareChallenge(response)) throw new CloudflareError(BASE_URL);
        return response;
      })
      .build();
    return this.client;
  }

  /** Runs a GraphQL operation over POST, which needs no signature. */
  async fetchGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.http.post(API_URL, {
      body: { query, variables },
      headers: { "content-type": "application/json" },
    });

    if (response.status >= 400) {
      throw new Error(`Mkissa rejected the request (HTTP ${response.status})`);
    }

    let parsed: GraphQLResponse<T>;
    try {
      parsed = JSON.parse(response.data) as GraphQLResponse<T>;
    } catch {
      throw new Error("Mkissa returned a response that was not JSON");
    }

    if (parsed.errors?.length) {
      throw new Error(parsed.errors.map((error) => error.message).join("\n"));
    }
    if (!parsed.data) throw new Error("Mkissa returned no data");

    return parsed.data;
  }

  /**
   * Chapter pages come only from a signed GET. The body may arrive in the clear or sealed
   * under `tobeparsed` with the same key that signed the request.
   */
  async fetchChapterPages(mangaId: string, chapter: string): Promise<PagesResponse | undefined> {
    const bootstrap = await this.fetchSigningBootstrap();
    if (!bootstrap) return undefined;

    const key = deriveSigningKey(bootstrap.partB);
    const queryHash = sha256Hex(utf8ToBytes(PAGES_QUERY));
    const signature = buildSignature(key, bootstrap.epoch, queryHash);

    const url = new UrlBuilder(API_URL)
      .setQueryItem("query", PAGES_QUERY)
      .setQueryItem(
        "variables",
        JSON.stringify({
          mangaId,
          translationType: "sub",
          chapterString: chapter,
          limit: 10,
          offset: 0,
        }),
      )
      .setQueryItem(
        "extensions",
        JSON.stringify({
          persistedQuery: { version: 1, sha256Hash: queryHash },
          aaReq: signature,
        }),
      )
      .build();

    const response = await this.http.get(url);
    if (response.status !== 200) return undefined;

    const parsed = JSON.parse(response.data) as {
      data?: { chapterPages?: PagesResponse["chapterPages"]; tobeparsed?: string } | null;
    };

    let pages = parsed.data?.chapterPages ?? undefined;
    if (!pages?.edges?.length && parsed.data?.tobeparsed) {
      pages = this.unsealPages(parsed.data.tobeparsed, key);
    }

    return pages?.edges?.length ? { chapterPages: pages } : undefined;
  }

  private unsealPages(value: string, key: Uint8Array): { edges: ChapterPageEdge[] } | undefined {
    const bytes = base64ToBytes(value);
    // Same envelope the signature uses: a version byte, a 12-byte IV, then the sealed body.
    const plain = aesGcmDecrypt(bytes.slice(13), key, bytes.slice(1, 13));
    const decoded = JSON.parse(bytesToUtf8(plain)) as {
      chapterPages?: { edges: ChapterPageEdge[] } | null;
      edges?: ChapterPageEdge[];
    };

    return decoded.chapterPages ?? (decoded.edges ? { edges: decoded.edges } : undefined);
  }

  private async fetchSigningBootstrap(): Promise<SigningBootstrap | undefined> {
    const now = Date.now();
    if (this.bootstrap && this.bootstrap.switchAt > now) return this.bootstrap;

    for (const host of MIRROR_HOSTS) {
      const response = await this.http
        .get(`https://${host}/client-crypto/v1/bootstrap?buildId=${BUILD_ID}`)
        .catch((error: unknown) => {
          if (error instanceof CloudflareError) throw error;
          return undefined;
        });

      if (!response || response.status !== 200) continue;

      const match = /window\.__aaCrypto\s*=\s*(\{.*?\})\s*;/.exec(response.data);
      if (!match?.[1]) continue;

      const json = JSON.parse(match[1]) as { epoch?: number; partB?: string; switchAt?: number };
      if (typeof json.epoch !== "number" || typeof json.partB !== "string") continue;

      this.bootstrap = {
        epoch: json.epoch,
        partB: json.partB,
        switchAt: typeof json.switchAt === "number" ? json.switchAt : now + TS_BUCKET_MS,
      };
      return this.bootstrap;
    }

    return undefined;
  }
}
