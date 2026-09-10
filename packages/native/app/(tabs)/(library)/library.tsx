import { chipBuckets, groupMovieLibrary } from "@cue/core/domain/library-buckets";
import { useLibrarySnapshot } from "@cue/core/hooks/useLibrarySnapshot";
import { movieLibraryQuery } from "@cue/core/queries/library";
import { useRuntime } from "@cue/core/runtime/runtime";
import { parseLibrarySearch } from "@cue/core/url/search-params";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocalSearchParams } from "expo-router";
import { type ReactElement, useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { TEST_IDS } from "../../../src/ui/test-ids";

/**
 * Library, over the shared cached reads, with the segment read through the core
 * route parser. A route parameter is untrusted text from a deep link, so
 * the one that decides which medium is shown is parsed rather than trusted, and
 * the medium that is not shown leaves its query idle rather than reading a
 * section nobody is looking at.
 */
export default function Library(): ReactElement {
  const runtime = useRuntime();
  const params = useLocalSearchParams<{ type?: string }>();
  const { type } = parseLibrarySearch(params);
  const movies = type === "movies";
  const { data, thresholdMs } = useLibrarySnapshot(!movies);
  const shows = useMemo(
    () => chipBuckets(data?.entries ?? [], Date.now(), thresholdMs, "alphabetical"),
    [data, thresholdMs],
  );
  const movieLibrary = useQuery({ ...movieLibraryQuery(runtime), enabled: movies });
  const movieSegments = useMemo(
    () => groupMovieLibrary(movieLibrary.data?.entries ?? [], "alphabetical"),
    [movieLibrary.data],
  );

  return (
    <View testID={TEST_IDS.screenLibrary}>
      <Text accessibilityRole="header">{movies ? "Library, movies" : "Library, shows"}</Text>
      <Link href={movies ? "/library" : "/library?type=movies"} testID={TEST_IDS.librarySegment}>
        {movies ? "Shows" : "Movies"}
      </Link>
      {movies ? (
        <FlatList
          testID={TEST_IDS.libraryList}
          data={movieSegments.flatMap((segment) => segment.entries)}
          keyExtractor={(entry) => String(entry.movieId)}
          renderItem={({ item }) => (
            <Link href={`/movie/${item.movieId}`} testID={TEST_IDS.libraryRow(item.movieId)}>
              {item.title}
            </Link>
          )}
        />
      ) : (
        <FlatList
          testID={TEST_IDS.libraryList}
          data={shows.watching}
          keyExtractor={(entry) => String(entry.showId)}
          renderItem={({ item }) => (
            <Link href={`/show/${item.showId}`} testID={TEST_IDS.libraryRow(item.showId)}>
              {item.title}
            </Link>
          )}
        />
      )}
    </View>
  );
}
