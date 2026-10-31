import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PlatformIcon } from "./PlatformIcon";
import { RADIUS, SELECTABLE, SPACE, TARGET_MIN, useColors } from "./tokens";

const { selected: ON, unselected: OFF } = SELECTABLE.check;

const PENDING_DOT = 6;
const RIPPLE = { borderless: true, radius: TARGET_MIN / 2 } as const;

export interface CheckControlProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly testID?: string;
}

export function CheckControl({
  checked,
  label,
  onPress,
  disabled = false,
  pending = false,
  testID,
}: CheckControlProps): ReactElement {
  const colors = useColors();

  return (
    <View style={styles.control}>
      {pending ? <PendingDot /> : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={label}
        disabled={disabled}
        testID={testID}
        onPress={onPress}
        android_ripple={RIPPLE}
        style={styles.target}
      >
        <PlatformIcon
          name={checked ? "checked" : "unchecked"}
          color={checked ? colors[ON.fill] : colors[OFF.glyph]}
          testID={testID === undefined ? undefined : `${testID}-icon`}
        />
      </Pressable>
    </View>
  );
}

export function PendingDot(): ReactElement {
  const colors = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.pending, { backgroundColor: colors.muted }]}
    />
  );
}

const styles = StyleSheet.create({
  control: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s1 },
  target: {
    flexShrink: 0,
    width: TARGET_MIN,
    height: TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  pending: {
    flexShrink: 0,
    width: PENDING_DOT,
    height: PENDING_DOT,
    borderRadius: RADIUS.pill,
  },
});
