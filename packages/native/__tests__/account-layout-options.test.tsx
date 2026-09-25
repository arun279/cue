import { render } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { Platform } from "react-native";
import AccountLayout from "../app/(account)/_layout";

interface HeaderOptions {
  readonly headerStyle?: { readonly backgroundColor?: unknown };
  readonly headerTransparent?: boolean;
}

let mockStackOptions: HeaderOptions | undefined;

jest.mock("expo-router", () => {
  const { createElement } = require("react") as typeof import("react");
  const { View: MockView } = require("react-native") as typeof import("react-native");
  const Stack = ({
    children,
    screenOptions,
  }: {
    readonly children: ReactNode;
    readonly screenOptions?: HeaderOptions;
  }): ReactElement => {
    mockStackOptions = screenOptions;
    return createElement(MockView, null, children);
  };
  Stack.Screen = (): null => null;
  return { Stack, useRouter: () => ({ dismissAll: jest.fn() }) };
});

it("leaves every iOS account bar to the system and fills Android's with the page", async () => {
  await render(<AccountLayout />);

  if (Platform.OS === "ios") {
    expect(mockStackOptions?.headerStyle).toBeUndefined();
    expect(mockStackOptions?.headerTransparent).toBe(true);
  } else {
    expect(mockStackOptions?.headerStyle?.backgroundColor).toBeDefined();
    expect(mockStackOptions?.headerTransparent).toBe(false);
  }
});
