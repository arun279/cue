import {
  type ColorValue,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useColorScheme,
  type ViewStyle,
} from "react-native";

/**
 * The design tokens, resolved for React Native.
 *
 * Every color below is a light/dark pair transcribed from the web app's
 * `src/ui/styles.css`, which is the one place the palette is defined. The pairs
 * are what iOS wants: a `DynamicColorIOS` value resolves itself, including under
 * `Appearance.setColorScheme`, so the three-way Theme setting drives the whole
 * palette, `useColorScheme` and `expo-status-bar` together and no token needs
 * plumbing of its own. Android has no such value, so `useColors` resolves the
 * pair against `useColorScheme` there.
 *
 * Two tokens do not survive the port. `--color-border-strong` is retired: its
 * five web users are the check ring, the sheet grabber, the History search
 * input, the Settings switch and the Library filter stroke, and on native the
 * first and last become `muted` while the middle three are drawn by the
 * platform. `--color-focus` goes with the CSS focus ring it exists for.
 */
const PALETTE = {
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
  // Theme-invariant: text over artwork always sits on a dark scrim.
  scrim: { light: "rgba(10,8,6,0.86)", dark: "rgba(10,8,6,0.86)" },
  onImage: { light: "#ffffff", dark: "#ffffff" },
  onImage2: { light: "#d9cfc0", dark: "#d9cfc0" },
  /**
   * The stroke every amber fill carries so a selected state is not identified by
   * a fill alone: `#f0a62a` reads 1.97:1 against the light page and 1.83:1
   * against the elevated fill beside it, which fails WCAG 1.4.11. On dark the
   * same fill is 10.98:1 and needs nothing, so the dark half is transparent and
   * a fill can draw the stroke unconditionally.
   */
  accentFillStroke: { light: "#935800", dark: "transparent" },
  /**
   * List separators. On iOS this is the system color, so it tracks Increase
   * Contrast, which a Cue token cannot. Android's `HorizontalDivider` takes
   * `outlineVariant`, which is `--color-border`; there is no framework constant
   * behind it and no setting that repaints it, so the token stands.
   */
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

/** Built only on iOS: `DynamicColorIOS` throws everywhere else. */
const DYNAMIC: Colors | null =
  Platform.OS === "ios"
    ? { ...mapPalette(DynamicColorIOS), separator: PlatformColor("separator") }
    : null;

/**
 * The palette this render should draw with. On iOS it is one constant map of
 * dynamic values the system resolves; on Android it is the resolved map for the
 * scheme, which is what makes the Theme setting repaint without per-token work.
 */
export function useColors(): Colors {
  const scheme = useColorScheme();
  return DYNAMIC ?? (scheme === "light" ? LIGHT : DARK);
}

/** The 8-step scale, in points and density-independent pixels, never scalable units. */
export const SPACE = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48, s8: 64 } as const;

export const RADIUS = { poster: 8, control: 12, card: 16, sheet: 20, pill: 999 } as const;

/**
 * No row has a height. Every row has a minimum and grows, so a title that wraps
 * at the largest content sizes takes the room it needs instead of truncating.
 */
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

/** Apple's default control size is 44 by 44 pt; Material's is 48 dp. */
export const TARGET_MIN = Platform.OS === "ios" ? 44 : 48;

/** The check's two sizes. The 44 pt one went with the "Previously" strip. */
export const CHECK_SIZE = { marquee: 56, row: 48 } as const;

/** `.sep` is a half-point hairline on iOS; `DividerDefaults.Thickness` is 1 dp. */
export const HAIRLINE = Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1;

/**
 * The lift under a surface that floats over the page. It is load bearing rather
 * than decoration: on the light theme `--color-overlay` is #ffffff on a #fbfaf7
 * page, 1.04:1, so nothing else separates a snackbar from what it covers.
 * Android takes elevation and the platform draws its own shadow; iOS takes the
 * offset, radius and opacity, with the shadow's own black rather than a palette
 * color, which is what a shadow is.
 */
export const FLOAT_SHADOW: ViewStyle = Platform.select({
  android: { elevation: 6 },
  default: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 15,
  },
});

/**
 * Where a row's trailing controls stop fitting beside its text and move below
 * it, and where a footer's rail and count stop sharing a line. Derived from
 * iOS's AX5 measurement; Android's curve and its independent Display size
 * setting give a different answer, which is measured on an Android device
 * rather than inherited from this one.
 */
export const REFLOW_FONT_SCALE = 1.6;
