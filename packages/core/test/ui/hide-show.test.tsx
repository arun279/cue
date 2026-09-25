// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { type HideController, useHideShow } from "@cue/core/hooks/useHideShow";
import {
  type CueRuntime,
  RuntimeProvider,
  type SubmitOutcome,
  type UpNextData,
} from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeShow } from "../domain/_helpers";
import { mount } from "./_mount";

const entry: LibraryEntry = {
  ...makeShow({ showId: 7, title: "Severance" }),
  tmdbId: null,
  pendingAdvance: false,
};

function Probe({ slot }: { readonly slot: HideController[] }): null {
  slot[0] = useHideShow();
  return null;
}

function setup(outcome: SubmitOutcome = "done") {
  const submitted: QueuedOp[] = [];
  const runtime = {
    newId: () => `op-${submitted.length}`,
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve(outcome);
    },
  } as unknown as CueRuntime;
  const queryClient = new QueryClient();
  queryClient.setQueryData<UpNextData>(queryKeys.library(), { entries: [entry] });
  queryClient.setQueryData(queryKeys.calendar("2026-07-12", 7), []);
  const slot: HideController[] = [];
  mount(
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  const hidden = () =>
    queryClient.getQueryData<UpNextData>(queryKeys.library())?.entries[0]?.hidden;
  return { slot, submitted, queryClient, hidden };
}

const snack = () => useSnackbar.getState().snack;

beforeEach(dismissSnack);

describe("useHideShow", () => {
  it("stops a show at once, drops it from the calendar, and resumes it on Undo", async () => {
    const { slot, submitted, queryClient, hidden } = setup();
    await act(async () => slot[0]?.stopWatching(entry));
    expect(hidden()).toBe(true);
    expect(submitted[0]?.request).toMatchObject({
      path: "/users/hidden/progress_watched",
      body: { shows: [{ ids: { trakt: 7 } }] },
    });
    expect(queryClient.getQueryState(queryKeys.calendar("2026-07-12", 7))?.isInvalidated).toBe(
      true,
    );
    expect(snack()?.message).toBe("Severance stopped");

    await act(async () => snack()?.actions?.[0]?.onPress());
    expect(hidden()).toBe(false);
    expect(submitted[1]?.request.path).toBe("/users/hidden/progress_watched/remove");
  });

  it("carries the TMDB id Trakt matches the show by when it has one", async () => {
    const { slot, submitted } = setup();
    await act(async () => slot[0]?.stopWatching({ ...entry, tmdbId: 95396 }));
    expect(submitted[0]?.request.body).toEqual({ shows: [{ ids: { trakt: 7, tmdb: 95396 } }] });
  });

  it("resumes a stopped show and stops it again on Undo", async () => {
    const { slot, hidden } = setup();
    await act(async () => slot[0]?.unhide(7, { trakt: 7 }, "Severance"));
    expect(hidden()).toBe(false);
    expect(snack()?.message).toBe("Severance resumed");

    await act(async () => snack()?.actions?.[0]?.onPress());
    expect(hidden()).toBe(true);
  });

  it("stops a show opened before the library has loaded", async () => {
    const { slot, submitted, queryClient } = setup();
    queryClient.removeQueries({ queryKey: queryKeys.library() });
    await act(async () => slot[0]?.hide(7, { trakt: 7 }, "Severance"));
    expect(submitted).toHaveLength(1);
    expect(queryClient.getQueryData(queryKeys.library())).toBeUndefined();
  });

  it("puts the show back and offers no Undo when Trakt refuses the write", async () => {
    const { slot, hidden } = setup("failed");
    await act(async () => slot[0]?.hide(7, { trakt: 7 }, "Severance"));
    expect(hidden()).toBe(false);
    expect(snack()?.message).toBe("Couldn't stop watching Severance. Please try again.");
    expect(snack()?.actions?.map((action) => action.label)).toEqual(["Dismiss"]);

    await act(async () => slot[0]?.unhide(7, { trakt: 7 }, "Severance"));
    expect(snack()?.message).toBe("Couldn't resume Severance. Please try again.");
  });
});
