import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SPACE, useColors } from "./tokens";
import { CueText } from "./type";

export interface EmptyStateProps {
  readonly headline: string;
  readonly body?: string;
  readonly centered?: boolean;
  readonly testID?: string;
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
      {centered ? <View style={styles.action}>{children}</View> : children}
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
  action: { alignSelf: "stretch", flexDirection: "row", justifyContent: "center" },
});
