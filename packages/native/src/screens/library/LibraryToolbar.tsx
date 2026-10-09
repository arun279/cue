import type { ReactElement } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { GLYPH, Glyph } from "../../ui/Glyph";
import { HIDE_CARET } from "../../ui/harness";
import { RowMenu } from "../../ui/RowMenu";
import { SegmentedControl, type SegmentOption } from "../../ui/SegmentedControl";
import { TEST_IDS } from "../../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import type { Segment, SortOption } from "./model";

const SEGMENTS: readonly SegmentOption<Segment>[] = [
  { value: "shows", label: "Shows", testID: TEST_IDS.librarySegmentShows },
  { value: "movies", label: "Movies", testID: TEST_IDS.librarySegmentMovies },
];

export interface LibraryToolbarProps<T extends string> {
  readonly bothMedia: boolean;
  readonly segment: Segment;
  onSegment(segment: Segment): void;
  readonly filter: string;
  readonly filtering: boolean;
  onFilter(text: string): void;
  onFilterToggle(): void;
  readonly sorts: readonly SortOption<T>[];
  readonly sort: T;
  onSort(sort: T): void;
}

export function LibraryToolbar<T extends string>({
  bothMedia,
  segment,
  onSegment,
  filter,
  filtering,
  onFilter,
  onFilterToggle,
  sorts,
  sort,
  onSort,
}: LibraryToolbarProps<T>): ReactElement {
  const colors = useColors();

  if (filtering) {
    return (
      <View style={styles.toolbar}>
        <TextInput
          autoFocus
          caretHidden={HIDE_CARET}
          testID={TEST_IDS.libraryFilterField}
          accessibilityLabel="Filter by title"
          placeholder="Filter by title"
          placeholderTextColor={colors.muted}
          defaultValue={filter}
          onChangeText={onFilter}
          returnKeyType="search"
          autoCorrect={false}
          style={[styles.field, { borderColor: colors.muted, color: colors.fg }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close filter"
          testID={TEST_IDS.libraryFilterToggle}
          onPress={onFilterToggle}
          style={styles.tool}
        >
          <Glyph path={GLYPH.close} color={colors.accentInk} />
        </Pressable>
      </View>
    );
  }

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter by title"
          testID={TEST_IDS.libraryFilterToggle}
          onPress={onFilterToggle}
          style={styles.tool}
        >
          <Glyph path={GLYPH.search} color={colors.accentInk} />
        </Pressable>
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
  tools: { flexDirection: "row", gap: SPACE.s2, marginLeft: "auto" },
  tool: {
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    flex: 1,
    minHeight: TARGET_MIN,
    paddingHorizontal: SPACE.s3,
    borderWidth: HAIRLINE,
    borderRadius: RADIUS.control,
  },
});
