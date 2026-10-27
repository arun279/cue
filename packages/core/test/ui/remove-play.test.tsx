// @vitest-environment jsdom

import { queryKeys } from "@cue/core/data/query-keys";
import type { HistoryEntry } from "@cue/core/domain/history";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { useRemovePlay } from "@cue/core/hooks/useRemovePlay";
import type { CueRuntime, SubmitOutcome } from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { partialRuntime, withRuntime } from "../support/runtime";

const entry: HistoryEntry = {
  historyId: 44,
  watchedAt: "2026-08-01T12:00:00.000Z",
  type: "movie",
  mediaId: 9,
  ids: { trakt: 9 },
  title: "Harbor",
  year: 2026,
  season: null,
  number: null,
  episodeTitle: null,
  posters: [],
  tmdbId: null,
};

function setup(
  submit: (op: QueuedOp) => Promise<SubmitOutcome> = () => Promise.resolve("deferred"),
) {
  const submitted: QueuedOp[] = [];
  const loadShowProgress = vi.fn<CueRuntime["loadShowProgress"]>(() => new Promise(() => {}));
  const runtime = partialRuntime({
    newId: () => `op-${submitted.length}`,
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return submit(op);
    },
    loadShowProgress,
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.movieLibrary(), { entries: [] });
  const { result } = renderHook(useRemovePlay, { wrapper: withRuntime(runtime, queryClient) });
  return { controller: result, submitted, queryClient, loadShowProgress };
}

const episode: HistoryEntry = {
  ...entry,
  type: "episode",
  mediaId: 3,
  ids: { trakt: 301 },
  season: 1,
  number: 4,
  episodeTitle: "Four",
};

const pressUndo = () =>
  act(async () => {
    useSnackbar.getState().snack?.actions?.[0]?.onPress();
    await Promise.resolve();
  });

beforeEach(dismissSnack);

describe("useRemovePlay", () => {
  it("states the loaded remainder and keeps successful undo silent", async () => {
    const { controller } = setup();
    await act(async () => controller.current.removePlay(entry, 2));
    expect(useSnackbar.getState().snack?.message).toBe("Removed 1 play · 2 remain");
    await act(async () => {
      useSnackbar.getState().snack?.actions?.[0]?.onPress();
      await Promise.resolve();
    });
    expect(useSnackbar.getState().snack).toBeNull();
  });

  it("hides one exact play and restores it through the snackbar action", async () => {
    const { controller, submitted } = setup();

    await act(async () => controller.current.removePlay(entry));
    expect(controller.current.removedIds).toEqual(new Set([44]));
    expect(submitted[0]?.request.body).toEqual({ ids: [44] });

    await act(async () => {
      useSnackbar.getState().snack?.actions?.[0]?.onPress();
      await Promise.resolve();
    });
    expect(controller.current.removedIds).toEqual(new Set());
    expect(submitted[1]?.request.path).toBe("/sync/history");
  });

  it("refreshes the movie library once a movie play is gone", async () => {
    const { controller, queryClient } = setup(() => Promise.resolve("done"));
    await act(async () => controller.current.removePlay(entry));
    expect(queryClient.getQueryState(queryKeys.movieLibrary())?.isInvalidated).toBe(true);
  });

  it("removes an episode play from its section and restores it once", async () => {
    const { controller, submitted, loadShowProgress } = setup(() => Promise.resolve("done"));
    await act(async () => controller.current.removePlay(episode));
    expect(submitted[0]?.inverse.body).toEqual({
      episodes: [{ ids: { trakt: 301 }, watched_at: episode.watchedAt }],
    });
    expect(loadShowProgress).toHaveBeenCalledOnce();

    const undo = useSnackbar.getState().snack?.actions?.[0];
    await act(async () => {
      undo?.onPress();
      undo?.onPress();
      await Promise.resolve();
    });
    expect(submitted.map((op) => op.request.path)).toEqual([
      "/sync/history/remove",
      "/sync/history",
    ]);
    expect(submitted[1]?.request.body).toMatchObject({ episodes: [{ ids: { trakt: 301 } }] });
  });

  it("brings the play back and says so when Trakt refuses the removal", async () => {
    const { controller } = setup(() => Promise.resolve("failed"));
    await act(async () => controller.current.removePlay(entry));
    expect(controller.current.removedIds).toEqual(new Set());
    expect(useSnackbar.getState().snack?.message).toBe(
      "Couldn't remove that play. Please try again.",
    );
  });

  it("restores nothing when Undo beat a removal that then failed", async () => {
    let settle: (outcome: SubmitOutcome) => void = () => {};
    const { controller, submitted } = setup(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    act(() => void controller.current.removePlay(entry));
    await pressUndo();
    await act(async () => settle("failed"));
    expect(submitted).toHaveLength(1);
    expect(controller.current.removedIds).toEqual(new Set());
  });

  it("hides the play again and says so when the restore fails", async () => {
    const { controller } = setup((op) =>
      Promise.resolve(op.request.path === "/sync/history" ? "failed" : "done"),
    );
    await act(async () => controller.current.removePlay(entry));
    await pressUndo();
    expect(controller.current.removedIds).toEqual(new Set([44]));
    expect(useSnackbar.getState().snack?.message).toBe(
      "Couldn't restore that play. Please try again.",
    );
  });
});
