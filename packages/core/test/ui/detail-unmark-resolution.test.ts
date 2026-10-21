import { type EpisodePlay, ownPlays } from "@cue/core/domain/reversal";
import { resolveEpisodeUnmark } from "@cue/core/hooks/resolve-unmark";
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

describe("ownPlays for one landed mark", () => {
  const MARKED_AT = "2026-07-09T12:00:00.123Z";
  const removes = (plays: readonly EpisodePlay[], watchedAt = MARKED_AT) =>
    ownPlays(
      plays,
      (play) => (play.episodeTrakt === EP ? watchedAt : null),
      (play) => play.episodeTrakt,
    ).map((play) => play.historyId);

  it("finds the play matching the mark's frozen watched_at exactly", () => {
    expect(removes([play(11, "2026-07-01T00:00:00.000Z"), play(21, MARKED_AT)])).toEqual([21]);
  });

  it("tolerates Trakt truncating the echoed timestamp to the minute", () => {
    expect(removes([play(21, "2026-07-09T12:00:00.000Z")], "2026-07-09T12:00:42.123Z")).toEqual([
      21,
    ]);
  });

  it("rejects a play beyond the truncation window", () => {
    expect(removes([play(21, "2026-07-09T11:58:59.000Z")])).toEqual([]);
  });

  it("never selects a historical play: restart-show rewatch history is untouchable", () => {
    const plays = [play(11, "2024-03-01T00:00:00.000Z"), play(12, "2025-01-01T00:00:00.000Z")];
    expect(removes(plays)).toEqual([]);
  });

  it("removes only the newest of two plays inside the echo tolerance", () => {
    const older = play(21, "2026-07-09T11:59:58.000Z");
    const newer = play(22, "2026-07-09T12:00:00.000Z");
    expect(removes([older, newer])).toEqual([22]);
    expect(removes([newer, older])).toEqual([22]);
  });

  it("ignores other episodes' plays and resolves nothing from an empty history", () => {
    expect(removes([play(99, MARKED_AT, 999)])).toEqual([]);
    expect(removes([])).toEqual([]);
  });
});
