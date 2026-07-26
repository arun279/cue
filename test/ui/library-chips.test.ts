import type { LibraryEntry } from "@data/trakt/library";
import { chipBuckets } from "@ui/hooks/useLibraryBuckets";
import { describe, expect, it } from "vitest";
import { DAY, iso, makeShow, NOW, THRESHOLD } from "../domain/_helpers";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    ...makeShow(),
    posters: [],
    backdrops: [],
    network: null,
    genres: [],
    runtime: null,
    tmdbId: null,
    pendingAdvance: false,
    ...overrides,
  };
}

const watching = entry({ showId: 1, title: "Alpha", lastWatchedAt: iso(NOW - DAY) });
const caughtUp = entry({
  showId: 2,
  title: "Bravo",
  nextEpisode: null,
  lastWatchedAt: iso(NOW - 2 * DAY),
});
const lapsed = entry({ showId: 3, title: "Charlie", lastWatchedAt: iso(NOW - 30 * DAY) });
const watchlisted = entry({
  showId: 4,
  title: "Delta",
  completed: 0,
  lastWatchedAt: null,
  inWatchlist: true,
});
const stopped = entry({ showId: 5, title: "Echo", hidden: true });
const finished = entry({ showId: 6, title: "Foxtrot", status: "ended", aired: 8, completed: 8 });
const tailBacklog = entry({ showId: 7, title: "Golf", aired: 10, completed: 3, nextEpisode: null });

describe("chipBuckets", () => {
  it("routes every status to exactly one chip", () => {
    const chips = chipBuckets(
      [watching, caughtUp, lapsed, watchlisted, stopped, finished, tailBacklog],
      NOW,
      THRESHOLD,
      "recently-watched",
    );
    // Golf is past the progress budget: real counts, no next episode named. Its
    // backlog puts it in Watching, never in Finished.
    expect(chips.watching.map((e) => e.showId)).toEqual([1, 7, 2, 3]);
    expect(chips.watchlist.map((e) => e.showId)).toEqual([4]);
    expect(chips.stopped.map((e) => e.showId)).toEqual([5]);
    expect(chips.finished.map((e) => e.showId)).toEqual([6]);
  });

  it("keeps one recency order across the merged watching + caught-up statuses", () => {
    const chips = chipBuckets([lapsed, watching, caughtUp], NOW, THRESHOLD, "recently-watched");
    expect(chips.watching.map((e) => e.showId)).toEqual([1, 2, 3]);
  });

  it("sorts alphabetically case-insensitively", () => {
    const chips = chipBuckets(
      [entry({ showId: 1, title: "beta" }), entry({ showId: 2, title: "Alpha" })],
      NOW,
      THRESHOLD,
      "alphabetical",
    );
    expect(chips.watching.map((e) => e.title)).toEqual(["Alpha", "beta"]);
  });

  it("sorts by progress ratio descending", () => {
    const chips = chipBuckets(
      [
        entry({ showId: 1, aired: 10, completed: 2 }),
        entry({ showId: 2, aired: 10, completed: 9 }),
      ],
      NOW,
      THRESHOLD,
      "progress",
    );
    expect(chips.watching.map((e) => e.showId)).toEqual([2, 1]);
  });

  it("returns empty chips for an empty library", () => {
    const chips = chipBuckets([], NOW, THRESHOLD, "recently-watched");
    expect(chips.watching).toEqual([]);
    expect(chips.finished).toEqual([]);
  });
});
