import { render } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import AccountLayout from "../app/(account)/_layout";
import { TabStack } from "../src/TabStack";
import { RADIUS } from "../src/ui/tokens";
import { atFontScale } from "./support/font-scale";

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
  return { Stack, useRouter: () => ({ dismissAll: jest.fn() }) };
});

/** The episode sheet as each host presents it, one read per host. */
async function sheetsAt(fontScale: number): Promise<SheetOptions[]> {
  atFontScale(fontScale);
  const hosts = [
    <TabStack key="tab" root="index" title="Up Next" />,
    <AccountLayout key="account" />,
  ];
  const sheets: SheetOptions[] = [];
  for (const host of hosts) {
    mockScreens.clear();
    await render(host);
    sheets.push(mockScreens.get(EPISODE) ?? {});
  }
  return sheets;
}

it.each([
  [1, 0],
  [1.3, 1],
])("opens the episode sheet the same way from every stack at text scale %s", async (scale, detent) => {
  const [tab, account] = await sheetsAt(scale);

  expect(tab?.sheetInitialDetentIndex).toBe(detent);
  expect(tab?.sheetCornerRadius).toBe(RADIUS.sheet);
  expect(account).toEqual(tab);
});
