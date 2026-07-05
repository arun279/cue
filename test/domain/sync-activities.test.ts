import {
  diffActivities,
  type InvalidationTarget,
  type LastActivities,
} from "@domain/sync-activities";
import { describe, expect, it } from "vitest";

const T0 = "2026-07-01T00:00:00.000Z";
const T1 = "2026-07-05T00:00:00.000Z";

function section(field: string, value: string): LastActivities["episodes"] {
  return { [field]: value };
}

describe("diffActivities", () => {
  it("returns nothing when timestamps are identical", () => {
    const same: LastActivities = { episodes: { watched_at: T1 }, shows: { hidden_at: T1 } };
    expect(diffActivities(same, same)).toEqual([]);
  });

  it("treats a first-ever activity (no stored value) as advanced", () => {
    const fresh: LastActivities = { episodes: { watched_at: T1 } };
    expect(diffActivities(undefined, fresh)).toEqual(["watched/shows", "progress/watched"]);
  });

  it("ignores a timestamp that moved backwards", () => {
    const stored: LastActivities = { episodes: { watched_at: T1 } };
    const fresh: LastActivities = { episodes: { watched_at: T0 } };
    expect(diffActivities(stored, fresh)).toEqual([]);
  });

  it("ignores unmapped sections (collected/commented/seasons/lists/account)", () => {
    const stored: LastActivities = {
      episodes: { collected_at: T0, commented_at: T0 },
      seasons: { rated_at: T0 },
      lists: { updated_at: T0 },
      account: { settings_at: T0 },
    };
    const fresh: LastActivities = {
      episodes: { collected_at: T1, commented_at: T1 },
      seasons: { rated_at: T1 },
      lists: { updated_at: T1 },
      account: { settings_at: T1 },
    };
    expect(diffActivities(stored, fresh)).toEqual([]);
  });

  const rows: Array<{
    before: LastActivities;
    after: LastActivities;
    targets: InvalidationTarget[];
  }> = [
    {
      before: { episodes: section("watched_at", T0) },
      after: { episodes: section("watched_at", T1) },
      targets: ["watched/shows", "progress/watched"],
    },
    {
      before: { episodes: section("rated_at", T0) },
      after: { episodes: section("rated_at", T1) },
      targets: ["ratings/episodes"],
    },
    {
      before: { episodes: section("watchlisted_at", T0) },
      after: { episodes: section("watchlisted_at", T1) },
      targets: ["watchlist/episodes"],
    },
    {
      before: { shows: { rated_at: T0 } },
      after: { shows: { rated_at: T1 } },
      targets: ["ratings/shows"],
    },
    {
      before: { shows: { hidden_at: T0 } },
      after: { shows: { hidden_at: T1 } },
      targets: ["hidden/progress_watched", "recompute:buckets"],
    },
    {
      before: { shows: { watchlisted_at: T0 } },
      after: { shows: { watchlisted_at: T1 } },
      targets: ["watchlist/shows", "recompute:following", "recompute:to-watch"],
    },
    {
      before: { shows: { favorited_at: T0 } },
      after: { shows: { favorited_at: T1 } },
      targets: ["favorites/shows"],
    },
    {
      before: { movies: { watched_at: T0 } },
      after: { movies: { watched_at: T1 } },
      targets: ["watched/movies", "movie-progress"],
    },
    {
      before: { movies: { rated_at: T0 } },
      after: { movies: { rated_at: T1 } },
      targets: ["ratings/movies"],
    },
    {
      before: { movies: { watchlisted_at: T0 } },
      after: { movies: { watchlisted_at: T1 } },
      targets: ["watchlist/movies", "recompute:following"],
    },
    {
      before: { movies: { hidden_at: T0 } },
      after: { movies: { hidden_at: T1 } },
      targets: ["hidden/movies", "recompute:buckets"],
    },
    {
      before: { movies: { favorited_at: T0 } },
      after: { movies: { favorited_at: T1 } },
      targets: ["favorites/movies"],
    },
    {
      before: { watchlist: { updated_at: T0 } },
      after: { watchlist: { updated_at: T1 } },
      targets: ["watchlist/shows", "watchlist/movies"],
    },
  ];

  for (const row of rows) {
    const label = Object.entries(row.after)[0];
    it(`maps ${label?.[0]}.${Object.keys(label?.[1] ?? {})[0]} to its exact keys`, () => {
      expect(diffActivities(row.before, row.after)).toEqual(row.targets);
    });
  }

  it("deduplicates overlapping targets across several advanced sections", () => {
    const stored: LastActivities = { shows: { hidden_at: T0 }, movies: { hidden_at: T0 } };
    const fresh: LastActivities = { shows: { hidden_at: T1 }, movies: { hidden_at: T1 } };
    const result = diffActivities(stored, fresh);
    expect(result).toContain("recompute:buckets");
    expect(result.filter((t) => t === "recompute:buckets")).toHaveLength(1);
  });
});
