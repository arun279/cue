import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Glyph } from "../../ui/Glyph";
import { RowMenu } from "../../ui/RowMenu";
import { SegmentedControl, type SegmentOption } from "../../ui/SegmentedControl";
import { TEST_IDS } from "../../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import type { Segment, SortOption } from "./model";

const SEGMENTS: readonly SegmentOption<Segment>[] = [
  { value: "shows", label: "Shows", testID: TEST_IDS.librarySegmentShows },
  { value: "movies", label: "Movies", testID: TEST_IDS.librarySegmentMovies },
];

export interface LibraryToolbarProps<T extends string> {
  readonly bothMedia: boolean;
  readonly segment: Segment;
  onSegment(segment: Segment): void;
  readonly sorts: readonly SortOption<T>[];
  readonly sort: T;
  onSort(sort: T): void;
}

export function LibraryToolbar<T extends string>({
  bothMedia,
  segment,
  onSegment,
  sorts,
  sort,
  onSort,
}: LibraryToolbarProps<T>): ReactElement {
  const colors = useColors();

  return (
    <View style={styles.toolbar}>
      {bothMedia ? (
        <SegmentedControl
          segments={SEGMENTS}
          value={segment}
          onChange={onSegment}
          style={styles.segments}
        />
      ) : null}
      <View style={styles.tools}>
        <RowMenu
          title="Sort"
          testID={TEST_IDS.librarySort}
          openOnLongPress={false}
          items={sorts.map((option) => ({
            id: option.testID,
            label: option.label,
            selected: option.id === sort,
            onPress: () => onSort(option.id),
          }))}
        >
          <View accessible accessibilityRole="button" accessibilityLabel="Sort" style={styles.tool}>
            <Glyph path="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3" color={colors.accentInk} />
          </View>
        </RowMenu>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: SPACE.s2,
    paddingHorizontal: SPACE.s4,
    paddingBottom: SPACE.s2,
  },
  segments: { flexGrow: 1, flexBasis: 176 },
  tools: { marginLeft: "auto" },
  tool: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
});
