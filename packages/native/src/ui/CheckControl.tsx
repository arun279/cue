import { type ReactElement, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { CHECK_SIZE, RADIUS, SELECTABLE, SPACE, useColors } from "./tokens";

const { selected: ON, unselected: OFF } = SELECTABLE.check;

const RING_WIDTH = 2;
const GLYPH_RATIO = 0.52;
const GLYPH = "M4 12.5 9.5 18 20 6.5";
const GLYPH_LENGTH = 24;
const DRAW_IN_MS = 160;
const DRAW_IN_DELAY_MS = 60;
const DRAW_OUT_MS = 120;
const FADE_MS = 140;
const PENDING_DOT = 6;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface CheckControlProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly size?: number;
  readonly onImage?: boolean;
  readonly testID?: string;
}

export function CheckControl({
  checked,
  label,
  onPress,
  disabled = false,
  pending = false,
  size = CHECK_SIZE.row,
  onImage = false,
  testID,
}: CheckControlProps): ReactElement {
  const colors = useColors();
  const reduced = useReducedMotion();
  const drawn = useSharedValue(checked ? 0 : GLYPH_LENGTH);
  const resting = useSharedValue(checked ? 0 : 1);

  useEffect(() => {
    if (reduced) {
      drawn.value = checked ? 0 : GLYPH_LENGTH;
      resting.value = checked ? 0 : 1;
      return;
    }
    drawn.value = checked
      ? withDelay(DRAW_IN_DELAY_MS, withTiming(0, { duration: DRAW_IN_MS }))
      : withTiming(GLYPH_LENGTH, { duration: DRAW_OUT_MS });
    resting.value = withTiming(checked ? 0 : 1, { duration: FADE_MS });
  }, [checked, reduced, drawn, resting]);

  const tick = useAnimatedProps(() => ({ strokeDashoffset: drawn.value }));
  const rest = useAnimatedProps(() => ({ opacity: resting.value }));
  const disc = size - SPACE.s2;
  const restInk = onImage ? colors.onImage : colors[OFF.glyph];

  return (
    <View style={styles.control}>
      {pending ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.pending, { backgroundColor: colors.muted }]}
        />
      ) : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={label}
        disabled={disabled}
        testID={testID}
        onPress={onPress}
        style={[styles.target, { width: size, height: size }]}
      >
        <View
          style={[
            styles.disc,
            { width: disc, height: disc, borderColor: checked ? colors[ON.fill] : restInk },
            checked && { backgroundColor: colors[ON.fill] },
          ]}
        >
          <Svg width={disc * GLYPH_RATIO} height={disc * GLYPH_RATIO} viewBox="0 0 24 24">
            <AnimatedPath
              animatedProps={rest}
              testID={testID === undefined ? undefined : `${testID}-rest`}
              d={GLYPH}
              fill="none"
              stroke={restInk}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <AnimatedPath
              animatedProps={tick}
              d={GLYPH}
              fill="none"
              stroke={colors[ON.glyph]}
              strokeDasharray={GLYPH_LENGTH}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  control: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s1 },
  target: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  disc: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    borderWidth: RING_WIDTH,
  },
  pending: {
    flexShrink: 0,
    width: PENDING_DOT,
    height: PENDING_DOT,
    borderRadius: RADIUS.pill,
  },
});
