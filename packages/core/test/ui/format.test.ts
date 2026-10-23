import { epCode } from "@cue/core/domain/model/library";
import {
  lastWatchedPhrase,
  leftNote,
  middleTruncate,
  watchedPercent,
  withEpisodeTitle,
} from "@cue/core/format";
import { describe, expect, it } from "vitest";

describe("epCode", () => {
  it("renders the quiet space-separated code with no zero padding", () => {
    expect(epCode(1, 5)).toBe("S1 E5");
    expect(epCode(10, 12)).toBe("S10 E12");
  });
});

describe("leftNote", () => {
  it("counts the episodes left, and says nothing once caught up", () => {
    expect(leftNote(3)).toBe("3 left");
    expect(leftNote(0)).toBeNull();
  });
});

describe("withEpisodeTitle", () => {
  it("joins the episode title to its code when there is one", () => {
    expect(withEpisodeTitle("S2 E10", "Salt Air")).toBe("S2 E10 · Salt Air");
    expect(withEpisodeTitle("S2 E10", null)).toBe("S2 E10");
  });
});

describe("watchedPercent", () => {
  it("rounds to a whole percent, clamped to the bar", () => {
    expect(watchedPercent(1, 3)).toBe(33);
    expect(watchedPercent(6, 5)).toBe(100);
  });

  it("is empty for a show with nothing aired yet", () => {
    expect(watchedPercent(0, 0)).toBe(0);
  });
});

describe("lastWatchedPhrase", () => {
  const now = Date.parse("2026-07-12T12:00:00Z");
  const daysAgo = (n: number): string => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

  it("uses day words inside the first two weeks", () => {
    expect(lastWatchedPhrase(daysAgo(0), now)).toBe("today");
    expect(lastWatchedPhrase(daysAgo(1), now)).toBe("yesterday");
    expect(lastWatchedPhrase(daysAgo(5), now)).toBe("5 days ago");
    expect(lastWatchedPhrase(daysAgo(13), now)).toBe("13 days ago");
  });

  it("switches to whole weeks from 14 days", () => {
    expect(lastWatchedPhrase(daysAgo(14), now)).toBe("2 weeks ago");
    expect(lastWatchedPhrase(daysAgo(20), now)).toBe("2 weeks ago");
    expect(lastWatchedPhrase(daysAgo(35), now)).toBe("5 weeks ago");
  });

  it("returns null for absent, unparseable, or future dates", () => {
    expect(lastWatchedPhrase(null, now)).toBeNull();
    expect(lastWatchedPhrase("not-a-date", now)).toBeNull();
    expect(lastWatchedPhrase(daysAgo(-1), now)).toBeNull();
  });
});

describe("middleTruncate", () => {
  it("leaves short titles alone", () => {
    expect(middleTruncate("The Wire")).toBe("The Wire");
  });

  it("keeps the head and tail around one ellipsis, within the budget", () => {
    const long = "The Lord of the Rings: The Rings of Power";
    const out = middleTruncate(long, 28);
    expect(out.length).toBeLessThanOrEqual(28);
    expect(out).toContain("…");
    expect(out.startsWith("The Lord of the R")).toBe(true);
    expect(out.endsWith("Power")).toBe(true);
  });
});
