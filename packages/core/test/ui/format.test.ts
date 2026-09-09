import { epCode } from "@cue/core/domain/model/library";
import { episodesLeft, lastWatchedPhrase, middleTruncate } from "@cue/core/format";
import { describe, expect, it } from "vitest";

describe("epCode", () => {
  it("renders the quiet space-separated code with no zero padding", () => {
    expect(epCode(1, 5)).toBe("S1 E5");
    expect(epCode(10, 12)).toBe("S10 E12");
  });
});

describe("episodesLeft", () => {
  it("is the aired-but-unwatched count", () => {
    expect(episodesLeft(10, 7)).toBe(3);
  });

  it("never goes negative when completed overshoots aired", () => {
    expect(episodesLeft(5, 6)).toBe(0);
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
