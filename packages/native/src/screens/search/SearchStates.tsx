import type { QueryStatus } from "@cue/core/queries/freshness";
import { readFailureBody } from "@cue/core/sync-contract";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { useLiveRegion } from "../../ui/live-region";
import { Skeleton } from "../../ui/Skeleton";
import { TEST_IDS } from "../../ui/test-ids";
import { POSTER_WIDTH, RADIUS, ROW_MIN_HEIGHT, SPACE } from "../../ui/tokens";
import { noResultsBody } from "./model";

const SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => index);
const BAR = { title: "55%", meta: 48, height: 12 } as const;

/** Which of the four non-result screens a settled query is looking at. */
export type SearchPhase = "searching" | "error" | "empty" | "offline";

export interface SearchStateProps {
  readonly phase: SearchPhase;
  readonly query: string;
  /** Hits the reader's media settings kept off this screen. */
  readonly hidden: number;
  readonly moviesEnabled: boolean;
  readonly failure: QueryStatus["failure"];
  onRetry(): void;
}

export function SearchState({
  phase,
  query,
  hidden,
  moviesEnabled,
  failure,
  onRetry,
}: SearchStateProps): ReactElement {
  if (phase === "offline") {
    return (
      <EmptyState testID={TEST_IDS.searchOffline} centered headline="Search needs a connection." />
    );
  }
  if (phase === "searching") return <SearchSkeleton />;
  if (phase === "error") return <SearchError failure={failure} onRetry={onRetry} />;
  return (
    <EmptyState
      testID={TEST_IDS.searchNoResults}
      headline={`Nothing for "${query}".`}
      body={noResultsBody(hidden, moviesEnabled)}
    />
  );
}

/** Six rows the shape the results will be. No spinner and no announcement: the
 * plates carry the wait visually, and a screen reader is told when it fails. */
function SearchSkeleton(): ReactElement {
  return (
    <View testID={TEST_IDS.searchSkeleton} style={styles.skeleton}>
      {SKELETON_ROWS.map((slot) => (
        <View key={slot} style={styles.row}>
          <Skeleton
            width={POSTER_WIDTH.row}
            height={ROW_MIN_HEIGHT.search}
            radius={RADIUS.poster}
          />
          <View style={styles.stack}>
            <Skeleton width={BAR.title} height={BAR.height} />
            <Skeleton width={BAR.meta} height={BAR.height} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Announced assertively, and it is the only thing this screen announces: the
 * "Searching…" live region is deleted, so a failure a reader cannot see is the
 * one event that would otherwise pass in silence.
 */
function SearchError({
  failure,
  onRetry,
}: Pick<SearchStateProps, "failure" | "onRetry">): ReactElement {
  const live = useLiveRegion("Search failed", "assertive");

  return (
    <View {...live}>
      <EmptyState
        testID={TEST_IDS.searchError}
        centered
        headline="Search failed"
        body={readFailureBody(failure)}
      >
        <Button label="Retry" onPress={onRetry} testID={TEST_IDS.searchErrorRetry} />
      </EmptyState>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: SPACE.s3 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
  stack: { flex: 1, gap: SPACE.s2 },
});
