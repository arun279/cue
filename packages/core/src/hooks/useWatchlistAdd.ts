import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { WatchlistItem } from "../data/trakt/schemas";
import type { SearchHit } from "../data/trakt/search";
import { usePrefs } from "../prefs/prefs-store";
import { libraryQuery, movieLibraryQuery, movieWatchlistQuery } from "../queries/library";
import { useRuntime } from "../runtime/runtime";
import { showFailure } from "../stores/snackbar-store";
import { useSetWatchlisted } from "./useSetWatchlisted";

const movieIds = (rows: readonly WatchlistItem[]): readonly number[] =>
  rows.flatMap((row) => (row.movie === undefined ? [] : [row.movie.ids.trakt]));

export interface WatchlistAddView {
  isAdded(hit: SearchHit): boolean;
  add(hit: SearchHit): Promise<void>;
  remove(hit: SearchHit): Promise<void>;
}

export function useWatchlistAdd(): WatchlistAddView {
  const runtime = useRuntime();
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const setListed = useSetWatchlisted();
  const listedMovies = useQuery({ ...movieWatchlistQuery(runtime), select: movieIds }).data;
  const shows = useQuery({ ...libraryQuery(runtime), enabled: showsEnabled }).data?.entries;
  const movies = useQuery({ ...movieLibraryQuery(runtime), enabled: false }).data?.entries;

  const listedIds = useMemo(
    () => ({
      movie: new Set([...(listedMovies ?? []), ...(movies ?? []).map(({ movieId }) => movieId)]),
      show: new Set((shows ?? []).map(({ showId }) => showId)),
    }),
    [listedMovies, shows, movies],
  );
  const isAdded = (hit: SearchHit) => listedIds[hit.type].has(hit.traktId);

  const add = async (hit: SearchHit) => {
    if (isAdded(hit)) return;
    if ((await setListed(hit, true)) === "failed")
      showFailure(`Couldn't add ${hit.title} to your watchlist. Please try again.`, () => {});
  };
  const remove = async (hit: SearchHit) => {
    if ((await setListed(hit, false)) === "failed")
      showFailure(`Couldn't remove ${hit.title} from your watchlist. Please try again.`, () => {});
  };
  return { isAdded, add, remove };
}
