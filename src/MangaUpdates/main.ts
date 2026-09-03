/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  BasicAuthenticationUIIdentifier,
  CatalogRating,
  DefinedLanguages,
  SearchExcludableMultiPicker,
  SearchGroup,
  SearchMultiPicker,
  SearchMultiPickerSheet,
  SearchPicker,
  SearchTextField,
  UIButton,
  UIListSection,
  UIPicker,
  UIStepper,
  UITextField,
  type BasicAuthenticatable,
  type BooleanState,
  type Content,
  type ContentTracker,
  type DeepLinkContext,
  type Form,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type SourcePreferenceProvider,
  type SourceSetupProvider,
  type TrackEntry,
  type TrackProgressUpdate,
  type TrackerConfig,
  type TrackerStatusOption,
  type User,
} from "@mana-app/types";

import {
  FilterReader,
  buildSearchForm,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
} from "../common/index.ts";
import { MangaUpdatesApi, UnauthorizedError } from "./client.ts";
import {
  BASE_URL,
  DEFAULT_STATUS,
  DISCOVER_SECTIONS,
  FilterID,
  LICENSED_OPTIONS,
  PAGE_SIZE,
  RELEASE_FILTER_OPTIONS,
  SECTION_SIZE,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  SortID,
  TYPE_OPTIONS,
  UNSAFE_GENRES,
  type Genre,
  type ListDefinition,
  type ListEntry,
  type LoginResponse,
  type Profile,
  type RatingResponse,
  type Series,
  type SeriesSearchBody,
  type SeriesSearchResponse,
} from "./model.ts";
import { parseContent, parseHighlight } from "./parsers.ts";
import {
  clearToken,
  decodeSession,
  forgetPassword,
  forgetPendingCredentials,
  readPendingCredentials,
  readToken,
  rememberPassword,
  rememberUsername,
  writeToken,
} from "./session.ts";

const info: SourceInfo = {
  id: "mangaupdates",
  name: "MangaUpdates",
  version: "1.0.6",
  description: "Track your reading against mangaupdates.com.",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "MangaUpdates.png",
  developers: [{ name: "PoppingMango", github: "https://github.com/PoppingMangoSources" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  // Browsing works signed out, but a tracker exists to write to an account — this is what
  // tells the app the source has one, and to offer signing into it.
  requiresAuthenticationToAccessContent: true,
};

const trackerConfig: TrackerConfig = {
  // What a source calls this tracker in its `Content.trackerInfo`, so a title that
  // already knows its MangaUpdates id links itself without the reader searching.
  linkKeys: ["mangaupdates", "mangaUpdates", "manga_updates"],
  owningLinks: ["mangaupdates.com", "www.mangaupdates.com"],
};

const SETUP_FIELD = {
  Username: "username",
  Password: "password",
} as const;

const ENTRY_FIELD = {
  Status: "status",
  Chapter: "chapter",
  Volume: "volume",
  Score: "score",
} as const;

class MangaUpdatesTracker
  implements
    ContentTracker,
    PageLinkResolver,
    BasicAuthenticatable,
    SourcePreferenceProvider,
    SourceSetupProvider
{
  readonly info = info;
  readonly config = config;
  readonly trackerConfig = trackerConfig;

  // The types call this `BasicAuthUIIdentifier` while the toolchain reads
  // `BasicAuthenticationUIIdentifier`, so both names carry the same answer.
  readonly BasicAuthUIIdentifier = BasicAuthenticationUIIdentifier.USERNAME;
  readonly BasicAuthenticationUIIdentifier = BasicAuthenticationUIIdentifier.USERNAME;

  private readonly api = new MangaUpdatesApi();

  private genreOptions: Option[] | undefined;
  private lists: Promise<ListDefinition[]> | undefined;

  // ===================== Authentication =====================

  /**
   * Signing in on a screen the app owns.
   *
   * A source cannot redraw its own settings, so a sign-in built out of a button there can
   * never show its own result. This one is submitted rather than pressed: the app collects
   * both fields, hands them over in one call, and closes the screen itself when that call
   * returns — which is the confirmation the settings form cannot give.
   */
  async getSetupMenu(): Promise<Form> {
    return {
      sections: [
        UIListSection({
          header: "Sign In",
          footer:
            "Your mangaupdates.com username and password. The password is used once to " +
            "obtain a session and is not kept.",
          children: [
            UITextField({ id: SETUP_FIELD.Username, title: "Username", value: "" }),
            UITextField({ id: SETUP_FIELD.Password, title: "Password", value: "", secure: true }),
          ],
        }),
      ],
    };
  }

  async validateSetupForm(data: unknown): Promise<void> {
    const submitted = (data ?? {}) as Record<string, unknown>;
    const username = submitted[SETUP_FIELD.Username];
    const password = submitted[SETUP_FIELD.Password];

    await this.handleBasicAuth(
      typeof username === "string" ? username : "",
      typeof password === "string" ? password : "",
    );
  }

  // The toolchain reads `isRunnerSetup` while the types declare `isSourceSetup`, so both
  // names answer — the same split as `BasicAuthUIIdentifier` above.
  async isSourceSetup(): Promise<BooleanState> {
    return { state: (await readToken()).length > 0 };
  }

  async isRunnerSetup(): Promise<BooleanState> {
    return this.isSourceSetup();
  }

  /**
   * The account screen.
   *
   * Nothing here can announce itself. A source is given a store and a network client and
   * no way to redraw this screen or raise a notice, and the app builds it only when it is
   * opened — so a press changes the account and leaves the screen showing the old one. The
   * state is therefore written out in full every time it is built, and the screen says
   * plainly that it has to be reopened. `getSetupMenu` above is the sign-in that does
   * confirm itself, because the app owns that screen and closes it.
   */
  async getPreferenceMenu(): Promise<Form> {
    const user = await this.getAuthenticatedUser();

    if (user) {
      return {
        sections: [
          UIListSection({
            header: "Account",
            footer:
              `Signed in as ${user.handle}. Signing out takes effect immediately, but ` +
              "this screen cannot redraw itself — close Settings and open it again to see " +
              "it change.",
            children: [
              UITextField({
                id: "status",
                title: "Status",
                value: `Signed in as ${user.handle}`,
              }),
              UIButton({
                id: "sign-out",
                title: `Sign Out of ${user.handle}`,
                isDestructive: true,
                // Nothing surfaces from here, so the outcome goes to the log rather than
                // the reader. What the reader gets is the state written above.
                action: async () => {
                  const signedIn = decodeSession(await readToken());
                  if (!signedIn) throw new Error("Already signed out.");

                  await this.handleUserSignOut();
                  throw new Error(`Signed out of ${signedIn.username}.`);
                },
              }),
            ],
          }),
        ],
      };
    }

    const pending = await readPendingCredentials();

    return {
      sections: [
        UIListSection({
          header: "Account",
          footer:
            "Not signed in. Enter your mangaupdates.com username and password, then press " +
            "Sign In — this screen cannot redraw itself, so close Settings and open it " +
            "again to confirm it worked. The password is held only until it has been " +
            "offered to the site, and the session it returns is what is kept.",
          children: [
            UITextField({
              id: "status",
              title: "Status",
              value: "Not signed in",
            }),
            UITextField({
              id: "username",
              title: "Username",
              value: pending.username,
              didChange: rememberUsername,
            }),
            UITextField({
              id: "password",
              title: "Password",
              // Never rendered back: the field starts empty even when one is being held.
              value: "",
              secure: true,
              didChange: rememberPassword,
            }),
            UIButton({
              id: "sign-in",
              title: "Sign In",
              // The outcome cannot reach the reader from here — a thrown message only
              // reaches the app's log — so the guard below is what this is for: pressing
              // twice must not sign in twice.
              action: async () => {
                const existing = decodeSession(await readToken());
                if (existing) throw new Error(`Already signed in as ${existing.username}.`);

                const { username, password } = await readPendingCredentials();
                await this.handleBasicAuth(username, password);

                const handle = decodeSession(await readToken())?.username ?? username;
                throw new Error(`Signed in as ${handle}. Reopen Settings to manage it.`);
              },
            }),
          ],
        }),
      ],
    };
  }

  async handleBasicAuth(identifier: string, password: string): Promise<void> {
    const username = identifier.trim();
    // Said apart, because "fill both in" is no help to someone who filled one in.
    if (!username) throw new Error("Enter your MangaUpdates username.");
    if (!password) throw new Error("Enter the password for that account.");

    const response = await this.api
      .call<LoginResponse>("/account/login", "PUT", {
        anonymous: true,
        withoutSession: true,
        unreadableMeansRefused: true,
        body: { username, password },
      })
      .catch(async (error: unknown) => {
        // A refused password is not worth holding on to, whatever refused it.
        await forgetPassword();
        // Being told to sign in is unhelpful while signing in; the details are the problem.
        if (error instanceof UnauthorizedError) {
          throw new Error("MangaUpdates did not accept that username and password.");
        }
        throw error;
      });

    const token = response.context?.session_token;
    if (!token) {
      await forgetPassword();
      throw new Error("MangaUpdates did not return a session for those details.");
    }

    await writeToken(token);
    await forgetPendingCredentials();
    // A new account has its own lists, so anything remembered for the last one is stale.
    this.lists = undefined;
  }

  async getAuthenticatedUser(): Promise<User | null> {
    const token = await readToken();
    if (!token) return null;

    const session = decodeSession(token);

    try {
      const profile = await this.api.call<Profile>("/account/profile", "GET");
      const handle = profile.username ?? session?.username ?? "";
      if (!handle) return null;

      // The profile's `stats` are contribution counts — releases added, series edited —
      // which say nothing about what the account is reading, so they stay off this screen.
      const joined = (profile.time_joined?.as_string ?? "").trim();
      const info = joined ? [`Member since ${joined}`] : [];

      return {
        handle,
        ...(profile.avatar?.url ? { avatar: profile.avatar.url } : {}),
        ...(info.length > 0 ? { info } : {}),
      };
    } catch (error) {
      // A rejected token is a signed-out account; anything else is a passing failure and
      // must not throw away a session that is still good.
      if (error instanceof UnauthorizedError) {
        await clearToken();
        return null;
      }
      return session ? { handle: session.username } : null;
    }
  }

  async handleUserSignOut(): Promise<void> {
    // Best effort: the local token is dropped either way, or the reader cannot sign out.
    await this.api.call("/account/logout", "POST").catch(() => undefined);
    await clearToken();
    await forgetPendingCredentials();
    this.lists = undefined;
  }

  // ========================= Browsing =========================

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  private async genres(): Promise<Option[]> {
    if (this.genreOptions) return this.genreOptions;

    try {
      const response = await this.api.call<Genre[]>("/genres", "GET", { anonymous: true });
      const named = response
        .map((entry) => (entry.genre ?? "").trim())
        .filter((genre) => genre.length > 0);

      if (named.length > 0) {
        this.genreOptions = named.map((genre) => ({ id: genre, title: genre }));
        return this.genreOptions;
      }
    } catch {}

    this.genreOptions = [];
    return this.genreOptions;
  }

  async getSearchForm(): Promise<SearchForm> {
    const genres = await this.genres();

    return buildSearchForm({
      header: "Filters",
      fields: [
        SearchMultiPickerSheet({ id: FilterID.Types, title: "Types", options: TYPE_OPTIONS }),
        SearchMultiPicker({
          id: FilterID.Filters,
          title: "Releases",
          options: RELEASE_FILTER_OPTIONS,
        }),
        SearchGroup({
          id: "publication",
          title: "Publication",
          children: [
            SearchPicker({
              id: FilterID.Licensed,
              title: "Licensed",
              options: LICENSED_OPTIONS,
            }),
            SearchTextField({
              id: FilterID.Year,
              title: "Year",
              placeholder: "2015, or 2005-2009",
            }),
            SearchTextField({
              id: FilterID.Categories,
              title: "Categories",
              subtitle: "Reader-submitted tags, separated by commas",
              placeholder: "Time Travel, Villainess",
            }),
          ],
        }),
      ],
      ...(genres.length > 0
        ? {
            tags: SearchExcludableMultiPicker({
              id: FilterID.Genres,
              title: "Genres",
              options: genres,
            }),
            tagsHeader: "Genres",
          }
        : {}),
      sortHeader: "Sort",
    });
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(DISCOVER_SECTIONS);
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const { results } = await this.loadSection(sectionID, 1);
    return { items: results };
  }

  private async loadSection(sectionId: string, page: number): Promise<PagedSearchResult> {
    const spec = sectionById(DISCOVER_SECTIONS, sectionId);
    if (!spec) return { results: [], isLastPage: true };

    return this.browse({
      page,
      perpage: SECTION_SIZE,
      orderby: spec.sort,
      ...(spec.type ? { type: [spec.type] } : {}),
      // A discover row is browsed, not searched for, so the adult genres stay out of it.
      exclude_genre: UNSAFE_GENRES,
    });
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId && sectionById(DISCOVER_SECTIONS, request.listId)) {
      return this.loadSection(request.listId, pageOf(request));
    }

    const filters = new FilterReader(request);
    const genres = filters.excludable(FilterID.Genres);
    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Default);

    const categories = filters
      .text(FilterID.Categories)
      .split(",")
      .map((category) => category.trim())
      .filter((category) => category.length > 0);

    const licensed = filters.option(FilterID.Licensed);
    const types = filters.options(FilterID.Types);
    const releases = filters.options(FilterID.Filters);
    const year = filters.text(FilterID.Year).trim();

    return this.browse({
      page: pageOf(request),
      perpage: PAGE_SIZE,
      search: request.query?.trim() || undefined,
      // The site treats an empty sort as "best match", which it rejects as a value.
      ...(sort ? { orderby: sort } : {}),
      ...(genres.included.length > 0 ? { genre: genres.included } : {}),
      ...(genres.excluded.length > 0 ? { exclude_genre: genres.excluded } : {}),
      ...(categories.length > 0 ? { category: categories } : {}),
      ...(types.length > 0 ? { type: types } : {}),
      ...(releases.length > 0 ? { filters: releases } : {}),
      ...(licensed === "yes" || licensed === "no" ? { licensed } : {}),
      ...(year ? { year } : {}),
    });
  }

  private async browse(body: SeriesSearchBody): Promise<PagedSearchResult> {
    const response = await this.api.call<SeriesSearchResponse>("/series/search", "POST", {
      anonymous: true,
      body,
    });

    const results = (response.results ?? []).flatMap((result) => {
      const record = result.record;
      return record?.series_id == null ? [] : [parseHighlight(record, result.hit_title)];
    });

    const seen = (body.page - 1) * body.perpage + results.length;
    return { results, isLastPage: results.length === 0 || seen >= (response.total_hits ?? 0) };
  }

  async getContent(contentId: string): Promise<Content> {
    const series = await this.api.call<Series>(`/series/${seriesId(contentId)}`, "GET", {
      anonymous: true,
    });
    return parseContent(series);
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const contentId = seriesIdFromUrl(url);
    if (!contentId) return null;

    try {
      const content = await this.getContent(contentId);
      return {
        content: {
          id: contentId,
          title: content.title,
          cover: content.cover,
          ...(content.contentRating === undefined ? {} : { contentRating: content.contentRating }),
          ...(content.webUrl ? { webUrl: content.webUrl } : {}),
        },
      };
    } catch {
      return null;
    }
  }

  // ========================= Tracking =========================

  async getStatusOptions(): Promise<TrackerStatusOption[]> {
    return STATUS_OPTIONS.map((option) => ({
      ...option,
      ...(option.id === DEFAULT_STATUS ? { isDefault: true } : {}),
    }));
  }

  async getTrackEntry(id: string): Promise<TrackEntry | null> {
    const entry = await this.readEntry(id);
    if (!entry) return null;

    return {
      status: await this.statusOf(entry),
      progress: {
        lastReadChapter: entry.status?.chapter ?? 0,
        ...(entry.status?.volume ? { lastReadVolume: entry.status.volume } : {}),
      },
    };
  }

  async removeTracking(id: string): Promise<void> {
    await this.api.call("/lists/series/delete", "POST", {
      mutation: true,
      body: [seriesId(id)],
    });
  }

  async didUpdateLastReadChapter(id: string, progress: TrackProgressUpdate): Promise<void> {
    const entry = await this.readEntry(id);

    // The site stores whole numbers only, and a tracker must never walk progress back.
    const chapter = Math.max(Math.floor(progress.chapter ?? 0), entry?.status?.chapter ?? 0);
    const volume = Math.max(Math.floor(progress.volume ?? 0), entry?.status?.volume ?? 0);

    if (entry && chapter === entry.status?.chapter && volume === (entry.status?.volume ?? 0)) {
      return;
    }

    await this.writeEntry(id, entry, { chapter, volume });
  }

  async didUpdateStatus(id: string, status: string): Promise<void> {
    const entry = await this.readEntry(id);
    await this.writeEntry(id, entry, {}, status);
  }

  async getEntryForm(id: string): Promise<Form> {
    const [entry, lists, rating] = await Promise.all([
      this.readEntry(id),
      this.listDefinitions(),
      this.api.call<RatingResponse>(`/series/${seriesId(id)}/rating`, "GET").catch(() => undefined),
    ]);

    // A reader's own lists are offered under their own names; the five built-in types
    // still stand in for whatever they have not renamed.
    const options: Option[] = lists.length
      ? lists.flatMap((list) =>
          list.list_id == null ? [] : [{ id: String(list.list_id), title: list.title ?? "List" }],
        )
      : STATUS_OPTIONS;

    const selected =
      entry?.list_id != null && lists.length
        ? String(entry.list_id)
        : ((await this.statusOf(entry)) ?? DEFAULT_STATUS);

    return {
      sections: [
        UIListSection({
          header: "Tracking",
          children: [
            UIPicker({
              id: ENTRY_FIELD.Status,
              title: "List",
              options,
              value: entry ? selected : "",
            }),
            UIStepper({
              id: ENTRY_FIELD.Chapter,
              title: "Chapter",
              value: entry?.status?.chapter ?? 0,
              lowerBound: 0,
              upperBound: 99_999,
              step: 1,
            }),
            UIStepper({
              id: ENTRY_FIELD.Volume,
              title: "Volume",
              value: entry?.status?.volume ?? 0,
              lowerBound: 0,
              upperBound: 9_999,
              step: 1,
            }),
          ],
        }),
        UIListSection({
          header: "Score",
          footer: "A score of 0 removes your rating from MangaUpdates.",
          children: [
            UIStepper({
              id: ENTRY_FIELD.Score,
              title: "Score",
              value: rating?.rating ?? 0,
              lowerBound: 0,
              upperBound: 10,
              step: 0.1,
            }),
          ],
        }),
      ],
    };
  }

  async didSubmitEntryForm(id: string, form: unknown): Promise<void> {
    const submitted = (form ?? {}) as Record<string, unknown>;
    const entry = await this.readEntry(id);

    const status = submitted[ENTRY_FIELD.Status];
    const chapter = numberOf(submitted[ENTRY_FIELD.Chapter]);
    const volume = numberOf(submitted[ENTRY_FIELD.Volume]);

    if (status !== undefined || chapter !== undefined || volume !== undefined) {
      await this.writeEntry(
        id,
        entry,
        {
          ...(chapter === undefined ? {} : { chapter: Math.floor(chapter) }),
          ...(volume === undefined ? {} : { volume: Math.floor(volume) }),
        },
        typeof status === "string" ? status : undefined,
      );
    }

    const score = numberOf(submitted[ENTRY_FIELD.Score]);
    if (score === undefined) return;

    if (score > 0) {
      await this.api.call(`/series/${seriesId(id)}/rating`, "PUT", {
        mutation: true,
        body: { rating: score },
      });
    } else {
      await this.api.call(`/series/${seriesId(id)}/rating`, "DELETE", { mutation: true });
    }
  }

  // ===================== Tracking internals =====================

  /**
   * Whether the title is on any of the reader's lists.
   *
   * The site says "it is not" with a 404 carrying no body, which the host cannot read: it
   * fails the whole request rather than reporting a status, and what it says about that
   * failure is its own business. Nothing here can tell that apart from any other failure,
   * so it is not attempted — a session that was refused still surfaces, and everything
   * else means the title is not tracked. That is what the reference implementation does.
   */
  private async readEntry(id: string): Promise<ListEntry | undefined> {
    try {
      return await this.api.call<ListEntry>(`/lists/series/${seriesId(id)}`, "GET");
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      return undefined;
    }
  }

  private listDefinitions(): Promise<ListDefinition[]> {
    this.lists ??= this.api.call<ListDefinition[]>("/lists", "GET").catch((error: unknown) => {
      this.lists = undefined;
      throw error;
    });
    return this.lists;
  }

  /** The list an entry sits in, named by the type the app tracks statuses with. */
  private async statusOf(entry: ListEntry | undefined): Promise<string> {
    if (!entry) return DEFAULT_STATUS;
    if (entry.list_type) return entry.list_type;

    const lists = await this.listDefinitions().catch(() => []);
    const match = lists.find((list) => list.list_id === entry.list_id);
    return match?.type ?? DEFAULT_STATUS;
  }

  /**
   * Adds the title to a list or moves it within one — the site separates the two, and
   * sending the wrong one is refused rather than corrected.
   */
  private async writeEntry(
    id: string,
    entry: ListEntry | undefined,
    progress: { chapter?: number; volume?: number },
    status?: string,
  ): Promise<void> {
    const listId = await this.resolveListId(status, entry);

    const payload = {
      series: { id: seriesId(id) },
      ...(listId === undefined ? {} : { list_id: listId }),
      status: {
        chapter: progress.chapter ?? entry?.status?.chapter ?? 0,
        volume: progress.volume ?? entry?.status?.volume ?? 0,
      },
    };

    const path = entry ? "/lists/series/update" : "/lists/series";
    await this.api.call(path, "POST", { mutation: true, body: [payload] });
  }

  /** Turns a status id — a list type, or a list id the entry form offered — into a list id. */
  private async resolveListId(
    status: string | undefined,
    entry: ListEntry | undefined,
  ): Promise<number | undefined> {
    if (status === undefined) return entry?.list_id;

    if (/^\d+$/.test(status)) return Number.parseInt(status, 10);

    const lists = await this.listDefinitions().catch(() => []);
    const match = lists.find((list) => list.type === status);
    return match?.list_id ?? entry?.list_id;
  }
}

function seriesId(id: string): number {
  // Strict, because `parseInt` would read the base36 id in a site URL as its first digits.
  if (!/^\d+$/.test(id.trim())) throw new Error(`Not a MangaUpdates series id: ${id}`);
  return Number.parseInt(id.trim(), 10);
}

/**
 * The site's own links carry the id two ways: the old query form spells it out, and the
 * current path form encodes it in base36. The API only ever takes the number.
 */
export function seriesIdFromUrl(url: string): string {
  const legacy = /\/series\.html\?(?:[^#]*&)?id=(\d+)/i.exec(url)?.[1];
  if (legacy) return legacy;

  // The segment has to end where the path does, or a hyphenated word would be read as
  // an id by its first half.
  const slug = /\/series\/([0-9a-z]+)(?:[/?#]|$)/i.exec(url)?.[1];
  if (!slug) return "";
  if (/^\d+$/.test(slug)) return slug;

  const decoded = Number.parseInt(slug, 36);
  // Round-tripping rules out a slug that merely starts with base36 characters. A word
  // that survives it still reaches the API, which answers for an id that does not exist.
  if (!Number.isSafeInteger(decoded) || decoded.toString(36) !== slug.toLowerCase()) return "";
  return String(decoded);
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export class Target extends MangaUpdatesTracker {}
