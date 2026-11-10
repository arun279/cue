import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SearchHit } from "../domain/discover";
import type { MovieEntry } from "../domain/model/movie";
import { usePrefs } from "../prefs/prefs-store";
import { libraryQuery, movieLibraryQuery, movieWatchlistQuery } from "../queries/library";
import { useRuntime } from "../runtime/runtime";
import { useSetWatchlisted } from "./useSetWatchlisted";

const movieIds = (entries: readonly MovieEntry[]): readonly number[] =>
  entries.map(({ movieId }) => movieId);

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
    if (!isAdded(hit)) await setListed(hit, true);
  };
  const remove = async (hit: SearchHit) => {
    await setListed(hit, false);
  };
  return { isAdded, add, remove };
}
