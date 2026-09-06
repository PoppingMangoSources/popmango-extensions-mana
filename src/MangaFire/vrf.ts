/* SPDX-License-Identifier: GPL-3.0-or-later */

import { base64ToBytes, bytesToBase64Url, utf8ToBytes } from "../common/index.ts";

/**
 * The signature the site's API asks for on every request.
 *
 * Each call to `/api/…` carries a `vrf` parameter derived from the request itself. Without
 * it the API refuses, so this is not an optimisation — nothing here reads without it.
 *
 * The scheme is three chained substitution passes over the canonical request line. Each
 * pass walks the bytes left to right, combining the byte with a repeating key and with the
 * byte it produced last, then looking the result up in a 256-entry table; the running value
 * makes every byte depend on all the bytes before it. The three tables, their keys and the
 * value each pass starts from are the site's own, and are what make the output verifiable
 * at its end. The result is base64url with no padding, so it survives a query string as-is.
 */

// Verbatim from the site's own client. They are lookup tables and repeating keys, not
// secrets to be derived: the API is signed, not authenticated.
const STAGE_TABLES = [
  "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
  "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
  "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==",
];

const STAGE_KEYS = [
  "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
  "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
  "DELOJgPsVaCcblDtTGMdHzM=",
];

const STAGE_SEEDS = [0x5a, 0x35, 0xba];

type Stage = { table: Uint8Array; key: Uint8Array; seed: number };

let stages: Stage[] | undefined;

/** Decoded once: the tables are a kilobyte each and every request signs through them. */
function stageTable(): Stage[] {
  stages ??= STAGE_TABLES.map((table, index) => ({
    table: base64ToBytes(table),
    key: base64ToBytes(STAGE_KEYS[index]!),
    seed: STAGE_SEEDS[index]!,
  }));
  return stages;
}

function substitute(data: Uint8Array, stage: Stage): Uint8Array {
  const output = new Uint8Array(data.length);
  let previous = stage.seed;

  for (let index = 0; index < data.length; index++) {
    previous =
      stage.table[(data[index]! ^ stage.key[index % stage.key.length]! ^ previous) & 0xff]!;
    output[index] = previous;
  }

  return output;
}

/** Signs a canonical request line. See `canonicalise` for how one is spelled. */
export function sign(canonical: string): string {
  let data = utf8ToBytes(canonical);
  for (const stage of stageTable()) data = substitute(data, stage);
  return bytesToBase64Url(data);
}

export type QueryParam = readonly [key: string, value: string];

/**
 * The exact line the signature is taken over, which is not the URL that gets sent.
 *
 * Three details have to match the site's own client or the signature is refused:
 * the `/api` prefix is dropped, the parameters are sorted by key, and a repeated key
 * written `name[]` is numbered `name[0]`, `name[1]` in the order it repeats. Values are
 * spelled out raw — the signature covers what was asked for, not how it was escaped.
 */
export function canonicalise(path: string, params: readonly QueryParam[]): string {
  if (params.length === 0) return path;

  const sorted = [...params].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  let lastKey = "";
  let repeat = 0;

  const query = sorted
    .map(([key, value]) => {
      if (!key.endsWith("[]")) return `${key}=${value}`;
      if (key !== lastKey) repeat = 0;
      lastKey = key;
      return `${key.slice(0, -2)}[${repeat++}]=${value}`;
    })
    .join("&");

  return `${path}?${query}`;
}
