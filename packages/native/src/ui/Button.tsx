import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { HAIRLINE, RADIUS, SPACE, TARGET_MIN, useColors } from "./tokens";
import { CueText, lineHeightOf } from "./type";

export interface ButtonProps {
  readonly label: string;
  /**
   * `primary` is the one action a screen wants taken, `ghost` is the alternative
   * beside it, and `link` is an action with no surface of its own.
   */
  readonly variant?: "primary" | "ghost" | "link";
  readonly onPress: () => void;
  /** A control that is momentarily unavailable, which is a state rather than an
   * absence: it keeps its place and says what it is waiting on. */
  readonly disabled?: boolean;
  readonly testID?: string;
  /** A navigation bar item, which on iOS stops growing at the bar's height, as
   * UIKit's own do, and shows its label in the Large Content Viewer on a long press. */
  readonly bar?: boolean;
}

/**
 * The height iOS 26 gives an item inside a navigation bar's 44 pt glass platter,
 * which insets it by 4 pt on each side. Android's 64 dp bar has no platter.
 */
const BAR_ITEM_HEIGHT = 36;
const BAR_TEXT_SCALE =
  Platform.OS === "ios" ? BAR_ITEM_HEIGHT / lineHeightOf("rowTitle") : undefined;

/**
 * Every amber fill carries a `--color-accent-ink` stroke, because on the light
 * theme `#f0a62a` reads 1.97:1 against the page: a control identified by a fill
 * alone that does not contrast is what WCAG 1.4.11 rules out, and delineating a
 * control's boundary is a best practice on top of it. On the dark theme the
 * stroke token is transparent, so the fill can draw it unconditionally.
 */
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
  // The ink stays on the leading edge and the target reaches the floor around
  // it, so a link lines up with the body text above it.
  link: { paddingRight: SPACE.s2 },
  disabled: { opacity: 0.7 },
});
