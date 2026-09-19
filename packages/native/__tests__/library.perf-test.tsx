import { libraryQuery, movieLibraryQuery } from "@cue/core/queries/library";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react-native";
import { measureRenders } from "reassure";
import { ShowTile } from "../src/screens/library/LibraryTile";
import { TEST_IDS } from "../src/ui/test-ids";
import { perfHarness } from "./support/perf";
import { entry, seedCalendars } from "./support/perf-up-next";
import { fakeRuntime, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);
jest.mock("../src/platform/stores", () => require("./support/native-ui").preferenceStorageModule());
jest.mock("react-native-safe-area-context", () => require("./support/native-ui").safeAreaModule());

const runtime = fakeRuntime({ entries: [entry] });
const TILE_WIDTH = 112;

function seed(client: QueryClient, cue: CueRuntime): void {
  resetSharedStores();
  client.setQueryData(libraryQuery(cue).queryKey, { entries: [entry] });
  client.setQueryData(movieLibraryQuery(cue).queryKey, { entries: [] });
  seedCalendars(client, cue);
}

const PerfHarness = perfHarness(runtime, (client) => seed(client, runtime));

const { default: Library } = require("../app/(tabs)/(library)/library");

test("library tile", async () => {
  await measureRenders(
    <PerfHarness>
      <ShowTile entry={entry} chip="watching" width={TILE_WIDTH} onScreen />
    </PerfHarness>,
  );
});

test("Library screen", async () => {
  await measureRenders(
    <PerfHarness>
      <Library />
    </PerfHarness>,
    {
      scenario: async (screen) =>
        fireEvent.press(screen.getByTestId(TEST_IDS.libraryChipWatchlist)),
    },
  );
});
