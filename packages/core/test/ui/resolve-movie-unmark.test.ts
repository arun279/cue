import type { MoviePlay } from "@cue/core/domain/reversal";
import { resolveMovieUnmark } from "@cue/core/hooks/resolve-unmark";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { describe, expect, it } from "vitest";

/** A runtime that answers only `loadMoviePlays`: the sole read the resolver makes. */
function runtimeWithPlays(load: () => Promise<readonly MoviePlay[]>): CueRuntime {
  return { loadMoviePlays: (_movieId: number) => load() } as unknown as CueRuntime;
}

const settled = (id: number, at = "2026-07-05T21:24:00.000Z"): MoviePlay => ({
  historyId: id,
  watchedAt: at,
});

describe("resolveMovieUnmark: the movie reversal safety decision", () => {
  it("one settled play removes by that play's EXACT history id (never an item wipe)", async () => {
    const resolution = await resolveMovieUnmark(
      runtimeWithPlays(async () => [settled(101)]),
      7,
    );
    expect(resolution).toEqual({
      kind: "remove",
      historyId: 101,
      watchedAt: "2026-07-05T21:24:00.000Z",
    });
  });

  it("a rewatch (two+ plays) is REFUSED and routed to history: never wiped", async () => {
    const resolution = await resolveMovieUnmark(
      runtimeWithPlays(async () => [settled(101), settled(202, "2026-01-01T00:00:00.000Z")]),
      7,
    );
    // Crucially NOT `remove`: a blunt unmark must never destroy the extra play.
    expect(resolution).toEqual({ kind: "rewatch", count: 2 });
  });

  it("no play on the server resolves to `none` (the optimistic un-tick is already correct)", async () => {
    const resolution = await resolveMovieUnmark(
      runtimeWithPlays(async () => []),
      7,
    );
    expect(resolution).toEqual({ kind: "none" });
  });

  it("a failed read fails SAFE: `error`, never a fallback to destructive removal", async () => {
    const resolution = await resolveMovieUnmark(
      runtimeWithPlays(() => Promise.reject(new Error("offline"))),
      7,
    );
    expect(resolution).toEqual({ kind: "error" });
  });
});
