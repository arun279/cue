// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEntry } from "@/core/domain/calendar";
import type { LibraryEntry } from "@/core/domain/model/library";
import type { EpisodeView, SeasonView } from "@/core/domain/show-detail";
import { type LibrarySnapshot, useLibrarySnapshot } from "@/core/hooks/useLibrarySnapshot";
import type { CueRuntime } from "@/core/runtime/runtime";
import { partialRuntime, withRuntime } from "../support/runtime";

const DAY = 24 * 60 * 60 * 1000;
const airedAt = (): string => new Date(Date.now() - DAY).toISOString();

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    showId: 1,
    title: "Show",
    year: null,
    status: "returning series",
    hidden: false,
    inWatchlist: false,
    addedAt: null,
    lastWatchedAt: airedAt(),
    plays: null,
    aired: 2,
    completed: 2,
    left: Math.max(0, (overrides.aired ?? 2) - (overrides.completed ?? 2)),
    nextEpisode: null,
    lastAired: { season: 1, number: 2 },
    tmdbId: null,
    runtime: null,
    posters: [],
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
    episodeType: null,
    posters: [],
    network: null,
    tmdbId: null,
  };
}

async function mountSnapshot(runtime: CueRuntime): Promise<{ readonly current: LibrarySnapshot }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(useLibrarySnapshot, { wrapper: withRuntime(runtime, client) });
  await act(async () => {});
  return result;
}

function runtimeFixture(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
  loadShowSeasons: (showId: number) => Promise<readonly SeasonView[]>,
): CueRuntime {
  return partialRuntime({
    loadUpNext: () => Promise.resolve({ entries: [...entries], isPartial: false }),
    loadCalendar: () => Promise.resolve({ entries: calendar }),
    loadShowSeasons,
  });
}

async function mountWithoutSeasonRead(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
): Promise<{ readonly current: LibrarySnapshot }> {
  const loadShowSeasons = vi.fn((_showId: number) => Promise.resolve([]));
  const snapshot = await mountSnapshot(runtimeFixture(entries, calendar, loadShowSeasons));
  await act(async () => {
    await vi.waitFor(() => expect(snapshot.current.data).toBeDefined());
  });
  expect(loadShowSeasons).not.toHaveBeenCalled();
  return snapshot;
}

async function mountWithResolvedTree(
  entries: readonly LibraryEntry[],
  calendar: readonly CalendarEntry[],
  tree: readonly SeasonView[],
  expected: object,
): Promise<{ readonly current: LibrarySnapshot }> {
  const snapshot = await mountSnapshot(
    runtimeFixture(entries, calendar, () => Promise.resolve(tree)),
  );
  await act(async () => {
    await vi.waitFor(() => expect(snapshot.current.data?.entries[0]).toMatchObject(expected));
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
        expect(snapshot.current.data?.entries[0]?.nextEpisode?.season).toBe(2);
      });
    });

    expect(loadShowSeasons).toHaveBeenCalledTimes(1);
    expect(loadShowSeasons).toHaveBeenCalledWith(stale.showId);
    expect(snapshot.current.data?.entries[0]).toMatchObject({
      aired: 4,
      nextEpisode: { season: 2, number: 1, ids: { trakt: 21 } },
    });
    expect(snapshot.current.data?.entries.find((entry) => entry.showId === 1)).toMatchObject({
      aired: 4,
      nextEpisode: { season: 2, number: 1, ids: { trakt: 21 } },
    });
    expect(snapshot.current.data?.entries[1]).toBe(healthy);
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

    expect(snapshot.current.data?.entries[0]).toBe(gap);
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

    expect(snapshot.current.data?.entries[0]).toMatchObject(expected);
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

    expect(snapshot.current.data?.entries[0]).toMatchObject(expected);
  });

  it("leaves the calendar episodes of a show hidden in the library out of reconciliation", async () => {
    const hidden = entry({ hidden: true });
    const snapshot = await mountWithoutSeasonRead([hidden], [calendarEpisode(1)]);

    expect(snapshot.current.data?.entries[0]).toBe(hidden);
  });
});
