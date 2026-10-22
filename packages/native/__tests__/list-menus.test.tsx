import type { CueRuntime } from "@cue/core/runtime/runtime";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { HistoryScreen } from "../src/screens/history/HistoryScreen";
import { historyEntry } from "./support/history";
import { LINK_MENU, MENU_HOST } from "./support/native-ui";
import { agesAgo, entry, fakeRuntime, Harness, spyHaptics } from "./support/up-next";

jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);
jest.mock("expo-router", () => require("./support/history").historyRouterModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);

const UpNext = (require("../app/(tabs)/(up-next)") as typeof import("../app/(tabs)/(up-next)"))
  .default;

const ROWS = 40;

const queue = Array.from({ length: ROWS }, (_, i) =>
  entry({ showId: 20_000 + i, title: `Show ${i}`, lastWatchedAt: agesAgo(1 + (i % 5)) }),
);
const plays = Array.from({ length: ROWS }, (_, i) =>
  historyEntry({
    historyId: 100 + i,
    mediaId: 600 + i,
    title: `Movie ${i}`,
    watchedAt: new Date(Date.UTC(2026, 7, 21, 20) - i * 3_600_000).toISOString(),
  }),
);

const LISTS: readonly (readonly [string, () => ReactElement, CueRuntime, RegExp])[] = [
  ["Up Next", () => <UpNext />, fakeRuntime({ entries: queue }), /^queue-row-\d+-body$/],
  [
    "History",
    () => <HistoryScreen />,
    {
      ...fakeRuntime({}),
      loadHistory: () => Promise.resolve({ entries: plays, page: 1, pageCount: 1 }),
    },
    /^history-row-\d+$/,
  ],
];

const count = (marker: string) =>
  screen.container.queryAll(
    (node) => node.props["nativeID"] === marker || node.props["testID"] === marker,
  ).length;

describe.each(LISTS)("%s rows", (_name, List, runtime, rowId) => {
  it("mount one platform menu per row and no native menu host until one is opened", async () => {
    await render(
      <Harness runtime={runtime} haptics={spyHaptics()}>
        <List />
      </Harness>,
    );
    await waitFor(() => expect(screen.queryAllByTestId(rowId).length).toBeGreaterThan(0));
    const rows = screen.queryAllByTestId(rowId).length;

    expect(count(MENU_HOST)).toBe(0);
    expect(count(LINK_MENU)).toBe(Platform.OS === "ios" ? rows : 0);

    if (Platform.OS === "android") {
      const [more] = screen.getAllByRole("button", { name: /^More actions for / });
      if (more !== undefined) await fireEvent.press(more);
      expect(count(MENU_HOST)).toBe(1);
    }
  });
});
