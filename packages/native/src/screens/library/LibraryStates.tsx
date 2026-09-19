import type { QueryStatus } from "@cue/core/queries/freshness";
import { readFailureBody } from "@cue/core/sync-contract";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE } from "../../ui/tokens";
import type { ChipKey, Segment } from "./model";

const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const POSTER_RATIO = 3 / 2;

/**
 * The grid with no tiles in it, which is four different screens: not yet, gone
 * wrong, genuinely empty, and filtered down to nothing.
 */
export function LibraryState({
  status,
  segment,
  chip,
  query,
  width,
  onRetry,
  onClear,
}: {
  readonly status: QueryStatus;
  readonly segment: Segment;
  readonly chip: ChipKey;
  readonly query: string;
  readonly width: number;
  onRetry(): void;
  onClear(): void;
}): ReactElement {
  if (status.isLoading) return <LibrarySkeleton width={width} />;
  if (status.isError && !status.hasData) {
    return <LibraryError segment={segment} failure={status.failure} onRetry={onRetry} />;
  }
  if (query === "") return <LibraryEmpty chip={chip} />;
  return <LibraryNoMatch segment={segment} query={query} onClear={onClear} />;
}

/** The grid before it knows its titles: the shape the content will take. */
function LibrarySkeleton({ width }: { readonly width: number }): ReactElement {
  return (
    <View testID={TEST_IDS.librarySkeleton} style={styles.skeleton}>
      {SKELETON_TILES.map((slot) => (
        <Skeleton key={slot} width={width} height={width * POSTER_RATIO} radius={RADIUS.poster} />
      ))}
    </View>
  );
}

function LibraryError({
  segment,
  failure,
  onRetry,
}: {
  readonly segment: Segment;
  readonly failure: QueryStatus["failure"];
  onRetry(): void;
}): ReactElement {
  return (
    <EmptyState
      testID={TEST_IDS.libraryError}
      centered
      headline={segment === "shows" ? "Couldn't load your library" : "Couldn't load your movies"}
      body={readFailureBody(failure)}
    >
      <Button label="Retry" onPress={onRetry} testID={TEST_IDS.libraryErrorRetry} />
    </EmptyState>
  );
}

/**
 * Six slots holding five sentences: a show watchlist and a movie
 * watchlist promise the same thing, so they say it in the same words and the copy is a property of the chip alone.
 */
const EMPTY: Readonly<Record<ChipKey, readonly [string, string?]>> = {
  watching: ["Shows you're watching land here.", "Find one in Search."],
  watchlist: ["Things you want to watch land here.", "Add them from Search."],
  stopped: ["Shows you stop keep their progress.", "Resume any time."],
  finished: ["Shows you finish land here."],
  watched: ["Movies you watch land here."],
};

function LibraryEmpty({ chip }: { readonly chip: ChipKey }): ReactElement {
  const router = useRouter();
  const [headline, body] = EMPTY[chip];

  return (
    <EmptyState testID={TEST_IDS.libraryEmpty} headline={headline} body={body}>
      {chip === "watching" ? (
        <Button label="Search shows" variant="link" onPress={() => router.push("/search")} />
      ) : null}
    </EmptyState>
  );
}

function LibraryNoMatch({
  segment,
  query,
  onClear,
}: {
  readonly segment: Segment;
  readonly query: string;
  onClear(): void;
}): ReactElement {
  return (
    <EmptyState
      testID={TEST_IDS.libraryNoMatch}
      headline={`No ${segment === "shows" ? "shows" : "movies"} match "${query}".`}
    >
      <Button
        label="Clear filter"
        variant="ghost"
        onPress={onClear}
        testID={TEST_IDS.libraryFilterClear}
      />
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  skeleton: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.s3 },
});
