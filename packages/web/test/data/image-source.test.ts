import { resolvePoster } from "@cue/core/data/image-source";
import { describe, expect, it } from "vitest";

describe("resolvePoster (Trakt inline → placeholder)", () => {
  it("prefers the Trakt inline poster and forces https on the host-relative url", () => {
    expect(resolvePoster({ title: "Severance", traktPosters: ["media.trakt.tv/p.webp"] })).toEqual({
      source: "trakt",
      url: "https://media.trakt.tv/p.webp",
    });
  });

  it("keeps an already-absolute Trakt url unchanged", () => {
    expect(
      resolvePoster({ title: "Severance", traktPosters: ["https://media.trakt.tv/p.webp"] }),
    ).toEqual({
      source: "trakt",
      url: "https://media.trakt.tv/p.webp",
    });
  });

  it("falls back to initials when no poster is present", () => {
    expect(resolvePoster({ title: "Breaking Bad", traktPosters: null })).toEqual({
      source: "placeholder",
      initials: "BB",
    });
    expect(resolvePoster({ title: "Dune", traktPosters: [] }).source).toBe("placeholder");
  });

  it("produces a single initial for one-word titles and ? for blank", () => {
    expect(resolvePoster({ title: "Severance" })).toEqual({ source: "placeholder", initials: "S" });
    expect(resolvePoster({ title: "   " })).toEqual({ source: "placeholder", initials: "?" });
  });
});
