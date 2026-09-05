import { render, screen } from "@testing-library/react-native";
import { Platform, type StyleProp, StyleSheet, type TextStyle, View } from "react-native";
import { CueText, type TypeRole } from "../../src/ui/type";

const ROLES: readonly TypeRole[] = [
  "screenTitle",
  "screenTitlePushed",
  "detailTitle",
  "statHero",
  "sectionHeading",
  "identity",
  "rowTitle",
  "rowTitleSecondary",
  "meta",
  "caption",
  "micro",
];

/** The five faces `useCueFonts` loads, and the only ones a role may name. */
const LOADED = [
  "Inter_400Regular",
  "Inter_500Medium",
  "Inter_600SemiBold",
  "Inter_700Bold",
  "SpaceGrotesk_700Bold",
];

interface RenderedText {
  readonly dynamicTypeRamp?: string;
  readonly maxFontSizeMultiplier?: number;
  readonly style?: StyleProp<TextStyle>;
}

function propsOf(testID: string): RenderedText {
  return screen.getByTestId(testID).props;
}

function styleOf(testID: string): TextStyle {
  return StyleSheet.flatten(propsOf(testID).style);
}

async function renderRoles() {
  await render(
    <View>
      {ROLES.map((role) => (
        <CueText key={role} variant={role} testID={role}>
          Salt Air
        </CueText>
      ))}
    </View>,
  );
}

it("scales every role, caps none, draws nothing below 11 and names only a loaded face", async () => {
  await renderRoles();

  for (const role of ROLES) {
    const style = styleOf(role);

    expect(propsOf(role).dynamicTypeRamp).toBeDefined();
    expect(propsOf(role).maxFontSizeMultiplier).toBeUndefined();
    expect(style.fontSize).toBeGreaterThanOrEqual(11);
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize ?? 0);
    // The two roles the navigation stack draws take the platform's own face.
    if (style.fontFamily !== undefined) expect(LOADED).toContain(style.fontFamily);
  }
});

it("changes the face on the weight axis and leaves the size alone", async () => {
  await render(
    <View>
      <CueText variant="rowTitle" weight="regular" testID="plain">
        Salt Air
      </CueText>
      <CueText variant="rowTitle" weight="semibold" testID="emphasized">
        Salt Air
      </CueText>
    </View>,
  );

  expect(styleOf("emphasized").fontFamily).toBe("Inter_600SemiBold");
  expect(styleOf("emphasized").fontFamily).not.toBe(styleOf("plain").fontFamily);
  expect(styleOf("emphasized").fontSize).toBe(styleOf("plain").fontSize);
});

it("sets an eyebrow in caps, tracked out against its own role's size", async () => {
  await render(
    <View>
      <CueText variant="meta" testID="meta">
        On the way
      </CueText>
      <CueText variant="meta" eyebrow testID="meta-eyebrow">
        On the way
      </CueText>
      <CueText variant="micro" eyebrow testID="micro-eyebrow">
        Aired last night
      </CueText>
    </View>,
  );

  expect(styleOf("meta").textTransform).toBeUndefined();
  expect(styleOf("meta-eyebrow").textTransform).toBe("uppercase");
  expect(styleOf("meta-eyebrow").letterSpacing).toBeGreaterThan(0);
  expect(styleOf("micro-eyebrow").letterSpacing).toBeLessThan(
    styleOf("meta-eyebrow").letterSpacing ?? 0,
  );
});

it("puts counts on tabular figures only when asked", async () => {
  await render(
    <View>
      <CueText variant="caption" testID="plain">
        3 left
      </CueText>
      <CueText variant="caption" tabularNums testID="tabular">
        3 left
      </CueText>
    </View>,
  );

  expect(styleOf("tabular").fontVariant).toEqual(["tabular-nums"]);
  expect(styleOf("plain").fontVariant).toBeUndefined();
});

it("emphasizes row titles by default", async () => {
  await render(<CueText variant="rowTitle">Salt Air</CueText>);
  expect(screen.getByText("Salt Air")).toHaveStyle({ fontFamily: "Inter_600SemiBold" });
});

const APPLE_LARGE: Readonly<Record<string, readonly [number, number]>> = {
  largeTitle: [34, 41],
  title1: [28, 34],
  title2: [22, 28],
  title3: [20, 25],
  headline: [17, 22],
  body: [17, 22],
  callout: [16, 21],
  subheadline: [15, 20],
  footnote: [13, 18],
  caption1: [12, 16],
  caption2: [11, 13],
};

const MATERIAL_3 = {
  displaySmall: [36, 44],
  headlineMedium: [28, 36],
  headlineSmall: [24, 32],
  titleLarge: [22, 28],
  titleMedium: [16, 24],
  bodyLarge: [16, 24],
  bodyMedium: [14, 20],
  bodySmall: [12, 16],
  labelMedium: [12, 16],
  labelSmall: [11, 16],
} as const;

const MATERIAL_ROLE: Readonly<Record<TypeRole, keyof typeof MATERIAL_3>> = {
  screenTitle: "headlineMedium",
  screenTitlePushed: "titleLarge",
  detailTitle: "headlineSmall",
  statHero: "displaySmall",
  sectionHeading: "titleLarge",
  identity: "titleMedium",
  rowTitle: "bodyLarge",
  rowTitleSecondary: "bodyMedium",
  meta: "bodySmall",
  caption: "labelMedium",
  micro: "labelSmall",
};

it("uses the platform default size and line height for each mapped text style", async () => {
  await renderRoles();
  for (const role of ROLES) {
    const style = styleOf(role);
    const metrics =
      Platform.OS === "ios"
        ? APPLE_LARGE[propsOf(role).dynamicTypeRamp ?? ""]
        : MATERIAL_3[MATERIAL_ROLE[role]];
    expect({ role, metrics: [style.fontSize, style.lineHeight] }).toEqual({ role, metrics });
  }
});
