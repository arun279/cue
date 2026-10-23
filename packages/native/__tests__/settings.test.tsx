import { sortLapsed, sortQueue } from "@cue/core/domain/queue-order";
import { computeWatchStatus } from "@cue/core/domain/watch-status";
import { type Reminders, RemindersProvider } from "@cue/core/ports/reminders";
import { createPrefsStore, usePrefs } from "@cue/core/prefs/prefs-store";
import { thresholdMsFromDays } from "@cue/core/prefs/threshold";
import { useReadIncidents } from "@cue/core/stores/read-incidents-store";
import { useStartFailure } from "@cue/core/stores/start-failure-store";
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { setStringAsync } from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import { Appearance, Platform } from "react-native";
import "./support/screen-mocks";
import { CueHaptics } from "../modules/cue-native/src";
import { createNativeHaptics } from "../src/platform/haptics";
import { EpisodeStill } from "../src/screens/episode-sheet/EpisodeStill";
import Settings from "../src/screens/Settings";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture } from "./support/account";
import { agesAgo, airing, entry } from "./support/up-next";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("../modules/cue-native/src", () => ({ CueHaptics: { success: jest.fn() } }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Testing Library recognizes only iOS's host switch, and iOS takes the switch role from UISwitch
 * rather than from a prop, so a Settings switch is found by the name a screen reader reads and the
 * native value it holds. */
const VALUE = Platform.OS === "ios" ? "value" : "on";

function switchNamed(name: string) {
  const [control, ...others] = screen
    .getAllByLabelText(name)
    .filter((element) => typeof element.props[VALUE] === "boolean");
  if (control === undefined || others.length > 0) throw new Error(`Not one switch named ${name}`);
  return control;
}

const isOn = (name: string): boolean => switchNamed(name).props[VALUE];

/** iOS announces a disabled UISwitch as dimmed only while React Native's Switch sets neither a
 * role nor a disabled state over UIKit's own traits; Android reads the disabled state that
 * Switch.js derives from `disabled`. */
function expectDisabled(name: string): void {
  const control = switchNamed(name);
  if (Platform.OS !== "ios") {
    expect(control).toBeDisabled();
    return;
  }
  expect(control.props).toMatchObject({ disabled: true, accessibilityRole: "none" });
  expect(control.props["accessibilityState"]?.disabled).toBeUndefined();
}

function SpoilerPreview() {
  const guarded = usePrefs((state) => state.hideStillsUntilWatched);
  return (
    <EpisodeStill episodeId={123} stills={["https://example.com/still.jpg"]} guarded={guarded} />
  );
}

it("applies haptics and spoiler preferences to their consumers without a reload", async () => {
  const fixture = accountFixture();
  const haptics = createNativeHaptics(() => fixture.prefs.getState().hapticsEnabled);
  await fixture.paint(
    <>
      <Settings />
      <SpoilerPreview />
    </>,
  );
  expect(screen.getByTestId(TEST_IDS.episodeStillBlur)).toBeVisible();
  haptics.success();
  expect(CueHaptics.success).toHaveBeenCalledTimes(1);
  await fireEvent(switchNamed("Haptics"), "valueChange", false);
  await fireEvent(switchNamed("Hide episode stills until watched"), "valueChange", false);
  haptics.success();
  expect(CueHaptics.success).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId(TEST_IDS.episodeStillBlur)).toBeNull();
  expect(screen.queryByRole("button", { name: "Reveal episode still" })).toBeNull();
});

function remindersAnswering(granted: Promise<boolean>): Reminders {
  return {
    requestPermission: jest.fn(() => granted),
    permissionRefused: () => Promise.resolve(false),
    reconcile: () => Promise.resolve(),
    cancelAll: () => Promise.resolve(),
  };
}

it("turns alerts on only once the OS allows notifications, and off without asking", async () => {
  let allow: (granted: boolean) => void = () => {};
  const reminders = remindersAnswering(new Promise((resolve) => (allow = resolve)));
  const fixture = accountFixture();
  await fixture.paint(
    <RemindersProvider value={reminders}>
      <Settings />
    </RemindersProvider>,
  );

  await fireEvent(switchNamed("New episodes"), "valueChange", true);
  expect(reminders.requestPermission).toHaveBeenCalledTimes(1);
  expect(isOn("New episodes")).toBe(false);

  await act(async () => allow(true));
  expect(isOn("New episodes")).toBe(true);
  expect(createPrefsStore(fixture.storage).getState().remindersEnabled).toBe(true);

  await fireEvent(switchNamed("New episodes"), "valueChange", false);
  expect(isOn("New episodes")).toBe(false);
  expect(reminders.requestPermission).toHaveBeenCalledTimes(1);
});

it("leaves alerts off and says where to change it when the OS refuses", async () => {
  const fixture = accountFixture();
  await fixture.paint(
    <RemindersProvider value={remindersAnswering(Promise.resolve(false))}>
      <Settings />
    </RemindersProvider>,
  );

  await fireEvent(switchNamed("New episodes"), "valueChange", true);

  expect(isOn("New episodes")).toBe(false);
  expect(createPrefsStore(fixture.storage).getState().remindersEnabled).toBe(false);
  expect(
    screen.getByText("Notifications are off for Cue. Turn them on in your phone's settings."),
  ).toBeVisible();
});

it("turns New episodes on from the Calendar's card once the OS allows them", async () => {
  const fixture = accountFixture({
    loadCalendar: () => Promise.resolve({ entries: [airing({ showId: 1 })], hiddenShowIds: [] }),
  });
  await fixture.paint(
    <RemindersProvider value={remindersAnswering(Promise.resolve(true))}>
      <Calendar />
      <Settings />
    </RemindersProvider>,
  );
  const card = () => screen.queryByRole("header", { name: "Alerts for new episodes" });
  expect(await screen.findByRole("header", { name: "Alerts for new episodes" })).toBeVisible();
  expect(isOn("New episodes")).toBe(false);

  await userEvent.press(screen.getByRole("button", { name: "Turn on alerts" }));

  expect(isOn("New episodes")).toBe(true);
  expect(card()).toBeNull();
});

it("offers the daily summary only while alerts are on", async () => {
  const fixture = accountFixture();
  await fixture.paint(<Settings />);
  const summary = () => screen.queryByLabelText("Daily summary instead");
  expect(summary()).toBeNull();

  await fireEvent(switchNamed("New episodes"), "valueChange", true);
  expect(isOn("Daily summary instead")).toBe(false);

  await fireEvent(switchNamed("Daily summary instead"), "valueChange", true);
  expect(createPrefsStore(fixture.storage).getState().dailySummary).toBe(true);

  await fireEvent(switchNamed("New episodes"), "valueChange", false);
  expect(summary()).toBeNull();
});

const Calendar = (
  require("../app/(tabs)/(calendar)/calendar") as typeof import("../app/(tabs)/(calendar)/calendar")
).default;
const Library = (
  require("../app/(tabs)/(library)/library") as typeof import("../app/(tabs)/(library)/library")
).default;

it("starts with accessible controls and the strong defaults", async () => {
  await accountFixture().paint(<Settings />);
  for (const name of ["Haptics", "Hide episode stills until watched", "TV shows", "Movies"]) {
    expect(isOn(name)).toBe(true);
  }
  expect(screen.getByRole("tab", { name: "System" })).toBeSelected();
  expect(
    screen.getByRole("button", { name: "Next episode order, After last watched" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Haven't watched lately order, Recently watched first" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Haven't watched in a while after, 3 weeks" }),
  ).toBeVisible();
  expect(isOn("New episodes")).toBe(false);
  expect(isOn("Every watchlist episode")).toBe(false);
});

it("brings every new episode of a watchlist show onto the Calendar once switched on", async () => {
  const fixture = accountFixture({
    loadUpNext: () =>
      Promise.resolve({
        entries: [entry({ showId: 9, completed: 0, lastWatchedAt: null, inWatchlist: true })],
      }),
    loadCalendar: () =>
      Promise.resolve({
        entries: [airing({ showId: 9, season: 2, number: 3, ids: { trakt: 903 } })],
        hiddenShowIds: [],
      }),
  });
  await fixture.paint(
    <RemindersProvider value={remindersAnswering(Promise.resolve(false))}>
      <Calendar />
      <Settings />
    </RemindersProvider>,
  );
  expect(await screen.findByText("No upcoming episodes in the next 28 days.")).toBeVisible();

  await fireEvent(switchNamed("Every watchlist episode"), "valueChange", true);

  expect(await screen.findByTestId("calendar-row-903")).toBeVisible();
  expect(createPrefsStore(fixture.storage).getState().everyWatchlistEpisode).toBe(true);
});

it("lists the sections in the order of the screen", async () => {
  await accountFixture().paint(<Settings />);
  expect(screen.getAllByRole("header").flatMap((heading) => heading.children)).toEqual([
    "Notifications",
    "Appearance",
    "Tracking",
    "Content",
    "Data",
    "Account",
    "About",
  ]);
});

it("persists each toggle and immediately removes the disabled medium from Library", async () => {
  const fixture = accountFixture();
  await fixture.paint(
    <>
      <Settings />
      <Library />
    </>,
  );
  expect(screen.getByRole("tab", { name: "Movies" })).toBeVisible();
  await fireEvent(switchNamed("Movies"), "valueChange", false);
  expect(screen.queryByRole("tab", { name: "Movies" })).toBeNull();
  expectDisabled("TV shows");
  await fireEvent(switchNamed("TV shows"), "valueChange", false);
  expect(fixture.prefs.getState().showsEnabled).toBe(true);
  await fireEvent(switchNamed("Movies"), "valueChange", true);
  await fireEvent(switchNamed("TV shows"), "valueChange", false);
  expectDisabled("Movies");
  for (const name of ["Haptics", "Hide episode stills until watched"])
    await fireEvent(switchNamed(name), "valueChange", false);
  expect(createPrefsStore(fixture.storage).getState()).toMatchObject({
    showsEnabled: false,
    moviesEnabled: true,
    hapticsEnabled: false,
    hideStillsUntilWatched: false,
  });
});

it("changes theme through the platform appearance and persists the selection", async () => {
  const setColorScheme = jest.spyOn(Appearance, "setColorScheme");
  const fixture = accountFixture();
  await fixture.paint(<Settings />);
  expect(setColorScheme).toHaveBeenLastCalledWith("unspecified");
  for (const theme of ["Dark", "Light", "System"]) {
    await userEvent.press(screen.getByRole("tab", { name: theme }));
    expect(screen.getByRole("tab", { name: theme })).toBeSelected();
    expect(setColorScheme).toHaveBeenLastCalledWith(
      theme === "System" ? "unspecified" : theme.toLowerCase(),
    );
    expect(createPrefsStore(fixture.storage).getState().theme).toBe(theme.toLowerCase());
  }
});

it("persists the three menu preferences and changes queue ordering", async () => {
  const fixture = accountFixture();
  await fixture.paint(<Settings />);
  const items = [
    {
      showId: 1,
      title: "Recent",
      backlog: 1,
      lastWatchedAt: agesAgo(1),
      episode: entry().nextEpisode,
    },
    {
      showId: 2,
      title: "Older",
      backlog: 1,
      lastWatchedAt: agesAgo(10),
      episode: {
        title: null,
        still: null,
        ids: { trakt: 2 },
        season: 1,
        number: 1,
        firstAired: agesAgo(15),
      },
    },
  ];
  expect(sortQueue(items, fixture.prefs.getState().nextEpisodeOrder)[0]?.showId).toBe(1);
  await userEvent.press(screen.getByLabelText("Oldest episode first"));
  expect(sortQueue(items, fixture.prefs.getState().nextEpisodeOrder)[0]?.showId).toBe(2);
  expect(sortLapsed(items, fixture.prefs.getState().lapsedOrder)[0]?.showId).toBe(1);
  await userEvent.press(screen.getByLabelText("Longest idle first"));
  expect(sortLapsed(items, fixture.prefs.getState().lapsedOrder)[0]?.showId).toBe(2);
  for (const weeks of [2, 4, 6, 3]) {
    await userEvent.press(screen.getByLabelText(`${weeks} weeks`));
    expect(thresholdMsFromDays(fixture.prefs.getState().thresholdDays)).toBe(
      weeks * 7 * 86_400_000,
    );
    const show = entry({ lastWatchedAt: agesAgo(25), nextEpisode: null });
    expect(
      computeWatchStatus(
        show,
        Date.now(),
        thresholdMsFromDays(fixture.prefs.getState().thresholdDays),
      ),
    ).toBe(weeks >= 4 ? "watching" : "lapsed");
  }
  expect(createPrefsStore(fixture.storage).getState()).toMatchObject({
    nextEpisodeOrder: "oldest-unwatched",
    lapsedOrder: "longest-idle",
    thresholdDays: 21,
  });
});

it("shows the injected store version and hands account management to Trakt", async () => {
  await accountFixture().paint(<Settings />);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(screen.getByTestId(TEST_IDS.settingsVersion)).toHaveTextContent("1.2.3 (45)");
  expect(screen.getByTestId(TEST_IDS.settingsAttribution)).toHaveTextContent(
    "Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.",
  );
  for (const [name, url] of [
    ["Manage Trakt account", "https://app.trakt.tv/settings"],
    ["Delete your Trakt account", "https://app.trakt.tv/settings/advanced"],
    ["Powered by Trakt", "https://trakt.tv"],
  ]) {
    await userEvent.press(screen.getByRole("link", { name }));
    expect(openBrowserAsync).toHaveBeenLastCalledWith(url);
  }
});

it("lists the last Trakt failure per endpoint under About and copies them as a report", async () => {
  const at = Date.UTC(2026, 9, 3, 22, 14);
  useReadIncidents.setState({
    incidents: [
      { endpoint: "/users/me/stats", kind: "no-content", detail: "", at },
      { endpoint: "/sync/watched/shows", kind: "server", detail: "HTTP 503", at: at - 60_000 },
    ],
  });
  await accountFixture().paint(<Settings />);
  expect(screen.getByText(/^Empty reply · \/users\/me\/stats · /)).toBeVisible();
  expect(screen.getByText(/^Server error · \/sync\/watched\/shows · .* · HTTP 503$/)).toBeVisible();

  await userEvent.press(screen.getByTestId(TEST_IDS.settingsDiagnosticsCopy));
  const report = jest.mocked(setStringAsync).mock.calls[0]?.[0];
  expect(report?.split("\n").slice(1)).toEqual([
    "2026-10-03T22:14:00.000Z  /users/me/stats  no-content",
    "2026-10-03T22:13:00.000Z  /sync/watched/shows  server  HTTP 503",
  ]);
  expect(await screen.findByText("Report copied.")).toBeVisible();
  await act(() => useReadIncidents.setState({ incidents: [] }));
});

it("lists a failed start above the Trakt failures and puts it first in the report", async () => {
  const at = Date.UTC(2026, 9, 3, 22, 14);
  useStartFailure.setState({ failure: { at, detail: "Error: database is locked" } });
  await accountFixture().paint(<Settings />);
  expect(screen.getByText(/^Couldn't start · .* · Error: database is locked$/)).toBeVisible();
  expect(screen.getByText("No Trakt errors recorded.")).toBeVisible();

  await userEvent.press(screen.getByTestId(TEST_IDS.settingsDiagnosticsCopy));
  expect(jest.mocked(setStringAsync).mock.calls.at(-1)?.[0]?.split("\n").slice(1)).toEqual([
    "2026-10-03T22:14:00.000Z  start  Error: database is locked",
  ]);
  await act(() => useStartFailure.setState({ failure: null }));
});
