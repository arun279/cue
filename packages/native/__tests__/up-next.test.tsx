import { TraktReadError } from "@cue/core/data/trakt/client";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { UNDO_WINDOW_MS } from "@cue/core/sync-contract";
import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import {
  agesAgo,
  airing,
  entry,
  fakeRuntime,
  Harness,
  memoryPreferences,
  OFFLINE,
  resetSharedStores,
  spyHaptics,
} from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./support/native-ui").menuModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./support/native-ui").swipeableModule(),
);
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
// The tutorial line reads its one-time flag at import, and this runner has no
// SQLite behind the preference store.
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: require("./support/native-stores").bulkBacking,
}));

// The shared 429 pause is the strip's own signal and the pull's own gate, and
// nothing in a test runner opens one. Its behavior is proved in the core; what
// this file owns is what the screen does while it stands.
jest.mock("@cue/core/data/trakt/read-budget", () => ({
  ...jest.requireActual("@cue/core/data/trakt/read-budget"),
  readsPausedUntil: jest.fn(() => 0),
}));

const { readsPausedUntil } = require("@cue/core/data/trakt/read-budget") as {
  readsPausedUntil: jest.Mock<number, [], unknown>;
};
const { UpNext } =
  require("../src/screens/up-next/UpNext") as typeof import("../src/screens/up-next/UpNext");

const haptics = spyHaptics();
const HARBOR = 8801;
const FRONTIER = 8802;
const CARTOGRAPHY = 8803;
const GLASSHOUSE = 8805;

function queueOf(): readonly LibraryEntry[] {
  return [
    entry(),
    entry({
      showId: FRONTIER,
      title: "The Quiet Frontier",
      aired: 25,
      completed: 24,
      lastWatchedAt: agesAgo(6),
      nextEpisode: {
        season: 2,
        number: 10,
        title: "The Long Way",
        firstAired: agesAgo(13),
        still: null,
        ids: { trakt: 88_210 },
      },
    }),
    entry({
      showId: CARTOGRAPHY,
      title: "Midnight Cartography",
      aired: 11,
      completed: 9,
      lastWatchedAt: agesAgo(3),
      nextEpisode: {
        season: 2,
        number: 3,
        title: "Half Measures",
        firstAired: agesAgo(7),
        still: null,
        ids: { trakt: 88_303 },
      },
    }),
  ];
}

/** A show whose last play and whose next episode both sit past the staleness
 * threshold, which is what files it in the drawer rather than in the queue. */
function lapsed(): LibraryEntry {
  return entry({
    showId: GLASSHOUSE,
    title: "Glasshouse",
    aired: 4,
    completed: 2,
    lastWatchedAt: agesAgo(140),
    nextEpisode: {
      season: 1,
      number: 4,
      title: "Cold Frame",
      firstAired: agesAgo(120),
      still: null,
      ids: { trakt: 88_104 },
    },
  });
}

interface Options {
  readonly entries?: readonly LibraryEntry[];
  readonly calendar?: Parameters<typeof fakeRuntime>[0]["calendar"];
  readonly submit?: Parameters<typeof fakeRuntime>[0]["submit"];
}

async function paint({ entries = queueOf(), calendar = [], submit }: Options = {}): Promise<void> {
  await render(
    <Harness runtime={fakeRuntime({ entries, calendar, submit })} haptics={haptics}>
      <UpNext />
    </Harness>,
  );
  await waitFor(() => expect(screen.queryByTestId("up-next-skeleton")).toBeNull());
  // The calendar read lands after the library one, and a query settling past the
  // end of a case is what leaves an update outside act.
  await act(async () => {});
}

const check = (showId: number) => screen.getByTestId(`queue-row-${showId}-mark`);

beforeEach(() => {
  jest.clearAllMocks();
  resetSharedStores();
  readsPausedUntil.mockReturnValue(0);
});

/** Ordered by the default "oldest unwatched" preference, so the show whose next
 * episode has waited longest heads the queue and is the one the card promotes. */
const rows = () => screen.getAllByTestId(/^queue-row-\d+$/);

/**
 * The home screen over the real read path, the real mark pipeline and the real
 * sync contract. What is mocked is the four platform edges a test runner has no
 * answer for; everything the screen decides is decided here.
 */
describe("Up Next", () => {
  it("paints skeleton plates before it knows the words, and no spinner", async () => {
    const held = { ...fakeRuntime({}), loadUpNext: () => new Promise<never>(() => {}) };
    await render(
      <Harness runtime={held} haptics={haptics}>
        <UpNext />
      </Harness>,
    );

    expect(screen.getByTestId("up-next-skeleton")).toBeOnTheScreen();
    expect(screen.queryByTestId("marquee-card")).toBeNull();
    expect(screen.queryByTestId("link-history")).toBeNull();
  });

  it("promotes the head of the queue into the card and starts the rows below it", async () => {
    await paint();

    // The card CONSUMES the head of the queue rather than sitting on top of it:
    // three shows draw one card and two rows, not one card and three rows.
    expect(screen.getByTestId("marquee-card")).toBeOnTheScreen();
    expect(rows()).toHaveLength(2);
    expect(screen.queryByTestId(`queue-row-${FRONTIER}`)).toBeNull();
  });

  it("keeps every show in the list when the queue is too short to promote one", async () => {
    await paint({ entries: queueOf().slice(0, 2) });

    expect(screen.queryByTestId("marquee-card")).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it("names the aired-but-unwatched count and never claims zero", async () => {
    await paint();

    expect(screen.getByText("1 left")).toBeOnTheScreen();
    expect(screen.getByText("2 left")).toBeOnTheScreen();
    expect(screen.queryByText("0 left")).toBeNull();
  });

  it("replaces the old timeline strip with one row that opens the whole log", async () => {
    await paint();

    expect(screen.getByTestId("link-history")).toBeOnTheScreen();
  });

  it("teaches the tap once, and never again after the first mark", async () => {
    const user = userEvent.setup();
    await paint();

    expect(screen.getByTestId("tutorial-caption")).toHaveTextContent(
      "Tap to mark watched. Undo appears below.",
    );

    await user.press(check(HARBOR));

    await waitFor(() => expect(screen.queryByTestId("tutorial-caption")).toBeNull());
  });
});

describe("Up Next's mark control", () => {
  it("marks from the check, and reverses from the same target for the undo window", async () => {
    const user = userEvent.setup();
    await paint();

    expect(check(CARTOGRAPHY)).toHaveAccessibleName("Mark Midnight Cartography S2 E3 watched");

    await user.press(check(CARTOGRAPHY));

    await waitFor(() => expect(check(CARTOGRAPHY)).toHaveAccessibleName("Watched. Tap to remove."));
    expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
  });

  it("marks from a swipe released past the threshold, through the same pipeline", async () => {
    const user = userEvent.setup();
    await paint();

    await user.press(screen.getByTestId(`queue-row-${CARTOGRAPHY}-drag-right`));

    await waitFor(() => expect(check(CARTOGRAPHY)).toHaveAccessibleName("Watched. Tap to remove."));
  });

  it("stops the show from a swipe the other way, and says so with an Undo", async () => {
    const user = userEvent.setup();
    await paint();

    await user.press(screen.getByTestId(`queue-row-${CARTOGRAPHY}-drag-left`));

    await waitFor(() =>
      expect(screen.getByTestId("snackbar-message")).toHaveTextContent(
        "Midnight Cartography stopped",
      ),
    );
    expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
  });

  it("advances on the clock into a checked, inert row rather than waiting on Trakt", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    // Deferred: the write is accepted and held, which is what a queue offline or
    // rate limited does, and the row must not sit there looking marked-and-stuck.
    await paint({ submit: () => Promise.resolve("deferred") });

    await user.press(check(CARTOGRAPHY));
    await waitFor(() => expect(check(CARTOGRAPHY)).toHaveAccessibleName("Watched. Tap to remove."));

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(check(CARTOGRAPHY)).toHaveAccessibleName("Watched. Not synced yet.");
    expect(check(CARTOGRAPHY)).toHaveProp("accessibilityState", {
      checked: true,
      disabled: true,
    });
    jest.useRealTimers();
  });
});

describe("Up Next's sections", () => {
  it("holds the idle shows in a collapsed drawer with its count, and opens on a tap", async () => {
    const user = userEvent.setup();
    await paint({ entries: [...queueOf(), lapsed()] });

    const toggle = screen.getByTestId("lapsed-drawer-toggle");
    expect(toggle).toHaveAccessibleName("Haven't watched lately, 1");
    expect(screen.queryByTestId(`lapsed-row-${GLASSHOUSE}`)).toBeNull();

    await user.press(toggle);

    expect(screen.getByTestId(`lapsed-row-${GLASSHOUSE}`)).toBeOnTheScreen();
    // The idle stretch stands where the queue draws its count, which is the
    // reason the row is in the drawer at all.
    expect(screen.getByText(/^last watched /)).toBeOnTheScreen();
  });

  it("caps what is coming at three rows and links to the whole of it", async () => {
    const soon = [1, 2, 3, 4, 5].map((number) =>
      airing({ number, ids: { trakt: 90_000 + number } }),
    );
    await paint({ calendar: soon });

    expect(screen.getByTestId("on-the-way-list")).toBeOnTheScreen();
    expect(screen.getAllByText(/Dead Reckoning/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Calendar" })).toBeOnTheScreen();
  });

  it("says nothing about what is coming when nothing is", async () => {
    await paint();

    expect(screen.queryByTestId("on-the-way-list")).toBeNull();
  });
});

describe("Up Next's empty and off states", () => {
  it("reads an empty library as nothing queued rather than as caught up", async () => {
    await paint({ entries: [] });

    expect(screen.getByText("Nothing queued.")).toBeOnTheScreen();
    expect(screen.getByText("Find a show and Cue keeps your place.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Search shows" })).toBeOnTheScreen();
  });

  it("answers a caught-up reader with what is coming instead of a second sentence", async () => {
    const done = [entry({ completed: 21, nextEpisode: null })];
    await paint({ entries: done, calendar: [airing()] });

    expect(screen.getByText("You're all caught up.")).toBeOnTheScreen();
    expect(screen.queryByText("Nothing airing in the next few days.")).toBeNull();
    expect(screen.getByTestId("on-the-way-list")).toBeOnTheScreen();
  });

  it("says so, and reads nothing, when TV shows are turned off", async () => {
    const loadUpNext = jest.fn(() => Promise.resolve({ entries: queueOf(), isPartial: false }));
    const runtime = { ...fakeRuntime({}), loadUpNext };
    await render(
      <Harness runtime={runtime} haptics={haptics} preferences={showsTurnedOff()}>
        <UpNext />
      </Harness>,
    );

    expect(screen.getByText("TV shows are turned off.")).toBeOnTheScreen();
    expect(
      screen.getByText("Turn TV shows back on in Settings to see your queue."),
    ).toBeOnTheScreen();
    expect(loadUpNext).not.toHaveBeenCalled();
  });
});

/** The Settings switch, already off, which is where this branch comes from. */
function showsTurnedOff(): PreferenceStorage {
  const preferences = memoryPreferences();
  preferences.setItem("cue.shows-enabled", "false");
  return preferences;
}

const PAUSE_MS = 42_000;

interface SyncOptions {
  readonly offline?: boolean;
  readonly failing?: boolean;
  readonly flushWrites?: () => Promise<number>;
}

async function paintSync({
  offline = false,
  failing = false,
  flushWrites,
}: SyncOptions = {}): Promise<void> {
  const runtime = {
    ...fakeRuntime({ entries: [entry()] }),
    ...(failing
      ? { loadUpNext: () => Promise.reject(new TraktReadError({ kind: "network" }, "your queue")) }
      : null),
    ...(flushWrites === undefined ? null : { flushWrites }),
  };
  await render(
    <Harness runtime={runtime} haptics={haptics} network={offline ? OFFLINE : undefined}>
      <UpNext />
    </Harness>,
  );
  await waitFor(() => expect(screen.queryByTestId("up-next-skeleton")).toBeNull());
  // The calendar read lands after the library one, and a query settling past the
  // end of a case is what leaves an update outside act.
  await act(async () => {});
}

describe("Up Next's sync strip", () => {
  it("says nothing at all while sync is healthy, and holds no space for a strip", async () => {
    await paintSync();

    expect(screen.queryByTestId("sync-strip")).toBeNull();
  });

  it("leads with offline, because an offline device fails every read", async () => {
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);
    await paintSync({ offline: true, failing: true });

    expect(screen.getByTestId("sync-strip-offline")).toHaveTextContent(
      "Offline. Your marks are saved.",
    );
  });

  it("counts a live rate limit down over the cached queue, and offers no Retry", async () => {
    readsPausedUntil.mockReturnValue(Date.now() + PAUSE_MS);
    await paintSync();

    expect(screen.getByTestId("sync-strip")).toHaveTextContent(
      "Trakt is limiting requests. Retrying in 42s.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    // The content stays: a failed refresh over a warm cache is a note, never a wipe.
    expect(screen.getByTestId("link-history")).toBeOnTheScreen();
  });

  it("shows its own error state, and no strip, when there is nothing cached to keep", async () => {
    await paintSync({ failing: true });

    expect(await screen.findByTestId("up-next-error")).toBeOnTheScreen();
    expect(screen.getByText("Check your connection and try again.")).toBeOnTheScreen();
    // A strip claiming to show cached data over an empty screen is the lie the
    // contract exists to remove.
    expect(screen.queryByTestId("sync-strip")).toBeNull();
  });

  it("stands no sections over a screen that has nothing to show them beside", async () => {
    await paintSync({ failing: true });

    expect(await screen.findByTestId("up-next-error")).toBeOnTheScreen();
    expect(screen.queryByTestId("link-history")).toBeNull();
    expect(screen.queryByTestId("lapsed-drawer-toggle")).toBeNull();
  });
});
