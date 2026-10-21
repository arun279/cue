import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { parseHistorySearch } from "@cue/core/url/search-params";
import { router, Stack, useLocalSearchParams, useNavigationContainerRef } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import type { ReactElement } from "react";
import { Platform, Text, View } from "react-native";
import * as accountLayout from "../app/(account)/_layout";
import MonthJumpRoute from "../app/(tabs)/(up-next,library,calendar,search)/history-jump";
import { enterFromOutside } from "../src/enter-from-outside";
import { MONTHS } from "../src/screens/history/model";
import { TabStack } from "../src/TabStack";
import { QueryProvider } from "./support/query-provider";

jest.mock("@expo/ui/jetpack-compose", () => require("./support/native-ui").composeModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

/**
 * The account modal over two tab stacks, presented the way the composition root
 * presents it, with History, the month jump and Settings registered in both the
 * tab stacks and the account stack as the app registers them. A plain stack
 * stands in for the native tabs, which this runner cannot draw.
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

const Blank = (): ReactElement => <View />;
const Settings = (): ReactElement => <View testID="screen-settings" />;

const routes = {
  _layout: (): ReactElement => (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(account)" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  ),
  "(tabs)/_layout": (): ReactElement => <Stack screenOptions={{ headerShown: false }} />,
  "(tabs)/(up-next)/_layout": (): ReactElement => <TabStack root="index" title="Up Next" />,
  "(tabs)/(up-next)/index": (): ReactElement => <View testID="screen-up-next" />,
  "(tabs)/(library)/_layout": (): ReactElement => <TabStack root="library" title="Library" />,
  "(tabs)/(library)/library": (): ReactElement => <View testID="screen-library" />,
  "(tabs)/(calendar)/_layout": (): ReactElement => <TabStack root="calendar" title="Calendar" />,
  "(tabs)/(calendar)/calendar": (): ReactElement => <View testID="screen-calendar" />,
  "(tabs)/(up-next,library)/history": HistoryScope,
  "(tabs)/(up-next,library)/history-jump": MonthJumpRoute,
  "(tabs)/(up-next,library)/settings": Settings,
  "(tabs)/(up-next,library)/show/[showId]": Blank,
  "(tabs)/(up-next,library)/movie/[movieId]": Blank,
  "(tabs)/(up-next,library)/show/[showId]/episode/[season]/[episode]": Blank,
  "(account)/_layout": accountLayout,
  "(account)/profile": (): ReactElement => <View testID="screen-profile" />,
  "(account)/settings": Settings,
  "(account)/history": HistoryScope,
  "(account)/history-jump": MonthJumpRoute,
  "(account)/show/[showId]": Blank,
  "(account)/movie/[movieId]": Blank,
  "(account)/show/[showId]/episode/[season]/[episode]": Blank,
};

/** Leaves Profile the way each platform's header offers: the UIKit Done item
 * the iOS header is handed, or on Android the up button, which react-native-screens
 * reports on the screen presenting a nested stack whose root it sits on. */
async function leaveProfile(): Promise<void> {
  if (Platform.OS === "android") {
    const presenting = screen.container.queryAll(
      (node) =>
        node.type === "RNSScreen" &&
        node.queryAll((child) => child.props["testID"] === "screen-profile").length > 0,
    )[0];
    expect(presenting).toBeDefined();
    if (presenting !== undefined) await fireEvent(presenting, "headerBackButtonClicked");
    return;
  }
  const header = screen.container.queryAll(
    (node) => node.type === "RNSScreenStackHeaderConfig" && node.props["title"] === "Profile",
  )[0];
  const items = header?.props["headerRightBarButtonItems"];
  expect(items).toEqual([
    expect.objectContaining({ type: "button", title: "Done", variant: "done" }),
  ]);
  if (header === undefined) return;
  await fireEvent(header, "pressHeaderBarButtonItem", {
    nativeEvent: { buttonId: items[0].buttonId },
  });
}

const openAccount = async (): Promise<void> => {
  await renderRouter(routes, { initialUrl: "/", wrapper: QueryProvider });
  await act(() => router.push("/profile"));
  expect(screen.getByTestId("screen-profile")).toBeOnTheScreen();
};

describe("the account stack", () => {
  beforeEach(() => dismissSnack());

  it("dismisses the modal back to where the user was from the platform's own header control", async () => {
    await openAccount();

    await leaveProfile();

    expect(screen.queryByTestId("screen-profile")).toBeNull();
    expect(screen.getByTestId("screen-up-next")).toBeOnTheScreen();
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

/** The sheet's close as each platform draws it: a bar item in the iOS sheet's own
 * header, or the Compose icon button in the Android sheet. */
async function closeSheet(): Promise<void> {
  if (Platform.OS === "android") {
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    return;
  }
  const header = screen.container.queryAll((node) =>
    (node.props["headerLeftBarButtonItems"] ?? []).some(
      (item: { accessibilityLabel?: string }) => item.accessibilityLabel === "Close",
    ),
  )[0];
  const [item] = header?.props["headerLeftBarButtonItems"] ?? [];
  expect(item).toBeDefined();
  if (header !== undefined)
    await fireEvent(header, "pressHeaderBarButtonItem", {
      nativeEvent: { buttonId: item.buttonId },
    });
}

/** The router's own record of where it is: render's result is a promise, and
 * expo-router hangs its location readers on the object it returned. */
async function renderAt(initialUrl: string): Promise<() => string[]> {
  const view = renderRouter(routes, { initialUrl, wrapper: QueryProvider });
  await view;
  return () => view.getSegments();
}

describe("a tab stack", () => {
  it.each([
    ["/", "(up-next)", "screen-up-next"],
    ["/library", "(library)", "screen-library"],
  ])("pushes History and Settings onto the tab at %s, and back returns to that tab", async (initialUrl, tab, origin) => {
    const segments = await renderAt(initialUrl);

    for (const pathname of ["/history", "/settings"] as const) {
      await act(() => router.push(pathname));
      expect(segments()).toEqual(["(tabs)", tab, pathname.slice(1)]);
      await act(() => router.back());
      expect(screen.getByTestId(origin)).toBeOnTheScreen();
    }
  });

  it("hands the month jump back to the History in the tab it came from", async () => {
    const segments = await renderAt("/");
    await act(() => router.push("/history?type=movies"));
    await act(() => router.push({ pathname: "/history-jump", params: { type: "movies" } }));

    await fireEvent.press(screen.getByTestId("history-jump-month-8"));

    expect(segments()).toEqual(["(tabs)", "(up-next)", "history"]);
    expect(screen.getByTestId("screen-history")).toHaveTextContent(
      JSON.stringify({ type: "movies", year: new Date().getFullYear(), month: 8 }),
    );
    await act(() => router.back());
    expect(screen.getByTestId("screen-up-next")).toBeOnTheScreen();
  });

  it("closes the month jump from its close button", async () => {
    const segments = await renderAt("/");
    await act(() => router.push("/history"));
    await act(() => router.push("/history-jump"));

    await closeSheet();

    expect(screen.queryByTestId("history-jump-sheet")).toBeNull();
    expect(segments()).toEqual(["(tabs)", "(up-next)", "history"]);
  });
});

describe("an entry from outside the app", () => {
  it("dismisses the account modal and its sheet before opening a tab", async () => {
    const segments = await renderAt("/");
    await act(() => router.push("/profile"));
    await act(() => router.push("/history"));
    await act(() => router.push("/history-jump"));

    await act(() => enterFromOutside(useNavigationContainerRef(), "/calendar"));

    expect(segments()).toEqual(["(tabs)", "(calendar)", "calendar"]);
    expect(screen.queryByTestId("screen-profile")).toBeNull();
    expect(screen.queryByTestId("history-jump-sheet")).toBeNull();
  });

  it("dismisses the current tab's sheet and pushes the target where back returns to the tab", async () => {
    const segments = await renderAt("/");
    await act(() => router.push("/history"));
    await act(() => router.push("/history-jump"));

    await act(() => enterFromOutside(useNavigationContainerRef(), "/show/7"));

    expect(segments()).toEqual(["(tabs)", "(up-next)", "show", "[showId]"]);
    await act(() => router.back());
    expect(segments()).toEqual(["(tabs)", "(up-next)"]);
  });
});
