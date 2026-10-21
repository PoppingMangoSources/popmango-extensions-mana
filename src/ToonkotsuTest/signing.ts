/* SPDX-License-Identifier: GPL-3.0-or-later */

import { base64ToBytes, bytesToBase64Url, utf8ToBytes } from "../common/bytes.ts";
import { hmacSha256, sha256 } from "../common/aes.ts";
import { type SitePage } from "./model.ts";

const READER_SECRET = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";

type ReaderKeyResponse = { key: string; now: number };

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.replace(/=+$/, "").length % 4 === 1) {
    throw new Error("Toonkotsu sent invalid base64 reader data.");
  }
  return base64ToBytes(value, true);
}

function xor(data: Uint8Array, mask: Uint8Array): Uint8Array {
  return data.map((byte, i) => byte ^ mask[i % mask.length]!);
}

export class ReaderSigner {
  private constructor(
    private readonly key: Uint8Array,
    private readonly offset: number,
  ) {}

  static from(value: unknown): ReaderSigner {
    const response = value as Partial<ReaderKeyResponse> | undefined;
    if (typeof response?.key !== "string" || !Number.isFinite(response.now)) {
      throw new Error("Toonkotsu sent an invalid signing key.");
    }
    const mask = sha256(utf8ToBytes(`sign:${READER_SECRET}`));
    return new ReaderSigner(xor(decode(response.key), mask), response.now! - Date.now());
  }

  header(path: string): string {
    const time = String(Date.now() + this.offset);
    // The server accepts a nonce derived from the request, so this needs no host RNG.
    const nonce = bytesToBase64Url(sha256(utf8ToBytes(`${time}.${path}`)).subarray(0, 12));
    const signature = bytesToBase64Url(
      hmacSha256(this.key, utf8ToBytes(`${time}.${nonce}.${path}`)),
    );
    return `v1.${time}.${nonce}.${signature.slice(0, 32)}`;
  }

  unwrap(body: unknown): unknown {
    const response = body as { wrap?: string; chapter?: { pages?: SitePage[] } } | undefined;
    if (!response?.wrap) return body;
    if (response.wrap !== "v1") {
      throw new Error(`Unsupported Toonkotsu reader encryption: ${response.wrap}`);
    }
    const pages = response.chapter?.pages;
    if (!Array.isArray(pages)) throw new Error("Toonkotsu sent no chapter pages.");
    return {
      ...response,
      wrap: undefined,
      chapter: {
        ...response.chapter,
        pages: pages.map((page) => {
          if (page.k == null && page.n == null) return page;
          if (typeof page.k !== "string" || typeof page.n !== "string") {
            throw new Error("Toonkotsu sent incomplete page keys.");
          }
          const mask = hmacSha256(this.key, utf8ToBytes(`page.${page.n}`));
          return { ...page, k: bytesToBase64Url(xor(decode(page.k), mask)) };
        }),
      },
    };
  }
}
