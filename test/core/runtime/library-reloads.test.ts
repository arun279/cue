import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { LibraryEntry } from "@/core/data/trakt/library";
import { buildBulkMarkOps } from "@/core/domain/write-queue/bulk";
import { buildMarkEpisodeOp } from "@/core/domain/write-queue/ops";
import type { QueuedOp } from "@/core/domain/write-queue/types";
import { refreshChangedShows } from "@/core/runtime/library-reloads";
import { makeShow } from "../domain/_helpers";

const entry = (showId: number, completed: number): LibraryEntry => ({
  ...makeShow({ showId, completed }),
  plays: completed,
  tmdbId: null,
  runtime: null,
  posters: [],
});

const EPISODE = 9001;

function watching(pending: readonly QueuedOp[] = []) {
  const qc = new QueryClient();
  qc.setQueryData(queryKeys.library(), { entries: [entry(1, 5), entry(2, 5)] });
  for (const showId of [1, 2]) {
    qc.setQueryData(queryKeys.showSeasons(showId), [
      { number: 1, episodes: [{ ids: { trakt: showId === 1 ? EPISODE : 9002 } }] },
    ]);
  }
  const stop = refreshChangedShows(qc, () => pending);
  const reload = (entries: readonly LibraryEntry[]) =>
    qc.fetchQuery({ queryKey: queryKeys.library(), queryFn: () => ({ entries }), staleTime: 0 });
  const refreshed = () =>
    [1, 2].filter((showId) => qc.getQueryState(queryKeys.showSeasons(showId))?.isInvalidated);
  return { qc, stop, reload, refreshed };
}

describe("refreshChangedShows", () => {
  it("refreshes the shows a fetched reload changed", async () => {
    const { reload, refreshed, stop } = watching();
    await reload([entry(1, 5), entry(2, 6)]);
    stop();
    expect(refreshed()).toEqual([2]);
  });

  it("ignores the app's own edits to the cached library", () => {
    const { qc, refreshed, stop } = watching();
    qc.setQueryData(queryKeys.library(), { entries: [entry(1, 6), entry(2, 6)] });
    stop();
    expect(refreshed()).toEqual([]);
  });

  it("ignores a reload that was cancelled before it landed", async () => {
    const { qc, refreshed, stop } = watching();
    const reload = qc.fetchQuery({
      queryKey: queryKeys.library(),
      queryFn: () => new Promise(() => {}),
      staleTime: 0,
    });
    await qc.cancelQueries({ queryKey: queryKeys.library() });
    await reload.catch(() => undefined);
    stop();
    expect(refreshed()).toEqual([]);
  });

  const AT = "2026-10-20T12:00:00.000Z";
  const [seasonMark] = buildBulkMarkOps(
    {
      showIds: { trakt: 1 },
      seasons: [{ number: 1, episodes: [{ number: 1, firstAired: AT, watched: false }] }],
      includeSpecials: false,
    },
    Date.parse(AT),
    AT,
    () => "op-1",
  );

  it.each([
    [
      "one of its episodes",
      buildMarkEpisodeOp({ opId: "op-1", ids: { trakt: EPISODE }, watchedAt: AT }),
    ],
    ["one of its seasons", seasonMark],
  ])("leaves a show alone while a write to %s is still on its way", async (_, op) => {
    if (op === undefined) throw new Error("no season write");
    const { reload, refreshed, stop } = watching([op]);
    await reload([entry(1, 6), entry(2, 6)]);
    stop();
    expect(refreshed()).toEqual([2]);
  });

  it("finds the show of a written episode through its cached episode page", async () => {
    const op = buildMarkEpisodeOp({ opId: "op-1", ids: { trakt: 9100 }, watchedAt: AT });
    const { qc, reload, refreshed, stop } = watching([op]);
    qc.setQueryData(queryKeys.episode(2, 1, 1), { ids: { trakt: 9100 } });
    await reload([entry(1, 6), entry(2, 6)]);
    stop();
    expect(refreshed()).toEqual([1]);
  });
});
