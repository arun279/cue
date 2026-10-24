import { libraryQuery } from "@cue/core/queries/library";
import { fireEvent } from "@testing-library/react-native";
import { measureRenders } from "reassure";
import { TEST_IDS } from "../src/ui/test-ids";
import { largeLibrary } from "./support/large-library";
import { perfHarness } from "./support/perf";
import { seedCalendars } from "./support/perf-up-next";
import { fakeRuntime, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);
jest.mock("../src/platform/stores", () => require("./support/native-ui").preferenceStorageModule());
jest.mock("react-native-safe-area-context", () => require("./support/native-ui").safeAreaModule());

const entries = largeLibrary(600);
const runtime = fakeRuntime({ entries });

const PerfHarness = perfHarness(runtime, (client) => {
  resetSharedStores();
  client.setQueryData(libraryQuery(runtime).queryKey, { entries });
  seedCalendars(client, runtime);
});

const { default: Library } = require("../app/(tabs)/(library)/library");

test("Library first mount", async () => {
  const { meanCount } = await measureRenders(
    <PerfHarness>
      <Library />
    </PerfHarness>,
    {
      runs: 20,
      // FlatList renders more cells after layout on a 50 ms timer. Held timers keep
      // that render out of every run, not just the runs fast enough to beat it.
      beforeEach: () => {
        jest.useFakeTimers();
      },
      afterEach: () => {
        jest.useRealTimers();
      },
      scenario: async (screen) => {
        await fireEvent(screen.getByTestId(TEST_IDS.libraryGrid), "layout", {
          nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
        });
        await fireEvent.press(screen.getByTestId(TEST_IDS.libraryChipNotStarted));
      },
    },
  );

  expect(meanCount).toBe(3);
});
