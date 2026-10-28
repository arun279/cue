import type { ReactElement } from "react";
import { type DimensionValue, StyleSheet, View } from "react-native";
import { RADIUS, RAIL, useColors } from "./tokens";

export interface ProgressBarProps {
  readonly percent: number;
  readonly width: DimensionValue;
}

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
