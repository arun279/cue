import { router, Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Platform, View } from "react-native";
import MonthJumpRoute from "../../app/(account)/history-jump";
import EpisodeRoute from "../../app/(tabs)/(up-next,library,calendar,search)/show/[showId]/episode/[season]/[episode]";
import { HARNESS_IDS } from "../../src/ui/harness-ids";
import { useEpisodeSheetOptions, useMonthJumpSheetOptions } from "../../src/ui/navigation-theme";
import { TEST_IDS } from "../../src/ui/test-ids";
import { QueryProvider } from "../support/query-provider";

jest.mock("../../src/screens/EpisodeSheet", () => {
  const { createElement } = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  const { TEST_IDS } = require("../../src/ui/test-ids") as typeof import("../../src/ui/test-ids");
  return { EpisodeSheet: () => createElement(View, { testID: TEST_IDS.episodeSheet }) };
});
jest.mock("@expo/ui/swift-ui", () => require("../support/native-ui").swiftUiModule());
jest.mock("@expo/ui/jetpack-compose", () => require("../support/native-ui").composeModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

afterEach(() => jest.useRealTimers());

it.each([
  { href: "/show/8803/episode/2/3", sheetId: TEST_IDS.episodeSheet },
  { href: "/history-jump", sheetId: TEST_IDS.historyJumpSheet },
] as const)("$href acknowledges only a completed presentation, retains it, and starts fresh on reopening", async ({
  href,
  sheetId,
}) => {
  jest.useFakeTimers();
  await renderRouter(
    {
      _layout: () => (
        <Stack>
          <Stack.Screen name="index" />
          <Stack.Screen name="history-jump" options={useMonthJumpSheetOptions()} />
          <Stack.Screen
            name="show/[showId]/episode/[season]/[episode]"
            options={useEpisodeSheetOptions()}
          />
        </Stack>
      ),
      index: () => <View />,
      "history-jump": MonthJumpRoute,
      "show/[showId]/episode/[season]/[episode]": EpisodeRoute,
    },
    { initialUrl: "/", wrapper: QueryProvider },
  );
  await act(() => router.push(href));
  const nativeSheet = screen.container.queryAll(
    (node) =>
      node.type === (Platform.OS === "ios" ? "RNSModalScreen" : "RNSScreen") &&
      node.queryAll((child) => child.props["testID"] === sheetId).length > 0,
  )[0];
  expect(nativeSheet).toBeDefined();
  if (nativeSheet === undefined) throw new Error("Missing native sheet");
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
  await fireEvent(nativeSheet, "willAppear");
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
  await fireEvent(nativeSheet, "disappear");
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
  await fireEvent(nativeSheet, "appear");
  expect(screen.getByTestId(HARNESS_IDS.sheetPresented)).toBeOnTheScreen();
  await fireEvent(nativeSheet, "willDisappear");
  await fireEvent(nativeSheet, "disappear");
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(screen.getByTestId(HARNESS_IDS.sheetPresented)).toBeOnTheScreen();
  await act(() => router.back());
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
  await act(() => router.push(href));
  expect(screen.getByTestId(sheetId)).toBeOnTheScreen();
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
});
