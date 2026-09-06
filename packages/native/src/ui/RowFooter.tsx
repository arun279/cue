import type { ReactElement } from "react";
import { type ColorValue, StyleSheet, useWindowDimensions, View } from "react-native";
import { ProgressBar } from "./ProgressBar";
import { REFLOW_FONT_SCALE, SPACE } from "./tokens";
import { CueText } from "./type";

export interface RowFooterProps {
  readonly percent: number;
  /** "3 left", or the idle stretch the drawer draws in its place. Null when a
   * projection has run past a show's last aired episode and there is nothing
   * left to count. */
  readonly note: string | null;
  /** From `RAIL`, for the line the rail shares with its count. */
  readonly rail: number;
  readonly color: ColorValue;
}

/**
 * The rail and its count, on the row and on the card alike.
 *
 * Above the reflow threshold the two stop sharing a line, the rail keeps the
 * full width and the count wraps beneath it, so the row grows rather than
 * shedding the only at-a-glance progress indication on the home screen.
 */
export function RowFooter({ percent, note, rail, color }: RowFooterProps): ReactElement {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= REFLOW_FONT_SCALE;

  return (
    <View style={stacked ? styles.stacked : styles.inline}>
      <ProgressBar percent={percent} width={stacked ? "100%" : rail} />
      {note === null ? null : (
        <CueText variant="caption" tabularNums style={{ color }}>
          {note}
        </CueText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: "row", alignItems: "center", gap: SPACE.s2, paddingTop: SPACE.s1 },
  stacked: { alignItems: "stretch", gap: SPACE.s1, paddingTop: SPACE.s1 },
});
