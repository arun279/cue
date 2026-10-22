import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { createSizedLibrary } from "../../../../scripts/mock-trakt/seed.mjs";
import { createMockTrakt, respond } from "../../../../scripts/mock-trakt/server.mjs";

interface RequestEntry {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: Record<string, unknown>;
}

export function createHarnessServer(prefix: string, journalPath = "journal.ndjson") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const journalFile = join(directory, journalPath);
  const waiting = new Set<{
    readonly matches: (entry: RequestEntry) => boolean;
    readonly resolve: (entry: RequestEntry) => void;
  }>();
  const server = createMockTrakt({
    port: 0,
    log: false,
    journalFile,
    onRequest: (entry: RequestEntry) => {
      for (const waiter of waiting) {
        if (!waiter.matches(entry)) continue;
        waiting.delete(waiter);
        waiter.resolve(entry);
      }
    },
  });
  return {
    journalFile,
    listen: () => server.listen(),
    nextRequest: (matches: (entry: RequestEntry) => boolean): Promise<RequestEntry> =>
      new Promise((resolve) => waiting.add({ matches, resolve })),
    close: async () => {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** The mock Trakt server for one test file: its base URL once it is listening. */
export function mockTraktBase(): () => string {
  const mock = createMockTrakt({ port: 0, log: false });
  let base = "";
  beforeAll(async () => {
    base = await mock.listen();
  });
  afterAll(async () => {
    await mock.close();
  });
  return () => base;
}

export interface LibrarySize {
  readonly inProgress: number;
  readonly lapsed: number;
  readonly caughtUp: number;
  readonly finished: number;
  readonly airingWatched: number;
  readonly airingWatchlist: number;
  readonly watchlistShows: number;
  readonly watchlistMovies: number;
  readonly watchedMovies: number;
  readonly hidden: number;
}

interface ServedRequest {
  readonly method: string;
  readonly path: string;
  readonly bytes: number;
}

const API = "https://api.trakt.tv";

/**
 * The mock Trakt server driven without a socket, for a replay under fake
 * timers: a `fetch` replacement over a sized account that records every request
 * it answered and its body size, and the bodies of reads it was not asked for,
 * which is what a budget is sized from.
 */
export class InProcessTrakt {
  readonly requests: ServedRequest[] = [];
  readonly unknown: string[] = [];
  private readonly library: ReturnType<typeof createSizedLibrary>;

  constructor(size: LibrarySize, now: number) {
    this.library = createSizedLibrary(size, now, () => Date.now());
  }

  readonly fetch = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const answer = respond(this.library, method, url, JSON.parse(String(init?.body ?? "{}")));
    if (answer.status === 404 && answer.body.includes("no route")) {
      this.unknown.push(`${method} ${url.pathname}${url.search}`);
    } else {
      this.requests.push({
        method,
        path: `${url.pathname}${url.search}`,
        bytes: Buffer.byteLength(answer.body),
      });
    }
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  };

  private get(path: string) {
    const answer = respond(this.library, "GET", new URL(path, API));
    if (answer.status !== 200) throw new Error(`no answer for ${path}`);
    return answer;
  }

  bytesOf(path: string): number {
    return Buffer.byteLength(this.get(path).body);
  }

  /** Every page of a list, read 100 at a time as the app reads it. */
  bytesOfList(path: string): number {
    const separator = path.includes("?") ? "&" : "?";
    const pages = Number(
      this.get(`${path}${separator}page=1&limit=100`).headers["x-pagination-page-count"],
    );
    let bytes = 0;
    for (let page = 1; page <= pages; page += 1)
      bytes += this.bytesOf(`${path}${separator}page=${page}&limit=100`);
    return bytes;
  }

  private watched(): {
    readonly plays: number;
    readonly last_watched_at: string;
    readonly show: { readonly aired_episodes: number; readonly ids: { readonly trakt: number } };
  }[] {
    const rows = [];
    for (let page = 1; ; page += 1) {
      const answer = this.get(`/sync/watched/shows?page=${page}&limit=100`);
      rows.push(...JSON.parse(answer.body));
      if (page >= Number(answer.headers["x-pagination-page-count"])) return rows;
    }
  }

  get watchedPages(): number {
    return Math.max(1, Math.ceil(this.watched().length / 100));
  }

  /** Shows with an aired episode still to watch, most recently watched first. */
  backlogShowIds(): number[] {
    return this.watched()
      .filter((row) => row.plays < row.show.aired_episodes)
      .sort((a, b) => b.last_watched_at.localeCompare(a.last_watched_at))
      .map((row) => row.show.ids.trakt);
  }
}
