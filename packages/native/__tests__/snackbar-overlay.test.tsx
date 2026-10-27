import "./support/detail-mocks";
import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AccountLayout from "../app/(account)/_layout";
import EpisodeRoute from "../app/show/[showId]/episode/[season]/[episode]";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture } from "./support/account";
import { DetailHarness } from "./support/detail";

jest.unmock("react-native-safe-area-context");

jest.mock("expo-router", () => {
  const { createElement } = require("react") as typeof import("react");
  const native = require("./support/native-ui").expoRouterModule();
  return {
    ...native,
    Stack: Object.assign(() => createElement(require("../src/screens/Profile").default), {
      Screen: native.Stack.Screen,
      Toolbar: native.Stack.Toolbar,
    }),
    useLocalSearchParams: () => ({ showId: "8803", season: "2", episode: "3" }),
    useNavigation: () => ({ addListener: () => () => {} }),
  };
});

function contentLayout(testID: string) {
  const content = screen.getByTestId(testID);
  return {
    parentStyle: StyleSheet.flatten(content.parent?.props["style"]),
    nodes: [content, ...content.queryAll(() => true)].map((node) => ({
      type: node.type,
      testID: node.props["testID"],
      style: StyleSheet.flatten(node.props["style"]),
      contentContainerStyle: StyleSheet.flatten(node.props["contentContainerStyle"]),
      contentInset: node.props["contentInset"],
    })),
  };
}

function NavigationBarInset({ children }: { readonly children: ReactElement }): ReactElement {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 412, height: 915 },
        insets: { top: 0, right: 0, bottom: 48, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

it.each([
  ["episode sheet", TEST_IDS.episodeSheet, TEST_IDS.episodePagerNext, { ios: 8, android: 56 }],
  ["account modal", TEST_IDS.screenProfile, TEST_IDS.profileEpisodeCount, { ios: 56, android: 56 }],
])("keeps the %s content layout unchanged while feedback appears and disappears", async (name, id, last, bottom) => {
  if (name === "episode sheet") {
    await render(
      <NavigationBarInset>
        <EpisodeRoute />
      </NavigationBarInset>,
      { wrapper: DetailHarness },
    );
  } else {
    await accountFixture().paint(
      <NavigationBarInset>
        <AccountLayout />
      </NavigationBarInset>,
    );
    await screen.findByText("Jo Taylor");
  }
  await screen.findByTestId(last);
  expect(screen.queryByTestId(TEST_IDS.snackbar)).toBeNull();
  const before = contentLayout(id);
  expect(before.nodes.map((node) => node.testID)).toContain(last);

  await act(() =>
    showSnack({ message: "Removed play", actions: [{ label: "Undo", onPress: jest.fn() }] }),
  );

  expect(screen.getAllByTestId(TEST_IDS.snackbar)).toHaveLength(1);
  expect(screen.getByTestId(TEST_IDS.snackbar)).toHaveStyle({
    position: "absolute",
    bottom: Platform.select(bottom),
  });
  const content = screen.getByTestId(id);
  expect(content.parent?.parent).toContainElement(screen.getByTestId(TEST_IDS.snackbar));
  expect(contentLayout(id)).toEqual(before);

  await act(() => dismissSnack());

  expect(screen.queryByTestId(TEST_IDS.snackbar)).toBeNull();
  expect(contentLayout(id)).toEqual(before);
});

it.each([
  "ios",
  "android",
] as const)("keeps the %s episode sheet's pager and a one-line snackbar above the bottom inset and below the mark row", async (os) => {
  jest.replaceProperty(Platform, "OS", os);
  await render(
    <NavigationBarInset>
      <EpisodeRoute />
    </NavigationBarInset>,
    { wrapper: DetailHarness },
  );
  await screen.findByTestId(TEST_IDS.episodeMarkRow);
  await act(() =>
    showSnack({ message: "S2 E3 marked", actions: [{ label: "Undo", onPress: jest.fn() }] }),
  );

  const style = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props["style"]);
  const inset = os === "android" ? 48 : 0;
  const pagerBottom = Number(style(TEST_IDS.screenEpisode).paddingBottom);
  const markRowBottom =
    pagerBottom +
    Number(style(TEST_IDS.episodePagerNext).minHeight) +
    Number(
      StyleSheet.flatten(screen.getByTestId(TEST_IDS.episodeMarkRow).parent?.props["style"])
        .paddingBottom,
    );
  const snackbar = style(TEST_IDS.snackbar);
  const snackbarTop =
    Number(snackbar.bottom) +
    2 * Number(snackbar.paddingVertical) +
    Number(style(TEST_IDS.snackbarUndo).minHeight);
  expect(pagerBottom).toBeGreaterThanOrEqual(inset);
  expect(Number(snackbar.bottom)).toBeGreaterThan(inset);
  expect(snackbarTop).toBeLessThanOrEqual(markRowBottom);
});
