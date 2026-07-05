import {
  buildMarkEpisodeOp,
  buildMarkMovieOp,
  buildUnmarkEpisodeOp,
  buildUnmarkMovieOp,
} from "@domain/write-queue/ops";
import { describe, expect, it } from "vitest";

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
      reconcileKeys: ["progress/watched", "watched/shows"],
    });
  });

  it("unmarking an episode inverts the request/inverse (remove-by-item, all plays)", () => {
    const op = buildUnmarkEpisodeOp({ opId: "op-2", ids: { trakt: 42 }, watchedAt: WATCHED_AT });
    expect(op.request.path).toBe("/sync/history/remove");
    expect(op.request.body).toEqual({ episodes: [{ ids: { trakt: 42 } }] });
    expect(op.inverse.path).toBe("/sync/history");
    expect(op.toState).toBe("absent");
    expect(op.fromState).toBe("present");
  });

  it("marks a movie with the movies[] shape and a movie item key", () => {
    const op = buildMarkMovieOp({ opId: "op-3", ids: { trakt: 7 }, watchedAt: WATCHED_AT });
    expect(op.request.body).toEqual({ movies: [{ ids: { trakt: 7 }, watched_at: WATCHED_AT }] });
    expect(op.itemKey).toBe("movie:7");
    expect(op.reconcileKeys).toEqual(["watched/movies", "movie-progress"]);
  });

  it("unmarks a movie with a movies[] remove body", () => {
    const op = buildUnmarkMovieOp({ opId: "op-4", ids: { trakt: 7 }, watchedAt: WATCHED_AT });
    expect(op.request).toEqual({
      method: "POST",
      path: "/sync/history/remove",
      body: { movies: [{ ids: { trakt: 7 } }] },
    });
  });

  it("carries the caller's inverse cache patch", () => {
    const patch = { queryKey: ["progress", 42], prev: { completed: 3 } };
    const op = buildMarkEpisodeOp({
      opId: "op-5",
      ids: { trakt: 42 },
      watchedAt: WATCHED_AT,
      inversePatch: patch,
    });
    expect(op.inversePatch).toBe(patch);
  });
});
