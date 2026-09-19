import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function HistoryChoice({
  label,
  selected = false,
  testID,
  onPress,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly testID: string;
  onPress(): void;
}): ReactElement {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? colors.accent : colors.elevated,
          borderColor: selected ? colors.accentFillStroke : colors.border,
        },
      ]}
    >
      <CueText
        variant="meta"
        weight="semibold"
        style={{ color: selected ? colors.accentFg : colors.ink2 }}
      >
        {label}
      </CueText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    minHeight: TARGET_MIN,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: SPACE.s2,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
  },
});
