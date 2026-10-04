import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  type Theme,
} from "expo-router";
import { Platform, useColorScheme, useWindowDimensions } from "react-native";
import { SnackbarHost } from "./SnackbarHost";
import { PALETTE, RADIUS, useColors } from "./tokens";

const EXPANDED_SHEET_FONT_SCALE = 1.3;

const episodeSheetFooter =
  Platform.OS === "android" ? () => <SnackbarHost placement="presentation" contained /> : undefined;

const sheetOptions = {
  presentation: "formSheet",
  headerShown: false,
  sheetGrabberVisible: true,
  sheetCornerRadius: RADIUS.sheet,
} as const satisfies NativeStackNavigationOptions;

export function useEpisodeSheetOptions(): NativeStackNavigationOptions {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  return {
    ...sheetOptions,
    sheetAllowedDetents: Platform.OS === "android" ? [0.92] : [0.65, 0.92],
    sheetInitialDetentIndex:
      Platform.OS === "ios" && fontScale >= EXPANDED_SHEET_FONT_SCALE ? 1 : 0,
    contentStyle: { backgroundColor: colors.bg },
    unstable_sheetFooter: episodeSheetFooter,
  };
}

export function useMonthJumpSheetOptions(): NativeStackNavigationOptions {
  const colors = useColors();
  return {
    ...sheetOptions,
    sheetAllowedDetents: [0.92],
    contentStyle: { backgroundColor: colors.overlay },
  };
}

export const barOptions: NativeStackNavigationOptions =
  Platform.OS === "android" ? { headerShadowVisible: false } : {};

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
