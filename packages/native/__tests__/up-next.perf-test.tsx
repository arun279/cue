import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { libraryQuery } from "@cue/core/queries/library";
import { showInfoQuery } from "@cue/core/queries/shows";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react-native";
import { type ReactElement, useState } from "react";
import { measureRenders } from "reassure";
import { QueueRow } from "../src/screens/up-next/QueueRow";
import { CheckControl } from "../src/ui/CheckControl";
import { TEST_IDS } from "../src/ui/test-ids";
import { perfHarness } from "./support/perf";
import { cardOf, entry, seedCalendars } from "./support/perf-up-next";
import { fakeRuntime, resetSharedStores } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);
jest.mock("../src/hooks/usePullToRefresh", () =>
  require("./support/native-ui").pullToRefreshModule(),
);
jest.mock("../src/platform/stores", () => require("./support/native-ui").preferenceStorageModule());
jest.mock("react-native-safe-area-context", () => require("./support/native-ui").safeAreaModule());

const runtime = fakeRuntime({ entries: [entry], submit: () => Promise.resolve("deferred") });

function seed(client: QueryClient, cue: CueRuntime): void {
  resetSharedStores();
  client.setQueryData(libraryQuery(cue).queryKey, { entries: [entry] });
  seedCalendars(client, cue);
  client.setQueryData(showInfoQuery(cue, entry.showId).queryKey, {
    ids: { trakt: entry.showId },
    title: entry.title,
    year: null,
    status: entry.status,
    network: null,
    genres: [],
    runtime: null,
    overview: null,
    posters: [],
    backdrops: [],
  });
}

const PerfHarness = perfHarness(runtime, (client) => seed(client, runtime));

function MeasuredQueueRow(): ReactElement {
  const mark = useMarkWatched();
  return <QueueRow card={cardOf(false)} mark={mark} onStop={jest.fn()} />;
}

function InteractiveCheckControl(): ReactElement {
  const [checked, setChecked] = useState(false);
  return (
    <CheckControl
      checked={checked}
      label="Mark Salt Air watched"
      testID={TEST_IDS.queueRowMark(entry.showId)}
      onPress={() => setChecked(true)}
    />
  );
}

const { default: UpNext } = require("../app/(tabs)/(up-next)");

test("queue row", async () => {
  await measureRenders(
    <PerfHarness>
      <MeasuredQueueRow />
    </PerfHarness>,
    {
      scenario: async (screen) =>
        fireEvent.press(screen.getByTestId(TEST_IDS.queueRowMark(entry.showId))),
    },
  );
});

test("check control", async () => {
  await measureRenders(<InteractiveCheckControl />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.queueRowMark(entry.showId))),
  });
});

test("Up Next screen", async () => {
  await measureRenders(
    <PerfHarness>
      <UpNext />
    </PerfHarness>,
    {
      scenario: async (screen) =>
        fireEvent.press(screen.getByTestId(TEST_IDS.queueRowMark(entry.showId))),
    },
  );
});
