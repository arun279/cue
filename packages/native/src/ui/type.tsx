import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import { useFonts } from "expo-font";
import type { ReactElement } from "react";
import { Platform, type StyleProp, Text, type TextProps, type TextStyle } from "react-native";

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

type TypeWeight = "regular" | "medium" | "semibold" | "bold";

type Face = "ui" | "display" | "system";

interface RoleSpec {
  readonly size: number;
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly weight: TypeWeight;
  readonly face: Face;
}

// dynamicTypeRamp is what scales a custom face through UIFontMetrics on iOS.
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
  rowTitle: { size: 17, lineHeight: 22, letterSpacing: -0.2, weight: "semibold", face: "ui" },
  rowTitleSecondary: { size: 15, lineHeight: 20, weight: "medium", face: "ui" },
  meta: { size: 13, lineHeight: 18, weight: "medium", face: "ui" },
  caption: { size: 12, lineHeight: 16, weight: "regular", face: "ui" },
  micro: { size: 11, lineHeight: 13, weight: "bold", face: "ui" },
};

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
  rowTitle: { size: 16, lineHeight: 24, letterSpacing: 0.1, weight: "semibold", face: "ui" },
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

const EYEBROW_TRACKING_EM = Platform.OS === "ios" ? 0.06 : 0.08;
const EYEBROW = byRole<TextStyle>((spec) => ({
  textTransform: "uppercase",
  letterSpacing: spec.size * EYEBROW_TRACKING_EM,
}));

const TABULAR: TextStyle = { fontVariant: ["tabular-nums"] };

export function roleStyle(variant: TypeRole, weight?: TypeWeight): StyleProp<TextStyle> {
  return [BASE[variant], weight === undefined ? null : faceStyle(ROLES[variant].face, weight)];
}

export interface CueTextProps extends TextProps {
  readonly variant: TypeRole;
  readonly weight?: TypeWeight;
  readonly eyebrow?: boolean;
  readonly tabularNums?: boolean;
}

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
        roleStyle(variant, weight),
        eyebrow ? EYEBROW[variant] : null,
        tabularNums ? TABULAR : null,
        style,
      ]}
      {...rest}
    />
  );
}

export function useFontsSettled(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_700Bold,
  });
  return loaded || error !== null;
}
