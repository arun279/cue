import { PendingWritesError } from "@cue/core/app/session";
import { sortLapsed, sortQueue } from "@cue/core/domain/queue-order";
import { computeWatchStatus } from "@cue/core/domain/watch-status";
import { createPrefsStore, usePrefs } from "@cue/core/prefs/prefs-store";
import { thresholdMsFromDays } from "@cue/core/prefs/threshold";
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { openBrowserAsync } from "expo-web-browser";
import { Alert, Appearance, Platform } from "react-native";
import "./support/screen-mocks";
import { CueHaptics } from "../modules/cue-native/src";
import { createNativeHaptics } from "../src/platform/haptics";
import { EpisodeStill } from "../src/screens/episode-sheet/EpisodeStill";
import Settings from "../src/screens/Settings";
import { TEST_IDS } from "../src/ui/test-ids";
import { accountFixture } from "./support/account";
import { agesAgo, entry } from "./support/up-next";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("../modules/cue-native/src", () => ({ CueHaptics: { success: jest.fn() } }));

afterEach(() => jest.restoreAllMocks());

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
  await fireEvent(screen.getByRole("switch", { name: "Haptics" }), "valueChange", false);
  await fireEvent(
    screen.getByRole("switch", { name: "Hide episode stills until watched" }),
    "valueChange",
    false,
  );
  haptics.success();
  expect(CueHaptics.success).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId(TEST_IDS.episodeStillBlur)).toBeNull();
  expect(screen.queryByRole("button", { name: "Reveal episode still" })).toBeNull();
});

const Library = (
  require("../app/(tabs)/(library)/library") as typeof import("../app/(tabs)/(library)/library")
).default;

it("starts with accessible controls and the strong defaults", async () => {
  await accountFixture().paint(<Settings />);
  for (const name of ["Haptics", "Hide episode stills until watched", "TV shows", "Movies"]) {
    expect(screen.getByRole("switch", { name })).toBeChecked();
  }
  expect(screen.getByRole("radio", { name: "System theme" })).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Next episode order, Oldest unwatched" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Haven't watched lately order, Recently watched first" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Haven't watched in a while after, 3 weeks" }),
  ).toBeVisible();
  expect(screen.queryByText("Notifications")).toBeNull();
});

it("lists the sections in the order of the screen", async () => {
  await accountFixture().paint(<Settings />);
  expect(screen.getAllByRole("header").flatMap((heading) => heading.children)).toEqual([
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
  await fireEvent(screen.getByRole("switch", { name: "Movies" }), "valueChange", false);
  expect(screen.queryByRole("tab", { name: "Movies" })).toBeNull();
  expect(screen.getByRole("switch", { name: "TV shows" })).toBeDisabled();
  await fireEvent(screen.getByRole("switch", { name: "TV shows" }), "valueChange", false);
  expect(fixture.prefs.getState().showsEnabled).toBe(true);
  await fireEvent(screen.getByRole("switch", { name: "Movies" }), "valueChange", true);
  await fireEvent(screen.getByRole("switch", { name: "TV shows" }), "valueChange", false);
  expect(screen.getByRole("switch", { name: "Movies" })).toBeDisabled();
  for (const name of ["Haptics", "Hide episode stills until watched"])
    await fireEvent(screen.getByRole("switch", { name }), "valueChange", false);
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
    await userEvent.press(screen.getByRole("radio", { name: `${theme} theme` }));
    expect(screen.getByRole("radio", { name: `${theme} theme` })).toBeChecked();
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
  expect(sortQueue(items, fixture.prefs.getState().nextEpisodeOrder)[0]?.showId).toBe(2);
  await userEvent.press(screen.getByLabelText("After last watched"));
  expect(sortQueue(items, fixture.prefs.getState().nextEpisodeOrder)[0]?.showId).toBe(1);
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
    nextEpisodeOrder: "after-last-watched",
    lapsedOrder: "longest-idle",
    thresholdDays: 21,
  });
});

it.each([
  "ios",
  "android",
] as const)("confirms sign-out in the %s platform shape", async (platform) => {
  jest.replaceProperty(Platform, "OS", platform);
  const alert = jest.spyOn(Alert, "alert");
  const fixture = accountFixture();
  await fixture.paint(<Settings />);
  await userEvent.press(screen.getByRole("button", { name: "Sign out" }));
  expect(fixture.disconnect).not.toHaveBeenCalled();
  expect(alert).toHaveBeenLastCalledWith("Sign out of Cue?", "Your Trakt history stays on Trakt.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Sign out",
      onPress: expect.any(Function),
      ...(platform === "ios" ? { isPreferred: true } : {}),
    },
  ]);
  await act(() => alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.());
  expect(fixture.disconnect).toHaveBeenCalledTimes(1);
});

it.each([
  [
    new PendingWritesError(),
    "Some changes haven't synced yet. Reconnect to the internet, then try signing out again.",
  ],
  [new Error("storage unavailable"), "Couldn't finish signing out. Please try again."],
])("shows an announced refusal and enables retry after %s", async (failure, message) => {
  jest.replaceProperty(Platform, "OS", "android");
  const alert = jest.spyOn(Alert, "alert");
  const fixture = accountFixture();
  fixture.disconnect.mockRejectedValueOnce(failure);
  await fixture.paint(<Settings />);
  await userEvent.press(screen.getByRole("button", { name: "Sign out" }));
  await act(() => alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.());
  expect(screen.getByText(String(message))).toHaveProp("accessibilityLiveRegion", "assertive");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
});

it("disables sign-out while the teardown is outstanding", async () => {
  const alert = jest.spyOn(Alert, "alert");
  const fixture = accountFixture();
  fixture.disconnect.mockImplementation(() => new Promise(() => {}));
  await fixture.paint(<Settings />);
  await userEvent.press(screen.getByRole("button", { name: "Sign out" }));
  await act(() => alert.mock.calls.at(-1)?.[2]?.[1]?.onPress?.());
  expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
});

it("shows the injected store version and hands account management to Trakt", async () => {
  await accountFixture().paint(<Settings />);
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
