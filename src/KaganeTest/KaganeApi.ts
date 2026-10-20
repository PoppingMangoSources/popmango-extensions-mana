/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Chapter traversal adapted from LucifersCircle/pirate.vodka-extensions (Inkdex). */
import {
  Body,
  CloudflareError,
  HttpClient,
  HttpMethod,
  HttpResponse,
  JsonValue,
} from "@mana-app/types";
import {
  ageRatings,
  api,
  Book,
  Challenge,
  Detail,
  Genre,
  ManifestPage,
  origin,
  parseURL,
  Rating,
  SearchResponse,
  Series,
  strictUUID,
  TagEntry,
  TrendingEntry,
  trustedHost,
  UploadSource,
  uploadTypes,
  validId,
} from "./KaganeModels";

type CacheEntry = { at: number; value: unknown };
const TAXONOMY_TTL = 24 * 60 * 60 * 1000;
// Public raw lists carry no selected-rating or reader-session state. Sharing them
// avoids fetching thousands of tags again for every preference edit or instance.
const publicTaxonomy = new Map<string, CacheEntry>();
const publicTaxonomyRequests = new Map<string, Promise<unknown>>();

export class KaganeApi {
  private readonly client = new HttpClient()
    .setRateLimit(3, 1000)
    .setTimeoutMs(30_000)
    .addHeader("Accept", "application/json")
    .addHeader("Content-Type", "application/json")
    .addRequestInterceptor((request) => ({
      ...request,
      headers: request.headers.setAll({ Origin: origin(), Referer: `${origin()}/` }),
    }));
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private generation = 0;
  private token = "";
  private expiry = 0;
  private integrityRequest?: Promise<string>;

  invalidate(): void {
    this.generation += 1;
    this.cache.clear();
    this.inflight.clear();
    this.token = "";
    this.expiry = 0;
    this.integrityRequest = undefined;
  }

  private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const cacheKey = `${generation}:${key}`;
    const entry = this.cache.get(cacheKey);
    if (entry && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T);
    const running = this.inflight.get(cacheKey);
    if (running) return running as Promise<T>;
    const request = load()
      .then((value) => {
        if (generation !== this.generation)
          throw new Error("Kagane settings changed; refresh to continue");
        if (ttl > 0) {
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string);
          this.cache.set(cacheKey, { at: Date.now(), value });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(cacheKey) === request) this.inflight.delete(cacheKey);
      });
    this.inflight.set(cacheKey, request);
    return request;
  }

  private taxonomy<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = publicTaxonomy.get(key);
    if (entry && Date.now() - entry.at < TAXONOMY_TTL) return Promise.resolve(entry.value as T);
    const running = publicTaxonomyRequests.get(key);
    if (running) return running as Promise<T>;
    const request = load()
      .then((value) => {
        publicTaxonomy.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        if (publicTaxonomyRequests.get(key) === request) publicTaxonomyRequests.delete(key);
      });
    publicTaxonomyRequests.set(key, request);
    return request;
  }

  private async response(
    url: string,
    body?: Record<string, JsonValue>,
    headers?: Record<string, string>,
  ): Promise<HttpResponse> {
    let response: HttpResponse;
    try {
      response = await this.client.request(
        {
          url,
          method: body === undefined ? HttpMethod.Get : HttpMethod.Post,
          ...(body === undefined ? {} : { body: Body.json(body) }),
        },
        { headers },
      );
    } catch (error) {
      // The SDK detects positive challenges before response interceptors.
      if (error instanceof CloudflareError) {
        this.token = "";
        this.expiry = 0;
      }
      throw error;
    }
    const type = response.headers.get("content-type") ?? "";
    const mitigated = response.headers.get("cf-mitigated") === "challenge";
    if (
      mitigated ||
      ((response.status === 403 || response.status === 503) &&
        !type.includes("application/json") &&
        /cf-chl-|_cf_chl_opt|Just a moment|cf-browser-verification/i.test(await response.text()))
    ) {
      this.token = "";
      this.expiry = 0;
      throw new CloudflareError(`${origin()}/`);
    }
    return response;
  }

  private async parse<T>(response: HttpResponse): Promise<T> {
    // Never include token-bearing URLs or remote response bodies in errors.
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Kagane request failed (HTTP ${response.status})`);
    try {
      return await response.json<T>();
    } catch {
      throw new Error("Kagane returned invalid JSON");
    }
  }

  private async json<T>(path: string, body?: Record<string, JsonValue>): Promise<T> {
    return this.parse<T>(await this.response(`${api()}${path}`, body));
  }

  search(
    body: Record<string, JsonValue>,
    page: number,
    size: number,
    sort: string,
    exactMatch = false,
  ): Promise<SearchResponse> {
    const path = `/search/series?page=${page - 1}&size=${size}${sort ? `&sort=${encodeURIComponent(sort)}` : ""}${exactMatch ? "&exact_match=true" : ""}`;
    return this.cached(`search:${path}:${JSON.stringify(body)}`, 30_000, async () => {
      const result = await this.json<SearchResponse>(path, body);
      if (!result || !Array.isArray(result.content) || typeof result.last !== "boolean")
        throw new Error("Kagane search pagination is invalid");
      return result;
    });
  }

  series(id: string): Promise<Detail> {
    return this.cached(`series:${validId(id)}`, 120_000, async () => {
      const result = await this.json<Detail>(`/series/${id}`);
      if (
        !result ||
        typeof result.title !== "string" ||
        !result.title.trim() ||
        (result.series_id !== undefined && result.series_id !== id)
      )
        throw new Error("Kagane returned invalid series details");
      return result;
    });
  }

  trackerSeries(id: string): Promise<unknown[]> {
    const tracker = strictUUID(id);
    if (!tracker) throw new Error("Invalid Kagane tracker ID");
    // Cache only raw bulk rows. The current caller must reapply every policy.
    return this.cached(`tracker-series:${tracker}`, 30_000, async () => {
      const result = await this.json<{ book_series: unknown[] }>(`/trackers/${tracker}/series`);
      if (!result || !Array.isArray(result.book_series))
        throw new Error("Kagane edition list is invalid");
      return result.book_series;
    });
  }

  genres(): Promise<Genre[]> {
    return this.taxonomy("genres", async () => {
      const items = await this.json<Genre[]>("/genres/list");
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.some(
          (item) => !item || typeof item.id !== "string" || typeof item.genre_name !== "string",
        )
      )
        throw new Error("Kagane genres are unavailable");
      return items;
    });
  }

  tags(): Promise<TagEntry[]> {
    return this.taxonomy("tags", async () => {
      const items = await this.json<TagEntry[]>("/tags/list");
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.some(
          (item) =>
            !item ||
            typeof item.id !== "string" ||
            !item.id.trim() ||
            typeof item.tag_name !== "string" ||
            !item.tag_name.trim(),
        )
      )
        throw new Error("Kagane tags are unavailable");
      return items;
    });
  }

  sources(): Promise<UploadSource[]> {
    return this.taxonomy("sources", async () => {
      const result = await this.json<{ sources: UploadSource[] }>("/sources/list", {
        source_types: null,
      });
      if (
        !Array.isArray(result?.sources) ||
        !result.sources.length ||
        result.sources.some(
          (item) =>
            !item ||
            typeof item.source_id !== "string" ||
            typeof item.title !== "string" ||
            typeof item.source_type !== "string",
        )
      )
        throw new Error("Kagane upload sources are unavailable");
      return result.sources;
    });
  }

  // One request for the whole list; each row is a column array named by `fields`.
  books(seriesId: string): Promise<Book[]> {
    return this.cached(`books:${validId(seriesId)}`, 120_000, async () => {
      const index = await this.json<{
        fields: string[];
        books: unknown[][];
        groups?: { title: string }[];
        count: number;
      }>(`/series/${seriesId}/books/index?fields=List`);
      if (
        !Array.isArray(index?.fields) ||
        !Array.isArray(index.books) ||
        !Number.isSafeInteger(index.count) ||
        index.books.length !== index.count
      )
        throw new Error("Kagane chapter index is invalid");
      const seen = new Set<string>();
      const isoTime = (value: unknown): unknown =>
        typeof value === "number" ? new Date(value * 1000).toISOString() : value;
      return index.books.map((row) => {
        if (!Array.isArray(row) || row.length !== index.fields.length)
          throw new Error("Kagane chapter index has an invalid row");
        const book: Record<string, unknown> = Object.fromEntries(
          index.fields.map((field, column) => [field, row[column]]),
        );
        if (
          typeof book.book_id !== "string" ||
          seen.has(book.book_id) ||
          typeof book.title !== "string"
        )
          throw new Error("Kagane chapter index has invalid or duplicate IDs");
        seen.add(validId(book.book_id));
        const groups = Array.isArray(book.group_ix)
          ? book.group_ix
              .map((position) => index.groups?.[position])
              .filter((group): group is { title: string } => typeof group?.title === "string")
          : undefined;
        return {
          ...book,
          groups,
          released_at: isoTime(book.released_at),
          available_at: isoTime(book.available_at),
        } as Book;
      });
    });
  }

  async trending(
    ratings: readonly Rating[],
    languages: string[],
    hideDisturbing: boolean,
  ): Promise<TrendingEntry[]> {
    const query = [
      "limit=5",
      `age_rating=${encodeURIComponent(ageRatings(ratings).join(","))}`,
      // The chart takes at most five languages; longer lists are matched locally.
      ...(languages.length && languages.length <= 5
        ? [`lang=${encodeURIComponent(languages.join(","))}`]
        : []),
      ...(!ratings.includes("Pornographic")
        ? ["is_pornographic=false"]
        : ratings.length === 1
          ? ["is_pornographic=true"]
          : []),
      ...(hideDisturbing ? ["is_disturbing=false"] : []),
    ].join("&");
    const result = await this.json<{ items: TrendingEntry[] }>(`/series/trending?${query}`);
    if (
      !Array.isArray(result?.items) ||
      result.items.some((entry) => !entry?.series || typeof entry.series.series_id !== "string")
    )
      throw new Error("Kagane trending chart is invalid");
    return result.items;
  }

  // Recommendations take visibility toggles, not the catalogue's exact-match flags.
  async similar(
    seriesId: string,
    ratings: readonly Rating[],
    languages: string[],
    uploadSource: string,
    hideDisturbing: boolean,
  ): Promise<Series[]> {
    const query = [
      "kind=similar",
      "limit=10",
      `age_rating=${encodeURIComponent(ageRatings(ratings).join(","))}`,
      `is_pornographic=${ratings.includes("Pornographic")}`,
      `is_disturbing=${!hideDisturbing}`,
      ...(languages.length ? [`lang=${encodeURIComponent(languages.join(","))}`] : []),
      ...(uploadSource === "all"
        ? []
        : [`source_type=${encodeURIComponent(uploadTypes(uploadSource).join(","))}`]),
    ].join("&");
    const result = await this.parse<SearchResponse>(
      await this.response(`${origin()}/api/v1/rec/series/${validId(seriesId)}/similar?${query}`),
    );
    if (!Array.isArray(result?.content)) throw new Error("Kagane recommendations are invalid");
    return result.content;
  }

  // Facets include uploader languages the site's own menu leaves out.
  languages(): Promise<string[]> {
    return this.taxonomy("languages", async () => {
      const result = await this.json<SearchResponse>(
        "/search/series?page=0&size=1&facets=true",
        {},
      );
      const values = [
        ...new Set(
          (result?.facets?.content_lang ?? [])
            .map((entry) => entry?.value)
            .filter((value): value is string => typeof value === "string" && !!value.trim()),
        ),
      ];
      if (!values.length) throw new Error("Kagane languages are unavailable");
      return values;
    });
  }

  resolvePerson(kind: "staff" | "groups", name: string): Promise<string> {
    const id = strictUUID(name);
    if (id) return Promise.resolve(id);
    return this.cached(`${kind}:${name.toLowerCase()}`, 120_000, async () => {
      const candidates =
        kind === "staff"
          ? (
              await this.json<{ content: { staff_id: string; name: string }[] }>(
                "/search/staff?size=8",
                { name },
              )
            ).content.map((person) => ({ id: person.staff_id, name: person.name }))
          : (
              await this.json<{ items: { group_id: string; title: string }[] }>(
                `/groups/search?q=${encodeURIComponent(name)}&limit=8`,
              )
            ).items.map((group) => ({ id: group.group_id, name: group.title }));
      const exact = candidates.filter(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
      );
      const matches = exact.length ? exact : candidates;
      if (matches.length === 1 && matches[0]) return matches[0].id;
      throw new Error(
        matches.length
          ? `Several Kagane matches for ${name}; enter the full name`
          : `No Kagane matches for ${name}`,
      );
    });
  }

  private integrity(force = false): Promise<string> {
    if (!force && this.token && Date.now() + 5000 < this.expiry) return Promise.resolve(this.token);
    if (this.integrityRequest) return this.integrityRequest;
    const generation = this.generation;
    const request = (async () => {
      const warmup = await this.response(`${origin()}/`);
      if (warmup.status >= 400)
        throw new Error(`Kagane session bootstrap failed (HTTP ${warmup.status})`);
      const result = await this.parse<{ token: string; exp: number }>(
        await this.response(`${origin()}/api/integrity`, {}),
      );
      if (
        !result ||
        typeof result.token !== "string" ||
        !result.token ||
        !Number.isFinite(result.exp) ||
        result.exp * 1000 <= Date.now()
      )
        throw new Error("Kagane returned an invalid reader bootstrap");
      if (generation !== this.generation)
        throw new Error("Kagane settings changed; refresh to continue");
      this.token = result.token;
      this.expiry = result.exp * 1000;
      return this.token;
    })().finally(() => {
      if (this.integrityRequest === request) this.integrityRequest = undefined;
    });
    this.integrityRequest = request;
    return request;
  }

  async challenge(chapterId: string, dataSaver: boolean): Promise<Challenge> {
    validId(chapterId);
    return this.cached(`reader:${chapterId}:${dataSaver}`, 0, async () => {
      for (const force of [false, true]) {
        const token = await this.integrity(force);
        const response = await this.response(
          `${api()}/books/${chapterId}?is_datasaver=${dataSaver}`,
          {},
          { "x-integrity-token": token },
        );
        if ([401, 403, 507].includes(response.status) && !force) {
          // Refresh only the public session bootstrap, never a login or paid entitlement.
          if (
            /login|sign.?in|subscription|premium|purchase|payment|paid|permission/i.test(
              await response.text(),
            )
          )
            break;
          this.token = "";
          this.expiry = 0;
          continue;
        }
        const result = await this.parse<Challenge>(response);
        const pages = result?.manifest?.pages;
        if (
          !result ||
          typeof result.access_token !== "string" ||
          !result.access_token ||
          !Array.isArray(pages) ||
          !pages.length
        )
          throw new Error("Kagane reader manifest is missing pages");
        const ids = new Set<string>();
        const positions = new Set<number>();
        for (const page of pages) {
          if (
            !page ||
            !Number.isInteger(page.page_no) ||
            page.page_no < 0 ||
            typeof page.page_id !== "string" ||
            !/^[A-Za-z0-9_-]+$/.test(page.page_id) ||
            (page.ext != null && !/^[a-z0-9]+$/i.test(page.ext)) ||
            ids.has(page.page_id) ||
            positions.has(page.page_no)
          )
            throw new Error("Kagane reader manifest contains invalid pages");
          ids.add(page.page_id);
          positions.add(page.page_no);
        }
        const ordered = [...positions].sort((left, right) => left - right);
        if (
          (ordered[0] !== 0 && ordered[0] !== 1) ||
          ordered.some((position, index) => position !== (ordered[0] ?? 0) + index)
        )
          throw new Error("Kagane reader manifest page order is incomplete");
        this.cacheOrigin(result.cache_url);
        return result;
      }
      throw new Error(
        "Kagane requires account access or rejected the reader token; open the chapter on the website",
      );
    });
  }

  private cacheOrigin(value?: string | null): string {
    const url = parseURL(value || origin());
    // Do not trust arbitrary cache_url hosts or all domains under that CDN.
    if (!url || !trustedHost(url.hostname))
      throw new Error("Kagane returned an untrusted image server");
    return url.origin;
  }

  pageURL(challenge: Challenge, chapterId: string, page: ManifestPage, dataSaver: boolean): string {
    return `${this.cacheOrigin(challenge.cache_url)}/api/v2/books/page/${validId(chapterId)}/${encodeURIComponent(page.page_id)}.${page.ext || "jxl"}?token=${encodeURIComponent(challenge.access_token)}&is_datasaver=${dataSaver}`;
  }
}
