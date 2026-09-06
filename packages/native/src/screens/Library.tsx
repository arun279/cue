import { useLibraryBuckets } from "@cue/core/hooks/useLibraryBuckets";
import { useMovieLibrary } from "@cue/core/hooks/useMovieLibrary";
import { parseLibrarySearch } from "@cue/core/url/search-params";
import { Link, useLocalSearchParams } from "expo-router";
import type { ReactElement } from "react";
import { FlatList, Text, View } from "react-native";

/**
 * Library, over the shared bucket hooks, with the segment read through the same
 * parser the web app validates its query string with. A route parameter is
 * untrusted text on both targets, from a deep link or a hand-edited address, so
 * the one that decides which medium is shown is parsed rather than trusted, and
 * the medium that is not shown leaves its query idle rather than reading a
 * section nobody is looking at.
 */
export function Library(): ReactElement {
  const params = useLocalSearchParams<{ type?: string }>();
  const { type } = parseLibrarySearch(params);
  const movies = type === "movies";
  const shows = useLibraryBuckets("alphabetical", !movies);
  const movieLibrary = useMovieLibrary("alphabetical", movies);

  return (
    <View testID="screen-library">
      <Text accessibilityRole="header">{movies ? "Library, movies" : "Library, shows"}</Text>
      <Link href={movies ? "/library" : "/library?type=movies"} testID="library-segment">
        {movies ? "Shows" : "Movies"}
      </Link>
      {movies ? (
        <FlatList
          testID="library-list"
          data={movieLibrary.segments.flatMap((segment) => segment.entries)}
          keyExtractor={(entry) => String(entry.movieId)}
          renderItem={({ item }) => (
            <Link href={`/movie/${item.movieId}`} testID="library-row">
              {item.title}
            </Link>
          )}
        />
      ) : (
        <FlatList
          testID="library-list"
          data={shows.chips.watching}
          keyExtractor={(entry) => String(entry.showId)}
          renderItem={({ item }) => (
            <Link href={`/show/${item.showId}`} testID="library-row">
              {item.title}
            </Link>
          )}
        />
      )}
    </View>
  );
}
