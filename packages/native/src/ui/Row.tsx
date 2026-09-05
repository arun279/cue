import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { HAIRLINE, REFLOW_FONT_SCALE, SPACE, useColors } from "./tokens";

export interface RowProps {
  /**
   * The composed label for the row body, in the order the row reads: show
   * title, episode code, episode title, count. The row is exactly two
   * accessibility elements, this one and the trailing control beside it.
   */
  readonly label: string;
  /** From `ROW_MIN_HEIGHT`. No row has a height; every row grows. */
  readonly minHeight: number;
  /** Artwork, which does not scale with text. */
  readonly leading?: ReactNode;
  /** The check, the overflow, a countdown chip. A sibling of the body, never
   * nested inside it. */
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly testID?: string;
  readonly children: ReactNode;
}

/**
 * A list row.
 *
 * Above `REFLOW_FONT_SCALE` the trailing cluster moves below the text column and
 * stays right-aligned, which is what UIKit does to a cell accessory at the
 * accessibility sizes: two fixed targets take a fifth of the width exactly when
 * the title needs all of it, and beside them a single unbreakable show title
 * would be drawn underneath them. The row grows and nothing is dropped, which is
 * the alternative to hyphenating a title mid-word.
 */
export function Row({
  label,
  minHeight,
  leading,
  trailing,
  onPress,
  testID,
  children,
}: RowProps): ReactElement {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= REFLOW_FONT_SCALE;

  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Pressable
        accessible
        accessibilityRole={onPress === undefined ? undefined : "button"}
        accessibilityLabel={label}
        testID={testID}
        onPress={onPress}
        style={[styles.body, { minHeight }]}
      >
        {leading}
        <View style={styles.stack}>{children}</View>
      </Pressable>
      {trailing === undefined ? null : <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

export interface SeparatorProps {
  /** How far the hairline is inset from the leading edge, which is normally the
   * width of the artwork plus its gap. */
  readonly inset?: number;
}

/**
 * The line between two rows, drawn in the platform separator rather than
 * `--color-border`: a hairline does not have to meet a contrast threshold, but
 * the platform's own tracks the Increase Contrast setting and a Cue token
 * cannot.
 */
export function Separator({ inset = 0 }: SeparatorProps): ReactElement {
  const colors = useColors();
  return (
    <View style={[styles.separator, { backgroundColor: colors.separator, marginLeft: inset }]} />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.s2 },
  rowStacked: { flexDirection: "column", alignItems: "stretch" },
  body: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s3 },
  stack: { flex: 1, minWidth: 0, gap: 2 },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: SPACE.s2,
  },
  separator: { flexShrink: 0, height: HAIRLINE },
});
