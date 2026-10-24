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
import { type ChipKey, type LibraryView, matchesElsewhere, type Segment } from "./model";

const SKELETON_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const POSTER_RATIO = 3 / 2;

export function LibraryState({
  status,
  segment,
  view,
  chip,
  onChip,
  query,
  width,
  onRetry,
  onClear,
}: {
  readonly status: QueryStatus;
  readonly segment: Segment;
  readonly view: LibraryView;
  readonly chip: ChipKey;
  onChip(key: ChipKey): void;
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
  return (
    <LibraryNoMatch
      segment={segment}
      view={view}
      chip={chip}
      query={query}
      onChip={onChip}
      onClear={onClear}
    />
  );
}

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
      centered
      headline={segment === "shows" ? "Couldn't load your library" : "Couldn't load your movies"}
      body={readFailureBody(failure)}
    >
      <Button label="Retry" onPress={onRetry} testID={TEST_IDS.libraryErrorRetry} />
    </EmptyState>
  );
}

const EMPTY: Readonly<Record<ChipKey, readonly [string, string?]>> = {
  watching: ["Shows you're watching land here.", "Find one in Search."],
  "not-started": ["Things you want to watch land here.", "Add them from Search."],
  stopped: ["Shows you stop keep their progress.", "Resume any time."],
  finished: ["Shows you finish land here."],
  watched: ["Movies you watch land here."],
};

function LibraryEmpty({ chip }: { readonly chip: ChipKey }): ReactElement {
  const router = useRouter();
  const [headline, body] = EMPTY[chip];

  return (
    <EmptyState headline={headline} body={body}>
      {chip === "watching" ? (
        <Button label="Search shows" variant="link" onPress={() => router.push("/search")} />
      ) : null}
    </EmptyState>
  );
}

function LibraryNoMatch({
  segment,
  view,
  chip,
  query,
  onChip,
  onClear,
}: {
  readonly segment: Segment;
  readonly view: LibraryView;
  readonly chip: ChipKey;
  readonly query: string;
  onChip(key: ChipKey): void;
  onClear(): void;
}): ReactElement {
  const noun = segment === "shows" ? "shows" : "movies";
  const elsewhere = matchesElsewhere(view, chip, query);
  const label = view.chips.find((candidate) => candidate.key === chip)?.label;
  return (
    <EmptyState
      headline={
        elsewhere.length === 0
          ? `No ${noun} match "${query}".`
          : `No ${noun} in ${label} match "${query}".`
      }
    >
      {elsewhere.map((other) => (
        <Button
          key={other.key}
          label={`Show ${other.count} in ${other.label}`}
          variant="link"
          onPress={() => onChip(other.key)}
        />
      ))}
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
