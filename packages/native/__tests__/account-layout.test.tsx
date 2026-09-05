import { router, Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { View } from "react-native";
import * as accountLayout from "../app/(account)/_layout";

/**
 * Done dismisses the modal, asserted by dismissing it.
 *
 * `dismissAll()` dispatches `POP_TO_TOP`, which the account stack declines
 * because Profile is its initial route, and the root stack then pops the whole
 * group. A mocked `useRouter` would only assert that a method with that name
 * was called, which passes just as happily for one that dismisses nothing, so
 * the tree below is the smallest one that reproduces what the composition root
 * presents: the account group as a full-screen modal over the tabs.
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

describe("the account stack", () => {
  it("dismisses the modal back to where the user was", async () => {
    await renderRouter(routes, { initialUrl: "/" });

    await act(() => router.push("/profile"));
    expect(screen.getByTestId("screen-profile")).toBeOnTheScreen();

    // Case-insensitive: React Native renders an Android button title in capitals.
    await fireEvent.press(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByTestId("screen-profile")).toBeNull();
    expect(screen.getByTestId("screen-tabs")).toBeOnTheScreen();
  });
});
