import { router, Stack } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Platform, View } from "react-native";
import EpisodeRoute from "../../app/(tabs)/(up-next,library,calendar,search)/show/[showId]/episode/[season]/[episode]";
import { HARNESS_IDS } from "../../src/ui/harness-ids";
import { useEpisodeSheetOptions } from "../../src/ui/navigation-theme";
import { TEST_IDS } from "../../src/ui/test-ids";
import { QueryProvider } from "../support/query-provider";

jest.mock("../../src/screens/EpisodeSheet", () => {
  const { createElement } = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  const { TEST_IDS } = require("../../src/ui/test-ids") as typeof import("../../src/ui/test-ids");
  return { EpisodeSheet: () => createElement(View, { testID: TEST_IDS.episodeSheet }) };
});
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

afterEach(() => jest.useRealTimers());

it("acknowledges only a completed presentation, retains it, and starts fresh on reopening", async () => {
  jest.useFakeTimers();
  await renderRouter(
    {
      _layout: () => (
        <Stack>
          <Stack.Screen name="index" />
          <Stack.Screen
            name="show/[showId]/episode/[season]/[episode]"
            options={useEpisodeSheetOptions()}
          />
        </Stack>
      ),
      index: () => <View />,
      "show/[showId]/episode/[season]/[episode]": EpisodeRoute,
    },
    { initialUrl: "/", wrapper: QueryProvider },
  );
  await act(() => router.push("/show/8803/episode/2/3"));
  const nativeSheet = screen.container.queryAll(
    (node) =>
      node.type === (Platform.OS === "ios" ? "RNSModalScreen" : "RNSScreen") &&
      node.queryAll((child) => child.props["testID"] === TEST_IDS.episodeSheet).length > 0,
  )[0];
  expect(nativeSheet).toBeDefined();
  if (nativeSheet === undefined) throw new Error("Missing native episode sheet");
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
  await act(() => router.push("/show/8803/episode/2/3"));
  expect(screen.getByTestId(TEST_IDS.episodeSheet)).toBeOnTheScreen();
  expect(screen.queryByTestId(HARNESS_IDS.sheetPresented)).toBeNull();
});
