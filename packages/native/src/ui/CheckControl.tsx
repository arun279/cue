import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CHECK_SIZE, RADIUS, SPACE, useColors } from "./tokens";

/** The ring's own weight, and the glyph as a fraction of the disc it sits in. */
const RING_WIDTH = 2;
const GLYPH_RATIO = 0.52;

export interface CheckControlProps {
  readonly checked: boolean;
  /** What the control does, not what it is: assistive technology reads the state
   * from `accessibilityState` and must not hear it twice. */
  readonly label: string;
  readonly onPress: () => void;
  /** The target's own size. A queue row's check is 48 and the marquee's is 56. */
  readonly size?: number;
  /** Over artwork the rest ring is `--color-on-image` at full strength. No alpha
   * variant of it exists and none is invented. */
  readonly onImage?: boolean;
  readonly testID?: string;
}

/**
 * The most-used control in the product.
 *
 * At rest the ring is `--color-muted` rather than the retired
 * `--color-border-strong`, which read 1.75:1 on the light background and 1.88:1
 * on the dark one: below the W3C's own published failure example for a checkbox
 * whose border is the only thing identifying it. `--color-muted` clears 3:1 on
 * every surface the check can sit on.
 *
 * It is a switch with a checked state rather than a button, and it is a sibling
 * of the row it belongs to rather than a child, because a control nested inside
 * another accessibility element is not a valid tree.
 */
export function CheckControl({
  checked,
  label,
  onPress,
  size = CHECK_SIZE.row,
  onImage = false,
  testID,
}: CheckControlProps): ReactElement {
  const colors = useColors();
  const disc = size - SPACE.s2;
  const ink = checked ? colors.watchedFg : onImage ? colors.onImage : colors.muted;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={[styles.target, { width: size, height: size }]}
    >
      <View
        style={[
          styles.disc,
          { width: disc, height: disc, borderColor: checked ? colors.watched : ink },
          checked && { backgroundColor: colors.watched },
        ]}
      >
        <Svg width={disc * GLYPH_RATIO} height={disc * GLYPH_RATIO} viewBox="0 0 24 24">
          <Path
            d="M4 12.5 9.5 18 20 6.5"
            fill="none"
            stroke={ink}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  disc: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.pill,
    borderWidth: RING_WIDTH,
  },
});
