import type { LibraryEntry } from "../../domain/model/library";
import { toMs } from "../../domain/time";
import { type TraktClient, unwrapRead } from "./client";
import {
  getCollectionShows,
  getDropped,
  getHidden,
  getShowProgress,
  getWatchedShows,
  getWatchlist,
} from "./endpoints";
import { assembleLibrary, showIdSet, watchedEpisodeCount } from "./library";
import type { Progress, WatchedShow } from "./schemas";

const ABANDONED = Symbol("abandoned read");

async function readProgressHead(
  client: TraktClient,
  head: readonly WatchedShow[],
): Promise<Map<number, Progress>> {
  let failure: unknown = null;
  const entries = await Promise.all(
    head.map(async (show) => {
      const id = show.show.ids.trakt;
      try {
        const read = await client.reads.withRetry(async () => {
          if (failure !== null) throw ABANDONED;
          return getShowProgress(client, id);
        });
        return [id, unwrapRead(read, "show progress")] as const;
      } catch (error) {
        if (error !== ABANDONED) failure ??= error;
        return null;
      }
    }),
  );
  if (failure !== null) throw failure;
  return new Map(entries.filter((entry) => entry !== null));
}

function byLastWatchedDesc(a: WatchedShow, b: WatchedShow): number {
  return (toMs(b.last_watched_at) ?? 0) - (toMs(a.last_watched_at) ?? 0);
}

export async function loadUpNextEntries(client: TraktClient): Promise<LibraryEntry[]> {
  const watched = unwrapRead(
    await client.reads.withRetry(() => getWatchedShows(client)),
    "watched shows",
  );

  const head = watched
    .filter((show) => watchedEpisodeCount(show) !== show.show.aired_episodes)
    .sort(byLastWatchedDesc)
    .slice(0, client.policy.progressBudget);
  const progress = await readProgressHead(client, head);

  const [hidden, dropped, watchlist, collection] = await Promise.all([
    client.reads.withRetry(() => getHidden(client)),
    client.reads.withRetry(() => getDropped(client)),
    client.reads.withRetry(() => getWatchlist(client, "shows")),
    client.reads.withRetry(() => getCollectionShows(client)),
  ]);
  return assembleLibrary({
    watchedShows: watched,
    progress,
    hiddenShowIds: showIdSet(unwrapRead(hidden, "hidden shows")),
    droppedShowIds: showIdSet(unwrapRead(dropped, "dropped shows")),
    watchlistShows: unwrapRead(watchlist, "watchlist"),
    collectionShows: unwrapRead(collection, "show collection"),
  });
}
