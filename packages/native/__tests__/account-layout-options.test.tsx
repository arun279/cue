import { render } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import AccountLayout from "../app/(account)/_layout";

interface HeaderOptions {
  readonly headerStyle?: { readonly backgroundColor?: unknown };
  readonly headerLargeStyle?: { readonly backgroundColor?: unknown };
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

it("gives every account screen an opaque header in both appearances", async () => {
  await render(<AccountLayout />);

  expect(mockStackOptions?.headerStyle?.backgroundColor).toBeDefined();
  expect(mockStackOptions?.headerLargeStyle?.backgroundColor).toEqual(
    mockStackOptions?.headerStyle?.backgroundColor,
  );
});
