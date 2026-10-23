import { TraktReadError } from "@cue/core/data/trakt/client";
import type { LibraryEntry } from "@cue/core/data/trakt/library";
import { useReadRetry } from "@cue/core/hooks/useReadRetry";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { UNDO_WINDOW_MS } from "@cue/core/sync-contract";
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { Dimensions, Platform, ScrollView } from "react-native";
import { memoryPreferenceStorage } from "../../core/test/support/stores";
import { ROW_MIN_HEIGHT } from "../src/ui/tokens";
import { expectUnavailable, menuItem, router } from "./support/native-ui";
import {
  agesAgo,
  airing,
  entry,
  fakeRuntime,
  Harness,
  OFFLINE,
  resetSharedStores,
  spyHaptics,
} from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock("@cue/core/hooks/useReadRetry", () => ({ useReadRetry: jest.fn(() => null) }));
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

const UpNext = (require("../app/(tabs)/(up-next)") as typeof import("../app/(tabs)/(up-next)"))
  .default;

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

const row = (showId: number) => screen.getByTestId(`queue-row-${showId}`);
const swipeRight = (showId: number) => screen.getByTestId(`queue-row-${showId}-drag-right`);
const quickMark = (showId: number) => menuItem(within(row(showId)), /^Mark .* watched$/);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useReadRetry).mockReturnValue(null);
  resetSharedStores();
});

/** Ordered by the default "oldest unwatched" preference, so the show whose next
 * episode has waited longest heads the queue. */
const rows = () => screen.getAllByTestId(/^queue-row-\d+$/);

/**
 * The home screen over the real read path, the real mark pipeline and the real
 * sync contract. What is mocked is the four platform edges a test runner has no
 * answer for; everything the screen decides is decided here.
 */
describe("Up Next", () => {
  it("paints skeleton plates before it knows the words, and no spinner", async () => {
    const held = { ...fakeRuntime({}), loadUpNext: () => new Promise<never>(() => {}) };
    const view = await render(
      <Harness runtime={held} haptics={haptics}>
        <UpNext />
      </Harness>,
    );

    expect(screen.getByTestId("up-next-skeleton")).toBeOnTheScreen();
    expect(screen.queryByTestId("link-history")).toBeNull();
    // Torn down while the read is still held, because the calendar query and the
    // list's own cell batch both land after the last assertion, and an update
    // with no case left to observe it is one React saw outside act.
    view.unmount();
  });

  it("says it is still trying, and why, once a first read fails with nothing to show", async () => {
    jest.mocked(useReadRetry).mockReturnValue({ kind: "timeout" });
    const held = { ...fakeRuntime({}), loadUpNext: () => new Promise<never>(() => {}) };
    const view = await render(
      <Harness runtime={held} haptics={haptics}>
        <UpNext />
      </Harness>,
    );

    expect(screen.getByText("Still trying to reach Trakt")).toBeOnTheScreen();
    expect(screen.getByText("Trakt didn't answer in time.")).toBeOnTheScreen();
    expect(screen.queryByTestId("up-next-skeleton")).toBeNull();
    view.unmount();
  });

  it("draws every queued show as the same row, the most recently watched first", async () => {
    await paint();

    expect(rows().map((row) => row.props["testID"])).toEqual([
      `queue-row-${HARBOR}`,
      `queue-row-${CARTOGRAPHY}`,
      `queue-row-${FRONTIER}`,
    ]);
  });

  it("badges an episode that aired last night, in words a reader hears", async () => {
    const lastNight = new Date();
    lastNight.setHours(-3, 0, 0, 0);
    const fresh = queueOf().map((show) =>
      show.showId === CARTOGRAPHY && show.nextEpisode !== null
        ? { ...show, nextEpisode: { ...show.nextEpisode, firstAired: lastNight.toISOString() } }
        : show,
    );
    await paint({ entries: fresh });

    expect(
      within(row(CARTOGRAPHY)).getByText("Aired last night", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/^Midnight Cartography, Aired last night, S2 E3/),
    ).toBeOnTheScreen();
    expect(
      within(row(FRONTIER)).queryByText("Aired last night", { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("names the aired-but-unwatched count and never claims zero", async () => {
    // Harbor Lights' watched count has caught up with its aired count, which is
    // the shape a just-marked row takes while its next episode is a projection
    // and the only way the count could read zero. Zero is a number the app
    // cannot stand by, so that row draws no count at all.
    await paint({
      entries: queueOf().map((show) =>
        show.showId === HARBOR ? { ...show, completed: show.aired, left: 0 } : show,
      ),
    });

    expect(screen.getByTestId(`queue-row-${HARBOR}`)).toBeOnTheScreen();
    expect(screen.getByText("1 left", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText("2 left", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText("0 left", { includeHiddenElements: true })).toBeNull();
  });

  it("counts what is left from the next-up episode, leaving skipped seasons out", async () => {
    await paint({
      entries: queueOf().map((show) =>
        show.showId === HARBOR ? { ...show, aired: 30, completed: 7, left: 13 } : show,
      ),
    });

    expect(screen.getByText("13 left", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText("23 left", { includeHiddenElements: true })).toBeNull();
  });

  it("replaces the old timeline strip with one row that opens the whole log", async () => {
    await paint();

    expect(screen.getByTestId("link-history")).toBeOnTheScreen();
  });

  it("teaches the swipe once, and never again after the first mark", async () => {
    const user = userEvent.setup();
    await paint();

    expect(screen.getByTestId("tutorial-caption")).toHaveTextContent(
      "Swipe right to mark watched. Undo appears below.",
    );

    await user.press(swipeRight(HARBOR));

    await waitFor(() => expect(screen.queryByTestId("tutorial-caption")).toBeNull());
  });
});

describe("Up Next's mark control", () => {
  it("leaves the header's bar items declared once while a mark re-renders the screen", async () => {
    const user = userEvent.setup();
    await paint();
    const { Stack } = jest.requireMock<typeof import("expo-router")>("expo-router");
    const toolbar = jest.mocked(Stack.Toolbar);
    toolbar.mockClear();

    await user.press(swipeRight(CARTOGRAPHY));
    await waitFor(() => expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen());
    await user.press(screen.getByTestId("snackbar-undo"));
    await waitFor(() => expect(screen.queryByTestId("snackbar-undo")).toBeNull());

    expect(toolbar).not.toHaveBeenCalled();
  });

  it("shows a mark and its undo in the queue without waiting on a timer", async () => {
    await paint();
    const unwatched = "Midnight Cartography, S2 E3, Half Measures, 2 left";
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    try {
      await act(async () => fireEvent.press(swipeRight(CARTOGRAPHY)));
      expect(screen.queryByLabelText(unwatched)).toBeNull();

      await act(async () => fireEvent.press(screen.getByTestId("snackbar-undo")));
      expect(screen.getByLabelText(unwatched)).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it("marks from a swipe released past the threshold, through the same pipeline", async () => {
    const user = userEvent.setup();
    await paint();

    await user.press(swipeRight(CARTOGRAPHY));

    await waitFor(() => expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen());
    expect(screen.queryByLabelText(/^Midnight Cartography, S2 E3,/)).toBeNull();
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

  it("advances on the clock into an inert row rather than waiting on Trakt", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    // Deferred: the write is accepted and held, which is what a queue offline or
    // rate limited does, and the row must not sit there looking marked-and-stuck.
    await paint({ submit: () => Promise.resolve("deferred") });

    await user.press(swipeRight(CARTOGRAPHY));
    await waitFor(() => expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen());

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(screen.getByLabelText(/^Midnight Cartography, .*, not synced yet$/)).toBeOnTheScreen();
    expectUnavailable(await quickMark(CARTOGRAPHY));
    jest.useRealTimers();
  });

  it("keeps a row whose projection has run out of episodes, and invents no code for it", async () => {
    // Mid-advance past the last aired episode: the row has been marked, the
    // confirming read has yet to name a next episode, and there may not be one.
    await paint({
      entries: [
        entry({ completed: 21, nextEpisode: null, pendingAdvance: true }),
        ...queueOf().slice(1),
      ],
    });

    const harbor = row(HARBOR);
    expect(
      within(harbor).getByText("Harbor Lights", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    // Nothing episode-code shaped, which rules out the real next code and a
    // placeholder standing in for one.
    expect(within(harbor).queryByText(/^S.*E/, { includeHiddenElements: true })).toBeNull();
    expectUnavailable(await quickMark(HARBOR));
  });
});

describe("Up Next's row menu", () => {
  it("is the tap path to Stop that the swipe would otherwise be the only way to", async () => {
    const user = userEvent.setup();
    await paint();

    const stop = await menuItem(within(row(CARTOGRAPHY)), "Stop show");
    if (stop === null) throw new Error("Stop show is missing from the row's menu");
    await user.press(stop);

    await waitFor(() =>
      expect(screen.getByTestId("snackbar-message")).toHaveTextContent(/ stopped$/),
    );
    expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen();
  });

  it("names the episode a quick mark would write, and marks it", async () => {
    const user = userEvent.setup();
    await paint();

    const mark = await menuItem(within(row(CARTOGRAPHY)), "Mark S2 E3 watched");
    if (mark === null) throw new Error("the quick mark is missing from the row's menu");

    await user.press(mark);

    await waitFor(() => expect(screen.getByTestId("snackbar-undo")).toBeOnTheScreen());
  });

  it("mutes a show's episode alerts, says so, and takes it back on Undo", async () => {
    const user = userEvent.setup();
    await paint();
    const mute = await menuItem(within(row(CARTOGRAPHY)), "Mute episode alerts");
    if (mute === null) throw new Error("mute is missing from the row's menu");

    await user.press(mute);

    expect(screen.getByTestId("snackbar-message")).toHaveTextContent(
      "Episode alerts muted for Midnight Cartography.",
    );
    expect(await menuItem(within(row(CARTOGRAPHY)), "Unmute episode alerts")).not.toBeNull();

    await user.press(screen.getByTestId("snackbar-undo"));

    expect(await menuItem(within(row(CARTOGRAPHY)), "Mute episode alerts")).not.toBeNull();
  });

  it("offers no mute in the lapsed drawer, where nothing is scheduled", async () => {
    const user = userEvent.setup();
    await paint({ entries: [...queueOf(), lapsed()] });

    await user.press(screen.getByTestId("lapsed-drawer-toggle"));

    expect(
      await menuItem(
        within(screen.getByTestId(`lapsed-row-${GLASSHOUSE}`)),
        /mute episode alerts/i,
      ),
    ).toBeNull();
  });

  it("withholds the quick mark while the next episode is a guess", async () => {
    // pendingAdvance: the projection has not been confirmed by a read, and
    // marking a guessed coordinate would write a play for an episode that may
    // not exist.
    const projected = queueOf().map((show) => ({ ...show, pendingAdvance: true }));
    await paint({ entries: projected });

    expectUnavailable(await quickMark(CARTOGRAPHY));
  });
});

describe("Up Next's sections", () => {
  it("files a show marked from the drawer back into the queue", async () => {
    const user = userEvent.setup();
    await paint({ entries: [...queueOf(), lapsed()] });
    await user.press(screen.getByTestId("lapsed-drawer-toggle"));

    await user.press(screen.getByTestId(`lapsed-row-${GLASSHOUSE}-drag-right`));

    await waitFor(() => expect(row(GLASSHOUSE)).toBeOnTheScreen());
    expect(screen.queryByTestId(`lapsed-row-${GLASSHOUSE}`)).toBeNull();
    expect(screen.queryByTestId("lapsed-drawer-toggle")).toBeNull();
  });

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
    expect(screen.getByText(/^last watched /, { includeHiddenElements: true })).toBeOnTheScreen();
    await screen.unmount();
  });

  it("opens the idle shows in the same frame and mounts only the list's render window", async () => {
    const idle = Array.from({ length: 60 }, (_, index) => ({
      ...lapsed(),
      showId: 20_000 + index,
      title: `Idle ${index}`,
    }));
    await paint({ entries: [...queueOf(), ...idle] });

    await act(async () => fireEvent.press(screen.getByTestId("lapsed-drawer-toggle")));

    expect(screen.getByTestId("lapsed-drawer-toggle")).toHaveProp("accessibilityState", {
      expanded: true,
    });
    const mounted = screen.getAllByTestId(/^(queue|lapsed)-row-\d+$/);
    expect(mounted.some((row) => row.props["testID"].startsWith("lapsed-row-"))).toBe(true);
    const oneScreenOfRows = Math.ceil(Dimensions.get("window").height / ROW_MIN_HEIGHT.queue);
    expect(mounted.length).toBeLessThanOrEqual(oneScreenOfRows);
    // Torn down before the list's next cell batch, which would land outside act.
    await screen.unmount();
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
    // The log is still one tap away from a screen with no queue on it.
    expect(screen.getByTestId("link-history")).toBeOnTheScreen();
  });

  it("says the second sentence when nothing is coming either", async () => {
    const done = [entry({ completed: 21, nextEpisode: null })];
    await paint({ entries: done });

    expect(screen.getByText("Nothing airing in the next few days.")).toBeOnTheScreen();
  });

  it("stands no sections under a branch that is only one block of type", async () => {
    // Nothing tracked: there is no queue to say what is coming after, and no
    // history to open, so the screen is the sentence and its one action.
    await paint({ entries: [], calendar: [airing()] });

    expect(screen.getByText("Nothing queued.")).toBeOnTheScreen();
    expect(screen.queryByTestId("on-the-way-list")).toBeNull();
    expect(screen.queryByTestId("link-history")).toBeNull();
  });

  it("drops the queue it already shows, and returns to the top, when TV shows are turned off in Settings", async () => {
    // React Native's ScrollView answers getScrollResponder with itself; its jest stand-in does not.
    const responder = jest
      .spyOn(ScrollView.prototype, "getScrollResponder")
      .mockImplementation(function (this: ScrollView) {
        return this;
      });
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
    let turnOff = (): void => {};
    function SettingsSwitch(): null {
      const setShowsEnabled = usePrefs((state) => state.setShowsEnabled);
      turnOff = () => setShowsEnabled(false);
      return null;
    }
    await render(
      <Harness runtime={fakeRuntime({ entries: queueOf() })} haptics={haptics}>
        <UpNext />
        <SettingsSwitch />
      </Harness>,
    );
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    scrollTo.mockClear();

    await act(async () => turnOff());

    expect(screen.getByTestId("up-next-tv-off")).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^queue-row-\d+$/).map((node) => node.props["testID"])).toEqual(
      [],
    );
    // Android keeps a list's offset when its content shrinks, which would leave the state above the viewport.
    // UIKit clamps the offset to the adjusted inset itself, and an offset of 0 there sits under the bar.
    if (Platform.OS === "android") expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    else expect(scrollTo).not.toHaveBeenCalled();
    responder.mockRestore();
    scrollTo.mockRestore();
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

  it("leads to Settings from the turned-off queue", async () => {
    await render(
      <Harness runtime={fakeRuntime({})} haptics={haptics} preferences={showsTurnedOff()}>
        <UpNext />
      </Harness>,
    );

    await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));

    expect(router.push).toHaveBeenCalledWith("/settings");
  });
});

/** The Settings switch, already off, which is where this branch comes from. */
function showsTurnedOff(): PreferenceStorage {
  const preferences = memoryPreferenceStorage();
  preferences.setItem("cue.shows-enabled", "false");
  return preferences;
}

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

  it("leads with offline over cached content, because an offline device fails every read", async () => {
    await paintSync({ offline: true });

    expect(screen.getByTestId("sync-strip-offline")).toHaveTextContent(
      "Offline. Your marks are saved.",
    );
    // A failed refresh over a warm cache is a note, never a wipe.
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
