import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  type Theme,
} from "expo-router";
import { type ColorValue, Platform, useColorScheme, useWindowDimensions } from "react-native";
import { PALETTE, RADIUS, useColors } from "./tokens";

/**
 * Above this text scale the episode sheet's own copy fills the compact detent,
 * so it opens expanded rather than opening on a mark row the reader has to drag
 * the sheet up to reach.
 */
const EXPANDED_SHEET_FONT_SCALE = 1.3;

/**
 * The episode sheet as every stack that hosts it presents it. UIKit owns the
 * detents, the grabber and the physics; the two heights keep compact and
 * expanded reading positions, and the grabber is the sheet's only chrome.
 */
export function useEpisodeSheetOptions(): NativeStackNavigationOptions {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  return {
    presentation: "formSheet",
    headerShown: false,
    sheetAllowedDetents: [0.65, 0.92],
    sheetInitialDetentIndex: fontScale >= EXPANDED_SHEET_FONT_SCALE ? 1 : 0,
    sheetGrabberVisible: true,
    sheetCornerRadius: RADIUS.sheet,
    contentStyle: { backgroundColor: colors.bg },
  };
}

/**
 * A stack bar's own fill, which only Android draws: the page's color, flat at
 * rest, the way a Material 3 top app bar sits before content scrolls under it.
 * On iOS a custom background overlays Liquid Glass and the scroll edge effect,
 * so the bar is left to the system and a large-title or floating bar needs its
 * screen's scroll view to adjust its content inset automatically.
 */
export const barOptions = (backgroundColor: ColorValue) =>
  Platform.OS === "android" ? { headerStyle: { backgroundColor }, headerShadowVisible: false } : {};

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
