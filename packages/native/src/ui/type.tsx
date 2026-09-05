import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import { useFonts } from "expo-font";
import type { ReactElement } from "react";
import { Platform, Text, type TextProps, type TextStyle } from "react-native";

/**
 * The eleven type roles, and the two faces that draw them.
 *
 * A role fixes a size, a line height and a tracking; weight is a separate axis,
 * because the design draws the same role at two weights (a queue row title is
 * emphasized, the History footer beside it is not) and a weight change is not a
 * size change. Nothing here is capped: `maxFontSizeMultiplier` is absent on
 * purpose, and the two roles the system draws are the tab-root large title and
 * the pushed inline title, which belong to the navigation stack rather than to
 * this module.
 *
 * On iOS `dynamicTypeRamp` binds each role to a `UIFontTextStyle`, so a custom
 * face still scales through `UIFontMetrics`; React Native scales the absolute
 * line height by the same multiplier. On Android every size is `sp`, which is
 * what puts it on Android 14's non-linear curve, and no spacing value anywhere
 * is in `sp`.
 *
 * The faces are `@expo-google-fonts` rather than the `@fontsource-variable`
 * packages the web app uses, which ship WOFF2 only; a native text engine needs
 * TTF or OTF.
 */
export type TypeRole =
  | "screenTitle"
  | "screenTitlePushed"
  | "detailTitle"
  | "statHero"
  | "sectionHeading"
  | "identity"
  | "rowTitle"
  | "rowTitleSecondary"
  | "meta"
  | "caption"
  | "micro";

export type TypeWeight = "regular" | "medium" | "semibold" | "bold";

/**
 * `ui` is Inter, `display` is Space Grotesk, and `system` is the platform's own
 * face, which two roles take because a custom face inside a system bar competes
 * with the bar's metrics. Space Grotesk ships one weight here, so a display role
 * ignores the weight axis.
 */
type Face = "ui" | "display" | "system";

interface RoleSpec {
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly weight: TypeWeight;
  readonly face: Face;
}

/** The iOS text style each role scales with, which is A4's own mapping. */
const RAMP: Readonly<Record<TypeRole, NonNullable<TextProps["dynamicTypeRamp"]>>> = {
  screenTitle: "largeTitle",
  screenTitlePushed: "headline",
  detailTitle: "title1",
  statHero: "largeTitle",
  sectionHeading: "title2",
  identity: "title3",
  rowTitle: "body",
  rowTitleSecondary: "subheadline",
  meta: "footnote",
  caption: "caption1",
  micro: "caption2",
};

const IOS_ROLES: Readonly<Record<TypeRole, RoleSpec>> = {
  screenTitle: { size: 34, lineHeight: 41, letterSpacing: 0.37, weight: "bold", face: "system" },
  screenTitlePushed: {
    size: 17,
    lineHeight: 22,
    letterSpacing: -0.43,
    weight: "semibold",
    face: "system",
  },
  detailTitle: { size: 28, lineHeight: 34, letterSpacing: -0.4, weight: "bold", face: "display" },
  statHero: { size: 34, lineHeight: 38, letterSpacing: -0.4, weight: "bold", face: "display" },
  sectionHeading: { size: 22, lineHeight: 28, letterSpacing: -0.26, weight: "bold", face: "ui" },
  identity: { size: 20, lineHeight: 25, weight: "semibold", face: "ui" },
  rowTitle: { size: 17, lineHeight: 22, letterSpacing: -0.2, weight: "medium", face: "ui" },
  rowTitleSecondary: { size: 15, lineHeight: 20, weight: "medium", face: "ui" },
  meta: { size: 13, lineHeight: 18, weight: "medium", face: "ui" },
  caption: { size: 12, lineHeight: 16, weight: "regular", face: "ui" },
  micro: { size: 11, lineHeight: 13, weight: "bold", face: "ui" },
};

/**
 * The Material scale, with Cue's own weights rather than the baseline's, so a
 * row title reads the same on both platforms. Material components draw Inter
 * too: the theme's typography is the app's, and Roboto appears only where the
 * platform draws the type itself.
 */
const ANDROID_ROLES: Readonly<Record<TypeRole, RoleSpec>> = {
  screenTitle: { size: 28, lineHeight: 36, weight: "semibold", face: "ui" },
  screenTitlePushed: {
    size: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
    weight: "semibold",
    face: "ui",
  },
  detailTitle: { size: 24, lineHeight: 32, letterSpacing: -0.3, weight: "bold", face: "display" },
  statHero: { size: 36, lineHeight: 44, weight: "bold", face: "display" },
  sectionHeading: { size: 22, lineHeight: 28, letterSpacing: -0.2, weight: "semibold", face: "ui" },
  identity: { size: 16, lineHeight: 24, letterSpacing: 0.15, weight: "semibold", face: "ui" },
  rowTitle: { size: 16, lineHeight: 24, letterSpacing: 0.1, weight: "regular", face: "ui" },
  rowTitleSecondary: {
    size: 14,
    lineHeight: 20,
    letterSpacing: 0.25,
    weight: "medium",
    face: "ui",
  },
  meta: { size: 12, lineHeight: 16, letterSpacing: 0.4, weight: "regular", face: "ui" },
  caption: { size: 12, lineHeight: 16, letterSpacing: 0.5, weight: "medium", face: "ui" },
  micro: { size: 11, lineHeight: 16, letterSpacing: 0.5, weight: "bold", face: "ui" },
};

const ROLES = Platform.OS === "ios" ? IOS_ROLES : ANDROID_ROLES;

const UI_FACE: Readonly<Record<TypeWeight, TextStyle>> = {
  regular: { fontFamily: "Inter_400Regular" },
  medium: { fontFamily: "Inter_500Medium" },
  semibold: { fontFamily: "Inter_600SemiBold" },
  bold: { fontFamily: "Inter_700Bold" },
};

const SYSTEM_FACE: Readonly<Record<TypeWeight, TextStyle>> = {
  regular: { fontWeight: "400" },
  medium: { fontWeight: "500" },
  semibold: { fontWeight: "600" },
  bold: { fontWeight: "700" },
};

const DISPLAY_FACE: TextStyle = { fontFamily: "SpaceGrotesk_700Bold" };

function faceStyle(face: Face, weight: TypeWeight): TextStyle {
  if (face === "display") return DISPLAY_FACE;
  return face === "system" ? SYSTEM_FACE[weight] : UI_FACE[weight];
}

function byRole<T>(build: (spec: RoleSpec) => T): Readonly<Record<TypeRole, T>> {
  return Object.fromEntries(
    Object.entries(ROLES).map(([role, spec]) => [role, build(spec)]),
  ) as Record<TypeRole, T>;
}

const BASE = byRole((spec) => ({
  fontSize: spec.size,
  lineHeight: spec.lineHeight,
  ...(spec.letterSpacing === undefined ? null : { letterSpacing: spec.letterSpacing }),
  ...faceStyle(spec.face, spec.weight),
}));

/**
 * Section labels, day sub-headers and the marquee's lead-in: a role set in caps
 * and tracked out. Tracking is stated in ems by both style sheets and React
 * Native takes points, so it is resolved against the role's own size.
 */
const EYEBROW_TRACKING_EM = Platform.OS === "ios" ? 0.06 : 0.08;
const EYEBROW = byRole<TextStyle>((spec) => ({
  textTransform: "uppercase",
  letterSpacing: spec.size * EYEBROW_TRACKING_EM,
}));

const TABULAR: TextStyle = { fontVariant: ["tabular-nums"] };

export interface CueTextProps extends TextProps {
  /** One of the eleven roles. Spelled `variant` because `role` is the ARIA prop. */
  readonly variant: TypeRole;
  /** Overrides the role's own weight, which is the design's emphasis axis. */
  readonly weight?: TypeWeight;
  readonly eyebrow?: boolean;
  /** For counts, times and episode codes, so digits do not shift as they change. */
  readonly tabularNums?: boolean;
}

/** Text at one of the eleven roles, and the only way this app draws type. */
export function CueText({
  variant,
  weight,
  eyebrow = false,
  tabularNums = false,
  style,
  ...rest
}: CueTextProps): ReactElement {
  return (
    <Text
      dynamicTypeRamp={RAMP[variant]}
      style={[
        BASE[variant],
        weight === undefined ? null : faceStyle(ROLES[variant].face, weight),
        eyebrow ? EYEBROW[variant] : null,
        tabularNums ? TABULAR : null,
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * True once the five faces are in, or once loading them has failed. A face that
 * will not load falls back to the platform's own, which is a worse-looking app
 * and not a reason to hold a blank screen forever.
 */
export function useCueFonts(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_700Bold,
  });
  return loaded || error !== null;
}
