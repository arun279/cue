import type { MoviePlay } from "@domain/reversal";
import { resolveMovieUnmark, routeMovieUnmark } from "@ui/hooks/resolveUnmark";
import type { CueRuntime } from "@ui/runtime/runtime";
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

describe("routeMovieUnmark: the fast mark→unmark race guard", () => {
  it("a pending session mark for THIS movie reverses the exact op (no live-plays read)", () => {
    // The mark op may still be queued; reading live plays would return 0 and silently
    // retain the play once the queued mark lands. Reverse the exact op instead.
    expect(routeMovieUnmark(7, 7)).toBe("reverse-session-mark");
  });

  it("a pending mark for a DIFFERENT movie is not touched: this movie resolves live", () => {
    expect(routeMovieUnmark(9, 7)).toBe("resolve-live-plays");
  });

  it("no pending mark resolves live plays (also the cross-unmount case)", () => {
    // TODO(cross-unmount-deferred-mark): after a deferred mark + unmount, the per-mount
    // ref is lost, so the unmark arrives here (null) and resolves live plays → 0 →
    // "none" → un-tick, then the durable queue flushes the mark and flips the movie
    // back to watched. Documented non-destructive behavior: asserted, not a bug fix.
    expect(routeMovieUnmark(null, 7)).toBe("resolve-live-plays");
  });
});
