import type { EpisodePlay } from "@cue/core/domain/reversal";
import { findMarkPlay, resolveEpisodeUnmark } from "@cue/core/hooks/resolveUnmark";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import { describe, expect, it } from "vitest";

const EP = 501;

function play(historyId: number, watchedAt: string, episodeTrakt = EP): EpisodePlay {
  return { historyId, episodeTrakt, season: 1, number: 5, watchedAt };
}

function runtimeWith(plays: readonly EpisodePlay[] | Error): CueRuntime {
  return {
    loadEpisodePlays: () =>
      plays instanceof Error ? Promise.reject(plays) : Promise.resolve(plays),
  } as unknown as CueRuntime;
}

describe("resolveEpisodeUnmark", () => {
  it("removes a single play by its exact history id", async () => {
    const resolution = await resolveEpisodeUnmark(
      runtimeWith([play(11, "2026-07-01T00:00:00.000Z")]),
      EP,
    );
    expect(resolution.kind).toBe("remove");
    if (resolution.kind === "remove") {
      expect(resolution.plan.removeIds).toEqual([11]);
      expect(resolution.plan.keptRewatch).toEqual([]);
    }
  });

  it("resolves a rewatch to its newest play, keeping the earlier one", async () => {
    const resolution = await resolveEpisodeUnmark(
      runtimeWith([play(11, "2026-07-01T00:00:00.000Z"), play(12, "2026-07-09T00:00:00.000Z")]),
      EP,
    );
    expect(resolution.kind).toBe("rewatch");
    if (resolution.kind === "rewatch") {
      expect(resolution.count).toBe(2);
      expect(resolution.latest.historyId).toBe(12);
      expect(resolution.previous.historyId).toBe(11);
    }
  });

  it("breaks a watched-at tie on the higher (later) history id", async () => {
    const at = "2026-07-09T00:00:00.000Z";
    const resolution = await resolveEpisodeUnmark(runtimeWith([play(31, at), play(30, at)]), EP);
    expect(resolution.kind).toBe("rewatch");
    if (resolution.kind === "rewatch") {
      expect(resolution.latest.historyId).toBe(31);
      expect(resolution.previous.historyId).toBe(30);
    }
  });

  it("ignores plays that belong to other episodes", async () => {
    const resolution = await resolveEpisodeUnmark(
      runtimeWith([
        play(11, "2026-07-01T00:00:00.000Z"),
        play(99, "2026-07-02T00:00:00.000Z", 999),
      ]),
      EP,
    );
    expect(resolution.kind).toBe("remove");
    if (resolution.kind === "remove") expect(resolution.plan.removeIds).toEqual([11]);
  });

  it("reads no plays as none, and a failed read as error", async () => {
    expect((await resolveEpisodeUnmark(runtimeWith([]), EP)).kind).toBe("none");
    expect((await resolveEpisodeUnmark(runtimeWith(new Error("net")), EP)).kind).toBe("error");
  });
});

describe("findMarkPlay (landed-mark undo resolution)", () => {
  const MARKED_AT = "2026-07-09T12:00:00.123Z";

  it("finds the play matching the mark's frozen watched_at exactly", () => {
    const own = play(21, MARKED_AT);
    expect(findMarkPlay([play(11, "2026-07-01T00:00:00.000Z"), own], EP, MARKED_AT)).toBe(own);
  });

  it("tolerates Trakt truncating the echoed timestamp to the minute", () => {
    // Marked at 12:00:42.123, echoed back floored to 12:00:00.
    const echoed = play(21, "2026-07-09T12:00:00.000Z");
    expect(findMarkPlay([echoed], EP, "2026-07-09T12:00:42.123Z")).toBe(echoed);
  });

  it("rejects a play beyond the truncation window", () => {
    expect(findMarkPlay([play(21, "2026-07-09T11:58:59.000Z")], EP, MARKED_AT)).toBeUndefined();
  });

  it("never selects a historical play: restart-show rewatch history is untouchable", () => {
    // The mark hard-failed (or was removed elsewhere): only old plays remain.
    const plays = [play(11, "2024-03-01T00:00:00.000Z"), play(12, "2025-01-01T00:00:00.000Z")];
    expect(findMarkPlay(plays, EP, MARKED_AT)).toBeUndefined();
  });

  it("prefers the newest of two plays inside the echo tolerance", () => {
    const older = play(21, "2026-07-09T11:59:58.000Z");
    const newer = play(22, "2026-07-09T12:00:00.000Z");
    expect(findMarkPlay([older, newer], EP, MARKED_AT)).toBe(newer);
  });

  it("ignores other episodes' plays and resolves nothing from an empty history", () => {
    expect(findMarkPlay([play(99, MARKED_AT, 999)], EP, MARKED_AT)).toBeUndefined();
    expect(findMarkPlay([], EP, MARKED_AT)).toBeUndefined();
  });
});
