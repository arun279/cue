import { render, screen } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { Platform, Text } from "react-native";
import AccountLayout from "../app/(account)/_layout";
import { AccountScreen } from "../src/screens/account/Rows";

interface HeaderOptions {
  readonly headerStyle?: unknown;
  readonly headerTransparent?: boolean;
  readonly headerShadowVisible?: boolean;
}

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

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

it("leaves every iOS account bar to the system and draws Android's flat", async () => {
  await render(<AccountLayout />);

  expect(mockStackOptions?.headerStyle).toBeUndefined();
  expect(mockStackOptions?.headerShadowVisible).toBe(Platform.OS === "ios" ? undefined : false);
});

it("insets account content by the bar floating over it on iOS, and lays Android's bar out above it", async () => {
  await render(<AccountLayout />);
  await render(
    <AccountScreen testID="account-content">
      <Text>row</Text>
    </AccountScreen>,
  );

  if (Platform.OS === "ios") {
    expect(mockStackOptions?.headerTransparent).toBe(true);
    expect(screen.getByTestId("account-content")).toHaveProp(
      "contentInsetAdjustmentBehavior",
      "automatic",
    );
  } else {
    expect(mockStackOptions?.headerTransparent).toBe(false);
  }
});
