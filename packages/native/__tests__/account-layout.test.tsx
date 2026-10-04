import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { parseHistorySearch } from "@cue/core/url/search-params";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { act, fireEvent, renderRouter, screen, within } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import * as accountLayout from "../app/(account)/_layout";
import MonthJumpRoute from "../app/(account)/history-jump";
import { MONTHS } from "../src/screens/history/model";
import { PALETTE } from "../src/ui/tokens";

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
 * History is a stand-in that shows the scope it was handed, so the month jump
 * is read the way the real screen reads it.
 */
function HistoryScope(): ReactElement {
  return (
    <Text testID="screen-history">
      {JSON.stringify(parseHistorySearch(useLocalSearchParams()))}
    </Text>
  );
}

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
  "(account)/history": HistoryScope,
  "(account)/history-jump": MonthJumpRoute,
  "(account)/movie/[movieId]": (): ReactElement => <View />,
  "(account)/show/[showId]/episode/[season]/[episode]": (): ReactElement => <View />,
};

/** The accent ink as each platform hands it over: a dynamic pair on iOS, the
 * light value on Android, whose renderer runs in the light scheme. */
const accentInk = () =>
  Platform.OS === "ios" ? { dynamic: PALETTE.accentInk } : PALETTE.accentInk.light;

const openAccount = async (): Promise<void> => {
  await renderRouter(routes, { initialUrl: "/" });
  await act(() => router.push("/profile"));
  expect(screen.getByTestId("screen-profile")).toBeOnTheScreen();
};

describe("the account stack", () => {
  beforeEach(() => dismissSnack());

  it("dismisses the modal back to where the user was from an accent Done", async () => {
    await openAccount();

    const done = screen.getByRole("button", { name: "Done" });
    expect(StyleSheet.flatten(within(done).getByText("Done").props["style"]).color).toEqual(
      accentInk(),
    );
    await fireEvent.press(done);

    expect(screen.queryByTestId("screen-profile")).toBeNull();
    expect(screen.getByTestId("screen-tabs")).toBeOnTheScreen();
  });

  it("draws snackbar feedback inside the modal", async () => {
    await openAccount();

    await act(async () => showSnack({ message: "Removed 1 play, 2 remain" }));

    expect(screen.getByTestId("snackbar-message")).toHaveTextContent("Removed 1 play, 2 remain");
  });
});

describe("the month jump sheet", () => {
  async function openJump(): Promise<void> {
    await openAccount();
    await act(() => router.push("/history?type=movies&year=2025&month=3"));
    await act(() =>
      router.push({ pathname: "/history-jump", params: { type: "movies", year: 2025, month: 3 } }),
    );
  }

  it("marks the month History is showing", async () => {
    await openJump();

    expect(screen.getByTestId("history-jump-month-3")).toBeSelected();
    expect(screen.getByTestId("history-jump-year-2025")).toBeSelected();
    for (const month of MONTHS)
      expect(screen.getByRole("button", { name: month })).toBeOnTheScreen();
  });

  it.each([
    ["history-jump-month-8", { type: "movies", year: 2024, month: 8 }],
    ["history-jump-all", { type: "movies", year: 2024 }],
    ["history-jump-recent", { type: "movies" }],
  ])("hands %s back to the History below it and keeps the medium", async (testID, expected) => {
    await openJump();

    await fireEvent.press(screen.getByTestId("history-jump-year-2024"));
    await fireEvent.press(screen.getByTestId(testID));

    expect(screen.queryByTestId("history-jump-sheet")).toBeNull();
    expect(screen.getByTestId("screen-history")).toHaveTextContent(JSON.stringify(expected));
    await act(() => router.back());
    expect(screen.queryByTestId("screen-history")).toBeNull();
    expect(screen.getByTestId("screen-profile")).toBeOnTheScreen();
  });
});
