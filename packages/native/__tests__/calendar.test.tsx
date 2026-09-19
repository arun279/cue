import type { CalendarEntry } from "@cue/core/domain/calendar";
import { DAY_MS } from "@cue/core/domain/time";
import type { PreferenceStorage } from "@cue/core/ports/preference-storage";
import { act, render, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { router } from "./support/native-ui";
import { airing, fakeRuntime, Harness, memoryPreferences, spyHaptics } from "./support/up-next";

jest.mock("expo-router", () => require("./support/native-ui").expoRouterModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
// Where the viewer is, which is the one thing about this screen a runner cannot
// have an opinion on: the grouping is meant to follow the reader, so the reader
// is placed rather than inherited from whatever host runs the suite.
jest.mock("@cue/core/domain/time", () => ({
  ...jest.requireActual("@cue/core/domain/time"),
  localTimeZone: () => "America/Los_Angeles",
}));

const Calendar = (
  require("../app/(tabs)/(calendar)/calendar") as typeof import("../app/(tabs)/(calendar)/calendar")
).default;

const haptics = spyHaptics();

/**
 * Los Angeles, at a moment whose UTC date has already turned over: 8:00 PM on
 * the 21st locally is the 22nd in UTC, so every grouping assertion below is also
 * an assertion that the screen groups in the viewer's own day rather than the
 * feed's.
 */
const NOW = Date.parse("2026-08-22T03:00:00.000Z");

const TONIGHT = airing({
  showId: 8806,
  showTitle: "Nine Lives of Ada Rook",
  season: 1,
  number: 8,
  episodeTitle: "Cat's Cradle",
  network: "Halyard",
  firstAired: "2026-08-22T04:00:00.000Z",
  ids: { trakt: 88_608 },
});
const EARLIER_TONIGHT = airing({
  showId: 8803,
  season: 2,
  number: 4,
  network: "Meridian",
  firstAired: "2026-08-22T02:00:00.000Z",
  ids: { trakt: 88_304 },
});
const LATER = airing({
  showId: 8805,
  showTitle: "Glasshouse",
  season: 1,
  number: 5,
  episodeTitle: "Vent Line",
  network: "Meridian",
  firstAired: "2026-08-25T03:00:00.000Z",
  ids: { trakt: 88_505 },
});

interface Options {
  readonly calendar?: readonly CalendarEntry[];
  readonly preferences?: PreferenceStorage;
  readonly runtime?: ReturnType<typeof fakeRuntime>;
  /** A read that never settles, so the screen stays on its plates. */
  readonly loading?: boolean;
}

async function paint({
  calendar = [],
  preferences,
  runtime,
  loading,
}: Options = {}): Promise<void> {
  await render(
    <Harness
      runtime={runtime ?? fakeRuntime({ calendar })}
      haptics={haptics}
      preferences={preferences}
    >
      <Calendar />
    </Harness>,
  );
  if (loading) return;
  await waitFor(() => expect(screen.queryByTestId("calendar-skeleton")).toBeNull());
}

const rowOf = (traktId: number) => screen.getByTestId(`calendar-row-${traktId}`);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Calendar", () => {
  it("groups by the viewer's day, not the feed's, and counts each group", async () => {
    await paint({ calendar: [TONIGHT, EARLIER_TONIGHT, LATER] });

    // Both of tonight's episodes carry tomorrow's UTC date.
    expect(screen.getByTestId("calendar-day-header-today")).toHaveTextContent("Today · 2");
    expect(screen.getByText("Mon, Aug 24 · 1")).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^calendar-row-/)).toHaveLength(3);
  });

  it("says the hour today, the days ahead later, and nothing once aired", async () => {
    await paint({ calendar: [TONIGHT, EARLIER_TONIGHT, LATER] });

    // The chip is hidden from assistive technology, so it is read here the way
    // the eye reads it and the row's own label carries the words.
    const chip = (label: string) => screen.queryByText(label, { includeHiddenElements: true });

    // Tonight: the hour is in the chip, so the line under it keeps the network.
    expect(chip("9:00 PM")).toBeOnTheScreen();
    expect(within(rowOf(88_608)).getByText("Halyard")).toBeOnTheScreen();
    // Later: the chip counts the days and the line carries both.
    expect(chip("3d")).toBeOnTheScreen();
    expect(within(rowOf(88_505)).getByText("8:00 PM · Meridian")).toBeOnTheScreen();
    // Already aired: no countdown at all, and the line says so.
    expect(within(rowOf(88_304)).getByText("Aired 7:00 PM · Meridian")).toBeOnTheScreen();
    expect(chip("7:00 PM")).toBeNull();
  });

  it("re-anchors its groups when the local day turns over under it", async () => {
    await paint({ calendar: [LATER] });

    expect(screen.getByText("Mon, Aug 24 · 1")).toBeOnTheScreen();

    // Three days of the screen sitting untouched, which is all it takes for
    // "Mon, Aug 24" to become the day the reader is standing in.
    await act(async () => {
      jest.advanceTimersByTime(3 * DAY_MS);
    });

    await waitFor(() =>
      expect(screen.getByTestId("calendar-day-header-today")).toHaveTextContent("Today · 1"),
    );
  });

  it("offers nothing to mark: a row is the show it opens and no more", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await paint({ calendar: [TONIGHT] });

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText(/^Mark .* watched$/)).toBeNull();
    expect(rowOf(88_608)).toHaveAccessibleName(
      "Nine Lives of Ada Rook, S1 E8, Cat's Cradle, 9:00 PM · Halyard",
    );

    await user.press(rowOf(88_608));

    expect(router.push).toHaveBeenCalledWith("/show/8806");
  });

  it("reads nothing at all while TV shows are turned off", async () => {
    const loadCalendar = jest.fn(() => Promise.resolve({ entries: [], hiddenShowIds: [] }));
    await paint({
      runtime: { ...fakeRuntime({}), loadCalendar },
      preferences: showsTurnedOff(),
    });

    expect(screen.getByText("TV shows are turned off.")).toBeOnTheScreen();
    expect(
      screen.getByText("Turn TV shows back on in Settings to see what's coming."),
    ).toBeOnTheScreen();
    expect(loadCalendar).not.toHaveBeenCalled();
  });

  it("says the window is empty rather than leaving a blank scroll", async () => {
    await paint();

    expect(screen.getByText("No upcoming episodes in the next 28 days.")).toBeOnTheScreen();
  });

  it("stands plates where the agenda will be, and no spinner, while it reads", async () => {
    const held = { ...fakeRuntime({}), loadCalendar: () => new Promise<never>(() => {}) };
    await paint({ runtime: held, loading: true });

    expect(screen.getByTestId("calendar-skeleton")).toBeOnTheScreen();
    expect(screen.queryByTestId("calendar-list")).toBeOnTheScreen();
  });
});

function showsTurnedOff(): PreferenceStorage {
  const preferences = memoryPreferences();
  preferences.setItem("cue.shows-enabled", "false");
  return preferences;
}
