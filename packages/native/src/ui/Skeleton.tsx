import { type ReactElement, useEffect } from "react";
import { type DimensionValue, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { RADIUS, useColors } from "./tokens";

const PULSE_MS = 600;
const REST_OPACITY = 1;
const DIM_OPACITY = 0.45;

export interface SkeletonProps {
  readonly width: DimensionValue;
  readonly height: number;
  readonly radius?: number;
}

export function Skeleton({ width, height, radius = RADIUS.pill }: SkeletonProps): ReactElement {
  const colors = useColors();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(REST_OPACITY);

  useEffect(() => {
    if (reduced) return;
    opacity.value = withRepeat(withTiming(DIM_OPACITY, { duration: PULSE_MS }), -1, true);
  }, [reduced, opacity]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.plate,
        { width, height, borderRadius: radius, backgroundColor: colors.elevated },
        pulse,
      ]}
    />
  );
}

const styles = StyleSheet.create({ plate: { flexShrink: 0 } });
