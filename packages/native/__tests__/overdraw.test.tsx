import { act, screen } from "@testing-library/react-native";
import { router, ThemeProvider } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import * as SystemUI from "expo-system-ui";
import type { ReactElement } from "react";
import { type ColorValue, Platform, processColor, StyleSheet } from "react-native";
import { RootStack } from "../src/RootStack";
import { useNavigationTheme } from "../src/ui/navigation-theme";
import { PALETTE } from "../src/ui/tokens";
import { useWindowBackground } from "../src/ui/useWindowBackground";
import { entry, fakeRuntime, Harness, spyHaptics } from "./support/up-next";

jest.mock("expo-system-ui", () => ({ setBackgroundColorAsync: jest.fn(async () => {}) }));
// expo-router's test setup swaps Reanimated for its partial mock; the skeletons need the real one.
jest.mock("react-native-reanimated/mock", () => jest.requireActual("react-native-reanimated"));
jest.mock("../src/ui/BarItems", () => ({ BarItems: () => null }));

const tabs = ["(up-next)", "(library)", "(calendar)", "(search)"] as const;
const roots = {
  "(up-next)": ["index", require("../app/(tabs)/(up-next)").default],
  "(library)": ["library", require("../app/(tabs)/(library)/library").default],
  "(calendar)": ["calendar", () => null],
  "(search)": ["search", () => null],
} as const;

function Shell(): ReactElement {
  useWindowBackground();
  return (
    <ThemeProvider value={useNavigationTheme()}>
      <RootStack />
    </ThemeProvider>
  );
}

async function paintTabs(): Promise<void> {
  await renderRouter(
    {
      _layout: Shell,
      "(tabs)/_layout": require("../app/(tabs)/_layout").default,
      ...Object.fromEntries(
        tabs.flatMap((tab) => [
          [`(tabs)/${tab}/_layout`, require(`../app/(tabs)/${tab}/_layout`).default],
          [`(tabs)/${tab}/${roots[tab][0]}`, roots[tab][1]],
        ]),
      ),
    },
    {
      initialUrl: "/",
      wrapper: ({ children }) => (
        <Harness runtime={fakeRuntime({ entries: [entry()] })} haptics={spyHaptics()}>
          {children}
        </Harness>
      ),
    },
  );
  await act(async () => {});
}

type Drawn = ReturnType<typeof screen.getByTestId>;

const opaque = (color: ColorValue | undefined): boolean => {
  const packed = processColor(color);
  return typeof packed === "number" && packed >>> 24 === 255;
};

function fillsUnder(leaf: Drawn): number {
  let fills = 0;
  for (let node: Drawn | null = leaf; node !== null; node = node.parent) {
    const { backgroundColor } = StyleSheet.flatten(node.props["style"] ?? {});
    fills += [backgroundColor, node.props["nativeContainerBackgroundColor"]].filter(opaque).length;
  }
  return fills;
}

/** The most opaque fills stacked under any one drawn view on screen, the window aside. */
function deepestFills(): number {
  const leaves = screen.container.queryAll(
    (node) =>
      typeof node.type === "string" && node.children.every((child) => typeof child === "string"),
  );
  return Math.max(...leaves.map(fillsUnder));
}

const onAndroid = Platform.OS === "android" ? it : it.skip;

onAndroid("paints the screen once, with the window, and fills no navigator layer", async () => {
  await paintTabs();

  expect(SystemUI.setBackgroundColorAsync).toHaveBeenLastCalledWith(PALETTE.bg.light);
  expect(fillsUnder(await screen.findByTestId(/^queue-row-\d+$/))).toBe(0);
});

onAndroid.each([
  ["Up Next", "/", /^queue-row-\d+$/, 3],
  ["Library", "/library", /^show-card-/, 2],
] as const)(
  "stacks no more fills over the window on %s than its own views need",
  async (_name, path, drawn, most) => {
    await paintTabs();
    await act(async () => router.navigate(path));
    await screen.findByTestId(drawn);

    expect(deepestFills()).toBeLessThanOrEqual(most);
  },
);
