import { recentCalendarStart } from "@cue/core/domain/calendar";
import { dayKeyOf } from "@cue/core/domain/day";
import { localTimeZone } from "@cue/core/domain/time";
import { calendarQuery, recentlyAiredQuery } from "@cue/core/queries/calendar";
import { libraryQuery, movieLibraryQuery } from "@cue/core/queries/library";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { configure, measureRenders } from "reassure";
import { ShowTile } from "../src/screens/library/LibraryTile";
import { TEST_IDS } from "../src/ui/test-ids";
import { entry } from "./support/perf-up-next";
import { fakeRuntime, Harness, resetSharedStores, spyHaptics } from "./support/up-next";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: Text, Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) };
});
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("../src/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ pull: jest.fn(), refreshing: false, sync: jest.fn() }),
}));
jest.mock("../src/platform/stores", () => ({
  preferenceStorage: { getItem: () => null, setItem: jest.fn(), clearNamespace: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

const runtime = fakeRuntime({ entries: [entry] });
const haptics = spyHaptics();
const TILE_WIDTH = 112;

function seed(client: QueryClient, cue: CueRuntime): void {
  resetSharedStores();
  const today = dayKeyOf(localTimeZone(), Date.now());
  const emptyCalendar = { entries: [], hiddenShowIds: [] };
  client.setQueryData(libraryQuery(cue).queryKey, { entries: [entry] });
  client.setQueryData(movieLibraryQuery(cue).queryKey, { entries: [] });
  client.setQueryData(calendarQuery(cue, today).queryKey, emptyCalendar);
  client.setQueryData(recentlyAiredQuery(cue, recentCalendarStart(today)).queryKey, emptyCalendar);
}

function PerfHarness({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <Harness runtime={runtime} haptics={haptics} seed={(client) => seed(client, runtime)}>
      {children}
    </Harness>
  );
}

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
