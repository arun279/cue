import type { ReactElement } from "react";
import { type DimensionValue, StyleSheet, View } from "react-native";
import { RADIUS, RAIL, useColors } from "./tokens";

export interface ProgressBarProps {
  readonly percent: number;
  /** From `RAIL`, or "100%" once the footer has reflowed and the rail has the
   * line to itself. */
  readonly width: DimensionValue;
}

/**
 * How far through a show the reader is, at 4 pt and never scaled.
 *
 * Hidden from assistive technology because its number is already in the row's
 * composed label; announcing it twice is the ungrouped reading A10 exists to
 * prevent. On the light theme `--color-progress` reads 3.28:1 against its own
 * track, which is the ratio a palette change has to keep.
 */
export function ProgressBar({ percent, width }: ProgressBarProps): ReactElement {
  const colors = useColors();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { width, backgroundColor: colors.track }]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${percent}%`,
            backgroundColor: percent >= 100 ? colors.watched : colors.progress,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexShrink: 0, height: RAIL.height, borderRadius: RADIUS.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: RADIUS.pill },
});
