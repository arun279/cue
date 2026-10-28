import { render } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { Platform } from "react-native";
import { RootStack } from "../src/RootStack";
import { RADIUS } from "../src/ui/tokens";
import { atFontScale } from "./support/font-scale";
import { QueryProvider } from "./support/query-provider";

const EPISODE = "show/[showId]/episode/[season]/[episode]";

interface SheetOptions {
  readonly sheetInitialDetentIndex?: number;
  readonly sheetCornerRadius?: number;
}

const mockScreens = new Map<string, SheetOptions>();

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");
jest.mock("expo-router", () => {
  const { createElement } = require("react") as typeof import("react");
  const { View: MockView } = require("react-native") as typeof import("react-native");
  const Stack = ({ children }: { readonly children: ReactNode }): ReactElement =>
    createElement(MockView, null, children);
  Stack.Screen = ({ name, options }: { name: string; options?: SheetOptions }): null => {
    mockScreens.set(name, options ?? {});
    return null;
  };
  Stack.Toolbar = require("./support/native-ui").toolbarModule();
  return { Stack, useNavigationContainerRef: () => ({}) };
});

it.each([
  [1, 0],
  [1.3, 1],
])("opens the episode sheet from the root stack at a detent that fits text scale %s", async (scale, detent) => {
  atFontScale(scale);

  await render(<RootStack />, { wrapper: QueryProvider });

  const sheet = mockScreens.get(EPISODE);
  expect(sheet?.sheetInitialDetentIndex).toBe(Platform.OS === "ios" ? detent : 0);
  expect(sheet?.sheetCornerRadius).toBe(RADIUS.sheet);
});
