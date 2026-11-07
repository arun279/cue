// @vitest-environment jsdom
/**
 * How the runtime's write queue delivers to the Trakt fake when Trakt's answers go
 * missing or keep failing: what is sent again, what is given up, and what the app
 * hears about each write afterwards.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildAddWatchlistOp,
  buildHideShowOp,
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveWatchlistOp,
  buildUnmarkEpisodeOp,
} from "@/core/domain/write-queue/ops";
import { useHideShow } from "@/core/hooks/useHideShow";
import { libraryQuery } from "@/core/queries/library";
import { createQueryClient } from "@/core/runtime/query-cache";
import { useSnackbar } from "@/core/stores/snackbar-store";
import { buildRuntime } from "../data/_runtime";
import { withRuntime } from "../support/runtime";
import { startTraktFake } from "../trakt-fake/in-process.ts";

const fake = startTraktFake();

afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-09-10T12:00:00.000Z";
const HISTORY = /^\/sync\/history$/;
const HIDDEN = /^\/users\/hidden\/progress_watched$/;
const EVERY = Number.POSITIVE_INFINITY;
// The seed's first show has its first 20 episodes watched; this is its 21st.
const NEXT_EPISODE = 880120;

const posts = (path: string) =>
  fake.requests.filter((entry) => entry.method === "POST" && entry.path === path);

it("sends the Undo of a mark whose answer was lost, so Trakt does not keep the mark", async () => {
  fake.drop({ method: "POST", path: HISTORY }, "after");
  fake.drop({ method: "GET", path: /\/progress\/watched$/, times: EVERY });
  const cue = await buildRuntime();
  const mark = buildMarkEpisodeOp({ opId: "mark", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  await expect(cue.submit(mark)).resolves.toBe("deferred");

  const undo = buildUnmarkEpisodeOp({ opId: "undo", ids: { trakt: NEXT_EPISODE }, watchedAt: AT });
  await cue.submit(undo);
  await cue.flushWrites();

  expect(posts("/sync/history/remove")).toHaveLength(1);
  expect(await cue.loadEpisodePlays(NEXT_EPISODE)).toEqual([]);
  expect(cue.pendingWrites()).toBe(0);
});

it("sends a movie mark again when its answer was lost, and Trakt keeps one play", async () => {
  fake.drop({ method: "POST", path: HISTORY }, "after");
  const cue = await buildRuntime();
  await cue.submit(buildMarkMovieOp({ opId: "movie", ids: { trakt: 5503 }, watchedAt: AT }));
  await cue.flushWrites();

  expect(posts("/sync/history")).toHaveLength(2);
  expect(await cue.loadMoviePlays(5503)).toHaveLength(1);
  expect(cue.pendingWrites()).toBe(0);
});

it("gives up a write Trakt keeps refusing, and sends the writes queued behind it", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AT));
  fake.fail({ method: "POST", path: HIDDEN, times: EVERY }, 500);
  const cue = await buildRuntime();
  void cue.submit(buildHideShowOp({ opId: "stuck", ids: { trakt: 8801 } }));
  void cue.submit(buildAddWatchlistOp({ opId: "behind", section: "shows", ids: { trakt: 8901 } }));

  for (let minute = 0; minute < 10 && cue.pendingWrites() > 0; minute += 1) {
    const flushed = cue.flushWrites();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushed;
  }

  expect(cue.pendingWrites()).toBe(0);
  expect(posts("/sync/watchlist")).toHaveLength(1);
  await expect(cue.settled("stuck")).resolves.toBe("failed");
  await expect(cue.settled("behind")).resolves.toBe("done");
});

it("rolls a write back and says so when Trakt refuses it after its screen has gone", async () => {
  const cue = await buildRuntime();
  const queryClient = createQueryClient();
  await queryClient.fetchQuery(libraryQuery(cue));
  const hidden = () =>
    queryClient.getQueryData(libraryQuery(cue).queryKey)?.entries.find((e) => e.showId === 8801)
      ?.hidden;
  fake.drop({ method: "POST", path: HIDDEN });
  fake.drop({ method: "GET", path: /^\/users\/hidden\// });
  const screen = renderHook(useHideShow, { wrapper: withRuntime(cue, queryClient) });
  await act(() => screen.result.current.hide(8801, { trakt: 8801 }, "A show"));
  expect(hidden()).toBe(true);
  screen.unmount();

  fake.fail({ method: "POST", path: HIDDEN }, 404);
  await act(() => cue.flushWrites());

  expect(hidden()).toBe(false);
  expect(useSnackbar.getState().snack?.message).toBe("Couldn't save an earlier change to Trakt.");
});

/** A runtime whose mark is held in flight, so the writes queued behind it are not sent yet. */
async function behindAHeldMark() {
  const release = fake.hold({ method: "POST", path: HISTORY });
  const cue = await buildRuntime();
  const ahead = cue.submit(
    buildMarkEpisodeOp({ opId: "ahead", ids: { trakt: NEXT_EPISODE }, watchedAt: AT }),
  );
  await vi.waitFor(() => expect(cue.inFlightOpId()).toBe("ahead"));
  return { cue, ahead, release };
}

const show = { section: "shows", ids: { trakt: 8901 } } as const;

it("tells each write it was cancelled when its opposite was queued before either was sent", async () => {
  const { cue, ahead, release } = await behindAHeldMark();
  const add = cue.submit(buildAddWatchlistOp({ opId: "add", ...show }));
  const remove = cue.submit(buildRemoveWatchlistOp({ opId: "remove", ...show }));
  release();

  await expect(Promise.all([ahead, add, remove])).resolves.toEqual([
    "done",
    "cancelled",
    "cancelled",
  ]);
  expect(posts("/sync/watchlist")).toHaveLength(0);
});

it("tells a write that repeats one already queued how that one went", async () => {
  const { cue, ahead, release } = await behindAHeldMark();
  const first = cue.submit(buildAddWatchlistOp({ opId: "first", ...show }));
  const again = cue.submit(buildAddWatchlistOp({ opId: "again", ...show }));
  release();

  await expect(Promise.all([ahead, first, again])).resolves.toEqual(["done", "done", "done"]);
  expect(posts("/sync/watchlist")).toHaveLength(1);
});
