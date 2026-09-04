/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * A value worth fetching once, kept where it survives.
 *
 * A field on the source only lasts as long as the instance holding it, and the app builds
 * a fresh one freely — so a memo written that way is re-fetched far more often than it
 * looks like it will be, and a screen that reads a whole page of markup to fill a filter
 * list pays for it every time it opens. This keeps the answer in the database as well, so
 * the second open is served from disk however the app chose to run the first.
 */
export class TimedCache<T> {
  private memo: { value: T; at: number } | undefined;
  private inFlight: Promise<T> | undefined;

  constructor(
    private readonly key: string,
    private readonly lifetimeMs: number,
  ) {}

  private fresh(at: number): boolean {
    const age = Date.now() - at;
    // A clock that moved backwards would otherwise keep a value for as long as it is out.
    return age >= 0 && age < this.lifetimeMs;
  }

  /** The stored value if it is still fresh, otherwise whatever `load` returns. */
  async get(load: () => Promise<T>): Promise<T> {
    if (this.memo && this.fresh(this.memo.at)) return this.memo.value;

    const stored = await this.read();
    if (stored) {
      this.memo = stored;
      return stored.value;
    }

    // One load at a time: a home page opening six rows at once asks the site once.
    this.inFlight ??= load()
      .then(async (value) => {
        this.memo = { value, at: Date.now() };
        await this.write(value);
        return value;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  /** Forget it everywhere, for a setting whose change invalidates what was stored. */
  async clear(): Promise<void> {
    this.memo = undefined;
    await ObjectStore.remove(this.key).catch(() => undefined);
  }

  private async read(): Promise<{ value: T; at: number } | undefined> {
    try {
      const raw = await ObjectStore.string(this.key);
      if (!raw) return undefined;

      const parsed = JSON.parse(raw) as { value?: T; at?: number };
      if (typeof parsed.at !== "number" || parsed.value === undefined) return undefined;
      if (!this.fresh(parsed.at)) return undefined;

      return { value: parsed.value, at: parsed.at };
    } catch {
      // Unreadable or written by an older shape: treat as absent rather than as a fault.
      return undefined;
    }
  }

  private async write(value: T): Promise<void> {
    try {
      await ObjectStore.set(this.key, JSON.stringify({ value, at: Date.now() }));
    } catch {
      // A cache that cannot be written is still a working source.
    }
  }
}
