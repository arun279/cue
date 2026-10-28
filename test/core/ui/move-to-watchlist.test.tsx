// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/core/data/query-keys";
import type { LibraryEntry } from "@/core/data/trakt/library";
import { useMoveToWatchlist } from "@/core/hooks/useMoveToWatchlist";
import type { SubmitOutcome, UpNextData } from "@/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { makeShow } from "../domain/_helpers";
import { withRuntime } from "../support/runtime";

afterEach(dismissSnack);

async function setup(outcome: SubmitOutcome, hidden = false) {
  const runtime = await buildRuntime();
  const submit = vi.spyOn(runtime, "submit").mockResolvedValue(outcome);
  const client = new QueryClient();
  const entry: LibraryEntry = {
    ...makeShow({ completed: 0, hidden }),
    tmdbId: null,
    runtime: null,
    posters: [],
  };
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [entry] });
  const { result } = renderHook(useMoveToWatchlist, { wrapper: withRuntime(runtime, client) });
  await act(async () => {});
  return {
    client,
    entry,
    submit,
    move: async (value = entry) => act(async () => result.current(value)),
  };
}

it("moves a stopped show with no history and restores both memberships on Undo", async () => {
  const { client, entry, submit, move } = await setup("done", true);
  await move();
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries[0]).toMatchObject({
    inWatchlist: true,
    hidden: false,
  });
  expect(submit.mock.calls.map(([op]) => op.request.path)).toEqual([
    "/sync/watchlist",
    "/users/hidden/progress_watched/remove",
    "/users/hidden/dropped/remove",
  ]);
  await act(async () => useSnackbar.getState().snack?.actions?.[0]?.onPress());
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([entry]);
  expect(submit).toHaveBeenCalledTimes(5);
});

it("rolls a failed move back without resuming the stopped show", async () => {
  const { client, entry, submit, move } = await setup("failed", true);
  await move();
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([entry]);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(useSnackbar.getState().snack?.message).toBe(
    "Couldn't update your watchlist. Please try again.",
  );
});

it("keeps a deferred move and ignores started or already listed shows", async () => {
  const { client, entry, submit, move } = await setup("deferred");
  await move({ ...entry, completed: 1 });
  await move({ ...entry, inWatchlist: true });
  expect(submit).not.toHaveBeenCalled();
  await move();
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries[0]?.inWatchlist).toBe(true);
});

it("leaves a show that was never stopped alone on Undo", async () => {
  const { entry, submit, move, client } = await setup("done");
  await move();
  await act(async () => useSnackbar.getState().snack?.actions?.[0]?.onPress());
  expect(submit.mock.calls.map(([op]) => op.request.path)).toEqual([
    "/sync/watchlist",
    "/sync/watchlist/remove",
  ]);
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([entry]);
});
