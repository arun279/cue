// @vitest-environment jsdom
import { queryKeys } from "@cue/core/data/query-keys";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { useMoveToWatchlist } from "@cue/core/hooks/useMoveToWatchlist";
import { RuntimeProvider, type SubmitOutcome, type UpNextData } from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { buildRuntime } from "../data/_runtime";
import { makeShow } from "../domain/_helpers";
import { mountAsync } from "./_mount";

afterEach(dismissSnack);

function Probe({ slot }: { readonly slot: ReturnType<typeof useMoveToWatchlist>[] }): null {
  slot[0] = useMoveToWatchlist();
  return null;
}

async function setup(outcome: SubmitOutcome, hidden = false) {
  const runtime = await buildRuntime();
  const submit = vi.spyOn(runtime, "submit").mockResolvedValue(outcome);
  const client = new QueryClient();
  const entry: LibraryEntry = { ...makeShow({ completed: 0, hidden }), tmdbId: null };
  client.setQueryData<UpNextData>(queryKeys.library(), { entries: [entry] });
  const slot: ReturnType<typeof useMoveToWatchlist>[] = [];
  await mountAsync(
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    entry,
    submit,
    move: async (value = entry) => act(async () => slot[0]?.(value)),
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
  ]);
  await act(async () => useSnackbar.getState().snack?.actions?.[0]?.onPress());
  expect(client.getQueryData<UpNextData>(queryKeys.library())?.entries).toEqual([entry]);
  expect(submit).toHaveBeenCalledTimes(4);
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
