import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { router, Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { View } from "react-native";
import * as accountLayout from "../app/(account)/_layout";

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

/**
 * The account modal over the tabs, presented the way the composition root
 * presents it.
 *
 * A real router rather than a mocked one, for both cases. `dismissAll()`
 * dispatches `POP_TO_TOP`, which the account stack declines because Profile is
 * its initial route, and the root stack then pops the whole group; a mocked
 * `useRouter` would only assert that a method with that name was called, which
 * passes just as happily for one that dismisses nothing. The snackbar host is
 * the account group's own, so it only draws once the group is presented.
 */
const routes = {
  _layout: (): ReactElement => (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(account)" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  ),
  index: (): ReactElement => <View testID="screen-tabs" />,
  "(account)/_layout": accountLayout,
  "(account)/profile": (): ReactElement => <View testID="screen-profile" />,
  "(account)/settings": (): ReactElement => <View testID="screen-settings" />,
  "(account)/history": (): ReactElement => <View testID="screen-history" />,
};

const openAccount = async (): Promise<void> => {
  await renderRouter(routes, { initialUrl: "/" });
  await act(() => router.push("/profile"));
  expect(screen.getByTestId("screen-profile")).toBeOnTheScreen();
};

describe("the account stack", () => {
  beforeEach(() => dismissSnack());

  it("dismisses the modal back to where the user was", async () => {
    await openAccount();

    // Case-insensitive: React Native renders an Android button title in capitals.
    await fireEvent.press(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByTestId("screen-profile")).toBeNull();
    expect(screen.getByTestId("screen-tabs")).toBeOnTheScreen();
  });

  it("draws snackbar feedback inside the modal", async () => {
    await openAccount();

    await act(async () => showSnack({ message: "Removed 1 play, 2 remain" }));

    expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Removed 1 play, 2 remain");
  });
});
