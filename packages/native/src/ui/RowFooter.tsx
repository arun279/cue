import type { ReactElement } from "react";
import { type ColorValue, StyleSheet, useWindowDimensions, View } from "react-native";
import { ProgressBar } from "./ProgressBar";
import { REFLOW_FONT_SCALE, SPACE } from "./tokens";
import { CueText } from "./type";

export interface RowFooterProps {
  readonly percent: number;
  readonly note: string | null;
  readonly rail: number;
  readonly color: ColorValue;
}

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
