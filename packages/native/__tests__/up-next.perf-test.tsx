import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { UpNextCard, UpNextView } from "@cue/core/hooks/useUpNext";
import { fireEvent } from "@testing-library/react-native";
import { useState } from "react";
import { configure, measureRenders } from "reassure";
import { CheckControl } from "../src/ui/CheckControl";
import { TEST_IDS } from "../src/ui/test-ids";

configure({ testingLibrary: "react-native" });

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: Text };
});
jest.mock("@cue/core/hooks/useMarkWatched", () => ({
  useMarkWatched: () => ({
    mark: jest.fn(),
    reverse: jest.fn(),
    reArm: jest.fn(),
    justMarkedAt: () => null,
  }),
}));
jest.mock("@cue/core/hooks/useMarkControl", () => ({
  useMarkControl: () => {
    const { useState } = require("react");
    const [state, setState] = useState("unwatched");
    return {
      state,
      pending: false,
      label: "Mark Harbor Lights S3 E6 watched",
      onPress: () => setState("watched"),
    };
  },
}));
jest.mock("@cue/core/hooks/useSyncBanner", () => ({ useSyncBanner: () => null }));
jest.mock("@cue/core/hooks/useUpNext", () => ({ useUpNext: () => mockView }));

const entry: LibraryEntry = {
  showId: 8801,
  title: "Harbor Lights",
  status: "returning series",
  hidden: false,
  inWatchlist: false,
  lastWatchedAt: "2026-01-01T00:00:00.000Z",
  aired: 22,
  completed: 20,
  nextEpisode: {
    season: 3,
    number: 6,
    title: "Salt Air",
    firstAired: "2026-01-01T00:00:00.000Z",
    still: null,
    ids: { trakt: 306 },
  },
  lastAired: { season: 3, number: 5 },
  tmdbId: null,
  pendingAdvance: false,
};

const card: UpNextCard = {
  entry,
  item: {
    showId: entry.showId,
    title: entry.title,
    episode: entry.nextEpisode,
    lastWatchedAt: entry.lastWatchedAt,
    backlog: 2,
  },
};

const mockView: UpNextView = {
  queue: [card],
  lapsedCards: [],
  watchlistEntries: [],
  totalCount: 1,
  trackedCount: 1,
  startedCount: 1,
  unresolvedCount: 0,
  refetch: jest.fn(),
  isLoading: false,
  isFetching: false,
  isError: false,
  hasData: true,
  syncedAt: 0,
  failure: null,
  retrying: false,
};

const { default: UpNext, QueueRow } = require("../app/(tabs)/(up-next)");

function InteractiveCheckControl() {
  const [checked, setChecked] = useState(false);
  return (
    <CheckControl
      checked={checked}
      label="Mark Salt Air watched"
      testID={TEST_IDS.markWatched(entry.showId)}
      onPress={() => setChecked(true)}
    />
  );
}

test("queue row", async () => {
  await measureRenders(<QueueRow card={card} />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});

test("check control", async () => {
  await measureRenders(<InteractiveCheckControl />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});

test("Up Next screen", async () => {
  await measureRenders(<UpNext />, {
    scenario: async (screen) =>
      fireEvent.press(screen.getByTestId(TEST_IDS.markWatched(entry.showId))),
  });
});
