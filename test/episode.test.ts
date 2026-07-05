import { formatEpisodeCode } from "@domain/episode";
import { describe, expect, it } from "vitest";

describe("formatEpisodeCode", () => {
  it("zero-pads single-digit season and episode", () => {
    expect(formatEpisodeCode(1, 2)).toBe("S01E02");
  });

  it("keeps multi-digit numbers intact", () => {
    expect(formatEpisodeCode(12, 134)).toBe("S12E134");
  });

  it("truncates fractional inputs", () => {
    expect(formatEpisodeCode(3.9, 4.2)).toBe("S03E04");
  });
});
