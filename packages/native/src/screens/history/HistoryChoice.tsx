import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SELECTABLE, SPACE, TARGET_MIN, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function HistoryChoice({
  label,
  selected = false,
  compact = false,
  testID,
  onPress,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly compact?: boolean;
  readonly testID: string;
  onPress(): void;
}): ReactElement {
  const colors = useColors();
  const look = selected ? SELECTABLE.historyChoice.selected : SELECTABLE.historyChoice.unselected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      hitSlop={compact ? { top: (TARGET_MIN - 34) / 2, bottom: (TARGET_MIN - 34) / 2 } : undefined}
      style={[
        styles.choice,
        compact && { minHeight: 34, borderRadius: RADIUS.pill },
        {
          backgroundColor: colors[look.fill],
          borderColor: colors[look.stroke],
        },
      ]}
    >
      <CueText variant="meta" weight="semibold" style={{ color: colors[look.label] }}>
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
