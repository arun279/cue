import { recentCalendarStart } from "@cue/core/domain/calendar";
import { dayKeyOf } from "@cue/core/domain/day";
import { localTimeZone } from "@cue/core/domain/time";
import { useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { calendarQuery, recentlyAiredQuery } from "@cue/core/queries/calendar";
import { libraryQuery } from "@cue/core/queries/library";
import { showInfoQuery } from "@cue/core/queries/shows";
import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react-native";
import { type ReactElement, type ReactNode, useState } from "react";
import { configure, measureRenders } from "reassure";
import { QueueRow } from "../src/screens/up-next/QueueRow";
import { CheckControl } from "../src/ui/CheckControl";
import { TEST_IDS } from "../src/ui/test-ids";
import { cardOf, entry } from "./support/perf-up-next";
import { fakeRuntime, Harness, resetSharedStores, spyHaptics } from "./support/up-next";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: Text, Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) };
});
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);
jest.mock("../src/hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ pull: jest.fn(), refreshing: false, sync: jest.fn() }),
}));
jest.mock("../src/platform/stores", () => ({
  preferenceStorage: { getItem: () => null, setItem: jest.fn(), clearNamespace: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));

const runtime = fakeRuntime({ entries: [entry], submit: () => Promise.resolve("deferred") });
const haptics = spyHaptics();

function seed(client: QueryClient, cue: CueRuntime): void {
  resetSharedStores();
  const today = dayKeyOf(localTimeZone(), Date.now());
  const emptyCalendar = { entries: [], hiddenShowIds: [] };
  client.setQueryData(libraryQuery(cue).queryKey, { entries: [entry] });
  client.setQueryData(calendarQuery(cue, today).queryKey, emptyCalendar);
  client.setQueryData(recentlyAiredQuery(cue, recentCalendarStart(today)).queryKey, emptyCalendar);
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

function PerfHarness({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <Harness runtime={runtime} haptics={haptics} seed={(client) => seed(client, runtime)}>
      {children}
    </Harness>
  );
}

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
