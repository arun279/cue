import { describe, expect, it } from "vitest";
import { advancePastNext, type LibraryEntry, quickMarkable } from "@/core/domain/model/library";
import { baseEntry } from "./_helpers";

describe("advancePastNext", () => {
  it("projects the following episode with an unknown air date, bumps completed, flags pendingAdvance", () => {
    const advanced = advancePastNext(baseEntry, "2026-07-05T12:00:00.000Z");
    expect(advanced.completed).toBe(4);
    expect(advanced.left).toBe(6);
    expect(advanced.lastWatchedAt).toBe("2026-07-05T12:00:00.000Z");
    expect(advanced.pendingAdvance).toBe(true);
    expect(advanced.nextEpisode).toEqual({
      season: 1,
      number: 5,
      title: null,
      firstAired: null,
      still: null,
      ids: { trakt: 0 },
    });
  });

  it("never inherits the watched episode's air date (no season-finale phantom in the lead slot)", () => {
    // A recent air date on the source episode must NOT flow onto the projection:
    // that is exactly what made a marked finale cling to the lead slot.
    const entry: LibraryEntry = {
      ...baseEntry,
      nextEpisode: {
        season: 1,
        number: 4,
        title: "Finale",
        firstAired: "2026-07-04T00:00:00.000Z",
        still: null,
        ids: { trakt: 4004 },
      },
    };
    expect(advancePastNext(entry, "2026-07-05T12:00:00.000Z").nextEpisode?.firstAired).toBeNull();
  });

  it("adds the mark's play to a known count of plays, and leaves an unknown one unknown", () => {
    const at = "2026-07-05T12:00:00.000Z";
    expect(advancePastNext({ ...baseEntry, plays: 7 }, at).plays).toBe(8);
    expect(advancePastNext({ ...baseEntry, plays: null }, at).plays).toBeNull();
  });

  it("leaves a caught-up entry (null next) with no projected episode", () => {
    const entry = { ...baseEntry, nextEpisode: null };
    const advanced = advancePastNext(entry, "2026-07-05T12:00:00.000Z");
    expect(advanced.nextEpisode).toBeNull();
    expect(advanced.completed).toBe(4);
  });

  it("carries no coordinate after the last aired episode", () => {
    const entry: LibraryEntry = {
      ...baseEntry,
      aired: 20,
      completed: 19,
      nextEpisode: {
        season: 2,
        number: 10,
        title: "Finale",
        firstAired: "2026-07-04T00:00:00.000Z",
        still: null,
        ids: { trakt: 2010 },
      },
      lastAired: { season: 2, number: 10 },
    };
    expect(advancePastNext(entry, "2026-07-05T12:00:00.000Z").nextEpisode).toBeNull();
  });
});

describe("quickMarkable", () => {
  const aired = Date.parse("2026-06-02T00:00:00.000Z");

  it("offers the accelerator only for a known next episode that has aired", () => {
    expect(quickMarkable(baseEntry, aired)).toBe(true);
    expect(quickMarkable(baseEntry, Date.parse("2026-05-31T00:00:00.000Z"))).toBe(false);
    expect(quickMarkable({ ...baseEntry, nextEpisode: null }, aired)).toBe(false);
  });

  it("holds it back while a mark's projected episode is still pending", () => {
    expect(quickMarkable({ ...baseEntry, pendingAdvance: true }, aired)).toBe(false);
  });
});
