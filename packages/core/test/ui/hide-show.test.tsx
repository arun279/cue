// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { useHideShow } from "@cue/core/hooks/useHideShow";
import type { SubmitOutcome, UpNextData } from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeShow } from "../domain/_helpers";
import { partialRuntime, withRuntime } from "../support/runtime";

const entry: LibraryEntry = {
  ...makeShow({ showId: 7, title: "Severance" }),
  tmdbId: null,
  runtime: null,
  posters: [],
  pendingAdvance: false,
};

function setup(outcome: SubmitOutcome = "done") {
  const submitted: QueuedOp[] = [];
  const runtime = partialRuntime({
    newId: () => `op-${submitted.length}`,
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve(outcome);
    },
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData<UpNextData>(queryKeys.library(), { entries: [entry] });
  queryClient.setQueryData(queryKeys.calendar("2026-07-12", 7), []);
  const { result } = renderHook(useHideShow, { wrapper: withRuntime(runtime, queryClient) });
  const hidden = () =>
    queryClient.getQueryData<UpNextData>(queryKeys.library())?.entries[0]?.hidden;
  return { controls: result, submitted, queryClient, hidden };
}

const snack = () => useSnackbar.getState().snack;

beforeEach(dismissSnack);

describe("useHideShow", () => {
  it("stops a show at once, leaves the calendar to its library flag rather than a re-read, and resumes it on Undo", async () => {
    const { controls, submitted, queryClient, hidden } = setup();
    await act(async () => controls.current.stopWatching(entry));
    expect(hidden()).toBe(true);
    expect(submitted[0]?.request).toMatchObject({
      path: "/users/hidden/progress_watched",
      body: { shows: [{ ids: { trakt: 7 } }] },
    });
    expect(queryClient.getQueryState(queryKeys.calendar("2026-07-12", 7))?.isInvalidated).toBe(
      false,
    );
    expect(snack()?.message).toBe("Severance stopped");

    await act(async () => snack()?.actions?.[0]?.onPress());
    expect(hidden()).toBe(false);
    expect(submitted[1]?.request.path).toBe("/users/hidden/progress_watched/remove");
  });

  it("carries the TMDB id Trakt matches the show by when it has one", async () => {
    const { controls, submitted } = setup();
    await act(async () => controls.current.stopWatching({ ...entry, tmdbId: 95396 }));
    expect(submitted[0]?.request.body).toEqual({ shows: [{ ids: { trakt: 7, tmdb: 95396 } }] });
  });

  it("resumes a stopped or dropped show and stops it again on Undo", async () => {
    const { controls, submitted, hidden } = setup();
    await act(async () => controls.current.unhide(7, { trakt: 7 }, "Severance"));
    expect(hidden()).toBe(false);
    expect(snack()?.message).toBe("Severance resumed");
    expect(submitted.map((op) => op.request.path)).toEqual([
      "/users/hidden/progress_watched/remove",
      "/users/hidden/dropped/remove",
    ]);

    await act(async () => snack()?.actions?.[0]?.onPress());
    expect(hidden()).toBe(true);
    expect(submitted[2]?.request.path).toBe("/users/hidden/progress_watched");
  });

  it("stops a show opened before the library has loaded", async () => {
    const { controls, submitted, queryClient } = setup();
    queryClient.removeQueries({ queryKey: queryKeys.library() });
    await act(async () => controls.current.hide(7, { trakt: 7 }, "Severance"));
    expect(submitted).toHaveLength(1);
    expect(queryClient.getQueryData(queryKeys.library())).toBeUndefined();
  });

  it("puts the show back and offers no Undo when Trakt refuses the write", async () => {
    const { controls, hidden } = setup("failed");
    await act(async () => controls.current.hide(7, { trakt: 7 }, "Severance"));
    expect(hidden()).toBe(false);
    expect(snack()?.message).toBe("Couldn't stop watching Severance. Please try again.");
    expect(snack()?.actions?.map((action) => action.label)).toEqual(["Dismiss"]);

    await act(async () => controls.current.unhide(7, { trakt: 7 }, "Severance"));
    expect(snack()?.message).toBe("Couldn't resume Severance. Please try again.");
  });
});
