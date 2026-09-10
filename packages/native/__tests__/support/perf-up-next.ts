import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { UpNextCard } from "../../src/screens/up-next/model";

export const SHOW_ID = 8801;

export const episode = {
  season: 3,
  number: 6,
  title: "Salt Air",
  firstAired: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  still: null,
  ids: { trakt: 1 },
};

export const entry: LibraryEntry = {
  showId: SHOW_ID,
  title: "Harbor Lights",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: new Date().toISOString(),
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
