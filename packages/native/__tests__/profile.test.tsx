import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import "./support/screen-mocks";
import Profile from "../src/screens/Profile";
import { BarItems } from "../src/ui/BarItems";
import { TEST_IDS } from "../src/ui/test-ids";
import { SPACE } from "../src/ui/tokens";
import { accountFixture, STATS } from "./support/account";
import { atFontScale } from "./support/font-scale";
import { router } from "./support/native-ui";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions");

beforeEach(() => atFontScale(1));

it("shows identity and matching enabled-media totals, with both navigation destinations", async () => {
  const fixture = accountFixture();
  await fixture.paint(<Profile />);
  expect(await screen.findByText("Jo Taylor")).toBeVisible();
  expect(await screen.findByLabelText("81 episodes watched")).toBeVisible();
  expect(screen.getByText("8 hr 3 min")).toBeVisible();
  await act(() => fixture.prefs.getState().setMoviesEnabled(false));
  expect(screen.queryByTestId(TEST_IDS.profileStatMovies)).toBeNull();
  expect(screen.getByText("6 hr 18 min")).toBeVisible();
  await act(() => {
    fixture.prefs.getState().setMoviesEnabled(true);
    fixture.prefs.getState().setShowsEnabled(false);
  });
  expect(screen.queryByTestId(TEST_IDS.profileStatShows)).toBeNull();
  expect(screen.queryByTestId(TEST_IDS.profileEpisodeCount)).toBeNull();
  expect(screen.getByText("45 min")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "History" }));
  expect(router.push).toHaveBeenLastCalledWith("/history");
  await userEvent.press(screen.getByRole("button", { name: "Settings" }));
  expect(router.push).toHaveBeenLastCalledWith("/settings");
});

it("draws the same monogram in the bar and on Profile for an account without a photo", async () => {
  await accountFixture({
    loadUserProfile: () =>
      Promise.resolve({ displayName: "Jo Taylor", username: "jo", avatar: null }),
  }).paint(
    <>
      <BarItems onSync={jest.fn()} />
      <Profile />
    </>,
  );
  expect(await screen.findByText("Jo Taylor")).toBeVisible();
  expect(screen.getAllByText("JT", { includeHiddenElements: true })).toHaveLength(2);
  expect(screen.queryByTestId(TEST_IDS.avatarPhoto, { includeHiddenElements: true })).toBeNull();
});

it("falls back to the monogram when the photo fails to load", async () => {
  await accountFixture().paint(<Profile />);
  const photo = await screen.findByTestId(TEST_IDS.avatarPhoto, { includeHiddenElements: true });
  await fireEvent(photo, "error");
  expect(screen.queryByTestId(TEST_IDS.avatarPhoto, { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("JT", { includeHiddenElements: true })).toBeOnTheScreen();
});

/** How many stat tiles share a row on a 402 pt phone, by the grid's own flex rules. */
function statColumns(): number {
  const tiles = screen.getAllByTestId(/^profile-(episode-count|stat-movies|stat-shows)$/);
  const grid = StyleSheet.flatten(tiles[0]?.parent?.props["style"]);
  if (grid.flexWrap !== "wrap") return tiles.length;
  const basis = Number(StyleSheet.flatten(tiles[0]?.props["style"]).flexBasis);
  const row = 402 - 2 * SPACE.s4;
  return Math.min(tiles.length, Math.floor((row + SPACE.s2) / (basis + SPACE.s2)));
}

it.each([
  ["the default size", 1, 3],
  ["XXXL", 1.353, 2],
  ["AX5", 3.571, 1],
])("sets the stat tiles in fewer columns as text grows, at %s", async (_size, scale, columns) => {
  atFontScale(scale);
  await accountFixture().paint(<Profile />);
  await screen.findByTestId(TEST_IDS.profileEpisodeCount);
  expect(statColumns()).toBe(columns);
});

it("keeps identity and navigation usable while stats load", async () => {
  await accountFixture({
    loadStats: () => new Promise(() => {}),
    loadUserProfile: () => new Promise(() => {}),
  }).paint(<Profile />);
  expect(screen.getByLabelText("Loading stats")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
});

it("recovers stats independently of a failed profile request", async () => {
  const loadStats = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(STATS);
  await accountFixture({
    loadStats,
    loadUserProfile: () => Promise.reject(new Error("offline")),
  }).paint(<Profile />);
  expect(await screen.findByText("Couldn't load your stats")).toBeVisible();
  expect(screen.getByText("Connected")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("7 shows watched")).toBeVisible();
});

it("offers discovery when the enabled media has no watch history", async () => {
  const fixture = accountFixture({
    loadStats: () =>
      Promise.resolve({ ...STATS, episodes: { watched: 0, minutes: 0 }, shows: { watched: 0 } }),
  });
  fixture.prefs.getState().setMoviesEnabled(false);
  await fixture.paint(<Profile />);
  expect(await screen.findByText("Nothing tallied yet.")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Find something to watch" }));
  expect(router.dismissTo).toHaveBeenCalledWith("/search");
});
