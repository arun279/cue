// @vitest-environment jsdom
/**
 * What Undo and a refused write leave behind, on the screen and on the Trakt fake:
 * a write that cannot stand is taken back with everything it changed, and only that.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { buildStopShowOp } from "@/core/domain/write-queue/ops";
import { useMarkSeason } from "@/core/hooks/useMarkSeason";
import { useMarkWatched } from "@/core/hooks/useMarkWatched";
import { libraryQuery } from "@/core/queries/library";
import { showSeasonsQuery } from "@/core/queries/shows";
import { createQueryClient } from "@/core/runtime/query-cache";
import { REFUSED_MESSAGE } from "@/core/runtime/refusals";
import { resetMarkStore } from "@/core/stores/mark-store";
import { useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { withRuntime } from "../support/runtime";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(resetMarkStore);

const HISTORY = /^\/sync\/history$/;
// Paper Moon Radio is on Trakt's dropped list; Glasshouse is hidden from progress.
const DROPPED = 8804;
const HIDDEN = 8805;
// Harbor Lights is watched through S3 E4.
const HARBOR = 8801;

async function mounted() {
  let made = 0;
  const cue = await buildRuntime({
    newId: () => {
      made += 1;
      return `op-${made}`;
    },
  });
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(libraryQuery(cue));
  const entryOf = (showId: number) => {
    const entry = queryClient
      .getQueryData(libraryQuery(cue).queryKey)
      ?.entries.find((candidate) => candidate.showId === showId);
    if (entry === undefined) throw new Error(`show ${showId} is not in the library`);
    return entry;
  };
  const wrapper = withRuntime(cue, queryClient);
  const up = renderHook(useMarkWatched, { wrapper });
  return { cue, queryClient, entryOf, wrapper, up };
}

const onTrakt = (showId: number) => ({
  hidden: fake.account.shows.find((show) => show.trakt === showId)?.hidden,
  dropped: fake.account.dropped.some(({ show }) => show.trakt === showId),
});

it("drops a show again when the mark that resumed it is undone", async () => {
  const { cue, entryOf, up } = await mounted();
  await act(() => up.result.current.mark(entryOf(DROPPED)));
  await act(() => up.result.current.reverse(DROPPED));
  await act(() => cue.flushWrites());

  expect(onTrakt(DROPPED)).toEqual({ hidden: false, dropped: true });
  expect(entryOf(DROPPED).hidden).toBe(true);
});

it("stops a show again when its mark is undone while Trakt is still answering it", async () => {
  const { cue, entryOf, up } = await mounted();
  const release = fake.hold({ method: "POST", path: HISTORY });
  let marking: Promise<void> = Promise.resolve();
  act(() => {
    marking = up.result.current.mark(entryOf(HIDDEN));
  });
  await vi.waitFor(() => expect(cue.writeState(cue.pendingOps()[0]?.id ?? "")).toBe("sent"));
  let undoing: Promise<void> = Promise.resolve();
  act(() => {
    undoing = up.result.current.reverse(HIDDEN);
  });
  release();
  await act(async () => {
    await marking;
    await undoing;
    await cue.flushWrites();
  });

  expect(onTrakt(HIDDEN)).toEqual({ hidden: true, dropped: false });
  expect(entryOf(HIDDEN).hidden).toBe(true);
});

it("shows a stopped show as Trakt has it when the mark that resumed it is refused later", async () => {
  const { cue, entryOf, up } = await mounted();
  // The mark's first send gets no answer, and Trakt refuses it the next time it is sent.
  fake.drop({ method: "POST", path: HISTORY });
  fake.fail({ method: "POST", path: HISTORY }, 422);
  await act(() => up.result.current.mark(entryOf(HIDDEN)));
  await act(() => cue.flushWrites());

  expect(useSnackbar.getState().snack?.message).toBe(REFUSED_MESSAGE);
  expect(entryOf(HIDDEN).hidden).toBe(onTrakt(HIDDEN).hidden);
});

it("takes the Undo of an episode mark off the screen once its tick is cleared", async () => {
  const { cue, queryClient, wrapper } = await mounted();
  const seasons = await queryClient.fetchQuery(showSeasonsQuery(cue, HARBOR));
  const next = seasons.find((s) => s.number === 3)?.episodes.find((e) => e.number === 5);
  if (next === undefined) throw new Error("Harbor Lights needs an S3 E5");
  fake.drop({ method: "POST", path: /^\/(sync|users)\//, times: Number.POSITIVE_INFINITY });
  await act(() => cue.submit(buildStopShowOp("hidden", { opId: "earlier", ids: { trakt: 8803 } })));
  const show = renderHook(useMarkSeason, { wrapper });
  const target = { showId: HARBOR, ids: { trakt: HARBOR }, includeSpecials: true };
  await act(() => show.result.current.toggleEpisode(target, next, { undoLabel: "S3 E5 marked" }));
  await act(() => show.result.current.toggleEpisode(target, { ...next, watched: true }));

  expect(cue.pendingOps().map((op) => op.id)).toEqual(["earlier"]);
  expect(useSnackbar.getState().snack).toBeNull();
});
