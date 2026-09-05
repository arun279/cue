import {
  type ColorValue,
  DynamicColorIOS,
  Platform,
  PlatformColor,
  StyleSheet,
  useColorScheme,
  type ViewStyle,
} from "react-native";

/** Native replaces border-strong with muted or platform strokes and retires the web focus ring. */
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

/** `.sep` is a half-point hairline on iOS; `DividerDefaults.Thickness` is 1 dp. */
export const HAIRLINE = Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1;

/**
 * Load bearing rather than decoration: the light overlay is #ffffff on a
 * #fbfaf7 page, 1.04:1, so the shadow separates a snackbar from what it covers.
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
