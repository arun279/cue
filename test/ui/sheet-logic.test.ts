import { formatWatchedDate } from "@ui/format";
import {
  removeAllBody,
  sheetMetaLine,
  watchedStatusLine,
} from "@ui/screens/episode-detail/sheet-logic";
import { describe, expect, it } from "vitest";

describe("sheetMetaLine", () => {
  it("reads code · aired date · runtime", () => {
    expect(
      sheetMetaLine({
        season: 1,
        number: 5,
        firstAired: "2002-07-01T00:00:00.000Z",
        runtime: 60,
        aired: true,
      }),
    ).toBe("S1 E5 · Aired Jul 1, 2002 · 60 min");
  });
  it("drops the parts it doesn't know", () => {
    expect(
      sheetMetaLine({ season: 1, number: 5, firstAired: null, runtime: null, aired: false }),
    ).toBe("S1 E5");
  });
  it("never claims an unaired episode aired: the countdown above it says when", () => {
    expect(
      sheetMetaLine({
        season: 3,
        number: 6,
        firstAired: "2099-08-27T01:00:00.000Z",
        runtime: 58,
        aired: false,
      }),
    ).toBe("S3 E6 · 58 min");
  });
});

describe("watchedStatusLine", () => {
  const iso = "2026-07-09T20:00:00.000Z";
  it("reads the watched date for a single play", () => {
    expect(watchedStatusLine(iso, 1)).toBe(`Watched ${formatWatchedDate(iso)}`);
    expect(watchedStatusLine(null, 1)).toBe("Watched");
  });
  it("treats an unresolved count as a single play", () => {
    expect(watchedStatusLine(iso, null)).toBe(`Watched ${formatWatchedDate(iso)}`);
  });
  it("reads rewatches as counts", () => {
    expect(watchedStatusLine(iso, 2)).toBe("Watched twice");
    expect(watchedStatusLine(iso, 3)).toBe("Watched 3 times");
  });
});

describe("removeAllBody", () => {
  it("uses the spec copy for two plays", () => {
    expect(removeAllBody("S1 E5", 2)).toBe(
      "S1 E5 has 2 plays. This removes both from your history.",
    );
  });
  it("spells out larger counts", () => {
    expect(removeAllBody("S1 E5", 3)).toBe(
      "S1 E5 has 3 plays. This removes all 3 from your history.",
    );
  });
});
