import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { RADIUS, SPACE, useColors } from "./tokens";
import { CueText } from "./type";

export interface BadgeProps {
  readonly label: string;
  readonly testID?: string;
}

export function Badge({ label, testID }: BadgeProps): ReactElement {
  const colors = useColors();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[styles.badge, { backgroundColor: colors.elevated }]}
    >
      <CueText variant="micro" tabularNums style={{ color: colors.ink2 }}>
        {label}
      </CueText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    minWidth: SPACE.s5,
    paddingHorizontal: SPACE.s2,
    paddingVertical: SPACE.s1,
    borderRadius: RADIUS.pill,
  },
});
