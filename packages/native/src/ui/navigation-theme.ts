import { DarkTheme, DefaultTheme, type Theme } from "expo-router";
import { useColorScheme } from "react-native";
import { PALETTE } from "./tokens";

/**
 * The theme the navigators draw their own chrome from: the bar's fill, the
 * title's ink, the back chevron and the hairline under a scrolled bar.
 *
 * These are UIKit surfaces configured through props rather than styles, so they
 * take a resolved color and change with the scheme by being handed a different
 * theme, not by the system resolving a dynamic one. Without it the navigation
 * bar keeps the library's own light palette on a dark device, which is a dark
 * title on a dark fill.
 */
export function useNavigationTheme(): Theme {
  const dark = useColorScheme() !== "light";
  const base = dark ? DarkTheme : DefaultTheme;
  const scheme = dark ? "dark" : "light";

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: PALETTE.accentInk[scheme],
      background: PALETTE.bg[scheme],
      card: PALETTE.bg[scheme],
      text: PALETTE.fg[scheme],
      border: PALETTE.border[scheme],
      notification: PALETTE.danger[scheme],
    },
  };
}
