import type { SearchHit } from "@cue/core/data/trakt/search";
import type { QueryStatus } from "@cue/core/queries/freshness";
import { readFailureBody } from "@cue/core/sync-contract";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { Chevron } from "../../ui/Chevron";
import { EmptyState } from "../../ui/EmptyState";
import { Separator } from "../../ui/Row";
import { SectionHeader } from "../../ui/SectionHeader";
import { Skeleton } from "../../ui/Skeleton";
import { TEST_IDS } from "../../ui/test-ids";
import { RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { Tile } from "../library/LibraryTile";
import { BROWSE_CELLS, type BrowseGrid, labelOf, routeOf } from "./model";

const POSTER_RATIO = 3 / 2;
const SKELETON_TILES = Array.from({ length: BROWSE_CELLS }, (_, index) => index);

export interface BrowseProps {
  readonly status: QueryStatus;
  readonly grids: readonly BrowseGrid[];
  readonly recent: readonly string[];
  readonly width: number;
  onRecall(term: string): void;
  onRetry(): void;
}

export function Browse({
  status,
  grids,
  recent,
  width,
  onRecall,
  onRetry,
}: BrowseProps): ReactElement {
  return (
    <View testID={TEST_IDS.searchBrowse}>
      {recent.length === 0 ? null : (
        <View>
          <SectionHeader label="Recent" />
          {recent.map((term) => (
            <View key={term}>
              <RecentTerm term={term} onRecall={onRecall} />
              <Separator />
            </View>
          ))}
        </View>
      )}
      <Grids status={status} grids={grids} width={width} onRetry={onRetry} />
    </View>
  );
}

function Grids({
  status,
  grids,
  width,
  onRetry,
}: Pick<BrowseProps, "status" | "grids" | "width" | "onRetry">): ReactElement {
  if (status.isLoading) {
    return (
      <View testID={TEST_IDS.browseSkeleton} style={styles.grid}>
        {SKELETON_TILES.map((slot) => (
          <Skeleton key={slot} width={width} height={width * POSTER_RATIO} radius={RADIUS.poster} />
        ))}
      </View>
    );
  }
  if (status.isError && !status.hasData) {
    return (
      <EmptyState
        testID={TEST_IDS.browseError}
        centered
        headline="Couldn't load browse"
        body={readFailureBody(status.failure)}
      >
        <Button label="Retry" onPress={onRetry} testID={TEST_IDS.browseErrorRetry} />
      </EmptyState>
    );
  }
  return (
    <View>
      {grids.map((grid) => (
        <View key={grid.key}>
          <SectionHeader label={grid.label} />
          <View testID={TEST_IDS.browseGrid} style={styles.grid}>
            {grid.hits.map((hit) => (
              <BrowseTile key={hit.key} hit={hit} width={width} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function RecentTerm({
  term,
  onRecall,
}: {
  readonly term: string;
  onRecall(term: string): void;
}): ReactElement {
  const colors = useColors();

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Search ${term} again`}
      testID={TEST_IDS.searchRecentRow}
      onPress={() => onRecall(term)}
      style={styles.recent}
    >
      <CueText variant="rowTitle" numberOfLines={1} style={[styles.term, { color: colors.fg }]}>
        {term}
      </CueText>
      <Chevron direction="recall" />
    </Pressable>
  );
}

function BrowseTile({
  hit,
  width,
}: {
  readonly hit: SearchHit;
  readonly width: number;
}): ReactElement {
  const router = useRouter();

  return (
    <Tile
      title={hit.title}
      posters={hit.posters}
      width={width}
      testID={
        hit.type === "movie" ? TEST_IDS.movieCard(hit.traktId) : TEST_IDS.showCard(hit.traktId)
      }
      label={labelOf(hit)}
      percent={null}
      left={0}
      year={hit.year === null ? undefined : String(hit.year)}
      onPress={() => router.push(routeOf(hit))}
    />
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.s3 },
  recent: { flexDirection: "row", alignItems: "center", gap: SPACE.s3, minHeight: TARGET_MIN },
  term: { flex: 1, minWidth: 0 },
});
