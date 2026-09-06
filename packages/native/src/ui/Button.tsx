import type { ReactElement } from "react";
import { Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText } from "./type";

export interface ButtonProps {
  readonly label: string;
  /**
   * `primary` is the one action a screen wants taken, `ghost` is the alternative
   * beside it, and `link` is an action with no surface of its own.
   */
  readonly variant?: "primary" | "ghost" | "link";
  readonly onPress: () => void;
  readonly testID?: string;
}

/**
 * Every amber fill carries a `--color-accent-ink` stroke, because on the light
 * theme `#f0a62a` reads 1.97:1 against the page: a control identified by a fill
 * alone that does not contrast is what WCAG 1.4.11 rules out, and delineating a
 * control's boundary is a best practice on top of it. On the dark theme the
 * stroke token is transparent, so the fill can draw it unconditionally.
 */
export function Button({ label, variant = "primary", onPress, testID }: ButtonProps): ReactElement {
  const colors = useColors();
  const primary = variant === "primary";
  const surface = primary ? colors.accent : variant === "ghost" ? colors.elevated : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[
        styles.button,
        variant === "link" ? styles.link : styles.filled,
        { backgroundColor: surface },
        primary && { borderWidth: HAIRLINE, borderColor: colors.accentFillStroke },
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
  // The ink stays on the leading edge and the target reaches the floor around
  // it, so a link lines up with the body text above it.
  link: { paddingRight: SPACE.s2 },
});
