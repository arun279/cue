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
import { queryKeys } from "@data/query-keys";
import type { EpisodeDetail } from "@data/trakt/episode-detail";
import type { LibraryEntry } from "@data/trakt/library";
import type { EpisodeView, SeasonView } from "@data/trakt/show-detail";
import type { EpisodePlay } from "@domain/reversal";
import type { QueuedOp } from "@domain/write-queue/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dismissSnack, useSnackbar } from "@ui/components/snackbar-store";
import { resetMarkStore } from "@ui/hooks/mark-store";
import { type MarkSeasonController, useMarkSeason } from "@ui/hooks/useMarkSeason";
import { type MarkWatched, useMarkWatched } from "@ui/hooks/useMarkWatched";
import { type CueRuntime, RuntimeProvider, type UpNextData } from "@ui/runtime/runtime";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "./_mount";

const SHOW = 1;
const NEXT_EP_TRAKT = 102;

function episodeView(number: number, watched = false): EpisodeView {
  return {
    season: 1,
    number,
    title: null,
    firstAired: "2026-01-01T00:00:00.000Z",
    ids: { trakt: 100 + number },
    stills: [],
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
    episodes,
    airedCount: episodes.length,
    completedCount: episodes.filter((e) => e.watched).length,
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
    progressKnown: true,
    posters: [],
    backdrops: [],
    network: null,
    genres: [],
    runtime: null,
    tmdbId: null,
    pendingAdvance: false,
  };
}

interface FakeRuntime {
  readonly runtime: CueRuntime;
  readonly submitted: QueuedOp[];
  /** The simulated durable queue `pendingOps()` reads. */
  readonly queued: QueuedOp[];
  readonly loadEpisodePlays: ReturnType<typeof vi.fn>;
}

function fakeRuntime(opts: {
  /** Per-op settle; default resolves "done" and never keeps the op queued. */
  submit?(op: QueuedOp): Promise<"done" | "failed" | "deferred">;
  plays?: readonly EpisodePlay[] | Error;
  inFlightOpId?(): string | null;
}): FakeRuntime {
  const submitted: QueuedOp[] = [];
  const queued: QueuedOp[] = [];
  const loadEpisodePlays = vi.fn((_id: number) => {
    const plays = opts.plays ?? [];
    return plays instanceof Error ? Promise.reject(plays) : Promise.resolve(plays);
  });
  const runtime = {
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return opts.submit?.(op) ?? Promise.resolve("done");
    },
    pendingOps: () => [...queued],
    inFlightOpId: opts.inFlightOpId ?? (() => null),
    loadEpisodePlays,
  } as unknown as CueRuntime;
  return { runtime, submitted, queued, loadEpisodePlays };
}

interface Api {
  mark: MarkWatched;
  season: MarkSeasonController;
}

function Probe({ slot }: { slot: Api[] }) {
  const mark = useMarkWatched();
  const season = useMarkSeason();
  slot[0] = { mark, season };
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
  qc.setQueryData<UpNextData>(queryKeys.library(), { entries, isPartial: false });
  if (seasons !== undefined) {
    qc.setQueryData<readonly SeasonView[]>(queryKeys.showSeasons(SHOW), seasons);
    for (const s of seasons) {
      for (const e of s.episodes) {
        qc.setQueryData<EpisodeDetail>(queryKeys.episode(SHOW, s.number, e.number), {
          watched: e.watched,
          watchedAt: e.watchedAt,
        } as EpisodeDetail);
      }
    }
  }
  return qc;
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
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
  dismissSnack();
});

describe("F3a: a queue mark ticks the show-detail caches in the same frame", () => {
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
