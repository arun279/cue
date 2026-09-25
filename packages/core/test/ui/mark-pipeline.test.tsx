// @vitest-environment jsdom
/**
 * Hook-level coverage of the mark pipeline's cross-surface guarantees: a queue
 * mark ticks the show-detail caches in the same frame (F3a), a pending mark for
 * an episode is dropped by EVERY other on-mark path (F3b), an uncheck with a
 * queued mark cancels the pair instead of leaving it to flip back (F5), the
 * reverse windows + snackbar batch are one module-level truth across hook
 * instances (F11), and undoing a LANDED mark removes only the mark's own play by
 * exact history id, never remove-by-item, with an honest failure when the play
 * can't be identified (F14).
 */
import { queryKeys } from "@cue/core/data/query-keys";
import type { EpisodeDetail } from "@cue/core/data/trakt/episode-detail";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { EpisodeView, SeasonView, ShowProgress } from "@cue/core/data/trakt/show-detail";
import type { EpisodePlay } from "@cue/core/domain/reversal";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { type MarkSeasonController, useMarkSeason } from "@cue/core/hooks/useMarkSeason";
import { type MarkWatched, useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import {
  type CueRuntime,
  RuntimeProvider,
  type UpNextData,
  useRuntime,
} from "@cue/core/runtime/runtime";
import { resetMarkStore } from "@cue/core/stores/mark-store";
import {
  forgetSeasonMark,
  getSeasonMarkDelta,
  rememberSeasonMark,
} from "@cue/core/stores/season-reversal";
import { dismissSnack, showSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

const SHOW = 1;
const NEXT_EP_TRAKT = 102;

function episodeView(number: number, watched = false, stills: readonly string[] = []): EpisodeView {
  return {
    season: 1,
    number,
    title: null,
    firstAired: "2026-01-01T00:00:00.000Z",
    ids: { trakt: 100 + number },
    stills,
    watched,
    watchedAt: watched ? "2026-07-01T00:00:00.000Z" : null,
    aired: true,
  };
}

function seasonView(episodes: readonly EpisodeView[]): SeasonView {
  return {
    number: 1,
    title: "Season 1",
    isSpecial: false,
    isHidden: false,
    episodes,
    airedCount: episodes.length,
    completedCount: episodes.filter((e) => e.watched).length,
  };
}

function episodeDetail(episode: EpisodeView): EpisodeDetail {
  return {
    showId: SHOW,
    season: episode.season,
    number: episode.number,
    title: episode.title,
    overview: null,
    firstAired: episode.firstAired,
    runtime: null,
    ids: episode.ids,
    stills: episode.stills,
    aired: episode.aired,
    watched: episode.watched,
    watchedAt: episode.watchedAt,
    prev: null,
    next: null,
  };
}

function libraryEntry(showId = SHOW): LibraryEntry {
  return {
    showId,
    title: `Show ${showId}`,
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: "2026-07-01T00:00:00.000Z",
    aired: 10,
    completed: 1,
    nextEpisode: {
      season: 1,
      number: 2,
      title: null,
      firstAired: "2026-01-01T00:00:00.000Z",
      still: null,
      ids: { trakt: showId === SHOW ? NEXT_EP_TRAKT : showId * 1000 },
    },
    lastAired: null,
    tmdbId: null,
    pendingAdvance: false,
  };
}

interface FakeRuntime {
  readonly runtime: CueRuntime;
  readonly submitted: QueuedOp[];
  /** The simulated durable queue `pendingOps()` reads. */
  readonly queued: QueuedOp[];
  readonly loadEpisode: ReturnType<typeof vi.fn>;
  readonly loadEpisodePlays: ReturnType<typeof vi.fn>;
  readonly loadShowPlays: ReturnType<typeof vi.fn>;
}

function fakeRuntime(opts: {
  /** Per-op settle; default resolves "done" and never keeps the op queued. */
  submit?(op: QueuedOp): Promise<"done" | "failed" | "deferred">;
  plays?: readonly EpisodePlay[] | Error;
  showPlays?: readonly EpisodePlay[] | Error;
  progress?: ShowProgress | Promise<ShowProgress>;
  episode?: EpisodeDetail | Promise<EpisodeDetail>;
  inFlightOpId?(): string | null;
}): FakeRuntime {
  const submitted: QueuedOp[] = [];
  const queued: QueuedOp[] = [];
  const loadEpisode = vi.fn(() =>
    opts.episode === undefined ? new Promise(() => {}) : Promise.resolve(opts.episode),
  );
  const loadEpisodePlays = vi.fn((_id: number) => {
    const plays = opts.plays ?? [];
    return plays instanceof Error ? Promise.reject(plays) : Promise.resolve(plays);
  });
  const loadShowPlays = vi.fn((_id: number) => {
    const plays = opts.showPlays ?? [];
    return plays instanceof Error ? Promise.reject(plays) : Promise.resolve(plays);
  });
  const runtime = {
    newId: () => `op-${submitted.length}`,
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return opts.submit?.(op) ?? Promise.resolve("done");
    },
    pendingOps: () => [...queued],
    inFlightOpId: opts.inFlightOpId ?? (() => null),
    loadEpisodePlays,
    loadShowPlays,
    loadEpisode,
    loadShowProgress: vi.fn(() =>
      opts.progress === undefined ? new Promise(() => {}) : Promise.resolve(opts.progress),
    ),
  } as unknown as CueRuntime;
  return { runtime, submitted, queued, loadEpisode, loadEpisodePlays, loadShowPlays };
}

interface Api {
  mark: MarkWatched;
  season: MarkSeasonController;
  markControlChecked: boolean;
}

function Probe({ slot }: { slot: Api[] }) {
  const runtime = useRuntime();
  const mark = useMarkWatched();
  const season = useMarkSeason();
  const detail = useQuery({
    queryKey: queryKeys.episode(SHOW, 1, 2),
    queryFn: () => runtime.loadEpisode(SHOW, 1, 2),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  slot[0] = { mark, season, markControlChecked: detail?.watched ?? false };
  return null;
}

/** Mount TWO independent hook instances (two surfaces) over one runtime + cache. */
function mountSurfaces(runtime: CueRuntime, qc: QueryClient): [Api[], Api[]] {
  const a: Api[] = [];
  const b: Api[] = [];
  mount(
    <QueryClientProvider client={qc}>
      <RuntimeProvider value={runtime}>
        <Probe slot={a} />
        <Probe slot={b} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return [a, b];
}

function seededClient(entries: readonly LibraryEntry[], seasons?: readonly SeasonView[]) {
  const qc = new QueryClient();
  qc.setQueryData<UpNextData>(queryKeys.library(), { entries });
  if (seasons !== undefined) {
    qc.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW), seasons);
    for (const s of seasons) {
      for (const e of s.episodes) {
        qc.setQueryData<EpisodeDetail>(
          queryKeys.episode(SHOW, s.number, e.number),
          episodeDetail(e),
        );
      }
    }
  }
  return qc;
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

it("advances a show opened without an aggregate cache and reverses it", async () => {
  const fake = fakeRuntime({});
  const qc = new QueryClient();
  const [a] = mountSurfaces(fake.runtime, qc);
  const entry = libraryEntry();
  await act(async () => a[0]?.mark.mark(entry));
  expect(entryOf(qc, SHOW)).toMatchObject({ completed: entry.completed + 1, pendingAdvance: true });
  stubLandedPlay(fake);
  await act(async () => a[0]?.mark.reverse(SHOW));
  expect(entryOf(qc, SHOW)).toEqual(entry);
});

it("silently resumes a stopped show after a continue mark and re-stops on Undo", async () => {
  const fake = fakeRuntime({});
  const entry = { ...libraryEntry(), hidden: true };
  const qc = seededClient([entry]);
  const [a] = mountSurfaces(fake.runtime, qc);
  await act(async () => a[0]?.mark.mark(entry));
  expect(entryOf(qc, SHOW)?.hidden).toBe(false);
  stubLandedPlay(fake);
  await act(async () => a[0]?.mark.reverse(SHOW));
  expect(entryOf(qc, SHOW)?.hidden).toBe(true);
  expect(fake.submitted.map((op) => op.request.path)).toEqual([
    "/sync/history",
    "/users/hidden/progress_watched/remove",
    "/sync/history/remove",
    "/users/hidden/progress_watched",
  ]);
});
const TARGET = { showId: SHOW, ids: { trakt: SHOW }, includeSpecials: false };

const entryOf = (qc: QueryClient, showId: number) =>
  qc.getQueryData<UpNextData>(queryKeys.library())?.entries.find((e) => e.showId === showId);
const seasonEp = (qc: QueryClient, number: number) =>
  qc
    .getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW))?.[0]
    ?.episodes.find((e) => e.number === number);

/** One show (E1 watched, E2 next) seeded and mounted on two surfaces over `fake`. */
function mountSeasonSurfaces(
  fake: FakeRuntime,
  episodes: readonly EpisodeView[] = [episodeView(1, true), episodeView(2)],
) {
  const entry = libraryEntry();
  const qc = seededClient([entry], [seasonView(episodes)]);
  const [a, b] = mountSurfaces(fake.runtime, qc);
  return { entry, qc, a, b };
}

/** A surface whose DURABLE queue already holds a mark for E2 (no session registry). */
function mountWithDurableMark() {
  const fake = fakeRuntime({});
  const { b } = mountSeasonSurfaces(fake);
  fake.queued.push({ itemKey: `episode:${NEXT_EP_TRAKT}`, toState: "present" } as QueuedOp);
  return { fake, b };
}

/** A historical play from long before any session mark (a restart-show user). */
const OLD_PLAY: EpisodePlay = {
  historyId: 11,
  episodeTrakt: NEXT_EP_TRAKT,
  season: 1,
  number: 2,
  watchedAt: "2023-01-01T00:00:00.000Z",
};

/** After the mark landed and left the queue, resolve the episode's plays: `older`
 * plus the mark's own play (id 900) stamped with the exact watched_at it POSTed. */
function stubLandedPlay(fake: FakeRuntime, ...older: readonly EpisodePlay[]): void {
  fake.loadEpisodePlays.mockResolvedValue([
    ...older,
    {
      historyId: 900,
      episodeTrakt: NEXT_EP_TRAKT,
      season: 1,
      number: 2,
      watchedAt: fake.submitted[0]?.watchedAt ?? "",
    },
  ]);
}

/** Mount one surface over `fake`, mark `entry`, then reverse the mark and settle. */
async function markThenReverse(
  fake: FakeRuntime,
  entry: LibraryEntry,
  beforeReverse?: () => void,
): Promise<QueryClient> {
  const qc = seededClient([entry]);
  const [a] = mountSurfaces(fake.runtime, qc);
  await act(async () => a[0]?.mark.mark(entry));
  beforeReverse?.();
  await act(async () => a[0]?.mark.reverse(SHOW));
  await flush();
  return qc;
}

beforeEach(() => {
  resetMarkStore();
  forgetSeasonMark(SHOW, 1);
  dismissSnack();
});

describe("F3a: a queue mark ticks the show-detail caches in the same frame", () => {
  it("replaces only the marked library entry from its scoped progress read", async () => {
    const other = libraryEntry(2);
    const fake = fakeRuntime({
      progress: {
        aired: 12,
        completed: 2,
        lastAired: episodeView(2),
        nextEpisode: episodeView(3, false, ["media.trakt.tv/s3.jpg"]),
      },
    });
    const entry = libraryEntry();
    const qc = seededClient([entry, other]);
    const [surface] = mountSurfaces(fake.runtime, qc);

    await act(async () => surface[0]?.mark.mark(entry));
    await flush();

    const patched = entryOf(qc, SHOW);
    expect(patched).toMatchObject({
      aired: 12,
      completed: 2,
      lastAired: { season: 1, number: 2 },
      pendingAdvance: false,
      // Resolved as an https URL, exactly as the aggregate resolves the same
      // host-relative candidate: a raw one renders as a broken still.
      nextEpisode: { season: 1, number: 3, still: "https://media.trakt.tv/s3.jpg" },
    });
    // A per-show progress read knows nothing about the rest of the entry, so the
    // patch has to carry the aggregate's own fields through untouched.
    expect(patched).toMatchObject({
      showId: entry.showId,
      title: entry.title,
      status: entry.status,
      hidden: entry.hidden,
      inWatchlist: entry.inWatchlist,
      tmdbId: entry.tmdbId,
    });
    expect(entryOf(qc, 2)).toStrictEqual(other);
    expect(fake.runtime.loadShowProgress).toHaveBeenCalledOnce();
  });

  it("reads a progress fold with nothing aired as no last aired episode", async () => {
    const fake = fakeRuntime({
      progress: { aired: 0, completed: 0, lastAired: null, nextEpisode: null },
    });
    const entry = libraryEntry();
    const qc = seededClient([entry]);
    const [surface] = mountSurfaces(fake.runtime, qc);
    await act(async () => surface[0]?.mark.mark(entry));
    await flush();
    expect(entryOf(qc, SHOW)).toMatchObject({ lastAired: null, nextEpisode: null });
  });

  it("replaces the marked show's library entry from the season surface too", async () => {
    // Every mark surface shares one reconcile. A surface that only invalidated
    // show detail left the queue row naming an episode the season mark had just
    // watched, until an unrelated remote change rebuilt the aggregate.
    const fake = fakeRuntime({
      progress: { aired: 10, completed: 10, lastAired: episodeView(10), nextEpisode: null },
    });
    const season = seasonView([episodeView(1, true), episodeView(2)]);
    const entry = libraryEntry();
    const qc = seededClient([entry], [season]);
    const [surface] = mountSurfaces(fake.runtime, qc);

    await act(async () => surface[0]?.season.markSeason(TARGET, season));
    await flush();

    expect(entryOf(qc, SHOW)).toMatchObject({ completed: 10, nextEpisode: null });
    expect(fake.runtime.loadShowProgress).toHaveBeenCalledWith(SHOW);
  });

  it("patches seasons + episode detail optimistically, and undo restores them", async () => {
    const fake = fakeRuntime({});
    const { entry, qc, a } = mountSeasonSurfaces(fake);

    await act(async () => a[0]?.mark.mark(entry));
    expect(entryOf(qc, SHOW)?.pendingAdvance).toBe(true);
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(
      qc.getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW))?.[0]?.completedCount,
    ).toBe(2);
    expect(qc.getQueryData<EpisodeDetail>(queryKeys.episode(SHOW, 1, 2))?.watched).toBe(true);

    stubLandedPlay(fake); // the op landed and left the queue: the per-play undo path
    await act(async () => a[0]?.mark.reverse(SHOW));
    await flush();
    expect(entryOf(qc, SHOW)).toStrictEqual(entry); // beforeMark restored verbatim
    expect(seasonEp(qc, 2)?.watched).toBe(false);
    expect(qc.getQueryData<EpisodeDetail>(queryKeys.episode(SHOW, 1, 2))?.watched).toBe(false);
  });

  it("keeps episode detail unwatched while Undo revalidates a lagging snapshot", async () => {
    let resolveEpisode!: (detail: EpisodeDetail) => void;
    const episode = new Promise<EpisodeDetail>((resolve) => {
      resolveEpisode = resolve;
    });
    const fake = fakeRuntime({ episode });
    const { qc, a } = mountSeasonSurfaces(fake);
    const detail = () => qc.getQueryData<EpisodeDetail>(queryKeys.episode(SHOW, 1, 2));

    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(2), { undoLabel: "S1 E2 marked" }),
    );
    await flush();
    expect(detail()?.watched).toBe(true);
    expect(a[0]?.markControlChecked).toBe(true);

    await act(async () => a[0]?.season.undo());
    await flush();
    expect(fake.loadEpisode).toHaveBeenCalled();
    expect(detail()?.watched).toBe(false);
    expect(a[0]?.markControlChecked).toBe(false);

    resolveEpisode(episodeDetail(episodeView(2, true)));
    await flush();
    expect(detail()?.watched).toBe(false);
    expect(a[0]?.markControlChecked).toBe(false);
  });
});

describe("F3b: a pending mark is dropped by every other on-mark path", () => {
  it("drops a season-row toggle ON while the queue mark is un-settled (registry)", async () => {
    const fake = fakeRuntime({ submit: () => new Promise(() => {}) }); // never settles
    const { entry, a, b } = mountSeasonSurfaces(fake);

    act(() => void a[0]?.mark.mark(entry));
    expect(fake.submitted).toHaveLength(1);
    // The other surface's cache hasn't re-rendered yet: tap the same episode's row.
    await act(async () => b[0]?.season.toggleEpisode(TARGET, { ...episodeView(2) }));
    expect(fake.submitted).toHaveLength(1); // dropped, no duplicate play
  });

  it("drops a queue mark while a toggle-ON mark is un-settled (mirror direction)", async () => {
    const fake = fakeRuntime({ submit: () => new Promise(() => {}) });
    const { entry, qc, a, b } = mountSeasonSurfaces(fake);

    act(() => void b[0]?.season.toggleEpisode(TARGET, { ...episodeView(2) }));
    expect(fake.submitted).toHaveLength(1);
    await act(async () => a[0]?.mark.mark(entry));
    expect(fake.submitted).toHaveLength(1);
    expect(entryOf(qc, SHOW)?.pendingAdvance).toBe(false); // never even patched
  });

  it("drops a toggle ON against a DURABLE queued mark (reload-restored op)", async () => {
    const { fake, b } = mountWithDurableMark();

    await act(async () => b[0]?.season.toggleEpisode(TARGET, { ...episodeView(2) }));
    expect(fake.submitted).toHaveLength(0);
  });

  it("never blocks a deliberate additive play (F6 exemption)", async () => {
    const { fake, b } = mountWithDurableMark();

    await act(async () => b[0]?.season.addEpisodePlay(TARGET, { ...episodeView(2, true) }));
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]?.itemKey).toBe(
      `episode:${NEXT_EP_TRAKT}:add:${fake.submitted[0]?.id}`,
    );
    expect(fake.submitted[0]?.inversePatch).toEqual({
      kind: "additive-episode",
      episodeTrakt: NEXT_EP_TRAKT,
    });
  });
});

describe("F5: uncheck with a queued mark cancels the pair, never resolves live plays", () => {
  it("enqueues the coalescing inverse and settles the UI unwatched", async () => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("deferred") });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);

    const queuedMark = {
      itemKey: `episode:${NEXT_EP_TRAKT}`,
      toState: "present",
      watchedAt: "2026-07-12T09:00:00.000Z",
    } as QueuedOp;
    fake.queued.push(queuedMark);

    await act(async () => a[0]?.season.toggleEpisode(TARGET, { ...episodeView(2, true) }));
    expect(fake.loadEpisodePlays).not.toHaveBeenCalled();
    expect(fake.submitted).toHaveLength(1);
    const inverse = fake.submitted[0];
    expect(inverse?.itemKey).toBe(`episode:${NEXT_EP_TRAKT}`);
    expect(inverse?.toState).toBe("absent");
    expect(inverse?.request.path).toBe("/sync/history/remove");
    // The inverse freezes the queued mark's watched_at so its own restore-inverse is exact.
    expect(inverse?.watchedAt).toBe(queuedMark.watchedAt);
    expect(seasonEp(qc, 2)?.watched).toBe(false);
  });

  it("resolves live plays as before when nothing is queued", async () => {
    const fake = fakeRuntime({
      plays: [
        {
          historyId: 41,
          episodeTrakt: NEXT_EP_TRAKT,
          season: 1,
          number: 2,
          watchedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    const { a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);

    await act(async () => a[0]?.season.toggleEpisode(TARGET, { ...episodeView(2, true) }));
    expect(fake.loadEpisodePlays).toHaveBeenCalledTimes(1);
    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [41] });
  });
});

describe("F11: windows + batch are one module-level truth across instances", () => {
  it("coalesces marks from two surfaces into one batch and undoes both", async () => {
    const e1 = libraryEntry(1);
    const e2 = libraryEntry(2);
    const fake = fakeRuntime({
      submit: (op) => {
        fake.queued.push(op); // stays queued: undo takes the coalesce-cancel path
        return Promise.resolve("deferred");
      },
    });
    const qc = seededClient([e1, e2]);
    const [a, b] = mountSurfaces(fake.runtime, qc);

    await act(async () => a[0]?.mark.mark(e1));
    await act(async () => b[0]?.mark.mark(e2));
    expect(useSnackbar.getState().snack?.message).toBe("2 episodes marked");
    // The reverse window opened by surface A is live on surface B too.
    expect(b[0]?.mark.justMarkedAt(1)).not.toBeNull();
    expect(a[0]?.mark.justMarkedAt(2)).not.toBeNull();

    const undo = useSnackbar.getState().snack?.actions?.[0];
    await act(async () => {
      undo?.onPress();
    });
    await flush();
    expect(entryOf(qc, 1)).toStrictEqual(e1);
    expect(entryOf(qc, 2)).toStrictEqual(e2);
    const inverses = fake.submitted.slice(2);
    expect(inverses).toHaveLength(2);
    expect(inverses.every((op) => op.toState === "absent")).toBe(true);
  });

  it("reverses a mark from a DIFFERENT instance than the one that made it", async () => {
    const fake = fakeRuntime({});
    const { entry, qc, a, b } = mountSeasonSurfaces(fake);

    await act(async () => a[0]?.mark.mark(entry));
    stubLandedPlay(fake);
    await act(async () => b[0]?.mark.reverse(SHOW));
    await flush();
    expect(entryOf(qc, SHOW)).toStrictEqual(entry);
    expect(a[0]?.mark.justMarkedAt(SHOW)).toBeNull();
  });
});

describe("F14: undoing a landed mark is per-play, never remove-by-item", () => {
  it("removes exactly the mark's own play by history id, keeping older plays", async () => {
    const entry = libraryEntry();
    const fake = fakeRuntime({});
    // Restart-show user: a historical play predates the mark. Only the fresh one may go.
    const qc = await markThenReverse(fake, entry, () => stubLandedPlay(fake, OLD_PLAY));

    const reversal = fake.submitted[1];
    expect(reversal?.request.path).toBe("/sync/history/remove");
    expect(reversal?.request.body).toEqual({ ids: [900] }); // exact id, not an episodes item
    expect(entryOf(qc, SHOW)).toStrictEqual(entry);
  });

  it("keeps the coalesce-cancel inverse while the mark is still queued", async () => {
    const fake = fakeRuntime({
      submit: (op) => {
        if (op.toState === "present") fake.queued.push(op);
        return Promise.resolve("deferred");
      },
    });
    await markThenReverse(fake, libraryEntry());
    expect(fake.loadEpisodePlays).not.toHaveBeenCalled();
    const inverse = fake.submitted[1];
    expect(inverse?.toState).toBe("absent");
    expect(inverse?.itemKey).toBe(`episode:${NEXT_EP_TRAKT}`); // coalesces against the queued mark
  });

  it("fails honestly when the play can't be resolved: no removal, row restored, snack says so", async () => {
    const entry = libraryEntry();
    const fake = fakeRuntime({ plays: new Error("offline") });
    const qc = await markThenReverse(fake, entry);
    expect(fake.submitted).toHaveLength(1); // the mark only: nothing was wiped
    expect(useSnackbar.getState().snack?.message).toBe(
      `Couldn't undo ${entry.title}. Please try again.`,
    );
    expect(entryOf(qc, SHOW)?.pendingAdvance).toBe(true); // the play still stands on Trakt
  });

  it("treats an already-removed play as a satisfied undo (revalidate, nothing removed)", async () => {
    const entry = libraryEntry();
    // Only history from long before the mark: never a removal candidate.
    const fake = fakeRuntime({ plays: [OLD_PLAY] });
    const qc = await markThenReverse(fake, entry);
    expect(fake.submitted).toHaveLength(1); // no reversal op: nothing provably ours
    expect(entryOf(qc, SHOW)).toStrictEqual(entry); // undone UI kept; revalidate reconciles
  });
});

describe("season write guards and Undo failures", () => {
  it("retains a partial mark delta after failed unmark and scopes the retry to it", async () => {
    const oldPlay: EpisodePlay = {
      historyId: 11,
      episodeTrakt: 101,
      season: 1,
      number: 1,
      watchedAt: "2023-01-01T00:00:00.000Z",
    };
    const markedPlay: EpisodePlay = {
      historyId: 22,
      episodeTrakt: 102,
      season: 1,
      number: 2,
      watchedAt: "2026-07-12T00:00:00.000Z",
    };
    let removals = 0;
    const fake = fakeRuntime({
      showPlays: [oldPlay, markedPlay],
      submit: (op) =>
        op.request.path === "/sync/history/remove"
          ? Promise.resolve(removals++ === 0 ? "failed" : "done")
          : Promise.resolve("done"),
    });
    const season = seasonView([episodeView(1, true), episodeView(2, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    rememberSeasonMark(SHOW, 1, [2]);

    await act(async () => a[0]?.season.unmarkSeason(TARGET, season));

    expect(getSeasonMarkDelta(SHOW, 1)).toEqual(new Set([2]));
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [22] });

    await act(async () => a[0]?.season.unmarkSeason(TARGET, season));

    expect(fake.submitted.map((op) => op.request.body)).toEqual([{ ids: [22] }, { ids: [22] }]);
    expect(getSeasonMarkDelta(SHOW, 1)).toBeUndefined();
  });

  it("drops a second season activation while the first write is in flight", () => {
    const fake = fakeRuntime({ submit: () => new Promise(() => {}) });
    const { a } = mountSeasonSurfaces(fake, [episodeView(1), episodeView(2)]);
    const season = seasonView([episodeView(1), episodeView(2)]);

    act(() => {
      void a[0]?.season.markSeason(TARGET, season);
      void a[0]?.season.markSeason(TARGET, season);
    });

    expect(fake.submitted).toHaveLength(1);
  });

  it("surfaces a hard-failed inverse submit through the existing error snack", async () => {
    let submits = 0;
    const fake = fakeRuntime({
      submit: () => Promise.resolve(submits++ === 0 ? "done" : "failed"),
    });
    const { a } = mountSeasonSurfaces(fake, [episodeView(1), episodeView(2)]);

    await act(async () =>
      a[0]?.season.markSeason(TARGET, seasonView([episodeView(1), episodeView(2)])),
    );
    await act(async () => a[0]?.season.undo());
    await flush();

    expect(useSnackbar.getState().snack?.message).toBe("Couldn't undo that. Please try again.");
  });
});

const snackText = () => {
  const message = useSnackbar.getState().snack?.message;
  return typeof message === "string"
    ? message
    : message && `${message.subject}${message.predicate}`;
};

describe("queue mark edges", () => {
  it("ignores a mark with no next episode or one already advancing", async () => {
    const fake = fakeRuntime({});
    const [a] = mountSurfaces(fake.runtime, seededClient([libraryEntry()]));
    await act(async () => a[0]?.mark.mark({ ...libraryEntry(), nextEpisode: null }));
    await act(async () => a[0]?.mark.mark({ ...libraryEntry(), pendingAdvance: true }));
    await act(async () => a[0]?.mark.reverse(SHOW));
    expect(fake.submitted).toHaveLength(0);
  });

  it("rolls a refused mark back and says so", async () => {
    const entry = libraryEntry();
    const refused = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const qc = seededClient([entry]);
    const [a] = mountSurfaces(refused.runtime, qc);
    await act(async () => a[0]?.mark.mark(entry));
    expect(entryOf(qc, SHOW)).toStrictEqual(entry);
    expect(snackText()).toBe(`Couldn't mark ${entry.title} watched. Please try again.`);
  });

  it("stays quiet about a refused mark the user had already reversed", async () => {
    let refuse: (outcome: "failed") => void = () => {};
    const fake = fakeRuntime({
      submit: (op) =>
        op.toState === "present"
          ? new Promise((resolve) => {
              refuse = resolve;
            })
          : Promise.resolve("done"),
    });
    const qc = seededClient([libraryEntry()]);
    const [a] = mountSurfaces(fake.runtime, qc);
    act(() => void a[0]?.mark.mark(libraryEntry()));
    await act(async () => a[0]?.mark.reverse(SHOW));
    await act(async () => refuse("failed"));
    expect(useSnackbar.getState().snack).toBeNull();
  });

  it("does not refetch a mark that lands while its Undo is still resolving", async () => {
    let land: (outcome: "done") => void = () => {};
    const fake = fakeRuntime({
      submit: () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    });
    fake.loadEpisodePlays.mockReturnValue(new Promise(() => {}));
    const [a] = mountSurfaces(fake.runtime, seededClient([libraryEntry()]));
    act(() => void a[0]?.mark.mark(libraryEntry()));
    act(() => void a[0]?.mark.reverse(SHOW));
    await act(async () => land("done"));
    expect(fake.runtime.loadShowProgress).not.toHaveBeenCalled();
  });

  it("reverses once however often Undo is pressed", async () => {
    const fake = fakeRuntime({});
    const [a] = mountSurfaces(fake.runtime, seededClient([libraryEntry()]));
    await act(async () => a[0]?.mark.mark(libraryEntry()));
    stubLandedPlay(fake);
    const undo = useSnackbar.getState().snack?.actions?.[0];
    await act(async () => {
      undo?.onPress();
      undo?.onPress();
    });
    await flush();
    expect(fake.submitted.map((op) => op.request.path)).toEqual([
      "/sync/history",
      "/sync/history/remove",
    ]);
  });

  it("leaves another action's snack alone when a mark is reversed", async () => {
    const fake = fakeRuntime({});
    const [a] = mountSurfaces(fake.runtime, seededClient([libraryEntry()]));
    await act(async () => a[0]?.mark.mark(libraryEntry()));
    act(() => void showSnack({ message: "Dune moved to Watchlist" }));
    stubLandedPlay(fake);
    await act(async () => a[0]?.mark.reverse(SHOW));
    expect(snackText()).toBe("Dune moved to Watchlist");
  });

  it("re-arms the check once the mark is retired", async () => {
    const fake = fakeRuntime({});
    const [a] = mountSurfaces(fake.runtime, seededClient([libraryEntry()]));
    await act(async () => a[0]?.mark.mark(libraryEntry()));
    expect(a[0]?.mark.justMarkedAt(SHOW)).not.toBeNull();
    act(() => a[0]?.mark.reArm(SHOW));
    expect(a[0]?.mark.justMarkedAt(SHOW)).toBeNull();
  });

  it("keeps the mark and says so when a reversal is refused", async () => {
    const fake = fakeRuntime({
      submit: (op) => Promise.resolve(op.toState === "present" ? "done" : "failed"),
    });
    const entry = libraryEntry();
    const qc = await markThenReverse(fake, entry, () => stubLandedPlay(fake));
    expect(entryOf(qc, SHOW)?.pendingAdvance).toBe(true);
    expect(snackText()).toBe(`Couldn't undo ${entry.title}. Please try again.`);
  });

  it("gives up an Undo that waits too long on a mark still being delivered", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeRuntime({ inFlightOpId: () => "op-0" });
      const entry = libraryEntry();
      const qc = seededClient([entry]);
      const [a] = mountSurfaces(fake.runtime, qc);
      await act(async () => a[0]?.mark.mark(entry));
      act(() => void a[0]?.mark.reverse(SHOW));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(fake.submitted).toHaveLength(1);
      expect(entryOf(qc, SHOW)?.pendingAdvance).toBe(true);
      expect(snackText()).toBe(`Couldn't undo ${entry.title}. Please try again.`);
    } finally {
      vi.useRealTimers();
    }
  });
});

const play = (historyId: number, number: number, watchedAt: string): EpisodePlay => ({
  historyId,
  episodeTrakt: 100 + number,
  season: 1,
  number,
  watchedAt,
});

const specials = (includeSpecials: boolean) => ({
  target: { ...TARGET, includeSpecials },
  season: {
    ...seasonView([{ ...episodeView(1), season: 0, ids: { trakt: 900 } }]),
    number: 0,
    isSpecial: true,
  },
});

describe("season controls", () => {
  it("marks Specials only for a show that counts them", async () => {
    const fake = fakeRuntime({});
    const qc = seededClient(
      [libraryEntry()],
      [seasonView([episodeView(1)]), specials(true).season],
    );
    const [a] = mountSurfaces(fake.runtime, qc);
    const special = () =>
      qc.getQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW))?.[1]?.episodes[0];
    await act(async () => a[0]?.season.markSeason(specials(false).target, specials(false).season));
    expect(fake.submitted).toHaveLength(0);
    await act(async () =>
      a[0]?.season.markUpToHere(TARGET, [seasonView([episodeView(1)]), specials(false).season], {
        season: 1,
        number: 1,
      }),
    );
    expect(seasonEp(qc, 1)?.watched).toBe(true);
    expect(special()?.watched).toBe(false);
    await act(async () => a[0]?.season.markSeason(specials(true).target, specials(true).season));
    expect(snackText()).toBe("Specials marked · 1 episode");
    expect(special()?.watched).toBe(true);
  });

  it("leaves a newer action's Undo in place when an older write is refused", async () => {
    let refuse: (outcome: "failed") => void = () => {};
    const fake = fakeRuntime({
      submit: (op) =>
        op.itemKey.includes(":bulk:")
          ? new Promise((resolve) => {
              refuse = resolve;
            })
          : Promise.resolve("done"),
    });
    const season = seasonView([episodeView(1), episodeView(2)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    act(() => void a[0]?.season.markSeason(TARGET, season));
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(3), { undoLabel: "S1 E3 marked" }),
    );
    await act(async () => refuse("failed"));
    await act(async () => a[0]?.season.undo());
    expect(fake.submitted.at(-1)).toMatchObject({ itemKey: "episode:103", toState: "absent" });
  });

  it("restores the season and forgets the mark when Trakt refuses it", async () => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const season = seasonView([episodeView(1, true), episodeView(2)]);
    const { qc, a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.markSeason(TARGET, season));
    expect(seasonEp(qc, 2)?.watched).toBe(false);
    expect(getSeasonMarkDelta(SHOW, 1)).toBeUndefined();
    expect(snackText()).toBe("Couldn't save that change. Please try again.");
  });

  it("catches up through an episode, folding the previous Undo into its own", async () => {
    const fake = fakeRuntime({});
    const episodes = [episodeView(1), episodeView(2), episodeView(3)];
    const { qc, a } = mountSeasonSurfaces(fake, episodes);
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(3), { undoLabel: "S1 E3 marked" }),
    );
    await act(async () =>
      a[0]?.season.markUpToHere(
        TARGET,
        [seasonView(episodes)],
        { season: 1, number: 2 },
        { absorbUndo: true },
      ),
    );
    expect(snackText()).toBe("Caught up through S1 E2");
    expect([1, 2, 3].map((n) => seasonEp(qc, n)?.watched)).toEqual([true, true, true]);

    await act(async () => a[0]?.season.undo());
    expect(fake.submitted.slice(2).map((op) => op.toState)).toEqual(["absent", "absent"]);
  });

  it("sends nothing to catch up on episodes already watched", async () => {
    const fake = fakeRuntime({});
    const { a } = mountSeasonSurfaces(fake);
    await act(async () =>
      a[0]?.season.markUpToHere(TARGET, [seasonView([episodeView(1, true)])], {
        season: 1,
        number: 1,
      }),
    );
    expect(fake.submitted).toHaveLength(0);
  });

  it("unmarks a watched season by exact play and keeps its rewatches", async () => {
    const fake = fakeRuntime({
      showPlays: [
        play(11, 1, "2026-01-01T00:00:00.000Z"),
        play(21, 2, "2026-01-02T00:00:00.000Z"),
        play(22, 2, "2026-02-02T00:00:00.000Z"),
      ],
    });
    const season = seasonView([episodeView(1, true), episodeView(2, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.unmarkSeason(TARGET, season));
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [11] });
    expect(snackText()).toBe("Season 1 unmarked · 1 episode · kept 1 rewatched episode");
  });

  it.each([
    [[], "No plays to unmark for this season."],
    [
      [play(21, 2, "2026-01-02T00:00:00.000Z"), play(22, 2, "2026-02-02T00:00:00.000Z")],
      "These plays are rewatches. Remove specific ones in your watch history.",
    ],
  ])("explains a season unmark with nothing single-play to remove", async (showPlays, message) => {
    const fake = fakeRuntime({ showPlays });
    const season = seasonView([episodeView(1, true), episodeView(2, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.unmarkSeason(TARGET, season));
    expect(fake.submitted).toHaveLength(0);
    expect(snackText()).toBe(message);
  });

  it("says so when history can't be reached to unmark a season", async () => {
    const fake = fakeRuntime({ showPlays: new Error("offline") });
    const season = seasonView([episodeView(1, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.unmarkSeason(TARGET, season));
    expect(snackText()).toBe(
      "Couldn't reach your history to unmark this season. Please try again.",
    );
  });

  it("reads no history to unmark a season with nothing aired", async () => {
    const fake = fakeRuntime({});
    const unaired = seasonView([{ ...episodeView(1), aired: false }]);
    const { a } = mountSeasonSurfaces(fake, unaired.episodes);
    await act(async () => a[0]?.season.unmarkSeason(TARGET, unaired));
    expect(fake.loadShowPlays).not.toHaveBeenCalled();
  });

  it("rewatches a season's aired episodes as fresh plays", async () => {
    const fake = fakeRuntime({});
    const season = seasonView([episodeView(1, true), episodeView(2, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.rewatchSeason(TARGET, season));
    expect(snackText()).toBe("Season 1 marked again · 2 episodes");
    expect(fake.submitted[0]?.itemKey).toContain(":add:");
    expect(fake.submitted[0]?.inversePatch).toEqual({
      kind: "additive-season",
      showId: SHOW,
      probe: { season: 1, number: 1 },
    });

    await act(async () =>
      a[0]?.season.rewatchSeason(specials(false).target, specials(false).season),
    );
    expect(fake.submitted).toHaveLength(1);
  });

  it("says so when a season rewatch is refused", async () => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const season = seasonView([episodeView(1, true)]);
    const { a } = mountSeasonSurfaces(fake, season.episodes);
    await act(async () => a[0]?.season.rewatchSeason(TARGET, season));
    expect(snackText()).toBe("Couldn't save that change. Please try again.");
  });
});

describe("episode controls", () => {
  it.each([
    "S1 E2 marked",
    undefined,
  ])("clears the tick and says so when a mark is refused (undo label: %s)", async (undoLabel) => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const { qc, a } = mountSeasonSurfaces(fake);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2), { undoLabel }));
    expect(seasonEp(qc, 2)?.watched).toBe(false);
    expect(snackText()).toBe("Couldn't update that episode. Please try again.");
  });

  it("resumes nothing when marking a show that is not in the library", async () => {
    const fake = fakeRuntime({});
    const qc = new QueryClient();
    const [a] = mountSurfaces(fake.runtime, qc);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2)));
    expect(fake.submitted.map((op) => op.request.path)).toEqual(["/sync/history"]);
  });

  it("refreshes an episode once cancelling its queued mark lands", async () => {
    const fake = fakeRuntime({});
    const { a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    fake.queued.push({ itemKey: `episode:${NEXT_EP_TRAKT}`, toState: "present" } as QueuedOp);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true)));
    expect(fake.runtime.loadShowProgress).toHaveBeenCalledWith(SHOW);
  });

  it("clears the tick of a known rewatch whose other plays are already gone", async () => {
    const fake = fakeRuntime({ plays: [play(21, 2, "2026-01-02T00:00:00.000Z")] });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(2, true), { knownPlays: 2 }),
    );
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [21] });
    expect(seasonEp(qc, 2)?.watched).toBe(false);
    expect(snackText()).toBe("Removed play");
  });

  it("keeps the rewatch tick at its newest play when removing that play is refused", async () => {
    const fake = fakeRuntime({
      plays: [play(21, 2, "2026-01-02T00:00:00.000Z"), play(22, 2, "2026-02-02T00:00:00.000Z")],
      submit: () => Promise.resolve("failed"),
    });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true)));
    expect(qc.getQueryData<EpisodeDetail>(queryKeys.episode(SHOW, 1, 2))).toMatchObject({
      watched: true,
      watchedAt: "2026-02-02T00:00:00.000Z",
    });
  });

  it("re-ticks a queued mark's episode when cancelling it is refused", async () => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    fake.queued.push({ itemKey: `episode:${NEXT_EP_TRAKT}`, toState: "present" } as QueuedOp);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true)));
    expect(fake.submitted[0]?.watchedAt).not.toBeNull();
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(snackText()).toBe("Couldn't update that episode. Please try again.");
  });

  it("removes only the newest play of a rewatch and keeps the tick", async () => {
    const fake = fakeRuntime({
      plays: [play(21, 2, "2026-01-02T00:00:00.000Z"), play(22, 2, "2026-02-02T00:00:00.000Z")],
    });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(2, true), { knownPlays: 2 }),
    );
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [22] });
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(snackText()).toBe("Removed 1 play · 1 remain");
  });

  it("re-ticks and says so when removing a play is refused", async () => {
    const fake = fakeRuntime({
      plays: [play(21, 2, "2026-01-02T00:00:00.000Z")],
      submit: () => Promise.resolve("failed"),
    });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true)));
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(snackText()).toBe("Couldn't update that episode. Please try again.");
  });

  it.each([
    undefined,
    2,
  ])("keeps the tick when history can't be reached (known plays: %s)", async (knownPlays) => {
    const fake = fakeRuntime({ plays: new Error("offline") });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true), { knownPlays }));
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(snackText()).toBe("Couldn't reach your history to unmark this. Please try again.");
  });

  it.each([
    undefined,
    2,
  ])("clears a tick whose plays are already gone (known plays: %s)", async (knownPlays) => {
    const fake = fakeRuntime({ plays: [] });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.toggleEpisode(TARGET, episodeView(2, true), { knownPlays }));
    expect(fake.submitted).toHaveLength(0);
    expect(seasonEp(qc, 2)?.watched).toBe(false);
  });

  it("says so when adding a play is refused", async () => {
    const fake = fakeRuntime({ submit: () => Promise.resolve("failed") });
    const { a } = mountSeasonSurfaces(fake);
    await act(async () => a[0]?.season.addEpisodePlay(TARGET, episodeView(2, true)));
    expect(snackText()).toBe("Couldn't add that play. Please try again.");
  });

  it("removes every play of one episode, and restores them on Undo", async () => {
    const fake = fakeRuntime({
      plays: [
        play(21, 2, "2026-01-02T00:00:00.000Z"),
        play(22, 2, "2026-02-02T00:00:00.000Z"),
        play(31, 3, "2026-02-03T00:00:00.000Z"),
      ],
    });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.removeAllPlays(TARGET, episodeView(2, true)));
    expect(fake.submitted[0]?.request.body).toEqual({ ids: [22, 21] });
    expect(seasonEp(qc, 2)?.watched).toBe(false);
    expect(snackText()).toBe("Removed 2 plays");

    await act(async () => a[0]?.season.undo());
    expect(fake.submitted[1]?.request.path).toBe("/sync/history");
  });

  it("re-ticks with the newest play and says so when removing every play is refused", async () => {
    const fake = fakeRuntime({
      plays: [play(21, 2, "2026-01-02T00:00:00.000Z"), play(22, 2, "2026-02-02T00:00:00.000Z")],
      submit: () => Promise.resolve("failed"),
    });
    const { qc, a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.removeAllPlays(TARGET, episodeView(2, true)));
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(qc.getQueryData<EpisodeDetail>(queryKeys.episode(SHOW, 1, 2))?.watchedAt).toBe(
      "2026-02-02T00:00:00.000Z",
    );
    expect(snackText()).toBe("Couldn't remove those plays. Please try again.");
  });

  it.each([
    [new Error("offline"), "Couldn't reach your history. Please try again."],
    [[], undefined],
  ])("removes nothing when no play can be named", async (plays, message) => {
    const fake = fakeRuntime({ plays });
    const { a } = mountSeasonSurfaces(fake, [episodeView(1, true), episodeView(2, true)]);
    await act(async () => a[0]?.season.removeAllPlays(TARGET, episodeView(2, true)));
    expect(fake.submitted).toHaveLength(0);
    expect(snackText()).toBe(message);
  });

  it("re-ticks and says so when an episode mark's Undo is refused", async () => {
    let submits = 0;
    const fake = fakeRuntime({
      submit: () => Promise.resolve(submits++ === 0 ? "done" : "failed"),
    });
    const { qc, a } = mountSeasonSurfaces(fake);
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(2), { undoLabel: "S1 E2 marked" }),
    );
    await act(async () => a[0]?.season.undo());
    await act(async () => a[0]?.season.undo());
    expect(fake.submitted).toHaveLength(2);
    expect(seasonEp(qc, 2)?.watched).toBe(true);
    expect(snackText()).toBe("Couldn't undo that. Please try again.");
  });

  it("stops a resumed show again when its mark is undone", async () => {
    const fake = fakeRuntime({});
    const entry = { ...libraryEntry(), hidden: true };
    const qc = seededClient([entry], [seasonView([episodeView(1, true), episodeView(2)])]);
    const [a] = mountSurfaces(fake.runtime, qc);
    await act(async () =>
      a[0]?.season.toggleEpisode(TARGET, episodeView(2), { undoLabel: "S1 E2 marked" }),
    );
    expect(entryOf(qc, SHOW)?.hidden).toBe(false);
    await act(async () => a[0]?.season.undo());
    expect(entryOf(qc, SHOW)?.hidden).toBe(true);
  });

  it("drops a second tap on an episode while its first write is in flight", () => {
    const fake = fakeRuntime({ submit: () => new Promise(() => {}) });
    const { a } = mountSeasonSurfaces(fake);
    act(() => {
      void a[0]?.season.addEpisodePlay(TARGET, episodeView(2, true));
      void a[0]?.season.addEpisodePlay(TARGET, episodeView(2, true));
    });
    expect(fake.submitted).toHaveLength(1);
  });
});
