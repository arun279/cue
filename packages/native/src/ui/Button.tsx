import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText, lineHeightOf } from "./type";

export interface ButtonProps {
  readonly label: string;
  readonly variant?: "primary" | "ghost" | "link";
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
  readonly bar?: boolean;
}

// iOS 26 insets a navigation bar item 4 pt inside the bar's 44 pt glass platter.
const BAR_ITEM_HEIGHT = 36;
const BAR_TEXT_SCALE =
  Platform.OS === "ios" ? BAR_ITEM_HEIGHT / lineHeightOf("rowTitle") : undefined;

export function Button({
  label,
  variant = "primary",
  onPress,
  disabled = false,
  testID,
  bar = false,
}: ButtonProps): ReactElement {
  const colors = useColors();
  const primary = variant === "primary";
  const surface = primary ? colors.accent : variant === "ghost" ? colors.elevated : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      accessibilityShowsLargeContentViewer={bar}
      accessibilityLargeContentTitle={bar ? label : undefined}
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
        maxFontSizeMultiplier={bar ? BAR_TEXT_SCALE : undefined}
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
