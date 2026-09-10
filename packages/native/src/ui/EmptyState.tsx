import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SPACE, useColors } from "./tokens";
import { CueText } from "./type";

export interface EmptyStateProps {
  readonly headline: string;
  readonly body?: string;
  /**
   * A failure is centered and a genuine empty state is left-aligned. That
   * difference is the whole of what keeps emptiness from reading as failure.
   */
  readonly centered?: boolean;
  readonly testID?: string;
  /** The action, where there is one. An empty screen is an invitation to act. */
  readonly children?: ReactNode;
}

export function EmptyState({
  headline,
  body,
  centered = false,
  testID,
  children,
}: EmptyStateProps): ReactElement {
  const colors = useColors();

  return (
    <View testID={testID} style={[styles.empty, centered && styles.centered]}>
      <CueText
        variant="sectionHeading"
        accessibilityRole="header"
        style={[{ color: colors.fg }, centered && styles.centeredText]}
      >
        {headline}
      </CueText>
      {body === undefined ? null : (
        <CueText
          variant="rowTitleSecondary"
          style={[{ color: colors.ink2 }, centered && styles.centeredText]}
        >
          {body}
        </CueText>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flexShrink: 0,
    alignItems: "flex-start",
    gap: SPACE.s3,
    paddingTop: SPACE.s7,
    paddingBottom: SPACE.s5,
  },
  centered: { alignItems: "center" },
  centeredText: { textAlign: "center" },
});
