import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

export interface ButtonProps {
  readonly label: string;
  readonly variant?: "primary" | "ghost" | "link";
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function Button({
  label,
  variant = "primary",
  onPress,
  disabled = false,
  testID,
}: ButtonProps): ReactElement {
  const colors = useColors();
  const primary = variant === "primary";
  const surface = primary ? colors.accent : variant === "ghost" ? colors.elevated : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === "link" ? styles.link : styles.filled,
        { backgroundColor: surface },
        // WCAG 1.4.11: amber #f0a62a is 1.97:1 on the light page, so the fill needs a stroke.
        primary && { borderWidth: HAIRLINE, borderColor: colors.accentFillStroke },
        disabled && styles.disabled,
      ]}
    >
      <CueText
        variant="rowTitle"
        weight="semibold"
        style={{
          color: primary ? colors.accentFg : variant === "ghost" ? colors.fg : colors.accentInk,
        }}
      >
        {label}
      </CueText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    minHeight: TARGET_MIN,
  },
  filled: { paddingHorizontal: SPACE.s4, borderRadius: RADIUS.control },
  link: { paddingRight: SPACE.s2 },
  disabled: { opacity: 0.7 },
});
