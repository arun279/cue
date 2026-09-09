import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { UpNextCard, UpNextView } from "@cue/core/hooks/useUpNext";

export const SHOW_ID = 8801;

export const episode = {
  season: 3,
  number: 6,
  title: "Salt Air",
  firstAired: "2026-01-01T00:00:00.000Z",
  still: null,
  ids: { trakt: 1 },
};

export const entry: LibraryEntry = {
  showId: SHOW_ID,
  title: "Harbor Lights",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-01-01T00:00:00.000Z",
  aired: 22,
  completed: 20,
  nextEpisode: episode,
  lastAired: null,
  tmdbId: null,
  pendingAdvance: false,
};

export const cardOf = (pendingAdvance: boolean): UpNextCard => ({
  item: { showId: SHOW_ID, title: entry.title, episode, lastWatchedAt: null, backlog: 2 },
  entry: { ...entry, pendingAdvance },
});

export function viewOf(overrides: Partial<UpNextView> = {}): UpNextView {
  return {
    queue: [cardOf(false)],
    lapsedCards: [],
    watchlistEntries: [],
    totalCount: 1,
    trackedCount: 1,
    startedCount: 1,
    unresolvedCount: 0,
    refetch: jest.fn(),
    isLoading: false,
    isFetching: false,
    isError: false,
    hasData: true,
    syncedAt: 0,
    failure: null,
    retrying: false,
    ...overrides,
  };
}
