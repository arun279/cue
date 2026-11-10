import { describe, expect, it } from "vitest";
import {
  buildAddEpisodePlayOp,
  buildAddWatchlistOp,
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildRemoveHistoryPlayOp,
  buildRemovePlaysOp,
  buildRemoveWatchlistOp,
  buildResumeShowOps,
  buildStopShowOp,
  buildUnmarkEpisodeOp,
  buildUnmarkMovieOp,
  episodeItemKey,
  targetOf,
} from "@/core/domain/write-queue/ops";

const WATCHED_AT = "2026-07-05T12:00:00.000Z";

describe("single-item history op builders", () => {
  it("marks an episode: add request, remove-by-item inverse, frozen watched_at", () => {
    const op = buildMarkEpisodeOp({ opId: "op-1", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/history",
      body: { episodes: [{ ids: { trakt: 42 }, watched_at: WATCHED_AT }] },
    });
    expect(op.inverse).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { episodes: [{ ids: { trakt: 42 } }] },
    });
    expect(op).toMatchObject({
      id: "op-1",
      itemKey: "episode:42",
      watchedAt: WATCHED_AT,
      fromState: "absent",
      toState: "present",
    });
  });

  it("exports the episode item key the mark ops coalesce on", () => {
    expect(episodeItemKey(42)).toBe(
      buildMarkEpisodeOp({ opId: "op-k", ids: { trakt: 42 }, watchedAt: WATCHED_AT }).itemKey,
    );
  });

  it("builds an additive play with a mark's request but an opId-unique item key", () => {
    const add = buildAddEpisodePlayOp({ opId: "op-a", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    const mark = buildMarkEpisodeOp({ opId: "op-a", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(add.request).toEqual(mark.request);
    expect(add.toState).toBe("present");
    expect(add.itemKey).toBe("episode:42:add:op-a");
    // Two deliberate extra plays never collapse into one either.
    const again = buildAddEpisodePlayOp({
      opId: "op-b",
      ids: { trakt: 42 },
      watchedAt: WATCHED_AT,
    });
    expect(again.itemKey).not.toBe(add.itemKey);
  });

  it("unmarking an episode inverts the request/inverse (remove-by-item, all plays)", () => {
    const op = buildUnmarkEpisodeOp({ opId: "op-2", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(op.request.path).toBe("/sync/history/remove");
    expect(op.request.body).toEqual({ episodes: [{ ids: { trakt: 42 } }] });
    expect(op.inverse.path).toBe("/sync/history");
    expect(op.toState).toBe("absent");
    expect(op.fromState).toBe("present");
  });

  it("unmark's restore-inverse re-adds the play with the *frozen* watched_at (Undo keeps the original date)", () => {
    // The caller feeds the episode's original progress date here (not `now`), so an
    // Undo of an unwatch restores the exact play instead of corrupting its date.
    const op = buildUnmarkEpisodeOp({ opId: "op-2b", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(op.inverse.body).toEqual({
      episodes: [{ ids: { trakt: 42 }, watched_at: WATCHED_AT }],
    });
    expect(op.watchedAt).toBe(WATCHED_AT);
  });

  it("marks a movie with the movies[] shape and a movie item key", () => {
    const op = buildMarkMovieOp({ opId: "op-3", ids: { trakt: 7 }, watchedAt: WATCHED_AT });
    expect(op.request.body).toEqual({ movies: [{ ids: { trakt: 7 }, watched_at: WATCHED_AT }] });
    expect(op.itemKey).toBe("movie:7");
  });

  it("unmarks a movie with a movies[] remove body", () => {
    const op = buildUnmarkMovieOp({ opId: "op-4", ids: { trakt: 7 }, watchedAt: WATCHED_AT });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { movies: [{ ids: { trakt: 7 } }] },
    });
  });

  it("hides a show: add to the hidden set, un-hide inverse, no watched_at", () => {
    const op = buildStopShowOp("hidden", { opId: "op-h1", ids: { trakt: 5 } });
    expect(op.request).toEqual({
      method: "POST",
      path: "/users/hidden/progress_watched",
      body: { shows: [{ ids: { trakt: 5 } }] },
    });
    expect(op.inverse).toEqual({
      method: "POST",
      path: "/users/hidden/progress_watched/remove",
      body: { shows: [{ ids: { trakt: 5 } }] },
    });
    expect(op).toMatchObject({
      itemKey: "show:5:hidden",
      watchedAt: null,
      fromState: "absent",
      toState: "present",
    });
  });

  it("resumes a show by taking it off both the hidden and the dropped list", () => {
    const ids = ["op-h2", "op-h3"];
    const ops = buildResumeShowOps({
      newId: () => ids.shift() ?? "",
      ids: { trakt: 5 },
    });
    expect(
      ops.map(({ id, request, inverse, itemKey, fromState, toState }) => ({
        id,
        request: request.path,
        inverse: inverse.path,
        itemKey,
        fromState,
        toState,
      })),
    ).toEqual([
      {
        id: "op-h2",
        request: "/users/hidden/progress_watched/remove",
        inverse: "/users/hidden/progress_watched",
        itemKey: "show:5:hidden",
        fromState: "present",
        toState: "absent",
      },
      {
        id: "op-h3",
        request: "/users/hidden/dropped/remove",
        inverse: "/users/hidden/dropped",
        itemKey: "show:5:dropped",
        fromState: "present",
        toState: "absent",
      },
    ]);
  });

  it("removes ONE play by its history event id: the Diary's exact per-play removal", () => {
    // The whole point: `{ ids: [historyId] }` deletes exactly this play, so a
    // rewatched item's OTHER plays survive: unlike the remove-by-item builders.
    const op = buildRemoveHistoryPlayOp({
      opId: "rm-1",
      ids: [1982],
      restore: { section: "episodes", ids: { trakt: 55 }, watchedAt: WATCHED_AT },
    });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { ids: [1982] },
    });
    // The body is history-ids only: no `episodes`/`movies` item section (which would
    // wipe every play of the item).
    expect(Object.keys(op.request.body as object)).toEqual(["ids"]);
    expect(op).toMatchObject({
      itemKey: "history-play:1982",
      fromState: "present",
      toState: "absent",
      watchedAt: WATCHED_AT,
    });
  });

  it("its inverse re-adds the play best-effort (by item + frozen watched_at)", () => {
    const op = buildRemoveHistoryPlayOp({
      opId: "rm-2",
      ids: [777],
      restore: { section: "movies", ids: { trakt: 7 }, watchedAt: WATCHED_AT },
    });
    expect(op.inverse).toEqual({
      method: "POST",
      path: "/sync/history",
      body: { movies: [{ ids: { trakt: 7 }, watched_at: WATCHED_AT }] },
    });
  });
});

describe("buildRemovePlaysOp (durable per-play-safe unmark)", () => {
  it("removes a SET of plays by exact history ids: never an item/season token", () => {
    const op = buildRemovePlaysOp({
      opId: "rp-1",
      ids: [131, 121],
      restore: [
        { trakt: 13, watchedAt: WATCHED_AT },
        { trakt: 12, watchedAt: WATCHED_AT },
      ],
    });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { ids: [131, 121] },
    });
    // ids-only body: no `episodes`/`shows` section that would wipe every play.
    expect(Object.keys(op.request.body as object)).toEqual(["ids"]);
    // The itemKey sorts the ids so a repeat remove of the same set stays idempotent.
    expect(op.itemKey).toBe("history-plays:121,131");
    expect(op).toMatchObject({
      fromState: "present",
      toState: "absent",
    });
  });

  it("its inverse re-adds exactly the removed episodes best-effort (by trakt + frozen watched_at)", () => {
    const op = buildRemovePlaysOp({
      opId: "rp-2",
      ids: [131, 121],
      restore: [
        { trakt: 13, watchedAt: "2026-01-02T00:00:00.000Z" },
        { trakt: 12, watchedAt: WATCHED_AT },
      ],
    });
    expect(op.inverse).toEqual({
      method: "POST",
      path: "/sync/history",
      body: {
        episodes: [
          { ids: { trakt: 13 }, watched_at: "2026-01-02T00:00:00.000Z" },
          { ids: { trakt: 12 }, watched_at: WATCHED_AT },
        ],
      },
    });
  });
});

describe("watchlist op builders", () => {
  it("adds a show: add request, remove inverse", () => {
    const op = buildAddWatchlistOp({ opId: "w-1", section: "shows", ids: { trakt: 3 } });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/watchlist",
      body: { shows: [{ ids: { trakt: 3 } }] },
    });
    expect(op.inverse.path).toBe("/sync/watchlist/remove");
    expect(op).toMatchObject({
      itemKey: "watchlist:shows:3",
      watchedAt: null,
      fromState: "absent",
      toState: "present",
    });
  });

  it("removes a show by inverting the request/inverse", () => {
    const op = buildRemoveWatchlistOp({ opId: "w-2", section: "movies", ids: { trakt: 5 } });
    expect(op.request.path).toBe("/sync/watchlist/remove");
    expect(op.request.body).toEqual({ movies: [{ ids: { trakt: 5 } }] });
    expect(op.inverse.path).toBe("/sync/watchlist");
    expect(op).toMatchObject({ itemKey: "watchlist:movies:5", toState: "absent" });
  });
});

describe("targetOf", () => {
  it("names the show or movie of a write saved before writes carried one, and none for a lone episode", () => {
    const watchedAt = "2026-07-05T12:00:00.000Z";
    expect(targetOf(buildStopShowOp("hidden", { opId: "a", ids: { trakt: 7 } }))).toEqual({
      kind: "show",
      id: 7,
    });
    expect(targetOf(buildMarkMovieOp({ opId: "b", ids: { trakt: 9 }, watchedAt }))).toEqual({
      kind: "movie",
      id: 9,
    });
    expect(targetOf(buildMarkEpisodeOp({ opId: "c", ids: { trakt: 11 }, watchedAt }))).toBeNull();
  });
});
