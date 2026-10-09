import { useHaptics } from "@cue/core/ports/haptics";
import type { ReactElement } from "react";
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { HAIRLINE, RADIUS, SELECTABLE, SPACE, TARGET_MIN, useColors, useStacked } from "./tokens";
import { CueText } from "./type";

const { selected: ON, unselected: OFF } = SELECTABLE.segment;

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly testID: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly segments: readonly SegmentOption<T>[];
  readonly value: T;
  onChange(value: T): void;
  readonly style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  style,
}: SegmentedControlProps<T>): ReactElement {
  const colors = useColors();
  const haptics = useHaptics();
  const stacked = useStacked();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        stacked && styles.trackStacked,
        { backgroundColor: colors[OFF.fill] },
        style,
      ]}
    >
      {segments.map((segment) => {
        const on = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={segment.label}
            testID={segment.testID}
            onPress={() => {
              haptics.selection();
              onChange(segment.value);
            }}
            style={[
              styles.segment,
              stacked && styles.segmentStacked,
              on && { backgroundColor: colors[ON.fill], borderColor: colors[ON.stroke] },
            ]}
          >
            <CueText
              variant="rowTitleSecondary"
              weight={on ? "semibold" : "medium"}
              style={[styles.label, { color: colors[on ? ON.label : OFF.label] }]}
            >
              {segment.label}
            </CueText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", gap: 2, padding: 2, borderRadius: RADIUS.control },
  trackStacked: { flexDirection: "column" },
  segment: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACE.s3,
    borderRadius: RADIUS.control - 2,
    borderWidth: HAIRLINE,
    borderColor: "transparent",
  },
  segmentStacked: { flexBasis: "auto" },
  label: { textAlign: "center" },
});
