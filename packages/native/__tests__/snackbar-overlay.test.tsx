import { dismissSnack, showSnack } from "@cue/core/stores/snackbar-store";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import AccountLayout from "../app/(account)/_layout";
import EpisodeRoute from "../app/(tabs)/(up-next,library,calendar,search)/show/[showId]/episode/[season]/[episode]";
import { TEST_IDS } from "../src/ui/test-ids";
import { SPACE, tabBarClearance } from "../src/ui/tokens";
import { accountFixture } from "./support/account";
import { DetailHarness } from "./support/detail";

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
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("expo-image", () => require("./support/detail").imageModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

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

it.each([
  ["episode sheet", TEST_IDS.episodeSheet],
  ["account modal", TEST_IDS.screenProfile],
])("keeps the %s content layout unchanged while feedback appears and disappears", async (name, id) => {
  if (name === "episode sheet") {
    await render(<EpisodeRoute />, { wrapper: DetailHarness });
    await screen.findByTestId(TEST_IDS.episodePagerNext);
    await fireEvent(screen.getByTestId(id), "layout", {
      nativeEvent: { layout: { width: 390, height: 600, x: 0, y: 0 } },
    });
  } else {
    await accountFixture().paint(<AccountLayout />);
    await screen.findByText("Jo Taylor");
    await screen.findByTestId(TEST_IDS.profileEpisodeCount);
  }
  expect(screen.queryByTestId(TEST_IDS.snackbar)).toBeNull();
  expect(screen.getByTestId(id)).toHaveProp(
    "contentContainerStyle",
    expect.objectContaining({ paddingBottom: tabBarClearance(0) + SPACE.s4 }),
  );
  const before = contentLayout(id);

  await act(() =>
    showSnack({ message: "Removed play", actions: [{ label: "Undo", onPress: jest.fn() }] }),
  );

  expect(screen.getAllByTestId(TEST_IDS.snackbar)).toHaveLength(1);
  expect(screen.getByTestId(TEST_IDS.snackbar)).toHaveStyle({ position: "absolute", bottom: 8 });
  const content = screen.getByTestId(id);
  expect(content.parent?.parent).toContainElement(screen.getByTestId(TEST_IDS.snackbar));
  expect(contentLayout(id)).toEqual(before);

  await act(() => dismissSnack());

  expect(screen.queryByTestId(TEST_IDS.snackbar)).toBeNull();
  expect(contentLayout(id)).toEqual(before);
});
