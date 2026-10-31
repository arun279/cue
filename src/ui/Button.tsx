import type { ReactElement } from "react";
import { ActivityIndicator, type ColorValue, Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

export interface ButtonProps {
  readonly label: string;
  readonly variant?: "primary" | "ghost" | "link";
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly testID?: string;
}

const LOOK = {
  primary: { surface: "accent", ink: "accentFg" },
  ghost: { surface: "elevated", ink: "fg" },
  link: { surface: null, ink: "accentInk" },
} as const;

export function Button({
  label,
  variant = "primary",
  onPress,
  disabled = false,
  busy = false,
  testID,
}: ButtonProps): ReactElement {
  const colors = useColors();
  const look = LOOK[variant];
  const ink = colors[look.ink];
  const inert = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      testID={testID}
      disabled={inert}
      onPress={onPress}
      style={[
        styles.button,
        variant === "link" ? styles.link : styles.filled,
        { backgroundColor: look.surface === null ? "transparent" : colors[look.surface] },
        // WCAG 1.4.11: amber #f0a62a is 1.97:1 on the light page, so the fill needs a stroke.
        variant === "primary" && { borderWidth: HAIRLINE, borderColor: colors.accentFillStroke },
        disabled && styles.disabled,
      ]}
    >
      {busy ? <Busy color={ink} testID={testID} /> : null}
      <CueText variant="rowTitle" weight="semibold" style={{ color: ink }}>
        {label}
      </CueText>
    </Pressable>
  );
}

function Busy({
  color,
  testID,
}: {
  readonly color: ColorValue;
  readonly testID?: string;
}): ReactElement {
  return <ActivityIndicator color={color} testID={testID && `${testID}-busy`} />;
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: SPACE.s2,
    alignItems: "center",
    justifyContent: "center",
    minHeight: TARGET_MIN,
  },
  filled: { paddingHorizontal: SPACE.s4, borderRadius: RADIUS.control },
  link: { paddingRight: SPACE.s2 },
  disabled: { opacity: 0.7 },
});
