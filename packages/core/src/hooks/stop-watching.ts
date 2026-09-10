import type { LibraryEntry } from "../data/trakt/library";
import type { HideController } from "./useHideShow";

export function stopWatching(stop: HideController, entry: LibraryEntry): void {
  void stop.hide(
    entry.showId,
    { trakt: entry.showId, tmdb: entry.tmdbId ?? undefined },
    entry.title,
  );
}
