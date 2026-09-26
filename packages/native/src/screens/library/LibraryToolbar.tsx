import { useHaptics } from "@cue/core/ports/haptics";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { GLYPH, Glyph } from "../../ui/Glyph";
import { RowMenu } from "../../ui/RowMenu";
import { TEST_IDS } from "../../ui/test-ids";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import type { Segment, SortOption } from "./model";

const SEGMENTS: readonly { key: Segment; label: string; testID: string }[] = [
  { key: "shows", label: "Shows", testID: TEST_IDS.librarySegmentShows },
  { key: "movies", label: "Movies", testID: TEST_IDS.librarySegmentMovies },
];
const SEGMENT_HEIGHT = 32;
const SEGMENT_SLOP = { top: 6, bottom: 6, left: 0, right: 0 };

export interface LibraryToolbarProps<T extends string> {
  /** The control appears only when both media are on; one medium is not a choice. */
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

/**
 * What the grid is showing and how it is ordered: the segmented control, the
 * filter, and sort.
 *
 * The segment control is Cue-drawn rather than the platform's: `@expo/ui`'s
 * segmented control contributes no accessibility element at all, which leaves
 * the medium switch unreachable by VoiceOver and by any test. Two targets that
 * set a value, with no path that clears it, hold the same always-one-selected
 * invariant. Sort is the platform's
 * own pull-down menu, which draws its own checkmark beside the chosen order.
 * Revealing the filter replaces the row, because a field and the control it
 * came from competing for the same 44 pt is what the reveal exists to avoid.
 */
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
  const haptics = useHaptics();

  if (filtering) {
    return (
      <View style={styles.toolbar}>
        <TextInput
          autoFocus
          testID={TEST_IDS.libraryFilterField}
          accessibilityLabel="Filter by title"
          placeholder="Filter by title"
          placeholderTextColor={colors.muted}
          value={filter}
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
        <View style={[styles.track, { backgroundColor: colors.elevated }]}>
          {SEGMENTS.map((option) => {
            const on = option.key === segment;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={option.label}
                testID={option.testID}
                hitSlop={SEGMENT_SLOP}
                onPress={() => {
                  haptics.selection();
                  onSegment(option.key);
                }}
                style={[
                  styles.segment,
                  on && { backgroundColor: colors.overlay, borderColor: colors.border },
                ]}
              >
                <CueText
                  variant="rowTitleSecondary"
                  weight={on ? "semibold" : "medium"}
                  style={{ color: on ? colors.fg : colors.ink2 }}
                >
                  {option.label}
                </CueText>
              </Pressable>
            );
          })}
        </View>
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
  track: {
    flexDirection: "row",
    gap: SPACE.s1,
    padding: 2,
    borderRadius: RADIUS.control,
  },
  segment: {
    minHeight: SEGMENT_HEIGHT,
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACE.s3,
    borderRadius: RADIUS.control - 2,
    borderWidth: HAIRLINE,
    borderColor: "transparent",
  },
  // Wrapping rather than a fixed row: the segment labels are type, so at the
  // largest sizes the two tools take a line of their own instead of leaving the
  // screen.
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
