import { resolvePoster, type TmdbImageConfig } from "@data/image-source";
import { describe, expect, it } from "vitest";

const tmdbConfig: TmdbImageConfig = {
  secureBaseUrl: "https://image.tmdb.org/t/p/",
  posterSize: "w342",
};

describe("resolvePoster (Trakt inline → TMDB → placeholder)", () => {
  it("prefers the Trakt inline poster and forces https on the host-relative url", () => {
    expect(
      resolvePoster({
        title: "Severance",
        traktPosters: ["media.trakt.tv/p.webp"],
        tmdbPath: "/x.jpg",
        tmdbConfig,
      }),
    ).toEqual({ source: "trakt", url: "https://media.trakt.tv/p.webp" });
  });

  it("keeps an already-absolute Trakt url unchanged", () => {
    expect(
      resolvePoster({ title: "Severance", traktPosters: ["https://media.trakt.tv/p.webp"] }),
    ).toEqual({
      source: "trakt",
      url: "https://media.trakt.tv/p.webp",
    });
  });

  it("falls back to a built TMDB url when Trakt has no poster but TMDB is configured", () => {
    expect(
      resolvePoster({ title: "Dune", traktPosters: [], tmdbPath: "/abc.jpg", tmdbConfig }),
    ).toEqual({
      source: "tmdb",
      url: "https://image.tmdb.org/t/p/w342/abc.jpg",
    });
  });

  it("skips TMDB when configured but the path is missing", () => {
    expect(resolvePoster({ title: "Dune", tmdbConfig }).source).toBe("placeholder");
  });

  it("skips TMDB when a path exists but no config is cached yet", () => {
    expect(resolvePoster({ title: "Dune", tmdbPath: "/abc.jpg" }).source).toBe("placeholder");
  });

  it("falls back to initials when both art planes are absent", () => {
    expect(resolvePoster({ title: "Breaking Bad", traktPosters: null })).toEqual({
      source: "placeholder",
      initials: "BB",
    });
  });

  it("produces a single initial for one-word titles and ? for blank", () => {
    expect(resolvePoster({ title: "Severance" })).toEqual({ source: "placeholder", initials: "S" });
    expect(resolvePoster({ title: "   " })).toEqual({ source: "placeholder", initials: "?" });
  });
});
