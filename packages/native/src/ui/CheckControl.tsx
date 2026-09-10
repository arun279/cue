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
import { CHECK_SIZE, RADIUS, SPACE, useColors } from "./tokens";

const RING_WIDTH = 2;
const GLYPH_RATIO = 0.52;
const GLYPH = "M4 12.5 9.5 18 20 6.5";
/** Comfortably over the path's own length, so a full offset hides all of it. */
const GLYPH_LENGTH = 24;
const DRAW_IN_MS = 160;
const DRAW_IN_DELAY_MS = 60;
const DRAW_OUT_MS = 120;
const FADE_MS = 140;
const PENDING_DOT = 6;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface CheckControlProps {
  readonly checked: boolean;
  /** What the control does, not what it is: assistive technology reads the state
   * from `accessibilityState` and must not hear it twice. */
  readonly label: string;
  readonly onPress: () => void;
  /**
   * Checked and inert. The row has advanced onto a next episode that is still a
   * client projection, and marking a guessed coordinate is forbidden, so an
   * honestly unavailable target beats one that answers nothing.
   */
  readonly disabled?: boolean;
  /** The mark is past its undo window and has yet to reach Trakt: the quiet dot
   * beside the check, never a second green. */
  readonly pending?: boolean;
  /** The target's own size. A queue row's check is 48 and the marquee's is 56. */
  readonly size?: number;
  /** Over artwork the rest ring is `--color-on-image` at full strength. No alpha
   * variant of it exists and none is invented. */
  readonly onImage?: boolean;
  /** The resting glyph takes this with a `-rest` suffix: it is decorative, so it
   * carries no role a query could otherwise reach it by. */
  readonly testID?: string;
}

/**
 * The retired border-strong ring read 1.75:1 on light and 1.88:1 on dark.
 * Muted clears 3:1 on every surface the check can sit on.
 *
 * The ring always carries a glyph, a check waiting to happen rather than an
 * empty circle, which is what says the control marks rather than selects. The
 * committed tick is a second layer that draws itself as the resting one fades,
 * because this is the feedback for the most repeated action in the product and
 * it is what makes a mark feel committed rather than merely recorded. Under
 * Reduce Motion both layers change without drawing: the state change is not
 * motion.
 */
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
  const restInk = onImage ? colors.onImage : colors.muted;

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
            { width: disc, height: disc, borderColor: checked ? colors.watched : restInk },
            checked && { backgroundColor: colors.watched },
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
              stroke={colors.watchedFg}
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
