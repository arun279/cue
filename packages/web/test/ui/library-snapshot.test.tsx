import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { EpisodeView, SeasonView } from "@cue/core/data/trakt/show-detail";
import type { CalendarEntry } from "@cue/core/domain/calendar";
import {
  type LibrarySnapshot,
  useLibraryEntry,
  useLibrarySnapshot,
} from "@cue/core/hooks/useLibrarySnapshot";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mountAsync } from "./_mount";

const DAY = 24 * 60 * 60 * 1000;
const airedAt = (): string => new Date(Date.now() - DAY).toISOString();

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: 1,
    title: "Show",
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    lastWatchedAt: airedAt(),
    aired: 2,
    completed: 2,
    nextEpisode: null,
    lastAired: { season: 1, number: 2 },
    tmdbId: null,
    pendingAdvance: false,
    ...overrides,
  };
}

function episode(season: number, number: number, watched: boolean, trakt: number): EpisodeView {
  return {
    season,
    number,
    title: `S${season}E${number}`,
    firstAired: airedAt(),
    ids: { trakt },
    stills: [],
    watched,
    watchedAt: watched ? airedAt() : null,
    aired: true,
  };
}

function season(number: number, episodes: readonly EpisodeView[], isHidden = false): SeasonView {
  return {
    number,
    title: `Season ${number}`,
    isSpecial: false,
    isHidden,
    episodes,
    airedCount: episodes.length,
    completedCount: episodes.filter((item) => item.watched).length,
  };
}

function calendarEpisode(number: number, showId = 1): CalendarEntry {
  const position = {
    showId,
    season: 2,
    number,
    firstAired: airedAt(),
    ids: { trakt: 20 + number },
  };
  return {
    ...position,
    showTitle: "Stale",
    episodeTitle: `S2E${number}`,
    posters: [],
    network: null,
    tmdbId: null,
  };
}

function Probe({
  onSnapshot,
  onEntry,
}: {
  readonly onSnapshot: (value: LibrarySnapshot) => void;
  readonly onEntry: (value: LibraryEntry | undefined) => void;
}): null {
  onSnapshot(useLibrarySnapshot());
  onEntry(useLibraryEntry(1));
  return null;
}

async function mountSnapshot(runtime: CueRuntime): Promise<{
  current: LibrarySnapshot | undefined;
  currentEntry: LibraryEntry | undefined;
}> {
  const snapshot: {
    current: LibrarySnapshot | undefined;
    currentEntry: LibraryEntry | undefined;
  } = { current: undefined, currentEntry: undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe
          onSnapshot={(value) => (snapshot.current = value)}
          onEntry={(value) => (snapshot.currentEntry = value)}
        />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return snapshot;
}

function runtimeFixture(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
  loadShowSeasons: (showId: number) => Promise<readonly SeasonView[]>,
  hiddenShowIds: readonly number[] = [],
): CueRuntime {
  return {
    loadUpNext: () => Promise.resolve({ entries: [...entries], isPartial: false }),
    loadCalendar: () => Promise.resolve({ entries: calendar, hiddenShowIds }),
    loadShowSeasons,
  } as unknown as CueRuntime;
}

async function mountWithoutSeasonRead(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
  hiddenShowIds: readonly number[] = [],
): Promise<{ current: LibrarySnapshot | undefined; currentEntry: LibraryEntry | undefined }> {
  const loadShowSeasons = vi.fn((_showId: number) => Promise.resolve([]));
  const snapshot = await mountSnapshot(
    runtimeFixture(entries, calendar, loadShowSeasons, hiddenShowIds),
  );
  await act(async () => {
    await vi.waitFor(() => expect(snapshot.current?.data).toBeDefined());
  });
  expect(loadShowSeasons).not.toHaveBeenCalled();
  return snapshot;
}

async function mountWithResolvedTree(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
  tree: readonly SeasonView[],
  expected: object,
): Promise<{ current: LibrarySnapshot | undefined; currentEntry: LibraryEntry | undefined }> {
  const snapshot = await mountSnapshot(
    runtimeFixture(entries, calendar, () => Promise.resolve(tree)),
  );
  await act(async () => {
    await vi.waitFor(() => expect(snapshot.current?.data?.entries[0]).toMatchObject(expected));
  });
  return snapshot;
}

describe("useLibrarySnapshot", () => {
  it("resolves only a calendar-flagged show's queue position from its season tree", async () => {
    const stale = entry({ title: "Stale" });
    const healthy = entry({
      showId: 2,
      title: "Healthy",
      aired: 3,
      completed: 2,
      nextEpisode: {
        season: 1,
        number: 3,
        title: "Next",
        firstAired: airedAt(),
        still: null,
        ids: { trakt: 30 },
      },
      lastAired: { season: 1, number: 3 },
    });
    const tree = [
      season(1, [episode(1, 1, true, 11), episode(1, 2, true, 12)]),
      season(2, [episode(2, 1, false, 21), episode(2, 2, false, 22)]),
    ];
    const loadShowSeasons = vi.fn((_showId: number) => Promise.resolve(tree));
    const runtime = runtimeFixture(
      [stale, healthy],
      [calendarEpisode(1), calendarEpisode(2)],
      loadShowSeasons,
    );

    const snapshot = await mountSnapshot(runtime);
    await act(async () => {
      await vi.waitFor(() => {
        expect(loadShowSeasons).toHaveBeenCalledTimes(1);
        expect(snapshot.current?.data?.entries[0]?.nextEpisode?.season).toBe(2);
      });
    });

    expect(loadShowSeasons).toHaveBeenCalledTimes(1);
    expect(loadShowSeasons).toHaveBeenCalledWith(stale.showId);
    expect(snapshot.current?.data?.entries[0]).toMatchObject({
      aired: 4,
      nextEpisode: { season: 2, number: 1, ids: { trakt: 21 } },
    });
    expect(snapshot.currentEntry).toMatchObject({
      aired: 4,
      nextEpisode: { season: 2, number: 1, ids: { trakt: 21 } },
    });
    expect(snapshot.current?.data?.entries[1]).toBe(healthy);
  });

  it("does not read season trees when the calendar detects no unknown episodes", async () => {
    await mountWithoutSeasonRead([entry()], []);
  });

  it("does not resolve a gap that the calendar did not detect", async () => {
    const gap = entry({
      aired: 4,
      completed: 2,
      nextEpisode: {
        season: 3,
        number: 1,
        title: "Future",
        firstAired: new Date(Date.now() + DAY).toISOString(),
        still: null,
        ids: { trakt: 31 },
      },
    });
    const snapshot = await mountWithoutSeasonRead([gap], []);

    expect(snapshot.current?.data?.entries[0]).toBe(gap);
  });

  it("restores the authoritative aired count when the tree has no unwatched episode", async () => {
    const stale = entry();
    const tree = [season(1, [episode(1, 1, true, 11), episode(1, 2, true, 12)])];
    const expected = {
      aired: 2,
      completed: 2,
      nextEpisode: null,
    };
    const snapshot = await mountWithResolvedTree([stale], [calendarEpisode(1)], tree, expected);

    expect(snapshot.current?.data?.entries[0]).toMatchObject(expected);
  });

  it("excludes hidden seasons when resolving the next episode and aired count", async () => {
    const stale = entry({ aired: 1, completed: 1, lastAired: { season: 2, number: 1 } });
    const tree = [
      season(1, [episode(1, 1, false, 11)], true),
      season(2, [episode(2, 1, true, 21)]),
      season(3, [episode(3, 1, false, 31)]),
    ];
    const calendar = [{ ...calendarEpisode(1), season: 3 }];
    const expected = {
      aired: 2,
      nextEpisode: { season: 3, number: 1, ids: { trakt: 31 } },
    };
    const snapshot = await mountWithResolvedTree([stale], calendar, tree, expected);

    expect(snapshot.current?.data?.entries[0]).toMatchObject(expected);
  });

  it("excludes hidden calendar shows before reconciliation", async () => {
    const hidden = entry();
    const snapshot = await mountWithoutSeasonRead([hidden], [calendarEpisode(1)], [hidden.showId]);

    expect(snapshot.current?.data?.entries[0]).toBe(hidden);
  });
});
