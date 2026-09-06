import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CHECK_SIZE, RADIUS, SPACE, useColors } from "./tokens";

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
 * The retired border-strong ring read 1.75:1 on light and 1.88:1 on dark.
 * Muted clears 3:1 on every surface the check can sit on.
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
