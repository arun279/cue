import {
  type ColorValue,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";

export const PALETTE = {
  bg: { light: "#fbfaf7", dark: "#0e0c0a" },
  surface: { light: "#ffffff", dark: "#17140f" },
  elevated: { light: "#f4f1ea", dark: "#221d16" },
  overlay: { light: "#ffffff", dark: "#2b241b" },
  border: { light: "#e7e2d8", dark: "#33291e" },
  fg: { light: "#1a1712", dark: "#f4efe7" },
  ink2: { light: "#514a3e", dark: "#c6baa8" },
  muted: { light: "#6e6656", dark: "#978a78" },
  accent: { light: "#f0a62a", dark: "#f5b841" },
  accentStrong: { light: "#d98f13", dark: "#ffc966" },
  accentFg: { light: "#1a1206", dark: "#140e04" },
  accentInk: { light: "#935800", dark: "#f5b841" },
  progress: { light: "#b26a00", dark: "#f5b841" },
  track: { light: "#e7e2d8", dark: "#2a241c" },
  watched: { light: "#1e7a54", dark: "#57c996" },
  watchedFg: { light: "#ffffff", dark: "#08130d" },
  ok: { light: "#1f7a54", dark: "#5fbe97" },
  danger: { light: "#b4231b", dark: "#f0857a" },
  scrim: { light: "rgba(10,8,6,0.86)", dark: "rgba(10,8,6,0.86)" },
  dim: { light: "rgba(10,8,6,0.32)", dark: "rgba(0,0,0,0.5)" },
  onImage: { light: "#ffffff", dark: "#ffffff" },
  onImage2: { light: "#d9cfc0", dark: "#d9cfc0" },
  // Light amber is 1.97:1 on the page, under the 3:1 WCAG 1.4.11 requires; dark amber is 10.98:1.
  accentFillStroke: { light: "#935800", dark: "transparent" },
  // Material 3's HorizontalDivider draws in outlineVariant, which no system setting repaints.
  separator: { light: "#e7e2d8", dark: "#33291e" },
} as const;

type Pair = (typeof PALETTE)[keyof typeof PALETTE];
type ColorToken = keyof typeof PALETTE;
export type Colors = Readonly<Record<ColorToken, ColorValue>>;

function mapPalette(pick: (pair: Pair) => ColorValue): Colors {
  return Object.fromEntries(
    Object.entries(PALETTE).map(([token, pair]) => [token, pick(pair)]),
  ) as Colors;
}

const LIGHT = mapPalette((pair) => pair.light);
const DARK = mapPalette((pair) => pair.dark);

// DynamicColorIOS throws on other platforms.
const DYNAMIC: Colors | null =
  Platform.OS === "ios"
    ? { ...mapPalette(DynamicColorIOS), separator: PlatformColor("separator") }
    : null;

export function useColors(): Colors {
  const scheme = useColorScheme();
  return DYNAMIC ?? (scheme === "light" ? LIGHT : DARK);
}

export const SPACE = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48, s8: 64 } as const;

export const RADIUS = { poster: 8, control: 12, card: 16, sheet: 20, pill: 999 } as const;

export const ROW_MIN_HEIGHT = {
  marquee: 140,
  queue: 72,
  lapsed: 72,
  onTheWay: 64,
  calendar: 64,
  history: 56,
  search: 56,
  settings: 56,
  seasonEpisode: 48,
  footer: 48,
} as const;

export const TARGET_MIN = Platform.OS === "ios" ? 44 : 48;

export const CHECK_SIZE = { marquee: 56, row: 48 } as const;

// `.sep` is a half-point hairline on iOS; `DividerDefaults.Thickness` is 1 dp.
export const HAIRLINE = Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1;

export const FLOAT_SHADOW: ViewStyle = Platform.select({
  android: { elevation: 6 },
  default: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 15,
  },
});

export const REFLOW_FONT_SCALE = 1.6;

export const SCRIM_FONT_SCALE = 1.3;

export const SWIPE_COMMIT = 96;

export const POSTER_WIDTH = { row: 48, onTheWay: 40, marquee: 64 } as const;

export const EPISODE_NUMBER_WIDTH = 20;

export const RAIL = { height: 4, row: 64, marquee: 120 } as const;

export const ROW_TEXT_INSET = SPACE.s4 + POSTER_WIDTH.row + SPACE.s3;

// iOS 26 floats the tab bar 40 pt off the edge at 56 pt tall; Android's navigation bar is 80 dp.
export function tabBarClearance(insetBottom: number): number {
  return Platform.OS === "ios" ? 40 + 56 : insetBottom + 80;
}

export function useStacked(): boolean {
  return useWindowDimensions().fontScale >= REFLOW_FONT_SCALE;
}
