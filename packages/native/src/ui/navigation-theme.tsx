import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  type Theme,
} from "expo-router";
import { type ColorValue, Platform, useColorScheme, useWindowDimensions } from "react-native";
import { PRESENTATIONS } from "../presentation";
import { PALETTE, RADIUS, useColors } from "./tokens";

const EXPANDED_SHEET_FONT_SCALE = 1.3;

function sheetOptions(background: ColorValue): NativeStackNavigationOptions {
  return {
    sheetGrabberVisible: true,
    sheetCornerRadius: RADIUS.sheet,
    contentStyle: { backgroundColor: background },
    ...(Platform.OS === "android"
      ? { headerShown: false }
      : {
          headerShown: true,
          title: "",
          headerTransparent: false,
          headerStyle: { backgroundColor: background },
        }),
  };
}

export function useEpisodeSheetOptions(): NativeStackNavigationOptions {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  return {
    ...sheetOptions(colors.bg),
    presentation: PRESENTATIONS["show/[showId]/episode/[season]/[episode]"],
    sheetAllowedDetents: Platform.OS === "android" ? [0.92] : [0.65, 0.92],
    sheetInitialDetentIndex:
      Platform.OS === "ios" && fontScale >= EXPANDED_SHEET_FONT_SCALE ? 1 : 0,
  };
}

export function useMonthJumpSheetOptions(): NativeStackNavigationOptions {
  const colors = useColors();
  return {
    ...sheetOptions(colors.overlay),
    presentation: PRESENTATIONS["history-jump"],
    sheetAllowedDetents: [0.92],
  };
}

export const HEADER_TINT = "accentInk";

export const TRANSPARENT_SCREEN: NativeStackNavigationOptions = {
  contentStyle: { backgroundColor: "transparent" },
};

export function useOpaqueScreen(): NativeStackNavigationOptions {
  const colors = useColors();
  return { contentStyle: { backgroundColor: colors.bg } };
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
      primary: PALETTE[HEADER_TINT][scheme],
      background: Platform.OS === "android" ? "transparent" : PALETTE.bg[scheme],
      card: PALETTE.bg[scheme],
      text: PALETTE.fg[scheme],
      border: PALETTE.border[scheme],
      notification: PALETTE.danger[scheme],
    },
  };
}
